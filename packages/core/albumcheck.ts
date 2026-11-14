// "Discos completos" sin internet: compara los temas de un disco con las listas oficiales ya guardadas, elige la edición
// que mejor coincide (normal, deluxe, remaster, con bonus) y dice qué falta y qué está repetido. Ante la duda, no elige:
// muestra las ediciones para elegir a mano.
import { normalize } from './dupnames'
import { cleanBase, loose } from './names'
import { bareTitle, similarity } from './online/hits'
import { versionRe } from './versionwords'
import type { AlbumGroup, AlbumTrack } from './albums'
import type { Edition, ListedTrack, Tracklist } from './albumsources'
import type { AlbumEdition, AlbumMissingTrack, AlbumReport } from '@paila/shared/types'

// Lo que dice qué edición es, no qué disco: se saca para comparar el nombre del disco.
const EDITION_WORDS = /\b(?:deluxe|super deluxe|expanded|edition|edici[oó]n|remaster(?:ed|izad[oa])?|anniversary|aniversario|bonus|tracks?|special|especial|version|versi[oó]n|reissue|reedici[oó]n|limited|japan(?:ese)?|collector'?s|legacy|definitive|\d{4}|\d+(?:th|st|nd|rd)|explicit|clean|mono|stereo)\b/gi
/** El nombre del disco sin la edición: "Appetite for Destruction (Deluxe Edition)" = "appetitefordestruction". */
export function albumBase(title: string): string {
  const t = title.replace(/\s*[([][^)\]]*[)\]]/g, (p) => (p.replace(EDITION_WORDS, '').replace(/[\s()[\]:,.\-–]/g, '') ? p : ' '))
    .replace(/\s+[-–:]\s+(?:[^-–:]*\b(?:deluxe|edition|edici[oó]n|remaster\w*|bonus|anniversary|expanded)\b[^-–:]*)$/i, '')
  return loose(t)
}

/** El título "de comparación" de un tema: sin número adelante, sin el artista repetido, sin feat. ni "Remastered". */
export function titleKey(title: string, artist?: string | null): string {
  let t = bareTitle(title).replace(/^\s*\d{1,3}\s*[-.)_]\s*/, '')
  const parts = t.split(/\s+[-–]\s+/)
  if (artist && parts.length > 1 && loose(parts[0]) === loose(artist)) t = parts.slice(1).join(' - ')
  return normalize(t.replace(/\s*[([](?:bonus(?: track)?|album version|lp version|versi[oó]n [aá]lbum)[)\]]/gi, '').replace(/\brmx\b/gi, 'remix').replace(/\b(?:vinyl only|free download|out now)\b/gi, ' '))
}
/** El título sin nada entre paréntesis o corchetes: "Roxana porcelana (Stud Free Pub, 15-07-85)" = "Roxana porcelana". */
const titleCoreKey = (title: string, artist?: string | null) => titleKey(title.replace(/\s*[([{][^)\]}]*(?:[)\]}]|$)/g, ' '), artist)
/** Sin título en el tag, el del nombre del archivo (sin el artista adelante: "las pelotas    Será"). */
function localKeys(t: AlbumTrack, artist: string, numbered = false): [string, string] {
  // "01 Viva El Funk": el número de tema adelante, sin guion (con cero adelante, o el mismo número de tema del tag)
  const num = (s: string) => s.replace(/^(\d{1,2})\s+(?=\S)/, (m, d: string) => (numbered || d.startsWith('0') || Number(d) === t.track ? '' : m))
  if (t.title?.trim()) return [titleKey(num(t.title), t.artist ?? artist), titleCoreKey(num(t.title), t.artist ?? artist)]
  const base = cleanBase(t.rel.split('/').pop()!.replace(/\.[^.]+$/, ''))
  const a = normalize(t.artist ?? artist)
  const strip = (k: string) => (a && k.startsWith(`${a} `) ? k.slice(a.length + 1) : k)
  return [strip(titleKey(base, artist)), strip(titleCoreKey(base, artist))]
}
/** Casi todos los títulos del disco empiezan con su número ("10 Ella No Vea La Tele"): ahí el número no es parte del título. */
const numberedTitles = (g: AlbumGroup) => g.tracks.filter((t) => /^\d{1,2}\s+\S/.test(t.title ?? '')).length >= Math.max(2, g.tracks.length * 0.6)
/** "Track 05", "Track11", "Pista 5", "Audio Track": un título que no dice nada (se empareja por número de tema). */
const generic = (k: string) => !k || /^(?:track|pista|audio track|tema|untitled|sin titulo)\s*\d*$/.test(k)
/** "[silence]", "[silencio]", "[data track]": pistas de relleno de un CD, no temas que falten. */
const placeholder = (title: string) => /^\[[^\]]*\]$/.test(title.trim())
export const realTracks = (l: Tracklist) => l.tracks.filter((t) => !placeholder(t.title))

