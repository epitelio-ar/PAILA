// Las tandas del Historial (core/history.ts) que salen de los registros de cada módulo: tags, nombres, extensiones y
// tapas (journal), la papelera (trash_log) y el organizador con la limpieza de Espacio (moves_log). Solo lectura. Lo de una carpeta que
// sacaste de PAILA queda afuera: no frena el resto (antes decía "el disco no está conectado") y deshacer lo deja como está.
import type { Db } from './db'
import { sameButExtension } from './organizer'
import { purgedMsg } from './purge'
import { commonDir } from './files'
import { FIELD, FIELD_ORDER, H, archivos, bare, base, dirOf, joinY, temas, type Connected } from './history-text'
import type { HistoryEntry } from '@paila/shared/types'
import { movidosDespues } from './history-cadena'

/** Las carpetas que sacaste de PAILA: número → nombre ("Temas De Un Amigo"). */
export function quitadas(db: Db): Map<number, string> {
  const rs = db.prepare('SELECT id, rel_path AS rel FROM roots WHERE removed_at IS NOT NULL').all() as { id: number; rel: string }[]
  return new Map(rs.map((r) => [r.id, r.rel.split(/[\\/]/).filter(Boolean).pop() ?? r.rel]))
}
/** "«Temas De Un Amigo»" (o varias, con "y") de los números de carpeta que se pasan. */
const nombres = (q: Map<number, string>, ids: Iterable<number | null>) => joinY([...new Set([...ids].filter((i): i is number => i != null && q.has(i)))].map((i) => `«${q.get(i)}»`))
/** Los avisos, juntos (sin repetir). */
const juntar = (...ns: (string | null)[]) => [...new Set(ns.filter((x): x is string => !!x))].join(' · ') || null

// ---------- tags, nombres, extensiones y tapas (journal) ----------

export function tagEntries(db: Db, connected: Connected): HistoryEntry[] {
  const rows = db.prepare(
    `SELECT j.batch_id AS b, j.file_id AS fileId, j.rel_path AS rel, j.field, j.applied_at AS at, j.undone_at IS NOT NULL AS undone, f.root_id AS rootId
     FROM journal j LEFT JOIN files f ON f.id = j.file_id ORDER BY j.batch_id, j.id`,
  ).all() as { b: number; fileId: number; rel: string; field: string; at: string; undone: number; rootId: number | null }[]
  // Lo que se volvió a cambiar en una tanda más nueva ya no frena: esa va en la cadena y se deshace antes (core/history-cadena.ts).
  const q = quitadas(db)
  const byBatch = new Map<number, typeof rows>()
  for (const r of rows) { const g = byBatch.get(r.b); if (g) g.push(r); else byBatch.set(r.b, [r]) }
  const out: HistoryEntry[] = []
  for (const [b, rs] of byBatch) {
    const files = new Set(rs.map((r) => r.fileId))
    const fields = FIELD_ORDER.filter((f) => rs.some((r) => r.field === f))
    const who = files.size === 1 ? `«${base(rs[0].rel)}»` : temas(files.size)
    let summary: string
    if (fields.every((f) => f === 'filename' || f === 'extension')) {
      summary = fields.length === 1 && fields[0] === 'extension'
        ? H.extension(files.size === 1 ? who : archivos(files.size))
        : files.size === 1 ? H.renombro(who) : H.renombraron(files.size)
    } else if (fields.length === 1) summary = H.cambio(FIELD[fields[0]], who)
    else if (fields.length <= 3) summary = H.cambiaron(joinY(fields.map((f) => FIELD[f])), who)
    else summary = H.datos(fields.length, fields.slice(0, 3).map((f) => bare(FIELD[f])).join(', '), who)

    const vivas = rs.filter((r) => !r.undone), fuera = vivas.filter((r) => r.rootId != null && q.has(r.rootId))
    const live = vivas.filter((r) => !fuera.includes(r))
    const soloFuera = !live.length && fuera.length > 0 && vivas.length === rs.length // nunca se deshizo nada: todo es de la carpeta quitada
    const undone = live.length === 0 && !soloFuera
    let whyNot: string | null = null
    if (undone) whyNot = H.yaDeshizo
    else if (soloFuera) whyNot = H.carpetaQuitada(nombres(q, fuera.map((r) => r.rootId)))
    else if (live.some((r) => r.rootId == null)) whyNot = H.yaNoEstan
    else if (live.some((r) => !connected(r.rootId!))) whyNot = H.discoTemas
    const n = new Set(fuera.map((r) => r.fileId)).size
    const note = juntar(!undone && vivas.length < rs.length ? H.parteDeshecha : null, n && !soloFuera ? H.quedanFuera(n, nombres(q, fuera.map((r) => r.rootId))) : null)
    out.push({ kind: 'tags', id: b, at: rs[0].at, files: files.size, summary, undone, canUndo: !whyNot, whyNot, note })
  }
  return out
}

