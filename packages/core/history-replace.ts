// Las tandas de reemplazos y conversiones del Historial (core/history.ts), de la tabla replacements: cada reemplazo a
// mano es una tanda; las conversiones seguidas de una misma corrida y el "Reemplazar todos" de la Bandeja, una sola.
import path from 'node:path'
import type { Db } from './db'
import { purgedMsg } from './purge'
import { H, base, joinY, type Connected } from './history-text'
import { AUTO_BATCH } from './inboxflow'
import { TRIM_BATCH } from './trim'
import type { HistoryEntry, HistoryKind } from '@paila/shared/types'

/** Las conversiones de una misma corrida se juntan en una tanda si entre una y otra pasaron menos de esto. */
const RUN_GAP_MS = 15 * 60 * 1000

type ConvClass = 'flac' | 'rekordbox' | 'reemplazo' | 'recorte'
export interface Rep { id: number; fileId: number; oldRel: string; newRel: string; at: string; undone: boolean; purgedAt: string | null; cls: ConvClass; batch: string | null }

/** Una conversión hecha por PAILA mantiene el nombre y cambia solo el formato (el reemplazo a mano no tiene esa forma fija). */
function classify(oldRel: string, newRel: string): ConvClass {
  const oe = path.posix.extname(oldRel).slice(1).toLowerCase(), ne = path.posix.extname(newRel).slice(1).toLowerCase()
  const sameName = oldRel.slice(0, oldRel.length - path.posix.extname(oldRel).length) === newRel.slice(0, newRel.length - path.posix.extname(newRel).length)
  if (!sameName) return 'reemplazo'
  if (['wav', 'aif', 'aiff'].includes(oe) && ne === 'flac') return 'flac'
  if (['wma', 'asf', 'ogg', 'oga', 'opus', 'webm'].includes(oe) && ['mp3', 'flac'].includes(ne)) return 'rekordbox'
  return 'reemplazo'
}

/** Reemplazos agrupados: cada reemplazo a mano es una tanda; las conversiones seguidas de la misma corrida, una sola. */
export function repGroups(db: Db): Rep[][] {
  const rows = db.prepare('SELECT id, file_id AS fileId, old_row AS oldRow, new_rel AS newRel, created_at AS at, undone_at IS NOT NULL AS undone, purged_at AS purgedAt, batch FROM replacements ORDER BY id')
    .all() as { id: number; fileId: number; oldRow: string; newRel: string; at: string; undone: number; purgedAt: string | null; batch: string | null }[]
  const groups: Rep[][] = []
  for (const r of rows) {
    const oldRel = (JSON.parse(r.oldRow) as { rel_path: string }).rel_path
    const cls: ConvClass = r.batch?.startsWith(TRIM_BATCH) ? 'recorte' : r.batch ? 'reemplazo' : classify(oldRel, r.newRel)
    const rep: Rep = { id: r.id, fileId: r.fileId, oldRel, newRel: r.newRel, at: r.at, undone: !!r.undone, purgedAt: r.purgedAt, cls, batch: r.batch }
    const last = groups[groups.length - 1]?.at(-1)
    // "Reemplazar todos" de la Bandeja: una sola tanda
    if (last && rep.batch && last.batch === rep.batch) groups[groups.length - 1].push(rep)
    else if (last && rep.cls !== 'reemplazo' && last.cls === rep.cls && Date.parse(rep.at) - Date.parse(last.at) <= RUN_GAP_MS) groups[groups.length - 1].push(rep)
    else groups.push([rep])
  }
  return groups
}

/** Por qué no se puede deshacer un reemplazo (null si se puede). */
export function repBlock(db: Db, r: Rep, connected: Connected): string | null {
  if (r.undone) return H.yaDeshizo
  if (r.purgedAt) return purgedMsg(r.purgedAt)
  const f = db.prepare('SELECT root_id AS rootId, rel_path AS rel, trashed_at AS trashed, missing_at AS missing FROM files WHERE id = ?').get(r.fileId) as { rootId: number; rel: string; trashed: string | null; missing: string | null } | undefined
  if (!f) return H.temaNoEstaBib
  if (db.prepare('SELECT 1 FROM replacements WHERE file_id = ? AND id > ? AND undone_at IS NULL').get(r.fileId, r.id)) return H.reemplazadoDespues
  if (f.trashed) return H.enPapelera
  // si cambió de lugar o de nombre después, Replacer.undo devuelve el original a ese lugar nuevo (A8)
  if (f.missing) return H.desaparecido
  if (!connected(f.rootId)) return H.discoTema
  return null
}

export function replacementEntries(db: Db, connected: Connected): HistoryEntry[] {
  return repGroups(db).map((g) => {
    const first = g[0]
    const live = g.filter((r) => !r.undone)
    const blocks = live.map((r) => repBlock(db, r, connected)).filter((x): x is string => !!x)
    const undone = live.length === 0
    const kind: HistoryKind = first.cls === 'reemplazo' ? 'reemplazo' : first.cls === 'recorte' ? 'recorte' : 'conversion'
    let summary: string
    if (first.cls === 'recorte') summary = g.length > 1 ? H.recortes(g.length) : H.recorte(base(first.oldRel))
    else if (first.batch?.startsWith(AUTO_BATCH)) summary = g.length > 1 ? H.autoVarios(g.length) : H.autoUno(base(first.oldRel))
    else if (first.batch && g.length > 1) summary = H.todos(g.length)
    else if (first.cls === 'reemplazo') summary = H.reemplazo(base(first.oldRel), base(first.newRel) === base(first.oldRel) ? null : base(first.newRel))
    else {
      const to = joinY([...new Set(g.map((r) => path.posix.extname(r.newRel).slice(1).toUpperCase()))])
      const from = joinY([...new Set(g.map((r) => { const e = path.posix.extname(r.oldRel).slice(1).toUpperCase(); return e === 'AIF' ? 'AIFF' : e }))])
      summary = g.length === 1 ? H.paso(base(first.oldRel), from, to) : H.pasaron(g.length, from, to)
      if (first.cls === 'rekordbox') summary += H.paraRekordbox
    }
    let whyNot: string | null = null, note: string | null = null
    if (undone) whyNot = H.yaDeshizo
    else if (blocks.length === live.length) whyNot = blocks[0]
    else if (blocks.length) note = H.noDeshacibles(blocks.length, blocks[0].toLowerCase())
    else if (live.length < g.length) note = H.parteDeshecha
    return { kind, id: first.id, at: first.at, files: g.length, summary, undone, canUndo: !whyNot, whyNot, note }
  })
}
