// Last.fm: las etiquetas que la gente le pone a cada tema y a cada artista ("deep house", "rock nacional", pero también
// "seen live"). Necesita la clave (API key) de cada usuario. Se manda solo el artista y el título; nunca rutas ni nada más.
// Su límite: unos 5 pedidos por segundo en promedio; PAILA hace 3.
import { ERR, KeyError, Polite, type FetchFn, realFetch } from './http'

/** Una etiqueta con su peso: Last.fm da 100 a la más usada y el resto en proporción. */
export interface LastfmTag { name: string; count: number }

const enc = encodeURIComponent
interface TagsJson { toptags?: { tag?: { name?: string; count?: number | string }[] | { name?: string; count?: number | string } }; error?: number; message?: string }

export class LastFm {
  readonly http: Polite
  constructor(private key: string, ua: string, fetchFn: FetchFn = realFetch, gapMs = 330) { this.http = new Polite('Last.fm', gapMs, fetchFn, ua) }

  /** Las etiquetas del tema (Last.fm corrige solo los nombres mal escritos). [] si no lo conoce. */
  trackTags(artist: string, title: string): Promise<LastfmTag[]> {
    return this.tags(`method=track.gettoptags&artist=${enc(artist)}&track=${enc(title)}&autocorrect=1`)
  }

  /** Las etiquetas del artista: sirven cuando el tema no tiene. */
  artistTags(artist: string): Promise<LastfmTag[]> {
    return this.tags(`method=artist.gettoptags&artist=${enc(artist)}&autocorrect=1`)
  }

  /** ¿Anda la clave? (con clave mala Last.fm responde el error 10). */
  async test(): Promise<void> { await this.call('method=tag.getinfo&tag=rock') }

  private async tags(q: string): Promise<LastfmTag[]> {
    const j = await this.call(q)
    if (!j) return []
    const raw = j.toptags?.tag
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    return list.filter((t) => t.name).slice(0, 20).map((t) => ({ name: String(t.name).trim(), count: Number(t.count) || 0 }))
  }

  /** Last.fm contesta los errores en JSON (a veces con código 4xx): se leen igual. null = no lo conoce (error 6). */
  private async call(q: string): Promise<TagsJson | null> {
    const res = await this.http.get(`https://ws.audioscrobbler.com/2.0/?${q}&api_key=${enc(this.key)}&format=json`)
    let j: TagsJson
    try { j = (await res.json()) as TagsJson } catch { throw new Error(ERR.respondio('Last.fm', res.status)) }
    if (!j.error) {
      if (!res.ok) throw new Error(ERR.respondio('Last.fm', res.status))
      return j
    }
    if (j.error === 6) return null // no encontró el tema o el artista
    if (j.error === 10 || j.error === 26 || j.error === 4) throw new KeyError(ERR.clave('Last.fm'))
    if (j.error === 29) throw new Error(ERR.despacio('Last.fm'))
    throw new Error(`Last.fm: ${j.message ?? `error ${j.error}`}`)
  }
}
