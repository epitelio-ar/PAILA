// Papelera propia de PAILA. "Borrar" nunca borra de verdad: el archivo se mueve a <carpeta>/_PAILA/papelera/<tanda>/…
// (en el mismo disco, así es instantáneo), la fila queda marcada y todo se puede restaurar.
import { enPaila, type Db } from './db'
import { trashBatch } from './safefs'
import { ahora } from './reloj'
import { podarPapelera } from './restos'
import path from 'node:path'
import { runMovesAsync } from './ops/run'
import type { Step } from './ops/types'
import type { Membership, Playlists } from './playlists'
import { purgedMsg } from './purge'
import { inheritDj, returnDj } from './trash-dj'
import type { TrashBatch, TrashResult } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

// Lo que se muestra cuando un tema no se puede restaurar. La carpeta de la tanda ("…_tanda-3_…") no se traduce.
const T = textos({
  noEsta: { es: 'El archivo ya no está en la papelera', en: "The file isn't in the trash anymore" },
  ocupado: { es: 'Ya hay otro archivo en el lugar original', en: 'There is already another file in the original place' },
})


/** Lo que se anota al mandar un tema a la papelera (en el diario antes de mover, y en trash_log después). */
export interface TrashData { batchId: number; fileId: number; origRel: string; trashRel: string; reason: string; kept: number | null }

