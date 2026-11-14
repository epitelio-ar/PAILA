// Reglas de nombres de artistas para "Arreglar nombres y tags": "feat." parejo, el artista repetido en el título, canales y
// sellos guardados como artista, y cómo se escribe cada artista en la propia biblioteca (ArtistSpelling). Funciones puras.
// Tienen su test en tests/names.test.ts.
import { VERSION_WORD, caseKind, fold, loose, sameCase, stylized, tidySpaces } from './names'

const FEAT_WORD = String.raw`(?:feat|ft|featuring)`
/** Unifica cómo se escribe "feat." dentro del artista ("Ft", "ft.-", "Feat", "featuring") y saca repetidos. */
export function normalizeFeat(artist: string): string {
  const s = artist.replace(new RegExp(String.raw`\s+${FEAT_WORD}\b\.?[\s.\-]*`, 'gi'), ' feat. ')
  const parts = s.split(' feat. ').map((p) => p.trim()).filter(Boolean)
  const seen = new Set<string>()
  const out = parts.filter((p) => { const k = fold(p); if (seen.has(k)) return false; seen.add(k); return true })
  return out.length > 1 ? `${out[0]} feat. ${out.slice(1).join(', ')}` : (out[0] ?? artist)
}

/** "Dj" y "Mc" van en mayúsculas ("Dj Lauuh" → "DJ Lauuh", "Mc Caco" → "MC Caco"). */
export const djMc = (artist: string) => artist.replace(/\b[Dd][Jj]\b/g, 'DJ').replace(/\b(?:Mc|mc|mC)\b(?=\s|$|,)/g, 'MC')

/**
 * Separa el "feat." del título: "Dancin (feat. Luvli) (Krono Remix)" → título "Dancin (Krono Remix)" y feat "Luvli".
 * También "Someday featuring AHKI (Original Mix)", "BICI feat Ak4_20, Juhn & Juanka", "Bugutu ft.El Verdadero".
 * Sin paréntesis tiene que ser corto y estar al final: "Adana Twins feat  Glowal   My Computer Original Mix" no se toca.
 */
export function splitFeat(title: string): { title: string; feat: string | null } {
  const re = new RegExp(String.raw`\s*([([])?\s*\b${FEAT_WORD}\b\.?[\s.\-]*([^()[\]]+?)\s*[)\]]?(?=\s*[([]|\s+-\s|$)`, 'i')
  const m = title.match(re)
  if (!m || !m[2].trim()) return { title, feat: null }
  const feat = m[2].trim()
  if (!m[1] && (/\s{2,}/.test(m[0]) || VERSION_WORD.test(feat) || /\b(?:original|extended|radio)\b/i.test(feat) || feat.split(/\s+/).length > 6)) return { title, feat: null }
  const rest = tidySpaces(title.replace(m[0], ' '))
  return rest ? { title: rest, feat } : { title, feat: null }
}

/** Los nombres sueltos de una lista de artistas ("Neo Pistea, Midel, Rei & Zecca", "Greg Paulus feat. Chucky De Ipola"). */
export const nameList = (s: string) =>
  s.split(new RegExp(String.raw`\s*(?:,|;|&|\s\by\b\s|\s\band\b\s|\s\bx\b\s|\s${FEAT_WORD}\b\.?)\s*`, 'i')).map((x) => x.trim()).filter(Boolean)

/**
 * Pone el feat. del título en el artista, como se decidió ("Emilia feat. TINI" y el título limpio).
 * Si los invitados ya figuran en el artista no se repiten; el estilo Beatport "Barbara Ford, SLV (DE)" + "feat. Barbara Ford"
 * queda "SLV (DE) feat. Barbara Ford".
 */
export function mergeFeat(artist: string, feat: string): string {
  const guests = nameList(feat)
  const have = fold(artist)
  const missing = guests.filter((g) => !have.includes(fold(g)))
  if (!missing.length) {
    if (/ feat\. /.test(artist)) return artist
    const parts = artist.split(/\s*,\s*/)
    const keep = parts.filter((p) => !guests.some((g) => fold(g) === fold(p)))
    return keep.length && keep.length < parts.length ? `${keep.join(', ')} feat. ${guests.join(', ')}` : artist
  }
  return / feat\. /.test(artist) ? `${artist}, ${missing.join(', ')}` : `${artist} feat. ${feat.replace(/\s+&\s+/g, ' & ')}`
}

