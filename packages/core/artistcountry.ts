// País del artista (decidido el 22/10): sale de lo que MusicBrainz contestó en "Completar desde internet"
// (la búsqueda de artistas de los nombres oficiales, guardada en `online_cache`), sin pedidos nuevos. Es un dato de PAILA:
// no se escribe en los archivos. Se usa en la ficha del tema y en Estadísticas.
// Solo con seguridad: el artista de MusicBrainz tiene que llamarse igual (o tener ese alias) y sumar 90 puntos o más; si
// hay dos con el mismo nombre de países distintos ("Nirvana" de Estados Unidos y de Inglaterra), no se dice nada.
import type { Db } from './db'
import { OnlineCache } from './online/http'
import type { ArtistHit } from './online/hits'
import { artistKey, mainArtist } from './official-findings'
import { relate } from './official'
import { idioma, tr, type Idioma } from '@paila/shared/idioma'

/** El código de país (ISO, "AR") de un artista encontrado; en lo guardado antes del 22/10 viene al final de `note`. */
export function hitCountry(h: ArtistHit): string | null {
  if (h.country) return h.country.toUpperCase()
  const last = h.note?.split(' · ').pop()?.trim()
  return last && /^[A-Z]{2}$/.test(last) ? last : null
}

/** El país de un artista según MusicBrainz (código ISO), o null si no se buscó o no es seguro. */
export function artistCountry(cache: OnlineCache, artist: string): string | null {
  const name = mainArtist(artist)
  const hits = cache.get<ArtistHit[]>('musicbrainz', artistKey(name))
  if (hits?.status !== 'ok' || !hits.data?.length) return null
  const sure = hits.data.filter((h) => h.score >= 90 && (relate(name, h.name, h.aliases) === 'same' || relate(name, h.name, h.aliases) === 'alias'))
  const codes = new Set(sure.map(hitCountry).filter((c): c is string => !!c))
  return codes.size === 1 ? [...codes][0] : null
}

const regions = new Map<Idioma, Intl.DisplayNames>()
/** "AR" → "Argentina", en el idioma de ahora. "XW" (todo el mundo) y "XE" (Europa) son de MusicBrainz. */
export function countryName(code: string): string {
  if (code === 'XW') return tr({ es: 'Todo el mundo', en: 'Worldwide' })
  if (code === 'XE') return tr({ es: 'Europa', en: 'Europe' })
  try {
    const i = idioma()
    let r = regions.get(i)
    if (!r) { r = new Intl.DisplayNames([i], { type: 'region' }); regions.set(i, r) }
    return r.of(code) ?? code
  } catch { return code }
}

/** El país de cada artista que aparece en Música (clave: el artista principal plegado), en una pasada por la caché. */
export function countriesFor(db: Db, artists: Iterable<string>): Map<string, string> {
  const cache = new OnlineCache(db)
  const out = new Map<string, string>()
  for (const a of artists) {
    const k = artistKey(mainArtist(a))
    if (out.has(k)) continue
    const c = artistCountry(cache, a)
    if (c) out.set(k, c)
  }
  return out
}