/** Las palabras de `short` aparecen en `long` y en el mismo orden ("Y mientras el sol se muere" en "Y mientras tanto el sol se muere"). */
function inOrder(short: string[], long: string[]): boolean {
  let j = 0
  for (const w of long) if (w === short[j]) j++
  return j === short.length
}

/** Lo que le sobra al más largo es un número de parte o de volumen ("Use Your Illusion" / "Use Your Illusion II"): son otros. */
const SEQUEL = /^(?:[ivx]+|\d+|pt \d+|part \d+|parte \d+|vol \d+)$/
/** Lo que le sobra al más largo empieza con una palabra de versión (core/versionwords.ts; acá también "medley", "rough", "take"). */
const VERSIONISH = versionRe(['mezcla', 'vivo', 'grabacion', 'remaster', 'tipo'], { except: ['cover', 'club', 'radio'], extra: ['medley', 'rough', 'take'], at: 'start' })
const sequel = (a: string, b: string) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return l.startsWith(s) && SEQUEL.test(l.slice(s.length).trim()) }

/** Qué tan seguro es que dos títulos (ya normalizados, y sin paréntesis) son el mismo tema: 0 = no. */
function score(a: string, b: string, ac: string, bc: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (sequel(a, b)) return 0
  // "Pretty Tied Up" = "Pretty Tied Up (live in New York…)"; pero "Ella" no es "Ella baila con todos"
  const [sw, lw] = a.length <= b.length ? [a, b] : [b, a]
  if (sw.length >= 4 && lw.startsWith(`${sw} `) && (sw.length / lw.length >= 0.5 || VERSIONISH.test(lw.slice(sw.length)))) return 0.9
  const A = a.replace(/ /g, ''), B = b.replace(/ /g, '')
  const s = similarity(A, B)
  if (s >= 0.85) return s
  if (ac.length >= 4 && bc.length >= 4 && (ac === bc || similarity(ac.replace(/ /g, ''), bc.replace(/ /g, '')) >= 0.85)) return 0.87
  // un título cortado (tags viejos de 30 letras) o abreviado ("…en el Día de la Bici")
  const [sh, lo] = A.length <= B.length ? [A, B] : [B, A]
  if (sh.length >= 12 && lo.startsWith(sh) && sh.length / lo.length >= 0.6) return 0.86
  const [ws, wl] = [a.split(' '), b.split(' ')].sort((x, y) => x.length - y.length)
  if (ws.length >= 4 && ws.length / wl.length >= 0.6 && inOrder(ws, wl)) return 0.86
  return 0
}

export interface Evaluation { list: Tracklist; matched: number; distinct: number; missing: ListedTrack[]; extra: AlbumTrack[]; repeated: { title: string; files: string[] }[] }

