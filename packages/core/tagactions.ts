// Acciones de edición de tags: funciones puras que, dado el estado actual de cada tema, devuelven los cambios a proponer.
// No tocan archivos: el resultado va a "Cambios pendientes" (Changes.stageMany).
import type { TagField } from './tagio'
import type { Origen } from './confianza'
import { tr } from '@paila/shared/idioma'

/** El patrón tiene un %campo% que no existe (se ve en la pantalla de acciones de tags). */
const campoDesconocido = (k: string) => tr({ es: `Campo desconocido en el patrón: %${k}%`, en: `Unknown field in the pattern: %${k}%` })

export interface TrackLike { id: number; rel: string; title: string | null; artist: string | null; albumArtist: string | null; album: string | null; track: string | null; year: string | null; genre: string | null }
/** `bpm`/`key` y `expect`: el BPM y el tono del tag que borra Arreglar nombres (core/tidy-djtag.ts), si el archivo sigue diciendo `expect`. */
/** `source`: qué herramienta lo propone (el orden de confianza, core/confianza.ts). */
export interface Proposal { id: number; field: TagField | 'filename' | 'extension' | 'bpm' | 'key'; value: string | null; expect?: string | null; source?: Origen }

const get = (t: TrackLike, f: TagField) => t[f]
const same = (a: string | null, b: string | null) => (a ?? '') === (b ?? '')
const base = (rel: string) => rel.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Aplica una transformación de texto a un campo de cada tema y devuelve solo lo que cambia. */
function mapField(tracks: TrackLike[], field: TagField, fn: (v: string, t: TrackLike) => string | null): Proposal[] {
  const out: Proposal[] = []
  for (const t of tracks) {
    const cur = get(t, field)
    if (!cur) continue
    const next = fn(cur, t)
    if (!same(cur, next)) out.push({ id: t.id, field, value: next })
  }
  return out
}

/** Reemplazar texto (literal o con expresión regular). */
export function replaceText(tracks: TrackLike[], field: TagField, find: string, repl: string, opts: { regex?: boolean; ignoreCase?: boolean } = {}): Proposal[] {
  if (!find) return []
  const re = new RegExp(opts.regex ? find : escapeRe(find), opts.ignoreCase ? 'gi' : 'g')
  return mapField(tracks, field, (v) => v.replace(re, repl).replace(/\s{2,}/g, ' ').trim() || null)
}

const SMALL = new Set(['a', 'al', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'y', 'o', 'u', 'con', 'por', 'para', 'un', 'una', 'the', 'of', 'and', 'in', 'on', 'to', 'at', 'vs', 'feat', 'ft'])
export type CaseMode = 'title' | 'lower' | 'upper' | 'sentence'

export function changeCase(v: string, mode: CaseMode): string {
  if (mode === 'lower') return v.toLowerCase()
  if (mode === 'upper') return v.toUpperCase()
  const low = v.toLowerCase()
  if (mode === 'sentence') return low.replace(/^(\s*\S)/u, (m) => m.toUpperCase())
  let first = true
  return low.replace(/(\p{L}[\p{L}\p{N}']*)/gu, (w) => {
    const keep = !first && SMALL.has(w)
    first = false
    return keep ? w : w[0].toUpperCase() + w.slice(1)
  })
}

export function caseAction(tracks: TrackLike[], field: TagField, mode: CaseMode): Proposal[] {
  return mapField(tracks, field, (v) => changeCase(v, mode))
}

/** Numera los temas en el orden recibido (1, 2, 3… o 01, 02, 03…). */
export function numberTracks(tracks: TrackLike[], opts: { start?: number; pad?: boolean } = {}): Proposal[] {
  const start = opts.start ?? 1
  const width = opts.pad ? Math.max(2, String(start + tracks.length - 1).length) : 0
  const out: Proposal[] = []
  tracks.forEach((t, i) => {
    const n = start + i
    if (Number(t.track) !== n) out.push({ id: t.id, field: 'track', value: String(n).padStart(width, '0') })
  })
  return out
}

// Windows-1252 en el rango 0x80–0x9F, que es donde se rompen los caracteres.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a,
  0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f,
}

/** Caracteres rotos típicos ("GarcÃ­a" → "García"): texto UTF-8 que se leyó como Windows-1252. */
export function fixMojibake(v: string): string {
  if (!/[ÃÂ]/.test(v)) return v
  try {
    const bytes = Uint8Array.from(Array.from(v, (c) => {
      const code = c.codePointAt(0)!
      if (code < 256) return code
      const b = CP1252[code]
      if (b === undefined) throw new Error('no es mojibake')
      return b
    }))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return v }
}

export function mojibakeAction(tracks: TrackLike[], fields: TagField[]): Proposal[] {
  return fields.flatMap((f) => mapField(tracks, f, fixMojibake))
}

const YT_JUNK = [
  /\s*[[(]\s*(official\s*)?((?:4k|hd|hq)\s*)?(music\s*)?(lyric(s)?\s*)?(video|videoclip|audio|visuali[sz]er|clip)(\s*oficial)?(\s*(?:hd|hq|4k))?\s*[\])]/gi,
  // "(Full Album)" no es basura: avisa que el archivo es un disco entero
  /\s*[[(]\s*(video\s*oficial|videoclip\s*oficial|audio\s*oficial|letra|lyrics?|hd|hq|4k|1080p|720p|(4k\s*)?remaster(ed)?(\s*\d{4})?)(\s*(?:hd|hq|4k))?\s*[\])]/gi,
  /\s*[[(]\s*www\.[^\])]+[\])]/gi,
  /\s*-?\s*\bwww\.[\w.-]+\.\w{2,}\b/gi,
  /\s*[[(]\s*[\w-]{11}\s*[\])]\s*$/g, // id de YouTube al final
  /\s*\[[^[\]]*\b(?:records|recordings|music)\]\s*$/gi, // sello al final: "[La Menace Records]", "[Sudbeat Music]"
  /\s+(?:official\s+(?:music\s+)?(?:video|audio)|(?:video|audio)\s+oficial)\s*$/gi, // sin paréntesis: "LOBA Official Video"
  /(?:\s+#\p{L}[\p{L}\p{N}_]*)+\s*$/gu, // hashtags al final ("#flowbr #elturko"); "#11" o "#Ysya2020 Vol. 6" quedan
  /\s+-[A-Z]{2,}\d{2,}-?\s*$/g, // n.º de catálogo: "Magalenha -BEAU003-"
]

