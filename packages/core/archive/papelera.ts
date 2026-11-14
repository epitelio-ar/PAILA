// "Mandar el comprimido a la papelera" (decisión del 23/10): cuando TODO lo que tiene adentro un ZIP o RAR ya está afuera, en tu
// Música (es lo que la pantalla marca "Ya está afuera"), PAILA ofrece mandarlo a la papelera propia (_PAILA/papelera), con vista
// previa, Historial y restaurar. Nada se borra de verdad. Un rar partido va entero (todas sus partes). Nunca un sample pack.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { runMovesAsync } from '../ops/run'
import type { Step } from '../ops/types'
import { trashBatch } from '../safefs'
import { soloLectura, T as J } from '../journal'
import { purgedMsg } from '../purge'
import { pruneEmpty } from './extract'
import type { Archives } from '../archives'
import { T as R } from '../recovery.textos'
import { num, textos } from '@paila/shared/idioma'
import type { ArchiveTrashPlan, ArchiveTrashResult, HistoryDetailRow, HistoryEntry, HistoryUndoResult } from '@paila/shared/types'

/** Lo que guarda el diario de cada paso (si se corta, la recuperación anota igual el Historial). */
export interface TrashedData { batch: number; archiveId: number; rootId: number; rel: string; trashRel: string; size: number; mtime: number }
export interface RestoredData { id: number; archiveId: number | null }

const MB = (n: number) => `${num(Math.round(n / 1e5) / 10)} MB`
// Lo que se muestra (vista previa, Historial). La carpeta de la tanda en la papelera ("…_zip-…") no se traduce.
const P = textos({
  noEsta: { es: 'Ese comprimido ya no está en la biblioteca', en: 'That archive is no longer in the library' },
  samplePack: { es: 'Es un sample pack: PAILA no lo manda a la papelera ni lo toca', en: "It's a sample pack: PAILA doesn't send it to the trash or touch it" },
  noLeido: { es: 'Solo se manda a la papelera un comprimido que PAILA pudo leer entero', en: 'Only an archive PAILA could read all the way through goes to the trash' },
  faltanAfuera: { es: 'Todavía hay temas que no están afuera: el comprimido hace falta', en: "There are still tracks that aren't outside: the archive is still needed" },
  fueraMusica: { es: 'Una parte del comprimido está fuera de tu Música: no se toca', en: "Part of the archive is outside your Music: it isn't touched" },
  falta: { es: (n: string) => `Falta «${n}»: volvé a escanear`, en: (n: string) => `«${n}» is missing: scan again` },
  cambio: { es: 'El comprimido cambió desde la vista previa: no se tocó nada. Volvé a armarla.', en: 'The archive changed since the preview: nothing was touched. Make the preview again.' },
  sinDisco: { es: 'El disco no está conectado: no se tocó nada', en: "The disk isn't connected: nothing was touched" },
  yaNoEsta: { es: 'El comprimido ya no está donde estaba', en: "The archive isn't where it was anymore" },
  enPapelera: { es: 'Ya hay algo en la papelera con ese nombre', en: 'There is already something in the trash with that name' },
  yaRestauro: { es: 'Ya se restauró', en: 'Already restored' },
  discoNo: { es: 'El disco no está conectado', en: "The disk isn't connected" },
  resumen: {
    es: (name: string, others: number, mb: string) => `«${name}»${others > 0 ? ` (y sus otras ${others} partes)` : ''} ya estaba abierto afuera: se mandó a la papelera de PAILA (${mb})`,
    en: (name: string, others: number, mb: string) => `«${name}»${others > 0 ? ` (and its other ${others} ${others === 1 ? 'part' : 'parts'})` : ''} was already opened outside: it was sent to PAILA's trash (${mb})`,
  },
  aLaPapelera: { es: 'A la papelera', en: 'To the trash' },
  noEstaPapelera: { es: 'Ya no está en la papelera de PAILA', en: "It isn't in PAILA's trash anymore" },
  ocupado: { es: 'Ya hay otro archivo en el lugar original', en: 'There is already another file in the original place' },
})

/** Anota que un comprimido ya está en la papelera de PAILA (también lo usa la recuperación tras un corte). */
export function logArchiveTrashed(db: Db, d: TrashedData) {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO archive_trashed (batch, archive_id, root_id, rel, size, mtime, trash_rel, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.batch, d.archiveId, d.rootId, d.rel, d.size, d.mtime, d.trashRel, now)
  // ya no está donde estaba: sale de la lista (si vuelve, el escaneo lo vuelve a anotar)
  db.prepare('UPDATE archives SET missing_at = COALESCE(missing_at, ?) WHERE id = ?').run(now, d.archiveId)
}

