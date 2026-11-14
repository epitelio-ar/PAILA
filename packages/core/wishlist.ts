// Lista de deseos: los álbumes (o artistas) cuyos temas tienen mala nota, para ir a conseguir mejores versiones.
// PAILA no descarga música: solo arma la lista y abre la búsqueda en la tienda o sitio que elijas.
import { visible, type Db } from './db'
import type { WishGroup } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  estadoDesconocido: { es: 'Estado desconocido', en: 'Unknown status' },
  sitioDesconocido: { es: 'Sitio desconocido', en: 'Unknown site' },
})

export type WishStatus = 'pendiente' | 'buscando' | 'conseguido' | 'reemplazado' | 'ignorar'
const STATUSES: WishStatus[] = ['pendiente', 'buscando', 'conseguido', 'reemplazado', 'ignorar']

const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
const normKey = (artist: string, album: string) => `${artist}|${album}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9|]+/g, ' ').trim()

const SEARCH_SITES = [
  { id: 'bandcamp', label: 'Bandcamp', url: (q: string) => `https://bandcamp.com/search?q=${encodeURIComponent(q)}` },
  { id: 'qobuz', label: 'Qobuz', url: (q: string) => `https://www.qobuz.com/search?q=${encodeURIComponent(q)}` },
  { id: '7digital', label: '7digital', url: (q: string) => `https://www.7digital.com/search?q=${encodeURIComponent(q)}` },
  { id: 'hdtracks', label: 'HDtracks', url: (q: string) => `https://www.hdtracks.com/#/search?q=${encodeURIComponent(q)}` },
  { id: 'discogs', label: 'Discogs (vinilos y CDs)', url: (q: string) => `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=release` },
] as const

export class Wishlist {
  constructor(private db: Db) {}

  /** Álbumes con temas de nota `maxGrade` o peor (por defecto D), más lo que ya tiene un estado. */
  list(maxGrade: 'C' | 'D' | 'F' = 'D'): WishGroup[] {
    const bad = RANK[maxGrade]
    const rows = this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, COALESCE(NULLIF(f.album_artist, ''), NULLIF(f.artist, ''), '') AS artist, COALESCE(f.album, '') AS album, f.title, f.size, a.grade
       FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.kind = 'musica' AND a.grade IS NOT NULL`,
    ).all() as unknown as { id: number; rel: string; artist: string; album: string; title: string | null; size: number; grade: string }[]
    const groups = new Map<string, { artist: string; album: string; all: typeof rows; badRows: typeof rows }>()
    for (const r of rows) {
      const artist = r.artist || this.dirArtist(r.rel)
      const album = r.album
      const key = normKey(artist, album)
      const g = groups.get(key) ?? { artist, album, all: [], badRows: [] }
      g.all.push(r)
      if ((RANK[r.grade] ?? 0) >= bad) g.badRows.push(r)
      groups.set(key, g)
    }
    const saved = new Map((this.db.prepare('SELECT key, status, note FROM wishlist').all() as { key: string; status: WishStatus; note: string }[]).map((s) => [s.key, s]))
    const out: WishGroup[] = []
    for (const [key, g] of groups) {
      const s = saved.get(key)
      if (!g.badRows.length && !s) continue
      if (!g.badRows.length && s && s.status === 'pendiente') continue
      const worst = (g.badRows.length ? g.badRows : g.all).reduce((w, r) => ((RANK[r.grade] ?? 0) > (RANK[w] ?? 0) ? r.grade : w), 'A+')
      out.push({
        key, artist: g.artist, album: g.album, status: s?.status ?? 'pendiente', note: s?.note ?? '', tracks: g.badRows.length || g.all.length, worst,
        bytes: g.badRows.reduce((a, r) => a + r.size, 0), fixed: g.badRows.length === 0,
        sample: (g.badRows.length ? g.badRows : g.all).slice(0, 3).map((r) => r.title ?? r.rel.split('/').pop() ?? ''),
      })
    }
    const order: Record<WishStatus, number> = { pendiente: 0, buscando: 1, conseguido: 2, reemplazado: 3, ignorar: 4 }
    return out.sort((a, b) => order[a.status] - order[b.status] || (RANK[b.worst ?? 'A+'] ?? 0) - (RANK[a.worst ?? 'A+'] ?? 0) || b.tracks - a.tracks)
  }

  private dirArtist(rel: string): string {
    const parts = rel.split('/')
    return parts.length > 1 ? parts[parts.length - 2] : ''
  }

  setStatus(key: string, status: WishStatus, note?: string) {
    if (!STATUSES.includes(status)) throw new Error(T.estadoDesconocido)
    this.db.prepare('INSERT INTO wishlist (key, status, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET status = excluded.status, note = COALESCE(?, wishlist.note), updated_at = excluded.updated_at')
      .run(key, status, note ?? '', new Date().toISOString(), note ?? null)
  }

  /** Dirección de búsqueda en un sitio, para abrir en el navegador. Solo sitios de la lista. */
  searchUrl(siteId: string, artist: string, album: string): string {
    const site = SEARCH_SITES.find((s) => s.id === siteId)
    if (!site) throw new Error(T.sitioDesconocido)
    return site.url([artist, album].filter(Boolean).join(' '))
  }
}
