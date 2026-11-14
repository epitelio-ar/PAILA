// Recuperación al abrir PAILA: si la vez anterior se cortó en medio de una operación (luz, cuelgue, cierre forzado),
// el diario (core/journal.ts) tiene anotado lo que quedó a medias. Acá se mira dónde quedó cada archivo y se deja todo
// consistente: si ya estaba en su lugar nuevo se completa la anotación; si no se llegó a mover, se da por no hecho; si una
// escritura de tags quedó a medias, el archivo vuelve a como estaba (core/recovery-tags.ts). Nunca se borra un
// archivo de la persona: lo que haya que sacar del medio va a la papelera de PAILA.
import fs from 'node:fs'
import path from 'node:path'
import { OpJournal, soloLectura, type JournalEntry, type RecoveryResult } from './journal'
import { logMove, logMoveUndo, type MoveData } from './organizer'
import { logRestore, logTrash, type TrashData } from './trash'
import { logReplaceUndo, type ReplaceUndoData } from './replace'
import { markPurged } from './purge'
import { logAdded, type AddData } from './inboxadd'
import { recoverExtract } from './archive/extract'
import { recoverArchiveTrash } from './archive/papelera'
import { recoverStems } from './stems/separar'
import { moveNoClobber, trashBatch } from './safefs'
import { Playlists } from './playlists'
import type { Db } from './db'
import { OP_KIND } from './ops/types'
import { recoverCopy } from './ops/copy'
import { recoverTags } from './recovery-tags'
import { workDir } from './changes-file'
import type { RecoveryItem, RecoveryReport } from '@paila/shared/types'
import { OP_NAME, T } from './recovery.textos'

export interface RecoveryDeps {
  /** Carpeta de música (ruta de hoy) de un disco conectado, o null. */
  rootPath: (rootId: number) => string | null
  ffmpeg: string
  /** Carpeta de las copias de resguardo (userData/resguardo): lo que quede ahí sin anotación pendiente se limpia. */
  backupDir?: string
  /** Carpetas de trabajo de PAILA (conversiones a medio hacer): se vacían. */
  workDirs?: string[]
  /** Donde la Bandeja abre los ZIP: lo que quede ahí es una copia de PAILA (no se vacía al abrir: la Bandeja la sigue usando). */
  inboxWork?: string
}

/** El nombre del archivo de una ruta relativa ("/") o completa de Windows ("\\"). */
const fileName = (p: string | null) => (p ?? '').split(/[\\/]/).pop() ?? ''

/** ¿Existe exactamente con ese nombre? (Windows no distingue mayúsculas: "a.mp3" y "A.mp3" serían el mismo archivo.) */
function existsExact(p: string): boolean {
  try { return fs.readdirSync(path.dirname(p)).includes(path.basename(p)) } catch { return false }
}

/** Saca carpetas vacías desde `dir` hacia arriba, sin pasar de `root`. Nunca algo con contenido. */
function pruneEmpty(root: string, dir: string) {
  let cur = dir
  while (cur.length > root.length && cur.toLowerCase().startsWith(root.toLowerCase())) {
    try { if (fs.readdirSync(cur).length) return; fs.rmdirSync(cur) } catch { return }
    cur = path.dirname(cur)
  }
}

/**
 * Qué hacer con una operación a medias. `annotate` = lo que faltaba guardar en la base (se guarda junto con la
 * resolución, en una sola transacción: un segundo corte no lo anota dos veces); `after` = limpieza que va recién cuando
 * la resolución ya quedó anotada.
 */
interface Outcome { result: RecoveryResult; message: string; annotate?: () => void; after?: () => void }

export interface RecoverOpts {
  /**
   * Con la app abierta (cuando vuelve un disco): solo las anotaciones de estos discos (y las de la Bandeja, que no son de
   * ningún disco de la biblioteca), y sin vaciar las carpetas de trabajo ni las copias de resguardo, que una operación en
   * segundo plano podría estar usando. Tiene que correr con el candado de operaciones tomado.
   */
  live?: { roots: number[] }
}

/**
 * Revisa el diario y resuelve lo que quedó a medias. Correr al abrir, antes de escanear o analizar, o con la app abierta
 * cuando vuelve un disco (`opts.live`), siempre sin ninguna operación en marcha. Devuelve el aviso para la persona.
 */
