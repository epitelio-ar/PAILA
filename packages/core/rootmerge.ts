// Unir carpetas: agregar una carpeta que contiene a otra que ya era parte de la biblioteca ("Música" cuando ya estaba
// "Música/Rock"). Solo cambia la base, nunca un archivo: los temas de la de adentro pasan a la de afuera con sus rutas
// alargadas, y así conservan playlists, análisis, historial, papelera y deshacer. La lleva `Library.addRoot`.
import type { Db } from './db'
import { textos } from '@paila/shared/idioma'

const T = textos({
  repetidos: {
    es: (n: number, prefix: string) => `No se pudieron unir las carpetas: ${n} temas de "${prefix}" ya figuraban dos veces. No se cambió nada.`,
    en: (n: number, prefix: string) => `Couldn't join the folders: ${n} tracks from "${prefix}" were already listed twice. Nothing was changed.`,
  },
})

/** Las partes de una ruta relativa, sin barras de más ("Rock\\Callejeros" o "Rock/Callejeros"). */
export const segments = (rel: string) => rel.split(/[\\/]+/).filter(Boolean)

/**
 * Pasa todo lo de la carpeta `innerId` a `outerId`, que la contiene; `prefix` es dónde queda la de adentro, relativa a la
 * de afuera ("Rock" o "Rock/Callejeros", con "/"). Corre dentro de la transacción de quien la llama. Las reglas de
 * colección de la de adentro las había elegido la persona para esas carpetas: mandan sobre las de la de afuera.
 */
export function mergeRoot(db: Db, outerId: number, innerId: number, prefix: string) {
  const ids = (db.prepare('SELECT id FROM files WHERE root_id = ?').all(innerId) as { id: number }[]).map((r) => r.id)
  // la de afuera ya tenía esos temas (se había sacado y vuelve): uniendo quedaría el mismo tema dos veces
  const clash = db.prepare(`SELECT COUNT(*) AS n FROM files a JOIN files b ON b.root_id = ? AND b.rel_path = ? || '/' || a.rel_path WHERE a.root_id = ?`).get(outerId, prefix, innerId) as { n: number }
  if (clash.n) throw new Error(T.repetidos(clash.n, prefix))
  const pre = (col: string) => `${col} = ? || '/' || ${col}`
  db.prepare(`UPDATE files SET root_id = ?, ${pre('rel_path')} WHERE root_id = ?`).run(outerId, prefix, innerId)
  if (ids.length) {
    const list = ids.join(',')
    db.prepare(`UPDATE trash_log SET ${pre('orig_rel')}, ${pre('trash_rel')} WHERE file_id IN (${list})`).run(prefix, prefix)
    db.prepare(`UPDATE replacements SET ${pre('old_trash_rel')}, ${pre('new_rel')} WHERE file_id IN (${list})`).run(prefix, prefix)
    db.prepare(`UPDATE journal SET ${pre('rel_path')} WHERE file_id IN (${list})`).run(prefix)
  }
  db.prepare(`UPDATE moves_log SET root_id = ?, ${pre('from_rel')}, ${pre('to_rel')} WHERE root_id = ?`).run(outerId, prefix, prefix, innerId)
  db.prepare(`UPDATE op_journal SET root_id = ?, src_rel = CASE WHEN src_rel IS NULL THEN NULL ELSE ? || '/' || src_rel END, dst_rel = CASE WHEN dst_rel IS NULL THEN NULL ELSE ? || '/' || dst_rel END WHERE root_id = ?`).run(outerId, prefix, prefix, innerId)
  const rules = db.prepare('SELECT rel_prefix AS rel, kind FROM rules WHERE root_id = ?').all(innerId) as { rel: string; kind: string }[]
  const put = db.prepare('INSERT INTO rules (root_id, rel_prefix, kind) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET kind = excluded.kind')
  for (const r of rules) put.run(outerId, r.rel ? `${prefix}/${r.rel}` : prefix, r.kind)
  db.prepare('DELETE FROM roots WHERE id = ?').run(innerId)
}