/** Empareja tus temas con una lista oficial: por título (perdonando una letra), y por número de tema si el título no dice nada. */
export function evaluate(g: AlbumGroup, full: Tracklist): Evaluation {
  const list = { ...full, tracks: realTracks(full) }
  const lk = g.tracks.map((t) => localKeys(t, g.artist, numberedTitles(g)))
  const keys = lk.map((k) => k[0])
  // "I Don't Care About You / Look at Your Game, Girl": dos temas (uno oculto) en una sola pista de la lista
  const lkeys = list.tracks.map((t) => [t.title, ...(t.title.includes(' / ') ? t.title.split(' / ') : [])].map((x) => [titleKey(x, t.artist), titleCoreKey(x, t.artist)]))
  const pairs: { i: number; j: number; s: number }[] = []
  for (let i = 0; i < g.tracks.length; i++) {
    for (let j = 0; j < list.tracks.length; j++) {
      let s = Math.max(...lkeys[j].map(([k, c], n) => score(keys[i], k, lk[i][1], c) * (n ? 0.97 : 1)))
      if (!s) continue
      const lt = list.tracks[j], t = g.tracks[i]
      if (t.track === lt.pos && (t.disc ?? 1) === lt.disc) s += 0.05
      if (t.duration != null && lt.length != null) s += Math.abs(t.duration - lt.length) <= 3 ? 0.05 : Math.abs(t.duration - lt.length) > 30 ? -0.1 : 0
      pairs.push({ i, j, s })
    }
  }
  pairs.sort((a, b) => b.s - a.s)
  const byLocal = new Map<number, number>(), takenBy = new Map<number, number>()
  for (const p of pairs) if (!byLocal.has(p.i) && !takenBy.has(p.j)) { byLocal.set(p.i, p.j); takenBy.set(p.j, p.i) }
  // el mismo tema dos veces: su mejor pareja ya la tiene otro archivo con el mismo título
  const rep = new Map<number, number[]>()
  for (const p of pairs) {
    if (byLocal.has(p.i) || p.s < 0.95 || keys[p.i] !== keys[takenBy.get(p.j)!]) continue
    if (!rep.has(p.j)) rep.set(p.j, [takenBy.get(p.j)!])
    if (!rep.get(p.j)!.includes(p.i)) rep.get(p.j)!.push(p.i)
    byLocal.set(p.i, -1)
  }
  // títulos que no dicen nada ("Track 05"): por número de tema y duración. Y lo que quedó suelto con el mismo número y la
  // misma duración (±2 s) es el mismo tema con otro nombre ("Final" = "Cierre", el tema oculto de La esquina del infinito)
  // (esto último solo para completar una edición que ya coincide bien por los títulos: si no, confundiría discos distintos)
  const byTitle = takenBy.size >= Math.max(2, Math.ceil(g.tracks.length * 0.6))
  for (let i = 0; i < g.tracks.length; i++) {
    const t = g.tracks[i]
    if (byLocal.has(i) || t.track == null || (!generic(keys[i]) && !byTitle)) continue
    const near = (lt: ListedTrack) => (generic(keys[i]) ? t.duration == null || lt.length == null || Math.abs(t.duration - lt.length) <= 3 : t.duration != null && lt.length != null && Math.abs(t.duration - lt.length) <= 2)
    const j = list.tracks.findIndex((lt, jj) => !takenBy.has(jj) && lt.pos === t.track && lt.disc === (t.disc ?? 1) && near(lt))
    if (j >= 0) { byLocal.set(i, j); takenBy.set(j, i) }
  }
  // los temas distintos que coinciden: una caja de lujo con el mismo tema tres veces no "coincide más" que el disco normal
  const distinct = new Set([...byLocal].filter(([, j]) => j >= 0).map(([i]) => keys[i] || `#${i}`)).size
  return {
    list, matched: takenBy.size, distinct, missing: list.tracks.filter((_, j) => !takenBy.has(j)),
    extra: g.tracks.filter((_, i) => !byLocal.has(i)),
    repeated: [...rep].sort((x, y) => x[0] - y[0]).map(([j, is]) => ({ title: list.tracks[j].title, files: is.map((i) => g.tracks[i].rel) })),
  }
}

