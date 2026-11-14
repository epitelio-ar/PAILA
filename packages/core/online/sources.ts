// Las cuatro fuentes de nombres oficiales, cada una con su ritmo y su forma de pedir:
// - MusicBrainz: sin clave, 1 pedido por segundo; artistas con sus alias ("Los Redondos" es alias de Patricio Rey…).
// - Deezer: sin clave, ritmo tranquilo (su límite es 50 pedidos cada 5 s; PAILA hace menos de 3 por segundo).
// - Discogs: con la clave de la aplicación (Consumer Key + Secret) o el código personal; 60 pedidos por minuto con clave.
// - AcoustID: con la clave de aplicación; reconoce un tema por su huella acústica (máximo 3 pedidos por segundo).
// Solo se manda el artista, el título y la duración (o la huella acústica): nunca rutas ni nada del usuario.
import { ERR, KeyError, Polite, type FetchFn, realFetch } from './http'
import { discogsName, plainPunct, type ArtistHit, type CreditPart, type RecHit } from './hits'

/** Escapa lo que Lucene (el buscador de MusicBrainz) toma como operador. */
const lucene = (s: string) => s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, ' ').replace(/\s+/g, ' ').trim()
const enc = encodeURIComponent
/** Artista con nombre parecido (perdona una o dos letras: "Weekend" encuentra "Weeknd"). */
const fuzzy = (artist: string) => `artist:(${lucene(artist).split(' ').map((w) => (w.length > 3 ? `${w}~` : w)).join(' ')})`

interface MbArtist { id: string; name: string; score?: number; disambiguation?: string; country?: string; aliases?: { name: string }[] }
interface MbRec { title: string; length?: number; disambiguation?: string; 'artist-credit'?: { name?: string; joinphrase?: string; artist?: { id?: string; name?: string } }[]; releases?: { 'release-group'?: { 'secondary-types'?: string[] } }[] }

export class MusicBrainzNames {
  readonly http: Polite
  constructor(ua: string, fetchFn: FetchFn = realFetch, gapMs = 1100) { this.http = new Polite('MusicBrainz', gapMs, fetchFn, ua) }

  /** Artistas que se llaman así (por nombre o por alias). */
  async artists(name: string): Promise<ArtistHit[]> {
    const j = await this.http.json<{ artists?: MbArtist[] }>(`https://musicbrainz.org/ws/2/artist/?query=${enc(lucene(name))}&fmt=json&limit=5`)
    return (j.artists ?? []).map((a) => ({
      source: 'musicbrainz', id: a.id, name: plainPunct(a.name), score: a.score ?? 0,
      aliases: (a.aliases ?? []).map((x) => plainPunct(x.name)), note: [a.disambiguation, a.country].filter(Boolean).join(' · ') || undefined,
      ...(a.country ? { country: a.country } : {}),
    }))
  }

  /** Grabaciones con ese título: de los artistas ya encontrados (`arids`) o, si no hay, de un artista con nombre parecido. */
  async recordings(artist: string, title: string, arids: string[]): Promise<RecHit[]> {
    // un título cortado en 30 letras (tags viejos) termina con media palabra: se busca sin ella
    const words = lucene(title).split(' ')
    const t = title.length >= 28 && words.length > 2 ? words.slice(0, -1).join(' ') : words.join(' ')
    const who = arids.length ? `(${arids.map((id) => `arid:${id}`).join(' OR ')})` : fuzzy(artist)
    const ask = (w: string) => this.http.json<{ recordings?: MbRec[] }>(`https://musicbrainz.org/ws/2/recording/?query=${enc(`recording:(${t}) AND ${w}`)}&fmt=json&limit=10`)
    let j = await ask(who)
    // nada entre esos artistas ("The Weekend" es también una banda canadiense): se prueba con un nombre parecido
    if (!j.recordings?.length && arids.length) j = await ask(fuzzy(artist))
    return (j.recordings ?? []).map((r) => ({
      source: 'musicbrainz', title: plainPunct(r.title), length: r.length ? r.length / 1000 : null,
      // el nombre de la ficha del artista (el oficial), no el "acreditado como" de ese disco
      credit: (r['artist-credit'] ?? []).map((c): CreditPart => ({ name: plainPunct(c.artist?.name ?? c.name ?? ''), join: c.joinphrase ?? '' })),
      odd: /\b(live|en vivo|karaoke|instrumental|demo)\b/i.test(r.disambiguation ?? '') || (r.releases ?? []).every((x) => (x['release-group']?.['secondary-types'] ?? []).some((s) => ['Live', 'Compilation', 'Karaoke'].includes(s))),
    }))
  }
}

