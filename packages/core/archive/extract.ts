// "Sacar al lado": la música de un ZIP o un RAR (con sus tapas, .cue y textos) va a una carpeta al lado del comprimido, con
// vista previa, Historial y deshacer. Primero se descomprime a una carpeta de trabajo de PAILA en el mismo disco
// (_PAILA/abriendo) y después el motor de operaciones lo mueve a su lugar sin pisar nada, con diario y verificación. El
// comprimido no se toca. Deshacer manda lo sacado a la papelera de PAILA (_PAILA/papelera): nada se borra de verdad.
// Los sample packs nunca se sacan.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { runMovesAsync } from '../ops/run'
import type { Step } from '../ops/types'
import { trashBatch } from '../safefs'
import { soloLectura, T as J } from '../journal'
import { extractEntries, type LibRunner } from './read'
import { isAudioName, isCompanion, isJunk, safeRel } from './names'
import type { Archives } from '../archives'
import { T as R } from '../recovery.textos'
import { cant, textos } from '@paila/shared/idioma'
import type { ArchiveExtractPlan, ArchiveExtractResult, HistoryDetailRow, HistoryEntry, HistoryUndoResult } from '@paila/shared/types'

/** Carpeta de trabajo (dentro de la carpeta de música, en _PAILA, que el escaneo no recorre). */
export const STAGING = '_PAILA/abriendo'

/** Lo que guarda el diario de cada paso (si se corta, la recuperación anota igual el Historial: `logExtracted`). */
export interface ExtractData { batch: number; archiveId: number; archiveRel: string; rootId: number; rel: string }
export interface UndoData { id: number; rootId: number; rel: string; trashRel: string }

const archivos = (n: number): string => cant(n, P.archivo, P.archivos)
// Lo que se muestra (vista previa, Historial). La carpeta que se arma al lado (el nombre del comprimido o "Comprimido") y los
// nombres de lo que se saca son los de adentro del ZIP: no se traducen.
const P = textos({
  archivo: { es: 'archivo', en: 'file' }, archivos: { es: 'archivos', en: 'files' },
  samplePack: { es: 'Es un sample pack: PAILA no lo saca ni lo toca', en: "It's a sample pack: PAILA doesn't take it out or touch it" },
  noAbre: { es: 'No se puede abrir', en: "It can't be opened" },
  yaAfuera: { es: 'Ya está afuera (el mismo archivo)', en: 'Already outside (the same file)' },
  cambio: { es: 'El comprimido cambió desde la vista previa: no se tocó nada. Volvé a armarla.', en: 'The archive changed since the preview: nothing was touched. Make the preview again.' },
  sinDisco: { es: 'El disco no está conectado: no se tocó nada', en: "The disk isn't connected: nothing was touched" },
  sinEspacio: { es: 'Falta espacio en el disco para sacarlo: no se tocó nada', en: 'Not enough space on the disk to take it out: nothing was touched' },
  descomprimiendo: { es: 'Descomprimiendo…', en: 'Decompressing…' },
  noSalio: { es: 'No salió del comprimido', en: "It didn't come out of the archive" },
  mismoNombre: { es: 'Ya hay un archivo con ese nombre', en: 'There is already a file with that name' },
  yaDeshizo: { es: 'Ya se deshizo', en: 'Already undone' },
  discoNo: { es: 'El disco no está conectado', en: "The disk isn't connected" },
  resumen: {
    es: (n: number, zip: string, dir: string) => `Se ${n === 1 ? 'sacó' : 'sacaron'} ${archivos(n)} de «${zip}» a la carpeta «${dir}» (el comprimido quedó igual)`,
    en: (n: number, zip: string, dir: string) => `Took ${archivos(n)} out of «${zip}» into the folder «${dir}» (the archive stayed the same)`,
  },
  volvieron: { es: (n: number) => `${archivos(n)} ya ${n === 1 ? 'volvió' : 'volvieron'} a la papelera`, en: (n: number) => `${archivos(n)} already went back to the trash` },
  sacado: { es: 'Sacado del comprimido', en: 'Taken out of the archive' },
  cambiaste: { es: 'Lo cambiaste después de sacarlo: queda en tu Música', en: 'You changed it after taking it out: it stays in your Music' },
  movido: { es: 'Ya no está donde se sacó (¿lo moviste?)', en: "It's no longer where it was taken out to (did you move it?)" },
  enPapelera: { es: 'Ya hay algo en la papelera con ese nombre', en: 'There is already something in the trash with that name' },
})
const join = (...p: string[]) => p.filter(Boolean).join('/')

