// Duplicados y lo traído de Rekordbox (punto 1 real del 24/10, MP4 4B.7): cuando un duplicado va a la papelera, la copia que
// queda hereda lo que Rekordbox sabía de él: la estrella más alta y la suma de veces tocado (en el punto 1 eran 8 estrellas y
// 6 veces tocado que se iban con la copia a la papelera). Las playlists ya pasan solas (playlists.ts, mergeFile). La grilla no:
// la del otro archivo puede caer corrida si tiene distinto relleno al principio (medido: 23 de 34 corridas o de otro audio).
// Lo que tenía la copia que queda se anota (trash_dj) y se le devuelve al restaurar el duplicado. Lo usa core/trash.ts.
import type { Db } from './db'

type Meta = { stars: number; plays: number | null }
const metaOf = (db: Db, id: number) => db.prepare('SELECT stars, play_count AS plays FROM dj_meta WHERE file_id = ?').get(id) as Meta | undefined

/** Pasa a `keptId` la estrella más alta y la suma de veces tocado de `fromId`. `logId`: la fila de trash_log, para devolverlo. */
export function inheritDj(db: Db, logId: number, fromId: number, keptId: number) {
  const from = metaOf(db, fromId)
  if (!from || (!(from.stars > 0) && !(from.plays && from.plays > 0))) return
  const kept = metaOf(db, keptId)
  const stars = Math.max(kept?.stars ?? 0, from.stars ?? 0)
  const plays = from.plays || kept?.plays ? (kept?.plays ?? 0) + (from.plays ?? 0) : null
  db.prepare(`INSERT INTO dj_meta (file_id, stars, play_count, imported_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (file_id) DO UPDATE SET stars = excluded.stars, play_count = excluded.play_count`).run(keptId, stars, plays, new Date().toISOString())
  db.prepare('INSERT OR REPLACE INTO trash_dj (log_id, kept_id, had, stars_before, plays_before, stars_after, plays_after) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(logId, keptId, kept ? 1 : 0, kept?.stars ?? 0, kept?.plays ?? null, stars, plays)
}

/**
 * Al restaurar el duplicado, la copia que quedó vuelve a lo que tenía: las veces tocado que sumó se restan (si después se tocó
 * más, eso queda) y la estrella vuelve a la de antes si nadie la cambió desde entonces.
 */
export function returnDj(db: Db, logId: number) {
  const r = db.prepare('SELECT kept_id AS kept, had, stars_before AS sb, plays_before AS pb, stars_after AS sa, plays_after AS pa FROM trash_dj WHERE log_id = ?').get(logId) as
    { kept: number; had: number; sb: number; pb: number | null; sa: number; pa: number | null } | undefined
  if (!r) return
  const now = metaOf(db, r.kept)
  if (now) {
    const stars = now.stars === r.sa ? r.sb : now.stars
    const added = (r.pa ?? 0) - (r.pb ?? 0), left = (now.plays ?? 0) - added
    const plays = r.pb == null && left <= 0 ? null : Math.max(0, left)
    if (!r.had && stars === 0 && plays == null) db.prepare('DELETE FROM dj_meta WHERE file_id = ? AND colour IS NULL AND my_tags IS NULL AND comments IS NULL').run(r.kept)
    else db.prepare('UPDATE dj_meta SET stars = ?, play_count = ? WHERE file_id = ?').run(stars, plays, r.kept)
  }
  db.prepare('DELETE FROM trash_dj WHERE log_id = ?').run(logId)
}