interface DzTrack { id?: number; title: string; duration?: number; artist?: { name: string }; album?: { title?: string; record_type?: string } }
export class Deezer {
  readonly http: Polite
  constructor(fetchFn: FetchFn = realFetch, gapMs = 400) { this.http = new Polite('Deezer', gapMs, fetchFn, 'PAILA') }

  async artists(name: string): Promise<ArtistHit[]> {
    const j = await this.http.json<{ data?: { id: number; name: string; nb_fan?: number }[]; error?: { message?: string } }>(`https://api.deezer.com/search/artist?q=${enc(name)}&limit=5`)
    if (j.error) throw new Error(`Deezer: ${j.error.message ?? 'error'}`)
    return (j.data ?? []).map((a, i) => ({ source: 'deezer', id: String(a.id), name: plainPunct(a.name), score: 100 - i * 5, aliases: [], fans: a.nb_fan ?? 0 }))
  }

  /** Primero la búsqueda exacta (artista y tema); si no hay nada, la libre (perdona errores de tipeo: "The Weekend"). */
  async recordings(artist: string, title: string): Promise<RecHit[]> {
    const q = (s: string) => s.replace(/"/g, ' ')
    let j = await this.http.json<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${enc(`artist:"${q(artist)}" track:"${q(title)}"`)}&limit=10`)
    if (!j.data?.length) j = await this.http.json<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${enc(`${q(artist)} ${q(title)}`)}&limit=10`)
    // un remix o versión que Deezer no tiene: se busca el tema original (sirve para el nombre del artista, no del título)
    const base = title.replace(/\s*[([][^)\]]*[)\]]/g, '').trim()
    if (!j.data?.length && base && base !== title) j = await this.http.json<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${enc(`${q(artist)} ${q(base)}`)}&limit=10`)
    return (j.data ?? []).map((t) => ({
      source: 'deezer', ...(t.id != null ? { id: String(t.id) } : {}), title: plainPunct(t.title), length: t.duration ?? null, credit: [{ name: plainPunct(t.artist?.name ?? ''), join: '' }],
      odd: /\b(karaoke|tribute|tributo|cover)\b/i.test(t.album?.title ?? ''),
    }))
  }

  /**
   * El tema exacto que tiene ese ISRC (el código único de cada grabación), o null si Deezer no lo tiene. Sin clave:
   * `track/isrc:<código>`. Sirve para "Traer una lista": un tema de un CSV de Spotify pasa a ser un tema de Deezer.
   */
  async byIsrc(isrc: string): Promise<RecHit | null> {
    const t = await this.http.json<DzTrack & { error?: { message?: string } }>(`https://api.deezer.com/2.0/track/isrc:${enc(isrc)}`)
    if (t.error || !t.title) return null
    return { source: 'deezer', ...(t.id != null ? { id: String(t.id) } : {}), title: plainPunct(t.title), length: t.duration ?? null, credit: [{ name: plainPunct(t.artist?.name ?? ''), join: '' }] }
  }
}

/** Clave de Discogs: la de la aplicación (Consumer Key + Secret) o el código personal de un usuario. */
export type DiscogsKey = { key: string; secret: string } | { token: string }
export const discogsAuth = (k: DiscogsKey) => ('token' in k ? `Discogs token=${k.token}` : `Discogs key=${k.key}, secret=${k.secret}`)

interface DgResult { title: string; year?: string; style?: string[]; genre?: string[] }
export class Discogs {
  readonly http: Polite
  constructor(private auth: DiscogsKey, ua: string, fetchFn: FetchFn = realFetch, gapMs = 1100) { this.http = new Polite('Discogs', gapMs, fetchFn, ua) }
  private get h() { return { Authorization: discogsAuth(this.auth) } }