// ---------- papelera (trash_log) ----------

export function trashEntries(db: Db, connected: Connected): HistoryEntry[] {
  const rows = db.prepare(
    `SELECT t.batch_id AS b, MIN(t.created_at) AS at, MIN(t.reason) AS reason, COUNT(*) AS n, SUM(t.restored_at IS NOT NULL) AS restored, SUM(t.restored_at IS NULL AND t.purged_at IS NOT NULL AND q.removed_at IS NULL) AS purged, MAX(t.purged_at) AS purgedAt,
            MIN(t.orig_rel) AS rel, GROUP_CONCAT(DISTINCT CASE WHEN t.restored_at IS NULL AND q.removed_at IS NULL THEN f.root_id END) AS roots,
            SUM(t.restored_at IS NULL AND q.removed_at IS NOT NULL) AS fuera,
            GROUP_CONCAT(DISTINCT CASE WHEN t.restored_at IS NULL AND q.removed_at IS NOT NULL THEN f.root_id END) AS rootsFuera
     FROM trash_log t JOIN files f ON f.id = t.file_id LEFT JOIN roots q ON q.id = f.root_id GROUP BY t.batch_id`,
  ).all() as { b: number; at: string; reason: string | null; n: number; restored: number; purged: number; purgedAt: string | null; rel: string; roots: string | null; fuera: number; rootsFuera: string | null }[]
  const q = quitadas(db)
  // ¿Alguno de estos discos (lista "1,3" de SQLite) no está conectado?
  const offline = (roots: string | null) => !!roots && roots.split(',').some((r) => !connected(Number(r)))
  return rows.map((r) => {
    const why = r.reason ? ` (${r.reason.toLowerCase()})` : ''
    const summary = r.n === 1 ? H.mando(base(r.rel), why) : H.mandaron(r.n, why)
    // lo de una carpeta quitada no cuenta: ni para restaurar ni para frenar el resto
    const quedan = r.n - r.restored - r.fuera
    const soloFuera = r.fuera > 0 && quedan === 0 && r.restored === 0
    const undone = r.restored === r.n || (r.fuera > 0 && quedan === 0 && !soloFuera)
    const lasQuitadas = nombres(q, (r.rootsFuera ?? '').split(',').filter(Boolean).map(Number))
    const whyNot = undone ? H.yaRestauro : soloFuera ? H.carpetaQuitada(lasQuitadas) : r.purged >= quedan ? purgedMsg(r.purgedAt!) : offline(r.roots) ? H.discoTemas : null
    const note = juntar(!undone && r.purged > 0 && r.purged < quedan ? H.noRestaurables(r.purged) : !undone && r.restored > 0 ? H.yaRestaurados(r.restored) : null,
      r.fuera && !soloFuera ? H.quedanFuera(r.fuera, lasQuitadas) : null)
    return { kind: 'papelera' as const, id: r.b, at: r.at, files: r.n, summary, undone, canUndo: !whyNot, whyNot, note }
  })
}

