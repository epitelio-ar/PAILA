// Las listas de temas oficiales de cada disco, de MusicBrainz (sin clave, 1 pedido por segundo), Deezer (sin clave: muchos
// discos digitales y EPs que MusicBrainz no tiene) y Discogs (con clave),
// guardadas en la caché `online_cache` para no volver a pedirlas. Solo se manda el artista y el nombre del disco.
import { OnlineCache, Polite, sinConexion, realFetch, type FetchFn } from './online/http'
import { discogsAuth, type DiscogsKey } from './online/sources'
import { discogsName, plainPunct } from './online/hits'
import { fold } from './names'
import { tr } from '@paila/shared/idioma'
import { catalogOf, sameAlbum, searchName } from './albumcheck'

/** Una edición de un disco, como sale de la búsqueda (sin la lista de temas). */
export interface Edition {
  source: 'musicbrainz' | 'deezer' | 'discogs'; id: string; title: string; artist: string; date: string | null; country: string | null
  format: string | null; trackCount: number | null; status: string | null; groupId: string | null; secondary: string[]; note: string | null; score: number
}
export interface ListedTrack { disc: number; pos: number; title: string; artist: string | null; length: number | null }
export interface Tracklist extends Edition { tracks: ListedTrack[] }

const enc = encodeURIComponent
const lucene = (s: string) => s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, ' ').replace(/\s+/g, ' ').trim()
const VARIOUS = /^(?:varios artistas|various artists|va)$/i
/** El prefijo de cada fuente en la caché (área `discos`). */
const PFX: Record<Edition['source'], string> = { musicbrainz: 'mb', deezer: 'dz', discogs: 'dg' }

interface MbCredit { name?: string; joinphrase?: string; artist?: { name?: string } }
interface MbRelease {
  id: string; title: string; score?: number; status?: string; date?: string; country?: string; disambiguation?: string; 'track-count'?: number
  'artist-credit'?: MbCredit[]; 'release-group'?: { id?: string; 'primary-type'?: string; 'secondary-types'?: string[] }
  media?: { format?: string; position?: number; 'track-count'?: number; tracks?: { position?: number; number?: string; title: string; length?: number; 'artist-credit'?: MbCredit[] }[] }[]
}
const credit = (c: MbCredit[] | undefined) => (c ?? []).map((x) => (x.name ?? x.artist?.name ?? '') + (x.joinphrase ?? '')).join('').trim()

function mbEdition(r: MbRelease): Edition {
  const formats = [...new Set((r.media ?? []).map((m) => m.format).filter(Boolean))]
  return {
    source: 'musicbrainz', id: r.id, title: plainPunct(r.title), artist: plainPunct(credit(r['artist-credit'])), date: r.date ?? null, country: r.country ?? null,
    format: formats.length ? `${(r.media ?? []).length > 1 ? `${(r.media ?? []).length}×` : ''}${formats.join(' + ')}` : null,
    trackCount: r['track-count'] ?? (r.media ?? []).reduce((a, m) => a + (m['track-count'] ?? 0), 0) ?? null, status: r.status ?? null,
    groupId: r['release-group']?.id ?? null, secondary: r['release-group']?.['secondary-types'] ?? [], note: r.disambiguation || null, score: r.score ?? 0,
  }
}

/** "3:45" o "1:02:03" → segundos. */
const secs = (d: string | undefined) => { if (!d) return null; const p = d.split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, x) => a * 60 + x, 0) || null }

export class AlbumSources {
  readonly cache: OnlineCache
  private mb: Polite
  private dg: Polite | null
  private dz: Polite | null
  /** `deezer`: si se usa Deezer (la preferencia de Configuración; prendido de fábrica). */
  constructor(db: import('./db').Db, private opts: { ua: string; discogs?: DiscogsKey | null; deezer?: boolean; fetchFn?: FetchFn; gapMs?: number }) {
    this.cache = new OnlineCache(db)
    const f = opts.fetchFn ?? realFetch
    this.mb = new Polite('MusicBrainz', opts.gapMs ?? 1100, f, opts.ua)
    this.dg = opts.discogs ? new Polite('Discogs', opts.gapMs ?? 1100, f, opts.ua) : null
    this.dz = opts.deezer === false ? null : new Polite('Deezer', opts.gapMs ?? 400, f, opts.ua)
  }
  get hasDiscogs() { return !!this.dg }
  get hasDeezer() { return !!this.dz }

  /** Clave de caché de la búsqueda de un disco. */
  static searchKey = (artist: string, album: string) => `disco|${fold(artist)}|${fold(album)}`

