// Emparejar una lista traída de otro lado (core/listparse.ts) con la biblioteca, tema por tema (MASTERPLAN-2, 4b):
// - seguro: el mismo ISRC (el código único de cada grabación, leído de los tags) o, en un .m3u, la misma ruta;
// - exacto: los mismos artistas y el mismo título, nombre por nombre (sin contar mayúsculas, tildes, el "feat." ni el remaster),
//   la misma versión y la misma duración; sin duración (una lista pegada), si es la única versión que tenés: entra solo (24/10);
// - probable: artista y título iguales (sin " - 2018 Remaster" ni el año: lo único que se saca) y la misma duración (±3 s),
//   con los alias del diccionario de artistas y de MusicBrainz, un artista de menos o un título genérico: se confirma a mano;
// - otra versión: el nombre coincide pero la duración no (un "Live at Royal Albert Hall" de 13 min no es el single), o
//   uno es en vivo, remix o acústico y el otro no: se avisa y no se da por bueno.
// Funciones puras: la biblioteca y los alias llegan como datos.
import { artistParts, isSeparator, nameList, splitFeat, stripArtistFromTitle } from './artists'
import { cleanIsrc, type ListEntry } from './listparse'
import { fold, loose } from './names'
import { stripJunk } from './tagactions'
import { versionRe } from './versionwords'
import { similarity } from './online/hits'
import { textos } from '@paila/shared/idioma'

/** Por qué se emparejó así (se muestra y se guarda con el pedido). Las versiones ("en vivo", "remix") son datos: no se traducen. */
const T = textos({
  ruta: { es: 'Es el mismo archivo: la ruta del .m3u existe en esta compu', en: "It's the same file: the .m3u path exists on this computer" },
  isrc: { es: (c: string) => `El mismo código ISRC (${c}): es la misma grabación`, en: (c: string) => `The same ISRC code (${c}): it's the same recording` },
  deezer: {
    es: (c: string, a: string, t: string) => `Deezer dice que el ISRC ${c} es «${a} - ${t}», el mismo tema que encontró para tu archivo, y dura lo mismo`,
    en: (c: string, a: string, t: string) => `Deezer says ISRC ${c} is «${a} - ${t}», the same track it found for your file, and it's the same length`,
  },
  sinArtista: {
    es: 'No está en tu biblioteca (sin artista y con un número de nombre: no alcanza para buscarlo)',
    en: "It isn't in your library (no artist and a number for a name: not enough to search for it)",
  },
  noEsta: { es: 'No está en tu biblioteca', en: "It isn't in your library" },
  duraIgual: { es: (a: string, b: string) => `y dura lo mismo (${a} y ${b})`, en: (a: string, b: string) => `and it's the same length (${a} and ${b})` },
  sinDuracion: { es: 'pero no hay duración para comparar', en: "but there's no length to compare" },
  probable: { es: (dur: string) => `Mismo artista y título ${dur}: confirmalo`, en: (dur: string) => `Same artist and title ${dur}: confirm it` },
  exactoDura: { es: (a: string, b: string) => `El mismo artista y el mismo título, y dura lo mismo (${a} y ${b})`, en: (a: string, b: string) => `The same artist and the same title, and it's the same length (${a} and ${b})` },
  exactoSolo: { es: 'El mismo artista y el mismo título, y es la única versión que tenés', en: "The same artist and the same title, and it's the only version you have" },
  comun: { es: 'la común', en: 'the regular one' },
  elPedido: { es: (d: string) => `; el pedido, ${d}`, en: (d: string) => `; the requested one, ${d}` },
  otraVersion: {
    es: (t: string, dur: string, tuya: string, pedido: string) => `Tenés «${t}»${dur}, pero es otra versión: la tuya es ${tuya} y el pedido ${pedido}`,
    en: (t: string, dur: string, tuya: string, pedido: string) => `You have «${t}»${dur}, but it's another version: yours is ${tuya} and the requested one ${pedido}`,
  },
  otroArtista: {
    es: (t: string, dur: string) => `Tenés «${t}»${dur}: el mismo tema por otro artista (un cover o el original). Confirmá si te sirve`,
    en: (t: string, dur: string) => `You have «${t}»${dur}: the same song by another artist (a cover or the original). Confirm whether it works for you`,
  },
  otraDuracion: {
    es: (t: string, a: string, b: string) => `Tenés «${t}», pero dura ${a} y el pedido ${b}: parece otra versión`,
    en: (t: string, a: string, b: string) => `You have «${t}», but it's ${a} long and the requested one ${b}: it looks like another version`,
  },
})

