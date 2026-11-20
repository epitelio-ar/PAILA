// Organizar: cómo se escribe la carpeta de cada artista (repaso de criterios del 24/10, el autor: "cómo se escribe popularmente o
// como el autor lo publicó; hay que poder googlear y ver qué es real"): el nombre oficial con sus mayúsculas, comprobable en
// MusicBrainz ("ABBA", "a-ha", "CA7RIEL"); si no está en internet, la forma que más usás. Y una colaboración de uno o dos temas va a la
// carpeta del primer artista si ese tiene una con más temas ("Charly García & Pedro Aznar" en "Charly García").
// Y un nombre con coma que es un solo artista ("Earth, Wind & Fire") no se corta en la coma (wholeNames).
import type { Db } from './db'
import { caseKind, fold, loose } from './names'
import { OnlineCache } from './online/http'
import type { ArtistHit, RecHit } from './online/hits'
import { mainArtist as leadArtist, recKey } from './official-findings'

/** Para juntar las formas de escribir un dúo: "Wisin & Yandel" y "Wisin Y Yandel", "Ángel & Khriz" y "Angel y Khriz". */
export const duoKey = (s: string) => loose(fold(s).replace(/\s+(?:&|y|and)\s+/g, ' '))
/** Para comparar nombres con coma: sin acentos ni mayúsculas, con la coma en su lugar ("Earth,Wind & Fire" = "earth, wind & fire"). */
const commaKey = (s: string) => fold(s).replace(/\s*,\s*/g, ', ')

/**
 * Los nombres con coma que son un solo artista, para que la carpeta no se corte en la coma ("Earth, Wind & Fire" iba a "Earth/",
 * "Lipps, Inc." a "Lipps/", "Tyler, The Creator" a "Tyler/": punto 1 real del 24/10). Lo es si MusicBrainz, en la caché, tiene un
 * artista con ese nombre (o alias) o lo acredita así en un tema; si ya tenés una carpeta con ese nombre; o si es el artista del disco
 * de dos temas o más de otro artista ("Earth, Wind & Fire" con "Earth, Wind & Fire feat. The Emotions"). Deezer y Discogs no
 * cuentan: juntan a varios en un crédito ("C. Tangana, Toquinho", "Q.U.A.K.E, OR"). Si cada parte es un artista que tenés con
 * temas propios ("Charly García, Pedro Aznar"), es una lista: se corta como siempre.
 */
export function wholeNames(db: Db, rows: { rel: string; artist: string | null; albumArtist: string | null; title: string | null }[]): (name: string) => boolean {
  const cache = new OnlineCache(db), known = new Set<string>(), solo = new Set<string>(), asked = new Set<string>()
  const add = (n: string) => { if (n.includes(',')) known.add(commaKey(n)) }
  // la caché guardó cada búsqueda con el nombre como venía cortado entonces ("a:earthwind", "a:lippsinc", "a:tyler"): se prueban todos
  const keys = (a: string) => new Set([a, leadArtist(a), ...[...a.matchAll(/\s*(?:,|&|\band\b|\bx\b|\by\b)\s*/gi)].map((m) => a.slice(0, m.index))].map(loose))
  const discs = new Map<string, number>()
  for (const r of rows) {
    for (const seg of r.rel.split('/').slice(0, -1)) add(seg)
    for (const a of [r.artist, r.albumArtist]) {
      const lead = a?.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim()
      if (lead && !/[,;]/.test(lead)) solo.add(commaKey(lead))
      if (!lead?.includes(',') || asked.has(`${lead}|${r.title}`)) continue
      asked.add(`${lead}|${r.title}`)
      for (const k of keys(lead)) {
        for (const h of cache.lista<ArtistHit>('musicbrainz', `a:${k}`)) [h.name, ...h.aliases].forEach(add)
        if (r.title) for (const h of cache.lista<RecHit>('musicbrainz', `r:${k}|${loose(r.title)}`)) h.credit.forEach((c) => add(c.name))
      }
    }
    if (r.albumArtist?.includes(',') && commaKey(r.albumArtist) !== commaKey(r.artist ?? '')) discs.set(commaKey(r.albumArtist), (discs.get(commaKey(r.albumArtist)) ?? 0) + 1)
  }
  for (const [k, n] of discs) if (n >= 2) known.add(k)
  return (name) => known.has(commaKey(name)) && !commaKey(name).split(', ').every((p) => solo.has(p))
}