/** Anota en el Historial un archivo que ya quedó afuera (lo usa también la recuperación tras un corte). */
export function logExtracted(db: Db, d: ExtractData, abs: string) {
  let st: fs.Stats | null = null
  try { st = fs.statSync(abs) } catch { /* lo anota igual */ }
  db.prepare('INSERT INTO archive_extracted (batch, archive_id, archive_rel, root_id, rel, size, mtime, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.batch, d.archiveId, d.archiveRel, d.rootId, d.rel, st?.size ?? 0, st ? Math.round(st.mtimeMs) : 0, new Date().toISOString())
}

/** Anota que un archivo sacado ya volvió a la papelera de PAILA (deshacer). */
export function logUnextracted(db: Db, d: UndoData) {
  const now = new Date().toISOString()
  db.prepare('UPDATE archive_extracted SET undone_at = ?, trash_rel = ? WHERE id = ?').run(now, d.trashRel, d.id)
  // si ya se había escaneado, sale de la biblioteca como "ya no está" (lo mismo que haría el escaneo)
  db.prepare('UPDATE files SET missing_at = COALESCE(missing_at, ?) WHERE root_id = ? AND rel_path = ?').run(now, d.rootId, d.rel)
}

/**
 * Al abrir tras un corte en medio de sacar (o de deshacer): si el archivo ya llegó, se termina de anotar; si quedó en la
 * carpeta de trabajo, era una copia de PAILA y se saca (el comprimido sigue igual: se puede volver a sacar).
 */
export function recoverExtract(db: Db, e: { op: string; src: string; dst: string; data: unknown }, exists: (p: string) => boolean):
  { result: 'completado' | 'no-hecho' | 'revisar'; message: string; annotate?: () => void; after?: () => void } {
  const name = path.basename(e.dst)
  if (e.op === 'abrir') {
    if (exists(e.dst)) return { result: 'completado', message: R.yaSacado(name), annotate: () => logExtracted(db, e.data as ExtractData, e.dst),
      after: () => { if (exists(e.src)) fs.rmSync(e.src, { force: true }) } }
    if (exists(e.src)) return { result: 'no-hecho', message: R.noSacado(name), after: () => fs.rmSync(e.src, { force: true }) }
    return { result: 'no-hecho', message: R.noSacado(name) }
  }
  if (exists(e.dst)) return { result: 'completado', message: R.yaEnPapelera(name), annotate: () => logUnextracted(db, e.data as UndoData) }
  if (exists(e.src)) return { result: 'no-hecho', message: R.noMandado(name) }
  return { result: 'revisar', message: R.niMusicaNiPapelera(name) }
}

/** Saca carpetas vacías desde `dir` hacia arriba, sin pasar de `stop`. Nunca algo con contenido. */
export function pruneEmpty(stop: string, dir: string) {
  for (let cur = dir; cur.length > stop.length && cur.toLowerCase().startsWith(stop.toLowerCase()); cur = path.dirname(cur)) {
    try { if (fs.readdirSync(cur).length) return; fs.rmdirSync(cur) } catch { return }
  }
}

export class ArchiveExtract {
  constructor(private arch: Archives, private rootPath: (rootId: number) => string | null) {}
  private get db() { return this.arch.db }

  /** La vista previa: a qué carpeta va cada archivo. No toca nada. */
  plan(archiveId: number): ArchiveExtractPlan {
    const { row, abs, listing } = this.arch.open(archiveId)
    if (row.samplePack) throw new Error(P.samplePack)
    if (row.status === 'clave' || row.status === 'roto') throw new Error(row.note ?? P.noAbre)
    const root = this.rootPath(row.rootId)!
    const dir = path.posix.dirname(row.rel) === '.' ? '' : path.posix.dirname(row.rel)
    const skipped: ArchiveExtractPlan['skipped'] = []
    const wanted = listing.entries.filter((e) => !e.dir && !isJunk(e.name) && (isAudioName(e.name) || isCompanion(e.name)))
    const ok = wanted.filter((e) => { if (e.blocked) skipped.push({ name: e.name, why: e.blocked }); return !e.blocked })
    const rels = ok.map((e) => ({ e, rel: safeRel(e.name) })).filter((x): x is { e: typeof ok[number]; rel: string } => !!x.rel)
    // todo adentro de una sola carpeta ("Disco/01.mp3"): esa carpeta va al lado; si no, una con el nombre del comprimido
    const tops = new Set(rels.map((x) => x.rel.split('/')[0].toLowerCase()))
    const nested = rels.length > 0 && tops.size === 1 && rels.every((x) => x.rel.includes('/'))
    const stem = safeRel(path.posix.basename(row.rel).replace(/\.(zip|rar)$/i, '').replace(/\.part0*1$/i, '')) ?? 'Comprimido'
    const items: ArchiveExtractPlan['items'] = []
    const taken = new Set<string>()
    for (const { e, rel } of rels) {
      let dest = join(dir, nested ? rel : `${stem}/${rel}`)
      const at = (r: string) => path.join(root, ...r.split('/'))
      if (fs.existsSync(at(dest))) {
        if (fs.statSync(at(dest)).size === e.size) { skipped.push({ name: e.name, why: P.yaAfuera }); continue }
        const ext = path.posix.extname(dest), base = dest.slice(0, dest.length - ext.length)
        for (let i = 2; fs.existsSync(at(dest)) || taken.has(dest.toLowerCase()); i++) dest = `${base} (${i})${ext}`
      }
      taken.add(dest.toLowerCase())
      items.push({ idx: e.index, name: e.name, rel: dest, size: e.size, audio: isAudioName(e.name) })
    }
    const folderRel = join(dir, nested ? rels[0].rel.split('/')[0] : stem)
    let free: number | null = null
    try { const s = fs.statfsSync(root); free = Number(s.bavail) * Number(s.bsize) } catch { /* no se sabe */ }
    const st = fs.statSync(abs)
    return { archiveId, archiveRel: row.rel, rootId: row.rootId, folderRel, folderExists: fs.existsSync(path.join(root, ...folderRel.split('/'))),
      items, skipped, bytes: items.reduce((s, i) => s + i.size, 0), free, size: st.size, mtime: Math.round(st.mtimeMs) }
  }

  /**
   * Saca lo de la vista previa (llamar con el candado tomado). Si el comprimido cambió desde la vista previa, no hace nada.
   * Todo va en una tanda del Historial; lo que falla se saltea con el motivo.
   */
  async apply(plan: ArchiveExtractPlan, on: { progress?: (done: number, total: number, current: string) => void; cancelled?: () => boolean; runner?: LibRunner } = {}): Promise<ArchiveExtractResult> {
    // abierta solo para mirar: ni siquiera la carpeta de trabajo (está adentro de la Música)
    if (soloLectura()) throw new Error(J.soloLectura)
    const { row, listing } = this.arch.open(plan.archiveId)
    if (row.size !== plan.size || Math.abs(row.mtime - plan.mtime) > 2000) throw new Error(P.cambio)
    const root = this.rootPath(plan.rootId)
    if (!root) throw new Error(P.sinDisco)
    let free = Infinity
    try { const s = fs.statfsSync(root); free = Number(s.bavail) * Number(s.bsize) } catch { /* sigue */ }
    if (plan.bytes * 1.05 + 50e6 > free) throw new Error(P.sinEspacio)
    const stagingRoot = path.join(root, ...STAGING.split('/'))
    // restos de una vez anterior que se cortó (copias de PAILA, sin nada pendiente en el diario)
    const open = (this.db.prepare("SELECT COUNT(*) AS n FROM op_journal WHERE op = 'abrir' AND recovered_at IS NULL").get() as { n: number }).n
    if (!open) fs.rmSync(stagingRoot, { recursive: true, force: true })
    const stage = path.join(stagingRoot, trashBatch('tanda'))
    const batch = Date.now()
    const failed: ArchiveExtractResult['failed'] = []
    const ac = new AbortController()
    const tick = setInterval(() => { if (on.cancelled?.()) ac.abort() }, 200)
    try {
      on.progress?.(0, plan.items.length, P.descomprimiendo)
      const out = await extractEntries(listing, plan.items.map((i) => ({ index: i.idx, dest: path.join(stage, ...i.rel.split('/')) })), { runner: on.runner, signal: ac.signal })
      const steps: Step<ExtractData>[] = []
      plan.items.forEach((i, k) => {
        if (out[k].error) { failed.push({ name: i.name, error: out[k].error! }); return }
        const src = path.join(stage, ...i.rel.split('/'))
        const when = listing.entries[i.idx]?.mtime
        if (when) try { fs.utimesSync(src, new Date(when), new Date(when)) } catch { /* queda con la fecha de hoy */ }
        steps.push({ kind: 'sacar', op: 'abrir', rootId: null, fileId: null, src, dst: path.join(root, ...i.rel.split('/')),
          data: { batch, archiveId: plan.archiveId, archiveRel: plan.archiveRel, rootId: plan.rootId, rel: i.rel },
          missing: P.noSalio, taken: P.mismoNombre })
      })
      const r = await runMovesAsync<ExtractData>(this.db, steps, { rootPath: this.rootPath, annotate: (s) => logExtracted(this.db, s.data, s.dst!) },
        { onStep: (done, total, s) => on.progress?.(done, total, path.basename(s.dst!)), isCancelled: on.cancelled })
      failed.push(...r.failed.map((f) => ({ name: f.step.data.rel, error: f.error })))
      return { batch, done: r.done.length, failed, folder: plan.folderRel }
    } finally {
      clearInterval(tick)
      fs.rmSync(stage, { recursive: true, force: true }) // solo copias de PAILA que no llegaron a moverse
      pruneEmpty(path.join(root, '_PAILA'), stagingRoot)
    }
  }

  /** Las tandas, para el Historial (kind 'comprimido'). */
  history(): HistoryEntry[] {
    const rows = this.db.prepare(`SELECT batch, root_id AS rootId, MIN(archive_rel) AS archive, MIN(rel) AS rel, MIN(at) AS at, COUNT(*) AS n,
      SUM(undone_at IS NOT NULL) AS undone FROM archive_extracted GROUP BY batch ORDER BY batch`).all() as { batch: number; rootId: number; archive: string; rel: string; at: string; n: number; undone: number }[]
    return rows.map((b) => {
      const undone = b.undone === b.n
      const whyNot = undone ? P.yaDeshizo : !this.rootPath(b.rootId) ? P.discoNo : null
      const folder = path.posix.dirname(b.rel)
      return { kind: 'comprimido' as const, id: b.batch, at: b.at, files: b.n, undone, canUndo: !whyNot, whyNot,
        summary: P.resumen(b.n, path.posix.basename(b.archive), path.posix.basename(folder)),
        note: !undone && b.undone ? P.volvieron(b.undone) : null }
    })
  }

  historyDetail(batch: number): HistoryDetailRow[] {
    const rs = this.db.prepare('SELECT rel, archive_rel AS archive, undone_at IS NOT NULL AS undone FROM archive_extracted WHERE batch = ? ORDER BY rel').all(batch) as { rel: string; archive: string; undone: number }[]
    return rs.map((r) => ({ name: path.posix.basename(r.rel), folder: path.posix.dirname(r.rel), what: P.sacado, before: path.posix.basename(r.archive), after: path.posix.dirname(r.rel), undone: !!r.undone }))
  }

  /** Deshacer: lo sacado (si sigue como quedó) va a la papelera de PAILA. Lo que cambiaste después, queda donde está. */
  async undo(batch: number): Promise<HistoryUndoResult> {
    const rs = this.db.prepare('SELECT id, root_id AS rootId, rel, size, mtime FROM archive_extracted WHERE batch = ? AND undone_at IS NULL').all(batch) as { id: number; rootId: number; rel: string; size: number; mtime: number }[]
    const out: HistoryUndoResult = { done: 0, failed: [] }
    const folder = trashBatch(`comprimido-${batch}`)
    const steps: Step<UndoData>[] = []
    for (const r of rs) {
      const root = this.rootPath(r.rootId)
      if (!root) { out.failed.push({ rel: r.rel, error: P.discoNo }); continue }
      const abs = path.join(root, ...r.rel.split('/'))
      let st: fs.Stats | null = null
      try { st = fs.statSync(abs) } catch { /* ya no está */ }
      if (st && (st.size !== r.size || Math.abs(st.mtimeMs - r.mtime) > 2000)) { out.failed.push({ rel: r.rel, error: P.cambiaste }); continue }
      const trashRel = `_PAILA/papelera/${folder}/${r.rel}`
      steps.push({ kind: 'sacar', op: 'deshacer-abrir', rootId: null, fileId: null, src: abs, dst: path.join(root, ...trashRel.split('/')),
        data: { id: r.id, rootId: r.rootId, rel: r.rel, trashRel }, missing: P.movido, taken: P.enPapelera })
    }
    const r = await runMovesAsync<UndoData>(this.db, steps, { rootPath: this.rootPath, annotate: (s) => logUnextracted(this.db, s.data),
      after: (s) => { const root = this.rootPath(s.data.rootId); if (root) pruneEmpty(root, path.dirname(s.src)) } })
    out.done = r.done.length
    out.failed.push(...r.failed.map((f) => ({ rel: f.step.data.rel, error: f.error })))
    return out
  }
}