/** Anota que un comprimido volvió de la papelera a su lugar. */
export function logArchiveRestored(db: Db, d: RestoredData) {
  db.prepare('UPDATE archive_trashed SET restored_at = ? WHERE id = ?').run(new Date().toISOString(), d.id)
  if (d.archiveId != null) db.prepare('UPDATE archives SET missing_at = NULL WHERE id = ?').run(d.archiveId)
}

/** Al abrir tras un corte en medio de mandarlo a la papelera (o de restaurarlo): termina de anotar o deja todo como estaba. */
export function recoverArchiveTrash(db: Db, e: { op: string; src: string; dst: string; data: unknown }, exists: (p: string) => boolean):
  { result: 'completado' | 'no-hecho' | 'revisar'; message: string; annotate?: () => void } {
  const name = path.basename(e.dst)
  if (e.op === 'zip-papelera') {
    if (exists(e.dst)) return { result: 'completado', message: R.yaEnPapeleraAnotado(name), annotate: () => logArchiveTrashed(db, e.data as TrashedData) }
    if (exists(e.src)) return { result: 'no-hecho', message: R.noMandado(name) }
    return { result: 'revisar', message: R.niMusicaNiPapelera(name) }
  }
  if (exists(e.dst)) return { result: 'completado', message: R.yaVolvio(name), annotate: () => logArchiveRestored(db, e.data as RestoredData) }
  if (exists(e.src)) return { result: 'no-hecho', message: R.noRestaurado(name) }
  return { result: 'revisar', message: R.niPapeleraNiLugar(name) }
}

export class ArchiveTrash {
  constructor(private arch: Archives, private rootPath: (rootId: number) => string | null) {}
  private get db() { return this.arch.db }

  /**
   * La vista previa: qué archivos van. Solo si no es un sample pack, PAILA lo pudo leer entero y todos sus temas ya están
   * afuera. No toca nada.
   */
  plan(archiveId: number): ArchiveTrashPlan {
    const s = this.arch.list().find((x) => x.id === archiveId)
    if (!s) throw new Error(P.noEsta)
    if (s.samplePack) throw new Error(P.samplePack)
    if (s.status !== 'ok') throw new Error(P.noLeido)
    if (!s.audio || s.outside !== s.audio) throw new Error(P.faltanAfuera)
    const { abs, listing } = this.arch.open(archiveId)
    const root = this.rootPath(s.rootId)!
    const files = (listing.volumes.length ? listing.volumes : [abs]).map((v) => {
      const rel = path.relative(root, v).split(path.sep).join('/')
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(P.fueraMusica)
      let st: fs.Stats
      try { st = fs.statSync(v) } catch { throw new Error(P.falta(path.basename(v))) }
      return { rel, size: st.size, mtime: Math.round(st.mtimeMs) }
    })
    return { archiveId, archiveRel: s.rel, rootId: s.rootId, files, bytes: files.reduce((n, f) => n + f.size, 0), audio: s.audio, outside: s.outside }
  }

  /** Lo manda a la papelera (llamar con el candado tomado). Si cambió desde la vista previa, no toca nada. Todo en una tanda. */
  async apply(plan: ArchiveTrashPlan): Promise<ArchiveTrashResult> {
    if (soloLectura()) throw new Error(J.soloLectura)
    // se vuelve a revisar todo: que siga estando afuera, que no sea un sample pack y que los archivos sean los de la vista previa
    const now = this.plan(plan.archiveId)
    const same = now.files.length === plan.files.length && now.files.every((f) => plan.files.some((p) => p.rel === f.rel && p.size === f.size && Math.abs(p.mtime - f.mtime) <= 2000))
    if (!same) throw new Error(P.cambio)
    const root = this.rootPath(plan.rootId)
    if (!root) throw new Error(P.sinDisco)
    const batch = Date.now()
    const folder = trashBatch(`zip-${batch}`)
    const steps: Step<TrashedData>[] = plan.files.map((f) => {
      const trashRel = `_PAILA/papelera/${folder}/${f.rel}`
      return { kind: 'sacar', op: 'zip-papelera', rootId: null, fileId: null, src: path.join(root, ...f.rel.split('/')), dst: path.join(root, ...trashRel.split('/')),
        size: f.size, mtime: f.mtime, data: { batch, archiveId: plan.archiveId, rootId: plan.rootId, rel: f.rel, trashRel, size: f.size, mtime: f.mtime },
        missing: P.yaNoEsta, taken: P.enPapelera }
    })
    const r = await runMovesAsync<TrashedData>(this.db, steps, { rootPath: this.rootPath, annotate: (s) => logArchiveTrashed(this.db, s.data) })
    const failed = r.failed.map((f) => ({ name: path.posix.basename(f.step.data.rel), error: f.error }))
    // un rar partido a medias queda inservible: si alguna parte no pudo, las que ya se movieron vuelven
    if (failed.length && r.done.length) {
      const back = await this.undo(batch)
      return { batch, done: 0, failed: [...failed, ...back.failed.map((f) => ({ name: path.posix.basename(f.rel), error: f.error }))], bytes: 0 }
    }
    return { batch, done: r.done.length, failed, bytes: r.done.reduce((n, s) => n + s.data.size, 0) }
  }

