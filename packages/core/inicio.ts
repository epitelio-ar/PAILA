// Consultas del Inicio: los últimos discos que sumaste a la Música (para "Llegaron hace poco"). Solo lee la base.
import { visible, type Db } from './db'
import type { RecentAlbum } from '@paila/shared/types'

/**
 * Los discos de la Música más nuevos (por la fecha del archivo más nuevo de cada uno). Un disco es una carpeta con un
 * mismo nombre de álbum y al menos `minTracks` temas: así no cuentan los sueltos ni las carpetas mezcladas.
 */
/** El año del disco: el primero que se lea bien (en la base es texto, a veces con "2008.0" o una fecha). */
const yearOf = (g: { year: string | number | null }[]) => { for (const r of g) { const y = parseInt(String(r.year ?? ''), 10); if (y >= 1900 && y <= 2099) return y } return null }

export function recentAlbums(db: Db, limit = 12, minTracks = 3): RecentAlbum[] {
  const rows = db.prepare(
    `SELECT f.id, f.root_id, f.rel_path, f.album, f.artist, f.album_artist, f.year, f.track, f.mtime, a.grade
     FROM files f LEFT JOIN analysis a ON a.file_id = f.id
     WHERE f.kind = 'musica' AND f.album IS NOT NULL AND trim(f.album) <> '' AND ${visible('f')}`,
  ).all() as { id: number; root_id: number; rel_path: string; album: string; artist: string | null; album_artist: string | null; year: string | number | null; track: string | null; mtime: number; grade: string | null }[]
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const num = (t: string | null) => { const m = (t ?? '').match(/^\s*(\d+)/); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = `${r.root_id}|${dirOf(r.rel_path)}|${r.album.trim().toLowerCase()}`
    const g = groups.get(k)
    if (g) g.push(r); else groups.set(k, [r])
  }
  const out: (RecentAlbum & { newest: number })[] = []
  for (const g of groups.values()) {
    if (g.length < minTracks) continue
    g.sort((a, b) => num(a.track) - num(b.track) || a.rel_path.localeCompare(b.rel_path, 'es', { numeric: true }))
    const count = new Map<string, number>()
    for (const r of g) if (r.grade) count.set(r.grade, (count.get(r.grade) ?? 0) + 1)
    const grade = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const artists = new Map<string, number>()
    for (const r of g) { const a = (r.album_artist || r.artist)?.trim(); if (a) artists.set(a, (artists.get(a) ?? 0) + 1) }
    const artist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    out.push({ album: g[0].album.trim(), artist, year: yearOf(g), tracks: g.length, trackId: g[0].id, grade, newest: Math.max(...g.map((r) => r.mtime)) })
  }
  out.sort((a, b) => b.newest - a.newest || a.album.localeCompare(b.album, 'es'))
  return out.slice(0, limit).map(({ newest: _n, ...a }) => a)
}