/** La duración tiene que coincidir con esta tolerancia (la misma que la Bandeja). */
export const LIST_SECONDS = 3
const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
const LOW_FLAGS = ['fake_lossless', 'maybe_transcoded', 'upscaled', 'reencoded']

/** Un tema de la biblioteca tal como lo mira el emparejador. `guess`: artista y título sacados del nombre del archivo. */
export interface LibTrack {
  id: number; rel: string; ext: string; artist: string | null; title: string | null; duration: number | null
  grade: string | null; flags: string | null; isrc: string | null; guess?: { artist: string; title: string } | null
  /** El disco del tag: un "Estadio Chateau Carreras 2001" dice que es en vivo aunque el título no lo diga. */
  album?: string | null
}
export type MatchKind = 'isrc' | 'ruta' | 'exacto' | 'probable' | 'version' | 'none'
export interface EntryMatch { kind: MatchKind; fileId: number | null; why: string; /** cuántas copias más del mismo tema hay */ copies: number }

/** Lo único que se saca antes de comparar: la remasterización y el año ("- 2015 Remaster", "(Remastered 2009)"). Nunca "Single Version", "Live" ni "Mix": son otras versiones (decidido el 20/10). */
const NOISE = /^(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?(?:stereo\s+)?re ?master(?:ed)?(?:\s+(?:version|edition))?(?:\s+\d{4})?|\d{4}|explicit|clean)$/
// Las palabras de versión (core/versionwords.ts): otra grabación del mismo tema, u otra mezcla o forma de publicarlo.
const KIND = versionRe(['vivo', 'grabacion'])
const REMIXISH = versionRe(['mezcla', 'tipo'])
const LIVE = versionRe(['vivo'])
/** Títulos que un mismo artista repite en varios discos ("Intro", "Interlude"): nunca alcanzan para darlo por exacto. */
const GENERIC = /^(?:intro|outro|interlude|interludio|skit|untitled|sintitulo|bonustrack|hiddentrack|track\d*|tema\d*|\d+)$/
/** Un disco o una carpeta de otra grabación ("Recitales y otros", "MTV Unplugged", "Estadio Chateau Carreras 2001"). */
const OTHER_TAKE = versionRe(['vivo', 'grabacion'], { extra: ['recital', 'recitales', 'estadio', 'concierto', 'concert'] })
const otherTake = (t: LibTrack) => OTHER_TAKE.test([t.album ?? '', ...t.rel.split('/').slice(0, -1)].join(' / '))