/** Anota en la base un tema que ya está en la papelera (también lo usa la recuperación al abrir). */
export function logTrash(db: Db, playlists: Playlists, d: TrashData) {
  const moves = d.kept != null ? playlists.mergeFile(d.fileId, d.kept) : []
  const now = ahora()
  // anotado donde está de verdad: su lugar de antes queda libre (lo guarda trash_log.orig_rel para restaurar; migración v54)
  db.prepare('UPDATE files SET trashed_at = ?, rel_path = ? WHERE id = ?').run(now, d.trashRel, d.fileId)
  // lo pendiente de un tema que se va ya no se puede aplicar: fallaba en cada Aplicar y la barra no se iba nunca (choques del 27/10, C4)
  db.prepare('DELETE FROM pending_changes WHERE file_id = ?').run(d.fileId)
  db.prepare('DELETE FROM pending_meta WHERE file_id = ?').run(d.fileId)
  db.prepare('DELETE FROM held_changes WHERE file_id = ?').run(d.fileId)
  db.prepare('DELETE FROM propuestas WHERE file_id = ?').run(d.fileId) // ni moverlo ni volver a mandarlo (core/propuestas.ts)
  const log = db.prepare('INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, kept_id, moves, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.batchId, d.fileId, d.origRel, d.trashRel, d.reason, d.kept, JSON.stringify(moves), now)
  // la copia que queda hereda las estrellas y las veces tocado que traía de Rekordbox (core/trash-dj.ts)
  if (d.kept != null) inheritDj(db, Number(log.lastInsertRowid), d.fileId, d.kept)
}

/** Anota en la base un tema que ya volvió de la papelera a su lugar. */
export function logRestore(db: Db, playlists: Playlists, d: { logId: number; fileId: number; moves: Membership[] }) {
  const orig = (db.prepare('SELECT orig_rel AS r FROM trash_log WHERE id = ?').get(d.logId) as { r: string } | undefined)?.r
  if (orig) db.prepare('UPDATE files SET trashed_at = NULL, rel_path = ? WHERE id = ?').run(orig, d.fileId)
  else db.prepare('UPDATE files SET trashed_at = NULL WHERE id = ?').run(d.fileId)
  db.prepare('UPDATE trash_log SET restored_at = ? WHERE id = ?').run(new Date().toISOString(), d.logId)
  playlists.restoreMemberships(d.fileId, d.moves)
  returnDj(db, d.logId)
}

export class Trash {
  constructor(private db: Db, private rootPath: (rootId: number) => string | null, private playlists: Playlists) {}

  /**
   * Manda temas a la papelera. `keptBy` (opcional) dice, para cada tema, cuál es la copia que se queda:
   * las playlists donde estaba pasan a apuntar a esa copia. Mueve cediendo el control: miles de duplicados no congelan la ventana.
   * `versiones`: el tamaño y la fecha de cuando se propuso (core/aplicar.ts): si el archivo cambió, no se mueve.
   */
  async trash(fileIds: number[], reason: string, keptBy: Map<number, number> = new Map(), versiones: Map<number, { size: number | null; mtime: number | null }> = new Map()): Promise<TrashResult> {
    const res: TrashResult = { batchId: null, moved: 0, failed: [] }
    const batchId = (this.db.prepare('SELECT COALESCE(MAX(batch_id), 0) AS m FROM trash_log').get() as { m: number }).m + 1
    const folder = trashBatch(`tanda-${batchId}`)
    const steps: Step<TrashData>[] = []
    for (const id of fileIds) {
      const f = this.db.prepare('SELECT root_id, rel_path, trashed_at FROM files WHERE id = ?').get(id) as { root_id: number; rel_path: string; trashed_at: string | null } | undefined
      if (!f || f.trashed_at) continue
      const trashRel = `_PAILA/papelera/${folder}/${f.rel_path}`
      const v = versiones.get(id)
      steps.push({ kind: 'mover', op: 'papelera', rootId: f.root_id, fileId: id, src: f.rel_path, dst: trashRel, data: { batchId, fileId: id, origRel: f.rel_path, trashRel, reason, kept: keptBy.get(id) ?? null },
        ...(v?.size != null ? { size: v.size, mtime: v.mtime ?? undefined } : {}) })
    }
    const r = await runMovesAsync(this.db, steps, { rootPath: this.rootPath, annotate: (s) => logTrash(this.db, this.playlists, s.data) })
    res.moved = r.done.length
    if (r.done.length) res.batchId = batchId
    res.failed = r.failed.map((x) => ({ fileId: x.step.fileId!, rel: x.step.src, error: x.error }))
    return res
  }

  batches(): TrashBatch[] {
    return (this.db.prepare(
      `SELECT t.batch_id AS batchId, MIN(t.created_at) AS createdAt, MIN(t.reason) AS reason, COUNT(*) AS files, SUM(f.size) AS bytes, MIN(t.restored_at IS NOT NULL) AS restored
       FROM trash_log t JOIN files f ON f.id = t.file_id GROUP BY t.batch_id ORDER BY t.batch_id DESC`,
    ).all() as { batchId: number; createdAt: string; reason: string | null; files: number; bytes: number; restored: number }[]).map((b) => ({ ...b, restored: !!b.restored }))
  }

  /** Lo que hay en la papelera ahora (para mostrarlo). */
  items(): { id: number; batchId: number; rel: string; size: number; reason: string | null }[] {
    return this.db.prepare(
      `SELECT f.id, t.batch_id AS batchId, t.orig_rel AS rel, f.size, t.reason FROM trash_log t JOIN files f ON f.id = t.file_id
       WHERE t.restored_at IS NULL AND t.purged_at IS NULL ORDER BY t.batch_id DESC, t.orig_rel`,
    ).all() as unknown as { id: number; batchId: number; rel: string; size: number; reason: string | null }[]
  }

  /** Restaura una tanda entera (o solo `fileIds`): vuelve cada archivo a su lugar original y a sus playlists. */
  async restore(batchId: number, fileIds?: number[]): Promise<TrashResult> {
    const res: TrashResult = { batchId, moved: 0, failed: [] }
    const rows = this.db.prepare(
      `SELECT t.id, t.file_id AS fileId, f.root_id AS rootId, t.orig_rel AS origRel, t.trash_rel AS trashRel, t.moves, t.purged_at AS purgedAt
       FROM trash_log t JOIN files f ON f.id = t.file_id WHERE t.batch_id = ? AND t.restored_at IS NULL AND ${enPaila('f.root_id')}`,
    ).all(batchId) as unknown as { id: number; fileId: number; rootId: number; origRel: string; trashRel: string; moves: string | null; purgedAt: string | null }[]
    type D = { logId: number; fileId: number; moves: Membership[] }
    const steps: Step<D>[] = []
    for (const r of rows) {
      if (fileIds && !fileIds.includes(r.fileId)) continue
      if (r.purgedAt) { res.failed.push({ fileId: r.fileId, rel: r.origRel, error: purgedMsg(r.purgedAt) }); continue }
      steps.push({
        kind: 'mover', op: 'restaurar', rootId: r.rootId, fileId: r.fileId, src: r.trashRel, dst: r.origRel, data: { logId: r.id, fileId: r.fileId, moves: r.moves ? JSON.parse(r.moves) : [] },
        missing: T.noEsta, taken: T.ocupado,
      })
    }
    // lo que vuelve deja vacía la carpeta de la tanda en la papelera: se saca (core/restos.ts)
    const r = await runMovesAsync(this.db, steps, { rootPath: this.rootPath, annotate: (s) => logRestore(this.db, this.playlists, s.data),
      after: (s) => { const root = this.rootPath(s.rootId!); if (root) podarPapelera(root, path.posix.dirname(s.src)) } })
    res.moved = r.done.length
    res.failed.push(...r.failed.map((x) => ({ fileId: x.step.fileId!, rel: x.step.dst!, error: x.error })))
    return res
  }
}