export async function recover(db: Db, deps: RecoveryDeps, opts: RecoverOpts = {}): Promise<RecoveryReport> {
  const bootAt = new Date().toISOString()
  if (soloLectura()) return report(db, bootAt) // abierta solo para mirar: no termina ni vuelve atrás nada en el disco
  const journal = new OpJournal(db)
  const playlists = new Playlists(db, () => null)
  const live = opts.live ? new Set(opts.live.roots) : null
  for (const e of journal.open()) {
    if (live && e.rootId != null && !live.has(e.rootId)) continue
    let out: Outcome | null
    try { out = await resolveOne(db, deps, playlists, e) } catch (err) {
      out = { result: 'revisar', message: T.noResuelto(fileName(e.dst ?? e.src), (err as Error).message) }
    }
    if (!out) continue // disco desconectado: se vuelve a mirar la próxima vez
    journal.resolve(e.id, out.result, out.message, out.annotate)
    try { out.after?.() } catch { /* era solo limpieza */ }
  }
  if (!live) cleanLeftovers(db, deps)
  return report(db, bootAt)
}

/**
 * Los discos (carpetas de música) que tienen algo a medias sin resolver, y si hay algo a medias de la Bandeja cuyo disco
 * ya está (lo de la Bandeja guarda rutas completas: alcanza con mirar si está la unidad).
 */
export function pendingRoots(db: Db): { roots: number[]; outside: boolean } {
  const rows = db.prepare('SELECT op, root_id AS r, src_rel AS src, dst_rel AS dst FROM op_journal WHERE recovered_at IS NULL').all() as { op: string; r: number | null; src: string | null; dst: string | null }[]
  const drive = (p: string | null) => !!p && fs.existsSync(path.parse(p).root)
  // una copia hacia afuera se resuelve con solo mirar el destino (el tema de origen no se tocó)
  return { roots: [...new Set(rows.filter((x) => x.r != null).map((x) => x.r!))], outside: rows.some((x) => x.r == null && (x.op === 'copia' || drive(x.src)) && drive(x.dst)) }
}