const artistOk = (e: Edition, g: AlbumGroup) => {
  if (g.various) return true
  const a = loose(e.artist), b = loose(g.artist)
  return !!a && (a === b || a.includes(b) || b.includes(a) || similarity(a, b) >= 0.8)
}

const LIVEISH = /\b(?:live|en vivo|vivo|unplugged|ac[uú]stico|concierto|recital|estadio)\b/i
const noParens = (t: string) => loose(t.replace(/\s*[([][^)\]]*[)\]]/g, ' '))
/** ¿Es el mismo disco? "El tesoro de los inocentes (Final paraíso)" sí (si no es un en vivo); "Led Zeppelin II" no es "Led Zeppelin". */
/**
 * El nombre del disco para buscarlo: sin "(Vinyl Only)", "[WEB-FLAC]" ni el código de catálogo pegado al final
 * ("The Summit EP (Vinyl Only) MULENV017" → "The Summit EP"). Así venían los EPs de vinilo en la corrida del 20/10.
 */
export function searchName(album: string): string {
  const t = album.replace(/\s*[([][^)\]]*\b(?:vinyl|vinilo|web|flac|mp3|320|wav)\b[^)\]]*[)\]]/gi, ' ').replace(/\s+\b[A-Z]{2,8}\d{2,5}[A-Z]?\s*$/, '').replace(/\s+/g, ' ').trim()
  return t || album
}
/** El código de catálogo del sello si el nombre lo trae ("FUN007", "MULENV017"); Discogs busca por él. */
export const catalogOf = (album: string) => album.match(/\b([A-Z]{2,8}\d{2,5}[A-Z]?)\b/)?.[1] ?? null

export function sameAlbum(title: string, secondary: string[], album: string): boolean {
  const a = albumBase(title), b = albumBase(album), c = albumBase(searchName(album))
  if (a === b || similarity(a, b) >= 0.85 || (c && (a === c || similarity(a, c) >= 0.85))) return true
  return noParens(title) === noParens(album) && (!secondary.includes('Live') || LIVEISH.test(album))
}

/** De lo que devolvió la búsqueda, las ediciones que vale la pena bajar (hasta 4, de distinta cantidad de temas). */
export function pickCandidates(eds: Edition[], g: AlbumGroup, max = 4): Edition[] {
  const ok = eds.filter((e) => (e.score >= 60 || e.source === 'discogs') && artistOk(e, g) && sameAlbum(e.title, e.secondary, g.album))
  const n = g.tracks.length
  ok.sort((a, b) => Math.abs((a.trackCount ?? n) - n) - Math.abs((b.trackCount ?? n) - n) || Number(b.status === 'Official') - Number(a.status === 'Official') || b.score - a.score)
  const out: Edition[] = [], seen = new Set<string>()
  for (const e of ok) {
    const k = e.trackCount == null ? e.id : `${e.trackCount}`
    if (seen.has(k)) continue
    seen.add(k); out.push(e)
    if (out.length >= max) break
  }
  return out
}

const ref = (e: Pick<Edition, 'source' | 'id'>) => `${e.source}:${e.id}`
const NOTE = /\b(deluxe|expanded|remaster\w*|anniversary|bonus|special|japan\w*|legacy|edici[oó]n [\p{L}]+)\b/iu
function editionOf(ev: Evaluation): AlbumEdition {
  const l = ev.list
  const fromTitle = l.title.match(/[([]([^)\]]+)[)\]]/)?.[1]
  return {
    ref: ref(l), source: l.source, title: l.title, artist: l.artist, date: l.date, country: l.country, format: l.format, tracks: l.tracks.length,
    // la nota de MusicBrainz a veces es un código de fábrica ("FORMACOL-OPTILASER VENEZUELA W.O.#…"): solo si es corta
    note: (l.note && l.note.length <= 40 ? l.note : null) ?? (fromTitle && NOTE.test(fromTitle) ? fromTitle : null) ?? (l.secondary.length ? l.secondary.join(', ') : null), matched: ev.matched, missing: ev.missing.length,
  }
}
const missingOf = (ev: Evaluation, g: AlbumGroup): AlbumMissingTrack[] => ev.missing.map((t) => ({ disc: t.disc, pos: t.pos, title: t.title, artist: t.artist ?? (g.various ? '' : g.artist), length: t.length }))
/**
 * ¿Les faltan los mismos temas? La misma edición en MusicBrainz y en Deezer escribe distinto algunos títulos ("Whole Lotta
 * Love (Remaster)", "Psilosibe" / "Psilocybe"): se comparan como los temas, y alcanza con que coincidan casi todos.
 */