/**
 * Saca el artista repetido en el título: "Alphaville - Big In Japan" (con artista Alphaville) → "Big In Japan";
 * también al final ("Traición - Miranda!"), dos veces ("Beau Didier - Beau Didier - Magalenha") y con n.º o feat. en el medio
 * ("08 Benny Benassi - Satisfaction", "La Factoria  ft. Eddy Lover- Perdoname"). Devuelve el feat. encontrado.
 */
export function stripArtistFromTitle(title: string, artist: string): { title: string; feat: string | null; artist?: string } {
  const main = loose(artist.split(' feat. ')[0])
  const whole = loose(artist)
  if (!main) return { title, feat: null }
  const same = (s: string) => { const l = loose(s); return !!l && (l === main || l === whole) }
  let t = title
  let feat: string | null = null
  let fuller: string | undefined
  for (let round = 0; round < 3; round++) {
    const cuts: { a: string; b: string }[] = []
    for (const m of t.matchAll(/\s+-\s*|\s*-\s+|\s{2,}/g)) cuts.push({ a: t.slice(0, m.index), b: t.slice(m.index! + m[0].length) })
    let next: string | null = null
    for (const { a, b } of cuts) {
      const left = a.replace(/^\d{1,3}\s*[-.]?\s*/, '')
      const f = splitFeat(left)
      // "Emilia, TINI - La_Original.mp3" con artista "Emilia": el de la izquierda es el artista completo
      if (round === 0 && b.trim() && !same(left) && /,|&/.test(left) && nameList(left).some((n) => same(n)) && nameList(left).length <= 4) { fuller = tidySpaces(left); next = b; break }
      if (!b.trim() || !(same(left) || same(f.title))) continue
      // "La Factoria  ft. Eddy Lover- Perdoname": después del artista viene el feat. y recién después el título
      const g = b.match(/^(?:feat|ft|featuring)\b\.?\s*(.+?)\s*(?:\s-\s*|-\s+)(.+)$/i)
      if (g) { feat = g[1]; next = g[2] } else { next = b; if (!same(left) && f.feat) feat = f.feat }
      break
    }
    if (next == null) for (const { a, b } of [...cuts].reverse()) if (a.trim() && same(b)) { next = a; break }
    if (next == null) break
    t = tidySpaces(next)
  }
  return fuller ? { title: t, feat, artist: fuller } : { title: t, feat }
}

// Canales de YouTube guardados como artista: "Damas Gratis Oficial", "Cristem Dj - CANAL OFICIAL", "Artista - Topic", "ArtistaVEVO"
const CHANNEL = /\s*(?:-\s*)?(?:canal\s+oficial|oficial|official|-\s*topic)\s*$|(?<=\p{Ll})VEVO$|\s+VEVO$/iu
/** Saca la parte "de canal" del artista. */
export const stripChannel = (artist: string) => { const s = artist.replace(CHANNEL, '').trim(); return s || artist }
/** ¿El "artista" es un sello o un canal ("MUEVA Records", "Macklemore Music")? Entonces el artista de verdad está en otro lado. */
export const looksLikeLabel = (artist: string) => /\b(?:records|recordings|music|musik|tv|channel|label)\s*$/i.test(artist)

/**
 * La cara y el lugar del vinilo pegados adelante del artista o del título, como vienen de las tiendas de vinilos
 * ("A1 Bodeler", "B2 Frazer Campbell", "A11 Tema"). Solo dice que podría serlo: "C4 Pedro" es un artista de verdad, así que
 * quien la usa pide pruebas. Lo que queda tiene que empezar con una letra ("A1 T26" sí, "A1 1440" no).
 */
export function vinylSide(artist: string): { side: string; artist: string } | null {
  const m = artist.match(/^([A-H][1-9]\d?)(?:\s*[-.)]\s*|\s+)(\p{L}.*)$/u)
  return m && m[2].trim() ? { side: m[1].toUpperCase(), artist: m[2].trim() } : null
}

/** "VINYL ONLY" donde esté: "Philypop VINYL ONLY", "(Vinyl Only)", "Feel It (Raw Mix VINYL ONLY)", "Tema - Vinyl Only". */
const VINYL_ONLY = /\s*(?:[-–]\s*)?(?:[([]\s*vinyl\s+only\s*[)\]]|\bvinyl\s+only\b)/giu
export const hasVinylOnly = (v: string | null | undefined) => !!v && /\bvinyl\s+only\b/i.test(v)
/**
 * Saca "VINYL ONLY" (y el paréntesis que queda vacío). Si queda el código de catálogo dos veces ("FUN007 (Vinyl Only)
 * FUN007" → "FUN007 FUN007", así venía de la tienda), queda una sola.
 */
