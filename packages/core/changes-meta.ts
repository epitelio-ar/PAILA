// Lo anotado de cada cambio pendiente (core/changes.ts), en la tabla `pending_meta`: quién lo propuso (el orden de confianza,
// core/confianza.ts) y por qué falló la última vez que se aplicó. Lo que falla queda aparte, con su motivo y "Sacarlos", y
// "Aplicar todo" ya no lo repite: antes quedaba en la barra para siempre (choques del 27/10, C4).
import type { Db } from './db'
import type { PendingChange } from '@paila/shared/types'

/** Un cambio pendiente con quién lo propuso (null = de antes del orden de confianza, o de algo que no lo cuida). */
export type Pending = Omit<PendingChange, 'field'> & { field: Exclude<PendingChange['field'], 'papelera' | 'mover'>; source: string | null }

/** Todo lo pendiente, con su motivo de falla (si hubo) y quién lo propuso. */
export function pendingRows(db: Db): Pending[] {
  return (db.prepare(
    `SELECT p.id, p.file_id AS fileId, f.rel_path AS rel, p.field, p.before, p.after, m.error, m.source
     FROM pending_changes p JOIN files f ON f.id = p.file_id LEFT JOIN pending_meta m ON m.file_id = p.file_id AND m.field = p.field
     ORDER BY f.rel_path, p.id`,
  ).all() as unknown as (Pending & { error: string | null })[]).map(({ error, ...c }) => (error ? { ...c, error } : c))
}

/** Arma (o reemplaza) un cambio: quién lo propuso, y sin el error de la vez anterior (es otra propuesta). */
export function saveRow(db: Db, id: number, field: string, before: string | null, after: string | null, source: string | null) {
  db.prepare(
    `INSERT INTO pending_changes (file_id, field, before, after, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (file_id, field) DO UPDATE SET after = excluded.after, before = excluded.before, created_at = excluded.created_at`,
  ).run(id, field, before, after, new Date().toISOString())
  db.prepare(`INSERT INTO pending_meta (file_id, field, source, error, error_at) VALUES (?, ?, ?, NULL, NULL)
    ON CONFLICT (file_id, field) DO UPDATE SET source = excluded.source, error = NULL, error_at = NULL`).run(id, field, source)
  // la versión del archivo que se miró al proponerlo: al aplicar, si cambió, no se escribe (riesgo 2, MASTERPLAN-5; core/propuestas.ts)
  db.prepare(`INSERT INTO pending_base (file_id, field, size, mtime) SELECT id, ?, size, mtime FROM files WHERE id = ?
    ON CONFLICT (file_id, field) DO UPDATE SET size = excluded.size, mtime = excluded.mtime`).run(field, id)
}

/** Saca un cambio (el valor nuevo es igual al de hoy). */
export function dropRow(db: Db, id: number, field: string) {
  db.prepare('DELETE FROM pending_changes WHERE file_id = ? AND field = ?').run(id, field)
  db.prepare('DELETE FROM pending_meta WHERE file_id = ? AND field = ?').run(id, field)
  db.prepare('DELETE FROM pending_base WHERE file_id = ? AND field = ?').run(id, field)
}

/** Anota por qué no se pudo aplicar: el cambio sigue pendiente, pero aparte y con el motivo. */
export function markFailed(db: Db, cs: PendingChange[], error: string) {
  const st = db.prepare(`INSERT INTO pending_meta (file_id, field, error, error_at) SELECT file_id, field, ?, ? FROM pending_changes WHERE id = ?
    ON CONFLICT (file_id, field) DO UPDATE SET error = excluded.error, error_at = excluded.error_at`)
  const at = new Date().toISOString()
  for (const c of cs) st.run(error, at, c.id)
}

/** "Sacarlos": lo que no se pudo aplicar la última vez sale de lo pendiente. */
export function dropFailed(db: Db) {
  db.exec(`DELETE FROM pending_changes WHERE EXISTS (SELECT 1 FROM pending_meta m WHERE m.file_id = pending_changes.file_id
    AND m.field = pending_changes.field AND m.error IS NOT NULL)`)
  tidyMeta(db)
}

/** Lo anotado de cambios que ya no están pendientes (aplicados, descartados, de temas que se fueron) no sirve más. */
export function tidyMeta(db: Db) {
  db.exec('DELETE FROM pending_meta WHERE NOT EXISTS (SELECT 1 FROM pending_changes p WHERE p.file_id = pending_meta.file_id AND p.field = pending_meta.field)')
  db.exec('DELETE FROM pending_base WHERE NOT EXISTS (SELECT 1 FROM pending_changes p WHERE p.file_id = pending_base.file_id AND p.field = pending_base.field)')
}