/** El título partido: lo de base, las partes que son del nombre ("(Forget About Me)") y las que dicen otra versión. */
export interface TitleParts { base: string; full: string; versions: string[] }
export function titleParts(title: string): TitleParts {
  const t = stripJunk(title)
  const groups: string[] = []
  // "Ship of Fools - 2009 - Remaster": cada " - " de más es un agregado; lo entre paréntesis o corchetes también
  const [head, ...tails] = t.split(/\s+[-–—]\s+/)
  const base = head.replace(/\s*[([{]([^)\]}]*)[)\]}]/g, (_, g: string) => { groups.push(g); return ' ' })
  groups.push(...tails)
  const part: string[] = [], versions: string[] = []
  for (const g of groups) {
    const f = fold(g).replace(/[^\p{L}\p{N}"\s]/gu, ' ').replace(/\s+/g, ' ').trim()
    if (!f || NOISE.test(f) || /^(?:feat|ft|featuring|with|con)\b/.test(f)) continue
    if (KIND.test(f)) versions.push(LIVE.test(f) ? 'en vivo' : f.match(KIND)![0])
    else if (REMIXISH.test(f)) versions.push(f.replace(/"/g, ''))
    else part.push(g)
  }
  return { base: loose(base), full: loose([base, ...part].join(' ')), versions: [...new Set(versions)].sort() }
}

/** Los nombres sueltos de un artista ("Tears For Fears, Oleta Adams", "Emilia feat. TINI"), sin "The" adelante. */
const names = (artist: string): string[] => {
  const out = new Set<string>()
  const add = (s: string) => { const k = loose(s.replace(/^\s*the\s+/i, '')); if (k) out.add(k) }
  add(artist)
  for (const p of artistParts(artist)) if (!isSeparator(p)) add(p)
  for (const p of nameList(artist)) add(p)
  return [...out]
}

/**
 * Los artistas de un tema, nombre por nombre y en orden alfabético, para la coincidencia exacta: "Bad Bunny feat. Drake",
 * "Bad Bunny, Drake" y "Bad Bunny" con "Song (feat. Drake)" dan lo mismo. Sin alias ni diccionario ("Balvin" no es "J Balvin").
 */
export function strictArtists(artist: string, title: string): string {
  const feat = splitFeat(title).feat
  const all = [...nameList(artist), ...(feat ? nameList(feat) : [])].map((n) => loose(n.replace(/^\s*the\s+/i, ''))).filter(Boolean)
  return [...new Set(all)].sort().join('|')
}

export interface MatchDeps {
  /** El diccionario de artistas (fold → cómo se escribe) y los alias conocidos de un nombre (MusicBrainz). */
  dict?: Map<string, string>
  aliases?: (name: string) => string[]
  /** Archivos que existen en esta compu (ruta en minúscula → id), para un .m3u. */
  byPath?: Map<string, number>
  /**
   * Lo que dice Deezer de un ISRC (su tema exacto, `track/isrc:`) y qué archivos tuyos dieron ese mismo tema al buscarlos
   * en Deezer (la caché de "Completar desde internet"). null si Deezer no lo tiene o no se preguntó.
   */
  deezer?: (isrc: string) => { artist: string; title: string; length: number | null; fileIds: number[] } | null
}

const isLow = (t: LibTrack) => (RANK[t.grade ?? ''] ?? -1) >= 4 || (t.flags ?? '').split(',').some((f) => LOW_FLAGS.includes(f))
/** De varias copias, la mejor (la que va a la playlist): nota más alta, sin problemas, con tags. */
const better = (a: LibTrack, b: LibTrack) => Number(isLow(a)) - Number(isLow(b)) || (RANK[a.grade ?? ''] ?? 6) - (RANK[b.grade ?? ''] ?? 6) || Number(!a.artist) - Number(!b.artist) || a.id - b.id
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const wordsOf = (title: string) => fold(stripJunk(title)).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4)
const shown = (t: LibTrack) => t.title ? `${t.artist ? `${t.artist} - ` : ''}${t.title}` : t.rel.split('/').pop()!

/** ¿Es mala calidad? (nota D o F, inflado o lossless falso: lo mismo que la lista «Faltan o suenan mal»). */
export const lowQuality = isLow

/** Arma el índice de la biblioteca una vez y empareja cada tema de la lista. */
export class ListMatcher {
  /** `strict`: los artistas para la coincidencia exacta (null: el nombre salió del archivo y el tema tiene tags, no cuenta). */
  private byTitle = new Map<string, { t: LibTrack; artists: string[]; parts: TitleParts; strict: string | null }[]>()
  private byIsrc = new Map<string, LibTrack[]>()
  private byId = new Map<number, LibTrack>()

  constructor(lib: LibTrack[], private deps: MatchDeps = {}) {
    for (const t of lib) {
      this.byId.set(t.id, t)
      const isrc = cleanIsrc(t.isrc)
      if (isrc) this.byIsrc.set(isrc, [...(this.byIsrc.get(isrc) ?? []), t])
      const seen = new Set<string>()
      // "Pet Shop Boys - It's a Sin" en el título, con el artista también en su tag: el título es "It's a Sin"
      const strip = t.artist && t.title ? stripArtistFromTitle(t.title, t.artist) : null
      const tagged = strip ? { artist: t.artist!, title: strip.title, feat: strip.feat } : null
      for (const n of [tagged, t.guess ? { ...t.guess, feat: null } : null]) {
        if (!n?.title) continue
        const parts = titleParts(n.title)
        const key = `${parts.base}|${n.artist}`
        if (!parts.base || seen.has(key)) continue
        seen.add(key)
        // el nombre del archivo cuenta para lo exacto solo si el tema no tiene tags (si los tiene, mandan ellos: "Tema (en vivo)" en el tag)
        const strict = n === tagged || !tagged ? strictArtists(n.feat ? `${n.artist} feat. ${n.feat}` : n.artist, n.title) : null
        this.byTitle.set(parts.base, [...(this.byTitle.get(parts.base) ?? []), { t, artists: this.artistKeys(n.artist), parts, strict }])
      }
    }
  }

  /** Las formas de un artista para comparar: tal cual, por partes, con el diccionario y con sus alias. */
  private artistKeys(artist: string): string[] {
    const out = new Set(names(artist))
    const d = this.deps.dict
    for (const p of [artist, ...artistParts(artist).filter((x) => !isSeparator(x))]) {
      const to = d?.get(fold(p.trim()))
      if (to) for (const k of names(to)) out.add(k)
      for (const a of this.deps.aliases?.(p.trim()) ?? []) for (const k of names(a)) out.add(k)
    }
    return [...out]
  }

  match(e: ListEntry): EntryMatch {
    const id = e.path ? this.deps.byPath?.get(e.path.toLowerCase()) : undefined
    if (id != null) return { kind: 'ruta', fileId: id, why: T.ruta, copies: 0 }
    const isrc = cleanIsrc(e.isrc)
    const same = isrc ? this.byIsrc.get(isrc) : undefined
    if (same?.length) {
      const pick = [...same].sort(better)[0]
      return { kind: 'isrc', fileId: pick.id, why: T.isrc(isrc!), copies: same.length - 1 }
    }
    // el ISRC en Deezer: si al buscar uno de tus archivos Deezer devolvió ese mismo tema y la duración coincide, es seguro
    const dz = isrc ? this.deps.deezer?.(isrc) : null
    if (dz) {
      const ok = dz.fileIds.map((id) => this.byId.get(id)).filter((t): t is LibTrack => !!t && (dz.length == null || t.duration == null || Math.abs(t.duration - dz.length) <= LIST_SECONDS)).sort(better)
      if (ok.length) return { kind: 'isrc', fileId: ok[0].id, why: T.deezer(isrc!, dz.artist, dz.title), copies: ok.length - 1 }
      // si con el nombre del pedido no aparece, se prueba con el nombre oficial de Deezer
      const byName = this.byName(e)
      if (byName.kind !== 'none') return byName
      return this.byName({ ...e, artist: dz.artist, title: dz.title, duration: e.duration ?? dz.length })
    }
    return this.byName(e)
  }

  /** Por artista, título y duración (probable u otra versión). */
  private byName(e: ListEntry): EntryMatch {
    const want = titleParts(e.title)
    // sin artista y con un título que es solo un número ("01", los golpes de un sample pack): no alcanza para buscarlo por nombre
    if (!e.artist.trim() && /^\d{0,3}$/.test(want.base.replace(/\s+/g, ''))) return { kind: 'none', fileId: null, why: T.sinArtista, copies: 0 }
    const artists = new Set(e.artist ? this.artistKeys(e.artist) : [])
    const cands = (this.byTitle.get(want.base) ?? []).filter((c) =>
      (c.parts.full === want.full || c.parts.base === c.parts.full || want.base === want.full)
      && (!artists.size || c.artists.some((a) => artists.has(a))))
    if (!cands.length) return (artists.size ? this.cover(e, want) : null) ?? { kind: 'none', fileId: null, why: T.noEsta, copies: 0 }
    const sameVersion = (c: (typeof cands)[number]) => c.parts.versions.join('|') === want.versions.join('|')
    const durOk = (c: (typeof cands)[number]) => e.duration == null || c.t.duration == null || Math.abs(c.t.duration - e.duration) <= LIST_SECONDS
    const fit = cands.filter((c) => sameVersion(c) && durOk(c))
    const exact = this.exact(e, want, fit)
    if (exact) return exact
    const ok = [...new Map(fit.map((c) => [c.t.id, c.t])).values()].sort(better)
    if (ok.length) {
      const t = ok[0]
      const dur = e.duration != null && t.duration != null ? T.duraIgual(mmss(e.duration), mmss(t.duration)) : T.sinDuracion
      return { kind: 'probable', fileId: t.id, why: T.probable(dur), copies: ok.length - 1 }
    }
    // otra versión: la más parecida en duración
    const v = [...cands].sort((a, b) => Number(!sameVersion(a)) - Number(!sameVersion(b)) || Math.abs((a.t.duration ?? 0) - (e.duration ?? 0)) - Math.abs((b.t.duration ?? 0) - (e.duration ?? 0)))[0]
    const label = (vs: string[]) => (vs.length ? `«${vs.join(', ')}»` : T.comun)
    const dur = v.t.duration != null ? ` (${mmss(v.t.duration)}${e.duration != null ? T.elPedido(mmss(e.duration)) : ''})` : ''
    const why = !sameVersion(v)
      ? T.otraVersion(shown(v.t), dur, label(v.parts.versions), label(want.versions))
      : T.otraDuracion(shown(v.t), mmss(v.t.duration!), mmss(e.duration!))
    return { kind: 'version', fileId: v.t.id, why, copies: 0 }
  }

  /**
   * Un cover en la lista y el original en tu biblioteca, o al revés ("Sugar Sisters - It's Raining Man" y tu "The Weather Girls -
   * It's Raining Men"; "Lyricist - You Can't Touch This" y tu "MC Hammer - U Can't Touch This"; uso real del 24/10): el mismo título
   * (o casi: una letra o dos de diferencia) por otro artista. Nunca entra solo: se ofrece como otra versión, para confirmar. Solo si
   * no tenés nada de ese artista: si lo tenés, lo que falta es su tema (Virus no es Virus Syndicate).
   */
  private cover(e: ListEntry, want: TitleParts): EntryMatch | null {
    if (want.base.length < 6 || GENERIC.test(want.base)) return null
    this.words ??= this.wordIndex()
    if (this.artistKeys(e.artist).some((a) => this.allArtists!.has(a))) return null
    const keys = new Set<string>([want.base])
    for (const w of wordsOf(e.title)) { const ks = this.words.get(w); if (ks && ks.size <= 3000) for (const k of ks) keys.add(k) }
    let best: { c: { t: LibTrack; parts: TitleParts }; sim: number } | null = null
    for (const k of keys) {
      const sim = k === want.base ? 1 : Math.abs(k.length - want.base.length) <= 3 ? similarity(k, want.base) : 0
      if (sim < 0.85) continue
      for (const c of this.byTitle.get(k) ?? []) {
        if (c.parts.versions.join('|') !== want.versions.join('|')) continue
        const closer = (x: LibTrack) => Math.abs((x.duration ?? 0) - (e.duration ?? 0))
        if (!best || sim > best.sim || (sim === best.sim && (closer(c.t) - closer(best.c.t) || better(c.t, best.c.t)) < 0)) best = { c, sim }
      }
    }
    if (!best) return null
    const t = best.c.t
    const dur = t.duration != null ? ` (${mmss(t.duration)}${e.duration != null ? T.elPedido(mmss(e.duration)) : ''})` : ''
    return { kind: 'version', fileId: t.id, why: T.otroArtista(shown(t), dur), copies: 0 }
  }

  /** Las palabras de cada título (de 4 letras o más), para encontrar rápido los que se escriben casi igual. */
  private words: Map<string, Set<string>> | null = null
  /** Todos los artistas de la biblioteca, como los compara el emparejador (se arma con `words`). */
  private allArtists: Set<string> | null = null
  private wordIndex(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    this.allArtists = new Set()
    for (const [k, cs] of this.byTitle) for (const c of cs) {
      for (const a of c.artists) this.allArtists.add(a)
      for (const w of wordsOf(c.t.title ?? c.t.guess?.title ?? '')) {
        let s = out.get(w)
        if (!s) out.set(w, (s = new Set()))
        s.add(k)
      }
    }
    return out
  }

  /**
   * Lo exacto: los mismos artistas, el mismo título entero y la misma versión (`fit` ya viene filtrado por versión y duración).
   * Sin duración en la lista, todas las copias tienen que durar lo mismo (±3 s): si no, son dos versiones y se confirma a mano.
   * Si la lista pide la común, no cuentan las copias de un disco o una carpeta en vivo (el "Jijiji" de Chateau Carreras dura
   * casi lo mismo que el de Oktubre; corrida del 24/10). De varias copias, la mejor nota.
   */
  private exact(e: ListEntry, want: TitleParts, fit: { t: LibTrack; parts: TitleParts; strict: string | null }[]): EntryMatch | null {
    const artists = strictArtists(e.artist, e.title)
    if (!artists || GENERIC.test(want.base)) return null
    const same = [...new Map(fit.filter((c) => c.strict === artists && c.parts.full === want.full && (want.versions.length || !otherTake(c.t))).map((c) => [c.t.id, c.t])).values()].sort(better)
    if (!same.length) return null
    const durs = same.map((t) => t.duration).filter((d): d is number => d != null)
    if (e.duration == null && durs.length && Math.max(...durs) - Math.min(...durs) > LIST_SECONDS) return null
    const t = same[0]
    const why = e.duration != null && t.duration != null ? T.exactoDura(mmss(e.duration), mmss(t.duration)) : T.exactoSolo
    return { kind: 'exacto', fileId: t.id, why, copies: same.length - 1 }
  }
}

const REMASTER = /^(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?re ?master(?:ed)?(?:\s+(?:version|edition))?(?:\s+\d{4})?|\d{4})$/
const plain = (s: string) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
/**
 * El título para buscarlo (Faltan o suenan mal): sin los remasters ni el año que agrega Spotify, pero con la versión que
 * pide la lista: "Ship of Fools - 2009 - Remaster" → "Ship of Fools"; "Save a Prayer - Single Version" → "Save a Prayer (Single Version)".
 */
export function requestTitle(title: string): string {
  const [head, ...tails] = title.split(/\s+[-–—]\s+/)
  const t = head.replace(/\s*[([]([^)\]]*)[)\]]/g, (m, g: string) => (REMASTER.test(plain(g)) ? '' : m)).trim()
  return [t || head, ...tails.filter((x) => !REMASTER.test(plain(x))).map((x) => `(${x.trim()})`)].join(' ')
}

/** ¿Es el mismo tema? Mismo título (sin remasters), misma versión, algún artista en común y la duración ±3 s si se sabe. Lo usa la Bandeja. */
export function sameSong(a: { artist: string; title: string; duration?: number | null }, b: { artist: string; title: string; duration?: number | null }): boolean {
  const pa = titleParts(a.title), pb = titleParts(b.title)
  if (!pa.base || pa.base !== pb.base || pa.versions.join('|') !== pb.versions.join('|')) return false
  if (pa.full !== pb.full && pa.base !== pa.full && pb.base !== pb.full) return false
  const na = new Set(names(a.artist))
  if (a.artist.trim() && b.artist.trim() && !names(b.artist).some((k) => na.has(k))) return false
  return a.duration == null || b.duration == null || Math.abs(a.duration - b.duration) <= LIST_SECONDS
}