export const stripVinylOnly = (v: string) => v.replace(VINYL_ONLY, '').replace(/\s*(?:\(\s*\)|\[\s*\])/g, '').replace(/\s{2,}/g, ' ').replace(/[\s\-–]+$/, '').trim()
  .replace(/^(\S+) \1$/i, '$1')
/** ¿El n.º de tema es una cara de vinilo ("A1", "B2")? */
export const isVinylTrack = (track: string | null | undefined) => !!track && /^[A-H][1-9]\d?$/i.test(track.trim())

/** Los nombres de un artista con sus separadores ("A, B & C feat. D", "A; B", "A x B"), para rearmarlo tal cual con `join('')`. */
export const artistParts = (artist: string): string[] => artist.split(/(\s*[,;]\s*|\s+&\s+|\s+x\s+| feat\. )/)
export const isSeparator = (p: string) => /^\s*(?:,|;|&| feat\. )\s*$|^\s+x\s+$/.test(p) || !p.trim()

/** Cuántos acentos tiene un nombre ("Rodríguez": 1). */
const accents = (s: string) => (s.normalize('NFD').match(/\p{M}/gu) ?? []).length

/**
 * Mejor forma de escribir cada nombre de artista según la propia biblioteca: lo que dicen las carpetas (las armó el dueño)
 * y, si no, la forma más usada, siempre que gane con claridad (el doble de veces). Nada todo en minúscula o todo en mayúscula
 * gana salvo los nombres estilizados de la lista. Si dos carpetas lo escriben distinto, deciden los tags.
 */
export class ArtistSpelling {
  private counts = new Map<string, Map<string, number>>()
  private folders = new Map<string, Map<string, number>>()

  addTag(artist: string | null) {
    if (!artist) return
    for (const p of artistParts(artist)) {
      if (isSeparator(p)) continue
      const k = fold(p), m = this.counts.get(k) ?? new Map<string, number>()
      m.set(p.trim(), (m.get(p.trim()) ?? 0) + 1)
      this.counts.set(k, m)
    }
  }
  /** Una carpeta con este nombre (se llama una vez por tema que está adentro). */
  addFolder(name: string) {
    if (!name.trim() || caseKind(name) !== 'mixed') return
    const m = this.folders.get(fold(name)) ?? new Map<string, number>()
    m.set(name.trim(), (m.get(name.trim()) ?? 0) + 1)
    this.folders.set(fold(name), m)
  }

  count(name: string): number { let n = 0; for (const c of this.counts.get(fold(name))?.values() ?? []) n += c; return n }
  known(name: string): boolean { return this.count(name) >= 2 || this.folders.has(fold(name)) }

  best(name: string): string | null {
    const k = fold(name)
    const st = stylized(name)
    if (st) return st
    const f = this.folders.get(k)
    if (f && f.size === 1) return [...f.keys()][0]
    const m = this.counts.get(k)
    if (!m) return null
    const ranked = [...m.entries()].filter(([s]) => caseKind(s) === 'mixed').sort((a, b) => b[1] - a[1])
    if (!ranked.length) return null
    const [top, n] = ranked[0]
    const rival = Math.max(0, ...[...m.entries()].filter(([s]) => s !== top).map(([, c]) => c))
    return n >= 2 && n >= rival * 2 ? top : null
  }

  /**
   * El artista con cada nombre escrito de la forma preferida (o igual si no hay una clara).
   * `keepCase`: solo acentos y signos ("Babasonicos" → "Babasónicos"); las mayúsculas quedan como vienen ("DUKI" no cambia), y
   * los acentos se agregan pero nunca se sacan, como en el perfil Oficial: con la carpeta "Manuel Rodriguez", "Manuel Rodríguez"
   * pasaba a "Rodriguez" (repaso de criterios del 24/10).
   */
  fix(artist: string, keepCase = false): string {
    return artistParts(artist).map((p) => {
      if (isSeparator(p)) return p
      const b = this.best(p)
      return b && (!keepCase || (sameCase(b, p) && accents(b) >= accents(p))) ? b : p
    }).join('')
  }
}
