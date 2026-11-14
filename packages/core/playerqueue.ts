// Consultas del reproductor: el álbum de un tema, en el orden del disco, para "seguir por álbum". Solo lee la base.
import { visible, type Db } from './db'

/**
 * Los temas del mismo álbum que `id`, en orden: los de su misma carpeta con el mismo nombre de álbum, por número de tema
 * (y por nombre de archivo si empatan). Si el tema no tiene álbum, devuelve solo ese tema. Solo temas visibles.
 */
export function albumQueue(db: Db, id: number): number[] {
  const f = db.prepare('SELECT root_id, rel_path, album FROM files WHERE id = ?').get(id) as { root_id: number; rel_path: string; album: string | null } | undefined
  if (!f) return []
  const album = f.album?.trim()
  if (!album) return [id]
  const dir = f.rel_path.includes('/') ? f.rel_path.slice(0, f.rel_path.lastIndexOf('/')) : ''
  const rows = db.prepare(
    `SELECT id, rel_path, track FROM files f WHERE root_id = ? AND lower(trim(album)) = lower(?) AND ${visible('f')}`,
  ).all(f.root_id, album) as { id: number; rel_path: string; track: string | null }[]
  const sameDir = rows.filter((r) => (r.rel_path.includes('/') ? r.rel_path.slice(0, r.rel_path.lastIndexOf('/')) : '') === dir)
  const num = (t: string | null) => { const m = (t ?? '').match(/^\s*(\d+)/); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }
  sameDir.sort((a, b) => num(a.track) - num(b.track) || a.rel_path.localeCompare(b.rel_path, 'es', { numeric: true }))
  return sameDir.map((r) => r.id)
}