async function resolveOne(db: Db, deps: RecoveryDeps, playlists: Playlists, e: JournalEntry): Promise<Outcome | null> {
  const root = e.rootId != null ? deps.rootPath(e.rootId) : null
  if (e.rootId != null && !root) return null
  const abs = (rel: string) => path.join(root!, ...rel.split('/'))
  const base = fileName
  const kind = OP_KIND[e.op] as string | undefined

  // lo que PAILA copiaba afuera (pendrive, celular, archivos de otros programas): la copia temporal es de PAILA
  if (kind === 'copiar') return recoverCopy(db, { fileId: e.fileId, src: e.src, dst: e.dst!, data: e.data, startedAt: e.startedAt }, { aMedias: T.copiaAMedias, hecha: T.copiaHecha, noHecha: T.copiaNoHecha })

  // fuera de la biblioteca (la Bandeja): rutas completas; si su disco no está, se mira la próxima vez
  if (kind === 'sacar') {
    const src = e.src!, dst = e.dst!
    if (!fs.existsSync(path.parse(src).root) || !fs.existsSync(path.parse(dst).root)) return null
    if (e.op === 'abrir' || e.op === 'deshacer-abrir') return recoverExtract(db, { op: e.op, src, dst, data: e.data }, existsExact)
    if (e.op === 'zip-papelera' || e.op === 'zip-restaurar') return recoverArchiveTrash(db, { op: e.op, src, dst, data: e.data }, existsExact)
    if (e.op === 'separar' || e.op === 'deshacer-separar') return recoverStems(db, { op: e.op, src, dst, data: e.data }, existsExact)
    // un tema que la Bandeja pasaba a tu Música: además se anota en el Historial (con deshacer)
    const added = (e.data as Partial<AddData> | null)?.added
    const dir = path.basename(path.dirname(dst)) // usados/ o no-sirvió/: nombres de carpetas, no se traducen
    const done = () => { if (added) logAdded(db, e.data as AddData); else db.prepare('DELETE FROM inbox_items WHERE path = ?').run(src) }
    if (existsExact(src) && existsExact(dst)) {
      // entre discos: la copia ya estaba y faltaba sacar el original. Si quedó igual, el original es de más.
      if (fs.statSync(src).size !== fs.statSync(dst).size) { fs.rmSync(dst, { force: true }); return { result: 'no-hecho', message: T.bandejaAMedias(base(src), dir) } }
      const workDir = !!deps.inboxWork && path.resolve(src).toLowerCase().startsWith(path.resolve(deps.inboxWork).toLowerCase() + path.sep)
      if (workDir) return { result: 'completado', message: T.yaEstabaEn(base(src), dir), annotate: done, after: () => fs.rmSync(src, { force: true }) }
      return { result: 'revisar', message: T.enLasDos(base(src), dir) }
    }
    if (existsExact(src)) return { result: 'no-hecho', message: T.sigueBandeja(base(src)) }
    if (existsExact(dst)) return { result: 'completado', message: T.yaEstabaEn(base(src), dir), annotate: done }
    return { result: 'revisar', message: T.niBandejaNi(base(src), dir) }
  }

  switch (e.op) {
    case 'organizar': case 'limpieza': case 'deshacer-organizar': case 'papelera': case 'restaurar': {
      const src = abs(e.src!), dst = abs(e.dst!), name = base(e.src)
      if (existsExact(src)) { pruneEmpty(root!, path.dirname(dst)); return { result: 'no-hecho', message: T.noSeMovio(name) } }
      if (!existsExact(dst)) return { result: 'revisar', message: T.niUnoNiOtro(name, e.src!, e.dst!) }
      // El archivo ya está en su lugar nuevo: falta anotarlo (el corte fue justo después de mover).
      const annotate = () => {
        if (e.op === 'papelera') logTrash(db, playlists, e.data as TrashData)
        else if (e.op === 'restaurar') logRestore(db, playlists, e.data as { logId: number; fileId: number; moves: { playlist_id: number; position: number }[] })
        else if (e.op === 'deshacer-organizar') logMoveUndo(db, e.data as { logId: number; fileId: number | null; fromRel: string })
        else logMove(db, e.data as MoveData)
      }
      const where = e.op === 'papelera' ? T.aLaPapelera : e.op === 'restaurar' ? T.aSuLugar : T.a(e.dst!)
      return { result: 'completado', message: T.yaSeMovio(name, where), annotate }
    }

    case 'tags': case 'deshacer-tags': return recoverTags(e, root!, deps.ffmpeg)

    case 'reemplazo': {
      const d = e.data as { replacementId: number; oldRel: string; oldTrashRel: string; newRel: string }
      if (!existsExact(abs(d.oldTrashRel))) return { result: 'no-hecho', message: T.noReemplazo(base(d.oldRel)) }
      // A medias: el original está en la papelera y la copia nueva (si llegó a copiarse) puede estar incompleta. Se vuelve atrás:
      // la copia nueva va a la papelera (nunca se borra) y el original vuelve a su lugar. El archivo elegido sigue donde estaba.
      if (fs.existsSync(abs(d.newRel))) moveNoClobber(abs(d.newRel), abs(`_PAILA/papelera/${trashBatch(`reemplazo-${d.replacementId}-recuperado`)}/${d.newRel}`))
      moveNoClobber(abs(d.oldTrashRel), abs(d.oldRel))
      return { result: 'vuelto-atras', message: T.reemplazoVuelto(base(d.oldRel)) }
    }

    case 'deshacer-reemplazo': {
      const d = e.data as ReplaceUndoData
      if (!existsExact(abs(d.newTrashRel))) return { result: 'no-hecho', message: T.noDeshizo(base(d.curRel)) }
      if (existsExact(abs(d.oldTrashRel))) {
        // Solo se había hecho el primer paso: el archivo de hoy vuelve a su lugar.
        moveNoClobber(abs(d.newTrashRel), abs(d.curRel))
        return { result: 'vuelto-atras', message: T.deshacerVuelto(base(d.curRel)) }
      }
      if (!existsExact(abs(d.target))) return { result: 'revisar', message: T.sinOriginal(base(d.curRel), d.target) }
      return { result: 'completado', message: T.yaDeshecho(base(d.curRel)), annotate: () => logReplaceUndo(db, d) }
    }

    case 'vaciar': {
      const rels = (e.data as { rels: string[] }).rels
      const gone = rels.filter((r) => !fs.existsSync(abs(r)))
      return {
        result: 'completado', annotate: () => markPurged(db, e.rootId!, gone),
        message: T.vaciando(gone.length, rels.length),
      }
    }
  }
  return { result: 'revisar', message: T.desconocida(e.op) }
}