function sameMissing(a: Evaluation, b: Evaluation): boolean {
  if (a.missing.length !== b.missing.length) return false
  const keys = (ev: Evaluation) => ev.missing.map((t) => [titleKey(t.title, t.artist), titleCoreKey(t.title, t.artist)])
  const ka = keys(a), kb = keys(b)
  const hits = ka.filter(([k, c]) => kb.some(([k2, c2]) => score(k, k2, c, c2) > 0)).length
  return hits >= Math.ceil(ka.length * 0.8)
}
const SOURCE_RANK: Record<Tracklist['source'], number> = { musicbrainz: 0, discogs: 1, deezer: 2 }

/**
 * Decide con las listas guardadas. `choice` = la edición que elegiste a mano ("musicbrainz:<id>") o "ignorar". Para que
 * una edición cuente, tus temas tienen que coincidir en buena parte (si no, es otro disco con el mismo nombre).
 */
export function decide(g: AlbumGroup, lists: Tracklist[], choice: string | null, searched: boolean): AlbumReport {
  const base: AlbumReport = { key: g.key, dir: g.dir, artist: g.artist, album: g.album, year: g.year, tracks: g.tracks.length, status: 'sin_buscar', edition: null, manual: false, missing: [], repeated: [], extra: [], options: [], bigger: null }
  if (choice === 'ignorar') return { ...base, status: 'ignorado' }
  const evs = lists.map((l) => evaluate(g, l))
  // tus temas distintos (los repetidos cuentan una vez)
  const mine = new Set(g.tracks.map((t, i) => localKeys(t, g.artist, numberedTitles(g))[0] || `#${i}`)).size
  const need = Math.max(2, Math.ceil(mine * 0.6))
  const good = evs.filter((ev) => ev.distinct >= need)
    .sort((a, b) => b.distinct - a.distinct || a.missing.length - b.missing.length || Number(b.list.status === 'Official') - Number(a.list.status === 'Official')
      || a.list.secondary.length - b.list.secondary.length || SOURCE_RANK[a.list.source] - SOURCE_RANK[b.list.source] || (a.list.date ?? '9999').localeCompare(b.list.date ?? '9999'))
  const chosen = choice ? evs.find((ev) => ref(ev.list) === choice) : undefined
  if (!chosen && !good.length) return { ...base, status: searched ? 'no_encontrado' : 'sin_buscar' }
  const best = chosen ?? good[0]
  const doubt = !chosen && good.slice(1).some((o) => !sameMissing(o, best)
    && ((o.distinct === best.distinct && o.missing.length === best.missing.length) || (best.missing.length > 0 && o.missing.length === 0 && best.distinct - o.distinct <= 2)))
  const bigger = !best.missing.length ? good.filter((o) => o.distinct === best.distinct && o.list.tracks.length > best.list.tracks.length).sort((a, b) => b.list.tracks.length - a.list.tracks.length)[0] : undefined
  return {
    ...base, status: doubt ? 'elegir' : best.missing.length ? 'faltan' : 'completo', edition: editionOf(best), manual: !!chosen,
    missing: missingOf(best, g), repeated: best.repeated, extra: best.extra.map((t) => t.rel), options: (good.length ? good : [best]).map(editionOf),
    bigger: bigger ? { edition: editionOf(bigger), more: bigger.list.tracks.length - best.list.tracks.length } : null,
  }
}