  async artists(name: string): Promise<ArtistHit[]> {
    const j = await this.http.json<{ results?: { id: number; title: string }[] }>(`https://api.discogs.com/database/search?type=artist&q=${enc(name)}&per_page=5`, this.h)
    return (j.results ?? []).map((a, i) => ({ source: 'discogs', id: String(a.id), name: discogsName(a.title), score: 100 - i * 5, aliases: [] }))
  }

  /** Discos de ese artista que tienen un tema con ese título (Discogs no da el título exacto del tema ni su duración). */
  async recordings(artist: string, title: string): Promise<RecHit[]> {
    const j = await this.http.json<{ results?: DgResult[] }>(`https://api.discogs.com/database/search?type=release&artist=${enc(artist)}&track=${enc(title)}&per_page=5`, this.h)
    return (j.results ?? []).map((r) => {
      const who = r.title.includes(' - ') ? r.title.slice(0, r.title.indexOf(' - ')) : r.title
      return { source: 'discogs', title, titleFromQuery: true, length: null, credit: [{ name: discogsName(who), join: '' }], styles: r.style ?? [], genres: r.genre ?? [], release: r.title }
    })
  }

  /** ¿Anda la clave? (una búsqueda chiquita: con clave mala Discogs responde 401). */
  async test(): Promise<void> { await this.http.json(`https://api.discogs.com/database/search?type=artist&q=Nirvana&per_page=1`, this.h) }
}

interface AcRecording { title?: string; duration?: number; artists?: { name: string; joinphrase?: string }[]; releasegroups?: { type?: string; secondarytypes?: string[] }[] }
/** Un resultado de AcoustID: qué tan parecida es la huella (0 a 1) y las grabaciones de MusicBrainz que tienen esa huella. */
export interface AcoustHit { score: number; recordings: RecHit[] }
export class AcoustId {
  readonly http: Polite
  constructor(private key: string, ua: string, fetchFn: FetchFn = realFetch, gapMs = 400) { this.http = new Polite('AcoustID', gapMs, fetchFn, ua) }

  async lookup(fingerprint: string, duration: number): Promise<AcoustHit[]> {
    const body = `client=${enc(this.key)}&duration=${Math.round(duration)}&meta=recordings+releasegroups+compress&format=json&fingerprint=${enc(fingerprint)}`
    const j = await this.call<{ results?: { score: number; recordings?: AcRecording[] }[] }>('https://api.acoustid.org/v2/lookup', { method: 'POST', body })
    return (j.results ?? []).map((r) => ({
      score: r.score,
      recordings: (r.recordings ?? []).filter((x) => x.title && x.artists?.length).map((x) => ({
        source: 'acoustid', title: plainPunct(x.title!), length: x.duration ?? null,
        credit: x.artists!.map((a) => ({ name: plainPunct(a.name), join: a.joinphrase ?? '' })),
        odd: (x.releasegroups ?? []).length > 0 && (x.releasegroups ?? []).every((g) => (g.secondarytypes ?? []).some((s) => ['Live', 'Compilation', 'Karaoke'].includes(s))),
      })),
    }))
  }

  /** ¿Anda la clave? (busca un tema por su número de AcoustID; con clave mala responde "invalid API key"). */
  async test(): Promise<void> {
    await this.call(`https://api.acoustid.org/v2/lookup?client=${enc(this.key)}&trackid=9ff43b6a-4f16-427c-93c2-92307ca505e0&format=json`)
  }

  /** AcoustID contesta los errores en JSON (con código 400): se leen igual. */
  private async call<T>(url: string, init: { method?: string; body?: string } = {}): Promise<T> {
    const res = await this.http.get(url, init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}, init)
    let j: { status?: string; error?: { code?: number; message?: string } }
    try { j = (await res.json()) as typeof j } catch { throw new Error(ERR.respondio('AcoustID', res.status)) }
    if (j.status === 'ok') return j as T
    if (j.error?.code === 4 || /api key/i.test(j.error?.message ?? '')) throw new KeyError(ERR.claveApp('AcoustID'))
    throw new Error(`AcoustID: ${j.error?.message ?? ERR.soloRespondio(res.status)}`)
  }
}