/**
 * El primero de una lista de artistas ("Bizarrap, Duki" → "Bizarrap"; el ";" separa igual: "Daniel Agostini;Grupo Sombras"), salvo
 * que el nombre con coma sea un solo artista (`whole`): el más largo que lo es ("Earth, Wind & Fire, Chaka Khan" → "Earth, Wind & Fire").
 */
export function firstOfList(s: string, whole?: (name: string) => boolean): string {
  const bits = s.split(/\s*;\s*/)[0].split(/\s*,\s*/)
  if (whole) for (let k = bits.length; k > 1; k--) { const n = bits.slice(0, k).join(', ').trim(); if (whole(n)) return n }
  return bits[0].trim()
}

/** Signos que Windows no deja en una carpeta ("Ca7riel/Paco Amoroso" quedaría "Ca7riel_Paco Amoroso"). */
const odd = (v: string) => Number(/[<>:"/\\|?*]/.test(v))

/**
 * El nombre oficial de un artista con sus mayúsculas: el de MusicBrainz, si solo cambia en mayúsculas (con otras letras, signos
 * o acentos puede ser otro artista: "C.R.O" no es "CRO", "NU" no es "Ñu") y Deezer no lo publica con otras mayúsculas (MusicBrainz a
 * veces normaliza a su manera: "Se va el camello"). `rows`: los temas, para buscar cómo los acredita Deezer.
 */
export function officialSpelling(db: Db, rows: { artist: string | null; title: string | null }[]): (name: string) => string | null {
  const cache = new OnlineCache(db)
  cache.known('musicbrainz'); cache.known('deezer')
  const deezer = new Map<string, Set<string>>() // nombre en minúsculas → cómo lo escribe Deezer
  for (const r of rows) {
    if (!r.artist || !r.title) continue
    for (const h of cache.lista<RecHit>('deezer', recKey(r.artist, r.title))) for (const c of h.credit) {
      const k = c.name.toLowerCase(), set = deezer.get(k) ?? new Set<string>()
      set.add(c.name); deezer.set(k, set)
    }
  }
  const memo = new Map<string, string | null>()
  return (name) => {
    const k = name.toLowerCase()
    if (!memo.has(k)) {
      const mb = cache.lista<ArtistHit>('musicbrainz', `a:${loose(name)}`).find((h) => h.score >= 95 && h.name.toLowerCase() === k)?.name ?? null
      const dz = deezer.get(k)
      memo.set(k, mb && (!dz || (dz.size === 1 && dz.has(mb))) ? mb : null)
    }
    return memo.get(k)!
  }
}

/**
 * La forma de escribir una carpeta entre las de tus tags (`m`: forma → cuántos temas). La oficial, si la hay; si no, la que no
 * está toda en mayúsculas o minúsculas ("se va el camello" no la escribe así nadie), la que más usás, la de más acentos y, si
 * empatan en todo, siempre la misma (no la que aparece primero según dónde están hoy los archivos: un segundo Organizar quería pasar
 * "CA7RIEL & Paco Amoroso" a "ca7riel & Paco Amoroso"). Lo oficial no baja un "DJ" o un "MC" ("Dj Peligro"): ahí manda la regla de
 * Arreglar nombres. null: queda como está.
 */
export function rankSpellings(m: Map<string, number> | undefined, official: string | null = null): string | null {
  if (!m) return null
  const lowersDj = (o: string) => /\b(?:Dj|Mc|dj|mc)\b/.test(o) && [...m.keys()].some((v) => /\b(?:DJ|MC)\b/.test(v))
  if (official && !odd(official) && !lowersDj(official)) return m.size === 1 && m.has(official) ? null : official
  if (m.size < 2) return null
  const accents = (s: string) => s.normalize('NFD').length - s.length
  const mixed = (s: string) => Number(caseKind(s) === 'mixed')
  return [...m.entries()].sort((a, b) => odd(a[0]) - odd(b[0]) || mixed(b[0]) - mixed(a[0]) || b[1] - a[1]
    || accents(b[0]) - accents(a[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0]
}

/** "Charly García & Pedro Aznar", "Miranda! x Maria Becerra x FMK": el primer nombre y el resto. */
const COLLAB = /^(.+?)\s+(?:&|x|y|and|vs\.?|con)\s+\S/i
/** Una colaboración con más temas que esto es un grupo con nombre propio ("Wisin & Yandel", "Indio Solari y los Fundamentalistas…"). */
const COLLAB_MAX = 2

/**
 * Las colaboraciones que van a la carpeta del primer artista: carpeta → carpeta del primero. `count`: cuántos temas van a cada
 * carpeta (por su clave); `key`: la clave de una carpeta; `name`: cómo se escribe la carpeta de una clave.
 */
export function collabTargets(folders: Iterable<string>, count: (k: string) => number, key: (name: string) => string, name: (k: string) => string | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of folders) {
    const m = f.match(COLLAB)
    if (!m || count(key(f)) > COLLAB_MAX) continue
    const first = key(m[1])
    if (count(first) > count(key(f))) { const n = name(first); if (n) out.set(key(f), n) }
  }
  return out
}

/** El año para la carpeta: cuatro cifras de un año posible (1800 a 2099). "0001" o "01-0" son tags rotos: van sin año (Ordenar, 13/11). */
export const anioDe = (y: string | null | undefined): string | null => (y && /^(1[89]|20)\d\d/.test(y.trim()) ? y.trim().slice(0, 4) : null)

/**
 * Un disco, una carpeta: si sus temas traen años distintos ("inFame" sin año y "2004 - inFame"), la carpeta usa el año más
 * repetido (y si empatan, el más viejo). Un año roto no vota. Solo para la carpeta: los tags no se tocan (cambia `year` de cada fila).
 */
export function anioPorDisco<R extends { album: string | null; year: string | null }>(rows: R[], clave: (r: R) => string) {
  const years = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const y = anioDe(r.year)
    if (!r.album || !y) continue
    const k = clave(r), m = years.get(k) ?? new Map<string, number>(); m.set(y, (m.get(y) ?? 0) + 1); years.set(k, m)
  }
  for (const r of rows) {
    const m = r.album ? years.get(clave(r)) : undefined
    if (m) r.year = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  }
}

/** El n.º de tema para el nombre: "3" o "3/12" → "03"; una pista de vinilo ("A1", "B2") queda así; sin número, nada (antes "00 - "). */
export function numeroDe(track: string | null | undefined): string {
  const s = track?.trim() ?? ''
  if (/^[A-Za-z]\d{1,2}$/.test(s)) return s.toUpperCase()
  const n = parseInt(s, 10)
  return n > 0 ? String(n).padStart(2, '0') : ''
}

/**
 * El nombre de una carpeta, antes de sacarle lo que Windows no deja: "Live: Era '87-'93" → "Live - Era '87-'93" (no
 * "Live_ Era") y el "?" del final se va ("WHERE DO WE GO?" → "WHERE DO WE GO", no "GO_"). Solo carpetas: el nombre del archivo
 * queda como siempre, para no renombrar lo que ya está ordenado (corrida supervisada, 13/11). `archivo` = es el último pedazo.
 */
export const carpetaSegura = (s: string, archivo = false) => (archivo ? s : s.replace(/\s*:\s+/g, ' - ').replace(/\?+\s*$/, ''))