  /** Ediciones de MusicBrainz con ese nombre y artista (de la caché si ya se buscó). */
  async editions(artist: string, album: string): Promise<Edition[]> {
    const key = AlbumSources.searchKey(artist, album)
    const hit = this.cache.get<Edition[]>('discos', `mb|${key}`)
    if (hit?.status === 'ok') return hit.data ?? []
    const who = VARIOUS.test(artist) ? '' : ` AND artist:(${lucene(artist)})`
    const ask = async (rel: string) => ((await this.mb.json<{ releases?: MbRelease[] }>(`https://musicbrainz.org/ws/2/release/?query=${enc(`release:(${rel})${who}`)}&fmt=json&limit=40`)).releases ?? []).map(mbEdition)
    try {
      let out = await ask(lucene(searchName(album)))
      // "Trueno Tierra" en MusicBrainz es "Truenotierra": si nada se llama así, se prueba todo junto y después parecido
      const words = lucene(searchName(album)).split(' ')
      const named = () => out.some((e) => sameAlbum(e.title, e.secondary, album))
      if (!named() && words.length > 1) out = [...out, ...await ask(words.join(''))]
      if (!named()) out = [...out, ...await ask(words.map((w) => (w.length > 3 ? `${w}~` : w)).join(' '))]
      this.cache.put('discos', `mb|${key}`, 'ok', out)
      return out
    } catch (e) { if (!sinConexion(e)) this.cache.put('discos', `mb|${key}`, 'error', { error: (e as Error).message }); throw e }
  }

  /** La lista de temas de una edición de MusicBrainz. */
  async tracklist(id: string): Promise<Tracklist> {
    const key = `edicion|${id}`
    const hit = this.cache.get<Tracklist>('discos', `mb|${key}`)
    if (hit?.status === 'ok' && hit.data) return hit.data
    const r = await this.mb.json<MbRelease>(`https://musicbrainz.org/ws/2/release/${id}?inc=recordings+artist-credits&fmt=json`)
    const tracks: ListedTrack[] = []
    for (const [mi, m] of (r.media ?? []).entries()) {
      for (const [ti, t] of (m.tracks ?? []).entries()) {
        tracks.push({ disc: m.position ?? mi + 1, pos: t.position ?? ti + 1, title: plainPunct(t.title), artist: plainPunct(credit(t['artist-credit'])) || null, length: t.length ? t.length / 1000 : null })
      }
    }
    const out: Tracklist = { ...mbEdition(r), tracks }
    this.cache.put('discos', `mb|${key}`, 'ok', out)
    return out
  }

  /** Lo que ya está guardado (sin pedir nada). */
  cachedEditions(artist: string, album: string): Edition[] | null {
    const hit = this.cache.get<Edition[]>('discos', `mb|${AlbumSources.searchKey(artist, album)}`)
    return hit?.status === 'ok' ? hit.data ?? [] : null
  }
  cachedTracklist(e: Pick<Edition, 'source' | 'id'>): Tracklist | null {
    const hit = this.cache.get<Tracklist>('discos', `${PFX[e.source]}|edicion|${e.id}`)
    return hit?.status === 'ok' ? hit.data : null
  }
  cachedDeezer(artist: string, album: string): Edition[] | null {
    const hit = this.cache.get<Edition[]>('discos', `dz|${AlbumSources.searchKey(artist, album)}`)
    return hit?.status === 'ok' ? hit.data ?? [] : null
  }
  cachedDiscogs(artist: string, album: string): Edition[] | null {
    const hit = this.cache.get<Edition[]>('discos', `dg|${AlbumSources.searchKey(artist, album)}`)
    return hit?.status === 'ok' ? hit.data ?? [] : null
  }

