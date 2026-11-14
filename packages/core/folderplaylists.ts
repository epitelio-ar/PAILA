// Asistente "Carpetas → Playlists": mira las carpetas de la Música y distingue las que son un ÁLBUM (temas de un mismo disco)
// de las que son una PLAYLIST (temas mezclados de varios artistas). Solo propone: crear las playlists es otro paso.
import { visible, type Db } from './db'
import type { Playlists } from './playlists'
import type { FolderProposal } from '@paila/shared/types'
import { cant, textos } from '@paila/shared/idioma'

/** Por qué cada carpeta parece un álbum o una playlist (solo se muestra; los nombres de las playlists salen de las carpetas). */
const T = textos({
  mismoAlbum: { es: 'Todos los temas tienen el mismo álbum', en: 'All the tracks have the same album' },
  mismoArtista: { es: 'Todos los temas son del mismo artista', en: 'All the tracks are by the same artist' },
  mezcla: { es: (n: number) => `Mezcla ${n} artistas distintos`, en: (n: number) => `Mixes ${n} different artists` },
  sinTags: {
    es: 'Muchos temas sin tags: no se puede saber. Arreglá los tags primero',
    en: "Many tracks have no tags: there's no way to tell. Fix the tags first",
  },
  aMedias: {
    es: (a: number, b: number) => `Parece un álbum a medias o una mezcla chica (${a} artistas, ${b} álbumes)`,
    en: (a: number, b: number) => `It looks like a partial album or a small mix (${cant(a, 'artist', 'artists')}, ${cant(b, 'album', 'albums')})`,
  },
})

export type FolderKind = 'album' | 'playlist' | 'dudosa'

interface Row { id: number; rel: string; artist: string | null; album: string | null; track: string | null; title: string | null }

const baseName = (dir: string) => dir.split('/').pop() ?? dir
/** Nombre de la playlist a partir de la carpeta: sin el año o el número del principio ("2024 - Fiesta" → "Fiesta"). */
export function nameFromDir(dir: string): string {
  const parts = dir.split('/')
  const last = parts[parts.length - 1].replace(/^\s*(\d{4}|\d{1,2})\s*[-.)_]\s*/, '').trim()
  return last || parts[parts.length - 1]
}

export function classify(rows: Row[]): { kind: FolderKind; reason: string; artists: number; albums: number } {
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  const artists = new Set(rows.filter((r) => r.artist).map((r) => norm(r.artist)))
  const albums = new Set(rows.filter((r) => r.album).map((r) => norm(r.album)))
  const tagged = rows.filter((r) => r.artist).length
  const withAlbum = rows.filter((r) => r.album).length
  const withTrack = rows.filter((r) => r.track && Number(r.track) > 0).length
  const n = rows.length
  // Un álbum: casi todos del mismo artista, o todos con el mismo álbum.
  if (withAlbum / n >= 0.7 && albums.size === 1) return { kind: 'album', reason: T.mismoAlbum, artists: artists.size, albums: albums.size }
  if (tagged / n >= 0.7 && artists.size === 1) return { kind: 'album', reason: T.mismoArtista, artists: artists.size, albums: albums.size }
  // Una playlist: varios artistas distintos y álbumes distintos (o sin álbum).
  if (tagged / n >= 0.6 && artists.size >= Math.max(3, Math.ceil(n * 0.4)) && albums.size >= Math.ceil(withAlbum * 0.5)) {
    return { kind: 'playlist', reason: T.mezcla(artists.size), artists: artists.size, albums: albums.size }
  }
  if (tagged / n < 0.6) return { kind: 'dudosa', reason: T.sinTags, artists: artists.size, albums: albums.size }
  void withTrack
  return { kind: 'dudosa', reason: T.aMedias(artists.size, albums.size), artists: artists.size, albums: albums.size }
}

export function analyzeFolders(db: Db, minTracks = 3): FolderProposal[] {
  const rows = db.prepare(
    `SELECT id, rel_path AS rel, artist, album, track, title FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY rel_path`,
  ).all() as unknown as Row[]
  const byDir = new Map<string, Row[]>()
  for (const r of rows) {
    const i = r.rel.lastIndexOf('/')
    if (i < 0) continue // en la raíz no hay carpeta de donde sacar una playlist
    const d = r.rel.slice(0, i)
    byDir.set(d, [...(byDir.get(d) ?? []), r])
  }
  const out: FolderProposal[] = []
  for (const [dir, rs] of byDir) {
    if (rs.length < minTracks) continue
    const c = classify(rs)
    // el orden: por n.º de tema y, si no hay, por nombre de archivo
    const sorted = [...rs].sort((a, b) => (Number(a.track) || 1e6) - (Number(b.track) || 1e6) || a.rel.localeCompare(b.rel, 'es', { numeric: true }))
    out.push({ dir, name: nameFromDir(dir), kind: c.kind, count: rs.length, artists: c.artists, albums: c.albums, reason: c.reason, trackIds: sorted.map((r) => r.id), sample: sorted.slice(0, 3).map((r) => r.title ?? baseName(r.rel)) })
  }
  const rank = { playlist: 0, dudosa: 1, album: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.count - a.count)
}

/** Crea una playlist por carpeta elegida. Si ya hay una con ese nombre, la completa en vez de duplicarla. */
export function createFromFolders(db: Db, playlists: Playlists, proposals: FolderProposal[]): { created: number; tracks: number } {
  const existing = new Map(playlists.tree().filter((n) => n.kind === 'list').map((n) => [n.name, n.id]))
  const used = new Set<string>()
  let created = 0, tracks = 0
  for (const p of proposals) {
    let name = p.name
    // dos carpetas distintas con el mismo nombre ("Sábado"): la segunda lleva la carpeta de arriba
    if (used.has(name)) { const up = p.dir.split('/').slice(-2, -1)[0]; name = up ? `${p.name} (${up})` : `${p.name} (2)` }
    used.add(name)
    let id = existing.get(name)
    if (id == null) { id = playlists.create(name, 'list'); existing.set(name, id); created++ }
    tracks += playlists.addTracks(id, p.trackIds)
  }
  void db
  return { created, tracks }
}