  /** Las tandas, para el Historial (kind 'comprimido-papelera'). */
  history(): HistoryEntry[] {
    const rows = this.db.prepare(`SELECT batch, root_id AS rootId, MIN(rel) AS rel, MIN(at) AS at, COUNT(*) AS n, SUM(size) AS bytes,
      SUM(restored_at IS NOT NULL) AS restored, MIN(purged_at) AS purged FROM archive_trashed GROUP BY batch ORDER BY batch`).all() as
      { batch: number; rootId: number; rel: string; at: string; n: number; bytes: number; restored: number; purged: string | null }[]
    return rows.map((b) => {
      const undone = b.restored === b.n
      const whyNot = undone ? P.yaRestauro : b.purged ? purgedMsg(b.purged) : !this.rootPath(b.rootId) ? P.discoNo : null
      const name = path.posix.basename(b.rel)
      return { kind: 'comprimido-papelera' as const, id: b.batch, at: b.at, files: b.n, undone, canUndo: !whyNot, whyNot,
        summary: P.resumen(name, b.n - 1, MB(b.bytes)), note: null }
    })
  }

  historyDetail(batch: number): HistoryDetailRow[] {
    const rs = this.db.prepare('SELECT rel, restored_at IS NOT NULL AS restored FROM archive_trashed WHERE batch = ? ORDER BY rel').all(batch) as { rel: string; restored: number }[]
    return rs.map((r) => ({ name: path.posix.basename(r.rel), folder: path.posix.dirname(r.rel), what: P.aLaPapelera, before: null, after: null, undone: !!r.restored }))
  }

  /** Restaurar: cada archivo vuelve a su lugar. Si ya hay otro ahí, no se pisa nada. */
  async undo(batch: number): Promise<HistoryUndoResult> {
    const rs = this.db.prepare('SELECT id, archive_id AS archiveId, root_id AS rootId, rel, trash_rel AS trashRel, purged_at AS purged FROM archive_trashed WHERE batch = ? AND restored_at IS NULL').all(batch) as
      { id: number; archiveId: number | null; rootId: number; rel: string; trashRel: string; purged: string | null }[]
    const out: HistoryUndoResult = { done: 0, failed: [] }
    const steps: Step<RestoredData>[] = []
    for (const r of rs) {
      const root = this.rootPath(r.rootId)
      if (!root) { out.failed.push({ rel: r.rel, error: P.discoNo }); continue }
      if (r.purged) { out.failed.push({ rel: r.rel, error: purgedMsg(r.purged) }); continue }
      steps.push({ kind: 'sacar', op: 'zip-restaurar', rootId: null, fileId: null, src: path.join(root, ...r.trashRel.split('/')), dst: path.join(root, ...r.rel.split('/')),
        data: { id: r.id, archiveId: r.archiveId }, missing: P.noEstaPapelera, taken: P.ocupado })
    }
    const r = await runMovesAsync<RestoredData>(this.db, steps, { rootPath: this.rootPath, annotate: (s) => logArchiveRestored(this.db, s.data),
      after: (s) => { const root = rs.length ? this.rootPath(rs[0].rootId) : null; if (root) pruneEmpty(root, path.dirname(s.src)) } })
    out.done = r.done.length
    out.failed.push(...r.failed.map((f) => ({ rel: path.basename(f.step.dst!), error: f.error })))
    return out
  }
}