  // ---------- Deezer (sin clave) ----------
  async deezerEditions(artist: string, album: string): Promise<Edition[]> {
    if (!this.dz) return []
    const key = `dz|${AlbumSources.searchKey(artist, album)}`
    const hit = this.cache.get<Edition[]>('discos', key)
    if (hit?.status === 'ok') return hit.data ?? []
    const q = (s: string) => s.replace(/"/g, ' ')
    const j = await this.dz.json<{ data?: { id: number; title: string; nb_tracks?: number; record_type?: string; artist?: { name: string } }[]; error?: { message?: string } }>(
      `https://api.deezer.com/search/album?q=${enc(VARIOUS.test(artist) ? `album:"${q(searchName(album))}"` : `artist:"${q(artist)}" album:"${q(searchName(album))}"`)}&limit=15`)
    if (j.error) throw new Error(`Deezer: ${j.error.message ?? 'error'}`)
    const out: Edition[] = (j.data ?? []).map((a, i) => ({ source: 'deezer', id: String(a.id), title: plainPunct(a.title), artist: plainPunct(a.artist?.name ?? ''), date: null, country: null,
      format: 'Digital', trackCount: a.nb_tracks ?? null, status: 'Official', groupId: null, secondary: a.record_type === 'compile' ? ['Compilation'] : [], note: null, score: 100 - i * 3 }))
    this.cache.put('discos', key, 'ok', out)
    return out
  }

  async deezerTracklist(id: string): Promise<Tracklist> {
    const key = `dz|edicion|${id}`
    const hit = this.cache.get<Tracklist>('discos', key)
    if (hit?.status === 'ok' && hit.data) return hit.data
    if (!this.dz) throw new Error(tr({ es: 'Deezer está apagado', en: 'Deezer is turned off' }))
    const a = await this.dz.json<{ id: number; title: string; release_date?: string; record_type?: string; artist?: { name: string }; error?: { message?: string } }>(`https://api.deezer.com/album/${id}`)
    if (a.error) throw new Error(`Deezer: ${a.error.message ?? 'error'}`)
    const t = await this.dz.json<{ data?: { title: string; duration?: number; track_position?: number; disk_number?: number; artist?: { name: string } }[] }>(`https://api.deezer.com/album/${id}/tracks?limit=300`)
    const tracks: ListedTrack[] = (t.data ?? []).map((x, i) => ({ disc: x.disk_number ?? 1, pos: x.track_position ?? i + 1, title: plainPunct(x.title), artist: x.artist?.name ? plainPunct(x.artist.name) : null, length: x.duration ?? null }))
    const out: Tracklist = { source: 'deezer', id: String(a.id), title: plainPunct(a.title), artist: plainPunct(a.artist?.name ?? ''), date: a.release_date ?? null, country: null, format: 'Digital',
      trackCount: tracks.length, status: 'Official', groupId: null, secondary: a.record_type === 'compile' ? ['Compilation'] : [], note: null, score: 100, tracks }
    this.cache.put('discos', key, 'ok', out)
    return out
  }

  /** La lista de una edición de cualquier fuente. */
  tracklistOf(e: Pick<Edition, 'source' | 'id'>): Promise<Tracklist> {
    return e.source === 'deezer' ? this.deezerTracklist(e.id) : e.source === 'discogs' ? this.discogsTracklist(e.id) : this.tracklist(e.id)
  }

  // ---------- Discogs (solo con clave) ----------
  private get dh() { return { Authorization: discogsAuth(this.opts.discogs!) } }

  async discogsEditions(artist: string, album: string): Promise<Edition[]> {
    if (!this.dg) return []
    const key = AlbumSources.searchKey(artist, album)
    const hit = this.cache.get<Edition[]>('discos', `dg|${key}`)
    if (hit?.status === 'ok') return hit.data ?? []
    const who = VARIOUS.test(artist) ? '' : `&artist=${enc(artist)}`
    // con código de catálogo ("FUN007") se busca por él: es lo más seguro en los vinilos de sellos chicos
    const cat = catalogOf(album)
    const j = await this.dg.json<{ results?: { id: number; title: string; year?: string; country?: string; format?: string[] }[] }>(
      `https://api.discogs.com/database/search?type=release&${cat ? `catno=${enc(cat)}` : `release_title=${enc(searchName(album))}${who}`}&per_page=15`, this.dh)
    const out: Edition[] = (j.results ?? []).map((r, i) => {
      const cut = r.title.indexOf(' - ')
      return { source: 'discogs', id: String(r.id), title: cut > 0 ? r.title.slice(cut + 3) : r.title, artist: discogsName(cut > 0 ? r.title.slice(0, cut) : ''), date: r.year ?? null,
        country: r.country ?? null, format: (r.format ?? []).slice(0, 3).join(', ') || null, trackCount: null, status: null, groupId: null, secondary: [], note: null, score: 100 - i * 3 }
    })
    this.cache.put('discos', `dg|${key}`, 'ok', out)
    return out
  }

  async discogsTracklist(id: string): Promise<Tracklist> {
    const key = `edicion|${id}`
    const hit = this.cache.get<Tracklist>('discos', `dg|${key}`)
    if (hit?.status === 'ok' && hit.data) return hit.data
    if (!this.dg) throw new Error(tr({ es: 'Falta la clave de Discogs', en: 'The Discogs key is missing' }))
    const r = await this.dg.json<{ id: number; title: string; year?: number; country?: string; artists?: { name: string }[]; formats?: { name: string }[]
      tracklist?: { position?: string; type_?: string; title: string; duration?: string; artists?: { name: string }[] }[] }>(`https://api.discogs.com/releases/${id}`, this.dh)
    const tracks: ListedTrack[] = []
    let n = 0
    for (const t of r.tracklist ?? []) {
      if (t.type_ && t.type_ !== 'track') continue
      // "1-03" = disco 1, tema 3; "A1"/"B2" = lados de un vinilo (un solo disco)
      const m = (t.position ?? '').match(/^(\d+)[-.](\d+)$/)
      n++
      tracks.push({ disc: m ? Number(m[1]) : 1, pos: m ? Number(m[2]) : n, title: plainPunct(t.title), artist: t.artists?.length ? discogsName(t.artists.map((a) => a.name).join(', ')) : null, length: secs(t.duration) })
    }
    const out: Tracklist = {
      source: 'discogs', id: String(r.id), title: plainPunct(r.title), artist: discogsName((r.artists ?? []).map((a) => a.name).join(', ')), date: r.year ? String(r.year) : null,
      country: r.country ?? null, format: (r.formats ?? []).map((f) => f.name).join(', ') || null, trackCount: tracks.length, status: null, groupId: null, secondary: [], note: null, score: 100, tracks,
    }
    this.cache.put('discos', `dg|${key}`, 'ok', out)
    return out
  }
}