/** Saca la basura de un texto (YouTube, sitios de descarga). `keepSpaces` deja los espacios dobles (sirven para leer nombres de archivo). */
export function stripJunk(s: string, keepSpaces = false): string {
  let t = s
  for (const re of YT_JUNK) t = t.replace(re, '')
  return keepSpaces ? t.trim() : t.replace(/\s{2,}/g, ' ').trim()
}

/** Limpieza de títulos de YouTube: saca "(Official Video)", "[HD]", "www.sitio.com"… y separa "Artista - Título". */
export function youtubeClean(tracks: TrackLike[]): Proposal[] {
  const out: Proposal[] = []
  const push = (t: TrackLike, field: TagField, value: string | null) => { if (!same(get(t, field), value)) out.push({ id: t.id, field, value }) }
  for (const t of tracks) {
    // Sin título en los tags se parte del nombre del archivo, sin el número de tema del principio.
    let title = (t.title ?? base(t.rel).replace(/^\d{1,3}\s*[-._)]?\s+/, '')).replace(/_/g, ' ')
    let artist = t.artist
    for (const re of YT_JUNK) title = title.replace(re, '')
    title = title.replace(/\s{2,}/g, ' ').trim()
    const m = title.match(/^(.{2,}?)\s+[-–—]\s+(.+)$/)
    if (m && (!artist || artist.toLowerCase() === m[1].toLowerCase() || /^(unknown|desconocido)/i.test(artist))) {
      artist = m[1].trim(); title = m[2].trim()
    }
    if (title) push(t, 'title', title)
    if (artist) push(t, 'artist', artist)
  }
  return out
}

/** Tag → Nombre de archivo: arma el nombre con un patrón como "%n% - %artista% - %titulo%". Salta los temas a los que les falta algún dato. */
export function tagsToFileName(tracks: TrackLike[], pattern: string): Proposal[] {
  const out: Proposal[] = []
  for (const t of tracks) {
    let missing = false
    const name = pattern.replace(/%([^%]+)%/g, (_m, k: string) => {
      const f = PATTERN_KEYS[k.toLowerCase()]
      if (!f) throw new Error(campoDesconocido(k))
      let v = t[f]
      if (!v) { missing = true; return '' }
      if (f === 'track') v = v.padStart(2, '0')
      return v
    })
    if (missing) continue
    const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s{2,}/g, ' ').replace(/[. ]+$/, '').trim()
    if (clean && clean !== base(t.rel)) out.push({ id: t.id, field: 'filename', value: clean })
  }
  return out
}

const PATTERN_KEYS: Record<string, TagField> = {
  artista: 'artist', titulo: 'title', título: 'title', album: 'album', álbum: 'album', n: 'track', año: 'year', anio: 'year',
  genero: 'genre', género: 'genre', artistaalbum: 'albumArtist',
}

/** Nombre de archivo → Tag, con un patrón como "%n% - %artista% - %titulo%". Devuelve null si el nombre no encaja. */
export function parsePattern(rel: string, pattern: string): Partial<Record<TagField, string>> | null {
  const names: TagField[] = []
  const src = pattern.split(/(%[^%]+%)/).map((part) => {
    const m = part.match(/^%([^%]+)%$/)
    if (!m) return escapeRe(part)
    const f = PATTERN_KEYS[m[1].toLowerCase()]
    if (!f) throw new Error(campoDesconocido(m[1]))
    names.push(f)
    return f === 'track' || f === 'year' ? '(\\d+)' : '(.+?)'
  }).join('')
  const m = base(rel).match(new RegExp(`^${src}$`))
  if (!m) return null
  const out: Partial<Record<TagField, string>> = {}
  names.forEach((f, i) => { out[f] = m[i + 1].trim() })
  return out
}

export function fileNameToTags(tracks: TrackLike[], pattern: string): Proposal[] {
  const out: Proposal[] = []
  for (const t of tracks) {
    const p = parsePattern(t.rel, pattern)
    if (!p) continue
    for (const [f, v] of Object.entries(p) as [TagField, string][]) if (!same(get(t, f), v)) out.push({ id: t.id, field: f, value: v })
  }
  return out
}

/** Carpeta → Tag: ".../Artista/2008 - Álbum/tema.mp3". Solo completa lo que está vacío. */
export function folderToTags(tracks: TrackLike[]): Proposal[] {
  const out: Proposal[] = []
  for (const t of tracks) {
    const parts = t.rel.split(/[\\/]/)
    if (parts.length < 3) continue
    const albumDir = parts[parts.length - 2]
    const artistDir = parts[parts.length - 3]
    const m = albumDir.match(/^(\d{4})\s*[-–]\s*(.+)$/)
    if (!t.album) out.push({ id: t.id, field: 'album', value: (m ? m[2] : albumDir).trim() })
    if (m && !t.year) out.push({ id: t.id, field: 'year', value: m[1] })
    if (!t.artist) out.push({ id: t.id, field: 'artist', value: artistDir.trim() })
  }
  return out
}
