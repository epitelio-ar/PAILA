// Lo que devuelve cada fuente de internet, en un formato común (artistas encontrados y grabaciones encontradas), y las
// reglas de texto para comparar nombres oficiales con los de la biblioteca. Lo usan core/online/*.ts y core/official.ts.
import type { Source } from './http'

/** Un artista encontrado al buscar un nombre. */
/** `country`: el país del artista (código ISO, "AR"), si la fuente lo dice (MusicBrainz): lo usa core/artistcountry.ts. */
export interface ArtistHit { source: Source; id: string; name: string; score: number; aliases: string[]; fans?: number; note?: string; country?: string }
/** Un artista dentro del crédito de una grabación ("J Balvin" + " feat. " + "Bad Bunny"). */
export interface CreditPart { name: string; join: string }
/** Una grabación encontrada al buscar "artista + título". */
export interface RecHit {
  source: Source
  /** El número del tema en la fuente (Deezer), para saber si dos búsquedas devolvieron el mismo. */
  id?: string
  title: string
  credit: CreditPart[]
  /** Duración en segundos (null si la fuente no la da, como Discogs). */
  length: number | null
  /** Discogs no devuelve el título del tema, solo confirma que el artista tiene un disco con ese tema. */
  titleFromQuery?: boolean
  /** Vivo, recopilación, karaoke… (no cambia el nombre, pero conviene saberlo). */
  odd?: boolean
  /** Discogs: los estilos ("Deep House") y los géneros generales ("Electronic") del disco; los usa core/genres.ts. */
  styles?: string[]
  genres?: string[]
  /** Discogs: el disco donde está ("Lady Gaga - Bad Romance (Remixes)"), para saber si es de remixes. */
  release?: string
}

/** Comillas y guiones tipográficos de las bases de datos ("Don’t", "Guns N’ Roses") → los comunes del teclado. */
export const plainPunct = (s: string) => s.replace(/[’‘ʼ´]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()

/** "Daft Punk (2)" (Discogs numera los homónimos) o "Prince*" (variante de nombre) → "Daft Punk". */
export const discogsName = (s: string) => plainPunct(s.replace(/\s*\(\d+\)$/, '').replace(/\*$/, ''))

/** "Various Artists" y parecidos nunca son el artista de un tema. */
export const isVarious = (s: string) => /^(various( artists)?|varios( artistas)?|va|artistas varios|v\.a\.)$/i.test(s.trim())

/** El crédito armado como lo escribe PAILA: el "feat." siempre igual (como "Emilia feat. TINI"). */
export function creditText(parts: CreditPart[]): string {
  return plainPunct(parts.map((p, i) => p.name + (i < parts.length - 1 ? normJoin(p.join) : '')).join(''))
}
const normJoin = (j: string) => (/^\s*(feat\.?|ft\.?|featuring|con|with)\s*$/i.test(j) ? ' feat. ' : /^\s*,\s*$/.test(j) ? ', ' : /^\s*&\s*$/.test(j) ? ' & ' : j || ', ')

/**
 * El título "de comparación" de una fuente: sin "(feat. X)" ni "- Remastered 2011" (Deezer los pega al título) ni
 * "(Remasterizado)". No se usa para proponer: solo para reconocer que es el mismo tema.
 */
export function bareTitle(t: string): string {
  return plainPunct(t)
    .replace(/\s*[([](?:feat|ft|featuring|con)\b\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed|izado)?|remasterizad[oa]|mono|stereo|single version|radio edit|live|en vivo)\b.*$/i, '')
    .replace(/\s*[([](?:\d{4}\s+)?(?:remaster(?:ed|izado)?|remasterizad[oa])(?:\s+\d{4})?(?:\s+version)?[)\]]/gi, '')
    .replace(/\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|remasterizad[oa])(?:\s+\d{4})?$/i, '') // "Jet-Set?? Remasterizado 2007"
    .trim()
}

/** Distancia de edición (para "The Weekend" ↔ "The Weeknd", "Led Zepelin" ↔ "Led Zeppelin"). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
/** Parecido de 0 a 1 entre dos textos ya normalizados. */
export const similarity = (a: string, b: string) => (!a.length && !b.length ? 1 : 1 - editDistance(a, b) / Math.max(a.length, b.length))