/** Copias de resguardo sin anotación pendiente y conversiones a medio hacer: son archivos de trabajo de PAILA, no de la persona. */
function cleanLeftovers(db: Db, deps: RecoveryDeps) {
  if (deps.backupDir && fs.existsSync(deps.backupDir)) {
    // se conservan las que siguen anotadas (disco desconectado) y las que la recuperación no pudo usar (para revisar a mano)
    const keep = new Set((db.prepare("SELECT backup FROM op_journal WHERE backup IS NOT NULL AND (recovered_at IS NULL OR result = 'revisar')").all() as { backup: string }[])
      .map((r) => path.resolve(r.backup).toLowerCase()))
    for (const n of fs.readdirSync(deps.backupDir)) {
      const p = path.join(deps.backupDir, n)
      if (!keep.has(path.resolve(p).toLowerCase())) fs.rmSync(p, { force: true })
    }
  }
  for (const dir of deps.workDirs ?? []) {
    try { for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n), { force: true }) } catch { /* no existe */ }
  }
  // los temporales de las escrituras de tags (_PAILA/escribiendo de cada disco): sin anotación pendiente, son de PAILA y sobran
  const busy = new Set((db.prepare('SELECT data FROM op_journal WHERE recovered_at IS NULL AND data IS NOT NULL').all() as { data: string }[])
    .map((r) => { try { return String((JSON.parse(r.data) as { tmp?: string }).tmp ?? '').toLowerCase() } catch { return '' } }))
  for (const { id } of db.prepare('SELECT id FROM roots').all() as { id: number }[]) {
    const root = deps.rootPath(id)
    if (!root) continue
    const dir = workDir(root)
    try { for (const n of fs.readdirSync(dir)) if (!busy.has(path.join(dir, n).toLowerCase())) fs.rmSync(path.join(dir, n), { force: true }) } catch { /* no existe */ }
  }
}

/**
 * Lo que la persona todavía no vio: lo resuelto (sin "Entendido") y lo que sigue pendiente porque falta un disco.
 * `bootAt`: cuándo se abrió PAILA; lo empezado después es una operación en marcha ahora, no algo a medias.
 */
export function report(db: Db, bootAt: string): RecoveryReport {
  const rows = db.prepare(
    `SELECT id, op, src_rel AS src, dst_rel AS dst, started_at AS startedAt, recovered_at AS recoveredAt, result, message
     FROM op_journal WHERE seen_at IS NULL AND (recovered_at IS NOT NULL OR started_at < ?) ORDER BY id`,
  ).all(bootAt) as { id: number; op: string; src: string | null; dst: string | null; startedAt: string; recoveredAt: string | null; result: RecoveryResult | null; message: string | null }[]
  const items: RecoveryItem[] = rows.map((r) => r.recoveredAt
    ? { id: r.id, op: OP_NAME[r.op] ?? r.op, result: r.result!, message: r.message ?? '', startedAt: r.startedAt }
    : {
      id: r.id, op: OP_NAME[r.op] ?? r.op, result: 'pendiente', startedAt: r.startedAt,
      message: T.pendiente(fileName(r.src ?? r.dst)),
    })
  return { items, pending: items.filter((i) => i.result === 'pendiente').length }
}

/** "Entendido": el aviso no se vuelve a mostrar (lo pendiente por falta de disco sigue apareciendo hasta resolverse). */
export function markSeen(db: Db) {
  db.prepare('UPDATE op_journal SET seen_at = ? WHERE recovered_at IS NOT NULL AND seen_at IS NULL').run(new Date().toISOString())
  // Lo ya visto no hace falta guardarlo: la historia de cada cosa está en sus propios registros. Lo que quedó "para revisar"
  // se guarda (su copia de resguardo también).
  db.prepare("DELETE FROM op_journal WHERE seen_at IS NOT NULL AND result != 'revisar'").run()
}