// ---------- organizador y limpieza de Espacio (moves_log) ----------

export function moveEntries(db: Db, connected: Connected): HistoryEntry[] {
  const rows = db.prepare(
    `SELECT m.batch_id AS b, m.root_id AS rootId, m.file_id AS fileId, m.from_rel AS fromRel, m.to_rel AS toRel, m.created_at AS at, m.undone_at IS NOT NULL AS undone, m.purged_at AS purgedAt,
            f.rel_path AS nowRel, f.trashed_at IS NOT NULL AS trashed
     FROM moves_log m LEFT JOIN files f ON f.id = m.file_id ORDER BY m.batch_id, m.id`,
  ).all() as { b: number; rootId: number; fileId: number | null; fromRel: string; toRel: string; at: string; undone: number; purgedAt: string | null; nowRel: string | null; trashed: number }[]
  const q = quitadas(db)
  const byBatch = new Map<number, typeof rows>()
  for (const r of rows) { const g = byBatch.get(r.b); if (g) g.push(r); else byBatch.set(r.b, [r]) }
  const out: HistoryEntry[] = []
  for (const [b, rs] of byBatch) {
    const cleanup = rs.every((r) => r.fileId == null && /(?:^|\/)_PAILA\/papelera\//.test(r.toRel)) // (con "Rock/" adelante si la carpeta se unió con otra)
    const tracks = rs.filter((r) => r.fileId != null), extras = rs.length - tracks.length
    let summary: string
    if (cleanup) summary = rs.length === 1 ? H.limpiezaUno(base(rs[0].fromRel)) : H.limpiezaVarios(rs.length)
    else {
      const dirs = tracks.map((r) => dirOf(r.toRel))
      const common = commonDir(dirs)
      const where = !common ? H.aNuevas : dirs.every((d) => d === common) ? H.a(common) : H.a(`${common}/…`)
      summary = tracks.length === 1 ? H.movio(base(tracks[0].fromRel), where) : H.movieron(tracks.length, where)
      if (extras) summary += H.acompanan(extras)
    }
    const vivas = rs.filter((r) => !r.undone), fuera = vivas.filter((r) => q.has(r.rootId))
    const live = vivas.filter((r) => !q.has(r.rootId))
    const soloFuera = !live.length && fuera.length > 0 && vivas.length === rs.length
    const undone = live.length === 0 && !soloFuera
    // temas que después cambiaron de lugar o de nombre, o se mandaron a la papelera: esos quedan donde están
    const movidos = live.filter((r) => r.fileId != null && (r.nowRel == null || (r.nowRel !== r.toRel && !sameButExtension(r.nowRel, r.toRel)) || r.trashed))
    const moved = movidos.length
    let whyNot: string | null = null, note: string | null = null
    if (undone) whyNot = H.yaDeshizo
    else if (soloFuera) whyNot = H.carpetaQuitada(nombres(q, fuera.map((r) => r.rootId)))
    else if (live.every((r) => r.purgedAt)) whyNot = purgedMsg(live[0].purgedAt!)
    else if (live.some((r) => !connected(r.rootId))) whyNot = H.discoArchivos
    else if (moved && moved === live.length) whyNot = H.todosCambiaron
    if (!whyNot && moved) note = H.algunosCambiaron(moved)
    else if (!undone && vivas.length < rs.length) note = H.parteDeshecha
    if (fuera.length && !soloFuera) note = juntar(note, H.quedanFuera(fuera.filter((r) => r.fileId != null).length || fuera.length, nombres(q, fuera.map((r) => r.rootId))))
    const e: HistoryEntry = { kind: cleanup ? 'limpieza' : 'organizar', id: b, at: rs[0].at, files: rs.length, summary, undone, canUndo: !whyNot, whyNot, note }
    if (moved) movidosDespues.set(e, movidos.map((r) => r.fileId!)) // si los cambió una tanda de la cadena, vuelven antes (core/history-cadena.ts)
    out.push(e)
  }
  return out
}
