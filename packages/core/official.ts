// Nombres oficiales (perfil "Oficial", Fase C): a partir de lo que respondieron las fuentes de internet, decide qué artista
// y qué título proponer para un tema y con qué confianza. Funciones puras (sin internet): las fuentes están en core/online/.
// Reglas (decididas el 20/10/2026):
// - el nombre del artista va como figura en las bases ("Balvin" → "J Balvin"); un tema cuenta como confirmado si la fuente
//   tiene una grabación con ese título y la misma duración (±7 s);
// - el título va como lo escribe MusicBrainz, mayúsculas incluidas (decidido el 20/10); si solo lo tiene
//   Deezer, se corrigen letras, acentos y títulos cortados, y las mayúsculas quedan como vienen. Nunca se sacan acentos ni signos.
//   Desde el 24/10, Arreglar nombres respeta las mayúsculas del tema (o las del nombre del archivo si el tag está vacío): las
//   de MusicBrainz no se proponen solas (core/tidy-official.ts, `keepCase` y `caseFromFile`);
// - el feat. queda en el artista, como lo arma PAILA; "Various Artists" nunca es el artista de un tema;
// - lo dudoso (una sola fuente con un nombre parecido, fuentes que no coinciden, sin duración) nunca se aplica solo: va a
//   "para mirar a mano".
import { artistParts, isSeparator } from './artists'
import { fold, loose, stylized } from './names'
import { SOURCE_LABEL, type Source } from './online/http'
import { bareTitle, creditText, isVarious, plainPunct, similarity, type ArtistHit, type RecHit } from './online/hits'
import type { AcoustHit } from './online/sources'
import type { AuddResult } from './online/audd'
import { T } from './official.textos'

export type Conf = 'alta' | 'media'
/** Cómo se relaciona el nombre del usuario con el oficial. */
export type Relation = 'same' | 'alias' | 'subset' | 'typo'
const REL_RANK: Record<Relation, number> = { same: 0, alias: 1, subset: 2, typo: 3 }
/** Orden de confianza de las fuentes para el texto exacto (MusicBrainz cuida la escritura; Discogs numera homónimos). */
export const SOURCE_ORDER: Source[] = ['musicbrainz', 'deezer', 'acoustid', 'discogs']

export interface OfficialTrack { id: number; artist: string; title: string; duration: number | null }
/** Una propuesta para un campo de un tema. */
export interface Found { field: 'artist' | 'title'; to: string; conf: Conf; why: string; sources: Source[] }
/** Lo que se sabe de un tema: artistas encontrados por nombre (MusicBrainz, con alias) y grabaciones de cada fuente. */
export interface Evidence { artists: ArtistHit[]; recs: Partial<Record<Source, RecHit[]>> }

const tokens = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** ¿El nombre `p` (del usuario) es el artista `name` de una fuente? `aliases`: los alias conocidos de ese artista. */
export function relate(p: string, name: string, aliases: string[] = []): Relation | null {
  const lp = loose(p), ln = loose(name)
  if (!lp || !ln || isVarious(name)) return null
  if (lp === ln) return 'same'
  if (aliases.some((a) => loose(a) === lp)) return 'alias'
  const tp = tokens(p), tn = new Set(tokens(name))
  if (lp.length >= 4 && tp.length < tn.size && tp.every((t) => tn.has(t))) return 'subset'
  if (Math.min(lp.length, ln.length) >= 5 && similarity(lp, ln) >= 0.8) return 'typo'
  return null
}

/** Cómo coincide el título: igual (salvo signos y acentos), cortado en 30 letras, o solo la base (sin paréntesis). */
export type TitleMatch = 'same' | 'cut' | 'base'
const noParens = (s: string) => s.replace(/\s*[([][^)\]]*[)\]]/g, '').trim()
/** Lo que el oficial tiene después de la parte que el usuario ya tiene (comparando sin signos ni acentos). */
function restAfter(mine: string, official: string): string {
  const want = loose(mine).length
  let i = 0
  while (i < official.length && loose(official.slice(0, i)).length < want) i++
  return official.slice(i)
}
export function titleMatch(t: string, official: string): TitleMatch | null {
  const o = bareTitle(official)
  const lt = loose(t), lo = loose(o)
  if (!lt || !lo) return null
  if (lt === lo) return 'same'
  // los tags viejos (ID3v1) cortan en 30 letras, a veces en medio de una palabra; lo que sigue no es un paréntesis
  // agregado ("Can't Take My Eyes Off of You (I Love You Baby)" no estaba cortado)
  const len = t.trim().length
  // lo que falta sigue la palabra cortada o empieza otra; no es un ")" ni un paréntesis nuevo ("(Part II)" + " (Pt. 2)")
  if (len >= 29 && len <= 30 && !/[)\]]$/.test(t.trim()) && lo.startsWith(lt) && lo.length > lt.length && /^(?:[\p{L}\p{N}]|\s+[\p{L}\p{N}])/u.test(restAfter(t, o))) return 'cut'
  if (loose(noParens(t)) && loose(noParens(t)) === loose(noParens(o))) return 'base'
  return null
}

const clusters = (s: string) => s.normalize('NFD').match(/\P{M}\p{M}*/gu) ?? []
/**
 * Pone los acentos de `official` sobre el texto del usuario, respetando sus mayúsculas: "SE QUE NO SE" + "Sé que no sé"
 * → "SÉ QUE NO SÉ". null si no se pueden alinear letra por letra (cambian signos o letras).
 */
export function transferMarks(mine: string, official: string): string | null {
  const a = clusters(mine), b = clusters(official)
  if (a.length !== b.length) return null
  let out = ''
  for (let i = 0; i < a.length; i++) {
    if (a[i][0].toLowerCase() !== b[i][0].toLowerCase()) return null
    out += a[i][0] + b[i].slice(1)
  }
  return out.normalize('NFC')
}

/**
 * ¿El oficial le saca acentos o tildes al nombre del usuario? Muchas bases los pierden ("Eladio Carrion", "Como le Digo",
 * "INVOKER"): PAILA solo agrega acentos, nunca los saca.
 */
export function dropsMarks(mine: string, official: string): boolean {
  const a = clusters(mine), b = clusters(official)
  if (a.length === b.length && a.every((x, i) => x[0].toLowerCase() === b[i][0].toLowerCase())) return a.some((x, i) => x.length > 1 && b[i].length === 1)
  const marks = (s: string) => (s.normalize('NFD').match(/\p{M}/gu) ?? []).length
  return marks(official) < marks(mine)
}

/** El texto oficial con el estilo de mayúsculas del usuario (todo en mayúsculas, o cada palabra con mayúscula). */
function restyle(mine: string, official: string, onlyNewWords = false): string {
  if (/\p{L}/u.test(mine) && mine === mine.toUpperCase()) return official.toUpperCase()
  const titled = mine.split(/\s+/).filter((w) => /\p{L}/u.test(w)).every((w) => /^\P{L}*\p{Lu}/u.test(w))
  return titled ? official.replace(onlyNewWords ? /(\s)(\p{Ll})/gu : /(^|\s)(\p{Ll})/gu, (_, s: string, c: string) => s + c.toUpperCase()) : official
}

/**
 * Un título cortado ("Voy A Bailar A La Nave Del Olv") completado con el oficial. `asOfficial`: entero como lo escribe la
 * fuente (MusicBrainz); si no, con las mayúsculas al estilo del usuario.
 */
export function completeCut(mine: string, official: string, asOfficial = false): string {
  const o = bareTitle(official)
  // solo hasta un paréntesis que abre en lo que falta ("Charlatán (Live)": la versión no es parte del nombre cortado)
  let rest = restAfter(mine, o)
  const open = (mine.match(/[([]/g) ?? []).length - (mine.match(/[)\]]/g) ?? []).length
  if (open <= 0) rest = rest.replace(/\s*[([].*$/, '')
  if (asOfficial) return (o.slice(0, o.length - restAfter(mine, o).length) + rest).replace(/\s+/g, ' ').trim()
  rest = restyle(mine, rest, true)
  const joined = (mine.trimEnd() + rest).replace(/\s+/g, ' ').trim()
  return transferMarks(joined, o) ?? joined // los acentos de la parte que ya estaba ("Corazo" → "Corazón")
}

/**
 * Lo que el usuario puede tener como artista principal, del más largo al más corto: los nombres antes del feat.
 * ("Sparrow & Barbossa, Enzo Siffredi", "Sparrow & Barbossa", "Sparrow"). Un dúo es un solo artista.
 */
export function leads(artist: string): string[] {
  const parts = artistParts(artist.split(' feat. ')[0])
  const out: string[] = []
  let acc = ''
  for (const p of parts) { acc += p; if (!isSeparator(p)) out.unshift(acc.trim()) }
  return out.length ? out : [artist]
}
/** ¿El artista repite un nombre? ("Wisin & Yandel & Yandel": el oficial ya incluía al que seguía). */
const repeats = (artist: string) => { const ns = artistParts(artist).filter((p) => !isSeparator(p)).map((p) => fold(p.trim())); return new Set(ns).size < ns.length }

/** `name`: el nombre oficial; si MusicBrainz conoce a ese artista, como lo escribe MusicBrainz ("No Te Va Gustar", no "No te va Gustar"). */
interface Pick { hit: RecHit; source: Source; rel: Relation; idx: number; lead: string; tm: TitleMatch; durOk: boolean | null; name: string; mbName: boolean }

/**
 * La grabación de una fuente que mejor confirma este tema: el título coincide, la duración también (si se sabe) y el
 * artista se relaciona. Primero se prueba el grupo entero ("Wisin & Yandel" es un dúo, no "Wisin" + otro).
 */
export function bestRec(t: OfficialTrack, hits: RecHit[], artistHits: ArtistHit[]): Pick | null {
  const ls = leads(t.artist)
  const aliasesOf = (name: string) => artistHits.filter((a) => loose(a.name) === loose(name)).flatMap((a) => a.aliases)
  let best: Pick | null = null
  for (const hit of hits) {
    const tm = hit.titleFromQuery ? 'base' : titleMatch(t.title, hit.title)
    if (!tm) continue
    const durOk = t.duration != null && hit.length != null ? Math.abs(t.duration - hit.length) <= 7 : null
    if (durOk === false) continue
    let rel: Relation | null = null, idx = -1, lead = ''
    for (const l of ls) {
      hit.credit.forEach((c, i) => { const r = relate(l, c.name, aliasesOf(c.name)); if (r && (!rel || REL_RANK[r] < REL_RANK[rel])) { rel = r; idx = i } })
      if (rel) { lead = l; break }
    }
    if (!rel) continue
    const credited = hit.credit[idx].name
    const mb = artistHits.find((a) => a.source === 'musicbrainz' && loose(a.name) === loose(credited))
    const cand: Pick = { hit, source: hit.source, rel, idx, lead, tm, durOk, name: mb?.name ?? credited, mbName: !!mb || hit.source === 'musicbrainz' }
    const score = (p: Pick) => REL_RANK[p.rel] * 10 + (p.tm === 'base' ? 3 : 0) + (p.durOk ? 0 : 2) + (p.hit.odd ? 1 : 0)
    if (!best || score(cand) < score(best)) best = cand
  }
  return best
}

const caseOnly = (a: string, b: string) => a !== b && a.toLowerCase() === b.toLowerCase()
const list = (ss: Source[]) => ss.map((s) => SOURCE_LABEL[s]).join(T.y)
/** Cambia el artista principal (`lead`) dentro del artista completo, sin tocar los invitados. */
export const replaceLead = (artist: string, lead: string, to: string) => {
  const i = artist.indexOf(lead)
  return i >= 0 ? artist.slice(0, i) + to + artist.slice(i + lead.length) : artist
}

/**
 * Lo que proponen las fuentes para un tema (artista principal y título). `main`: el nombre oficial del artista principal
 * si cambia; `keeps`: alguna fuente confirma el tema con el artista escrito tal cual (sirve para no generalizar).
 */
export interface TrackDecision { found: Found[]; main: { from: string; to: string; conf: Conf } | null; keeps: boolean; confirmed: boolean; lead?: string
  /** El artista es otro nombre de uno de MusicBrainz (`mb`) y, si este tema está en Deezer, cómo lo publica (`as`). */
  alias?: { mb: string; as?: string } }
export function decideTrack(t: OfficialTrack, ev: Evidence): TrackDecision {
  const picks = SOURCE_ORDER.map((s) => bestRec(t, ev.recs[s] ?? [], ev.artists)).filter((p): p is Pick => !!p)
  if (!picks.length) return { found: [], main: null, keeps: false, confirmed: false }
  const out: Found[] = []
  let mainTo: TrackDecision['main'] = null
  const confirmed = picks.some((p) => p.durOk)

  // --- artista principal ---
  const named = picks.map((p) => ({ src: p.source, name: p.name, raw: p.hit.credit[p.idx].name, rel: p.rel, lead: p.lead, mbName: p.mbName }))
  const off = { ...named[0] }, lead = off.lead
  // un artista que cambió de nombre ("Kanye West" → "Ye"): va como se publica hoy en las tiendas, el crédito de Deezer, si
  // MusicBrainz confirma que es el mismo artista (su nombre o uno de sus alias). Si Deezer no lo tiene, el de MusicBrainz
  // (el autor, 24/10: "una sola carpeta, con el nombre como se publica hoy en las tiendas")
  // Solo si Deezer usa otro nombre de verdad: con las mismas letras ("No te va Gustar", "Køzløv") manda MusicBrainz, que respeta
  // cómo lo escribe el artista. Si Deezer no tiene este tema, lo resuelve officialFindings con los otros temas del mismo artista.
  const dz = named.find((x) => x.src === 'deezer')
  // el artista de MusicBrainz que tiene ese nombre como alias ("Ye" tiene "Kanye West"), aunque este tema no esté en MusicBrainz
  const mbOf = (n: string) => ev.artists.find((a) => a.source === 'musicbrainz' && a.score >= 90 && loose(a.name) !== loose(n) && a.aliases.some((x) => loose(x) === loose(n)))
  let alias: TrackDecision['alias'] = off.rel === 'alias' ? { mb: off.name } : undefined
  const m = dz ? mbOf(dz.raw) : undefined
  if (dz && m && (!alias || loose(alias.mb) === loose(m.name))) {
    alias = { mb: m.name, as: dz.raw }
    if (off.rel === 'alias') off.name = dz.raw
  }
  const agree = named.filter((x) => loose(x.name) === loose(off.name))
  const disagree = named.some((x) => loose(x.name) !== loose(off.name))
  // cada fuente vota con lo que escribe ella (MusicBrainz: su ficha del artista; Deezer: su crédito)
  // Discogs confirma qué artista es, pero no cómo se escribe (usa sus propias convenciones: "J. Balvin", "Rage Against The Machine")
  const spellers = agree.filter((x) => x.src !== 'discogs')
  const voices = new Set([...(off.mbName ? [off.name] : []), ...spellers.filter((x) => x.src !== 'musicbrainz').map((x) => x.raw)])
  const voters = spellers.length + (off.mbName && !spellers.some((x) => x.src === 'musicbrainz') ? 1 : 0) // la ficha de MusicBrainz también vota
  const exactAll = voters >= 2 && voices.size === 1 && voices.has(off.name)
  const punct = (s: string) => (s.match(/[^\p{L}\p{N}\s]/gu) ?? []).length
  // nunca se sacan acentos; signos, solo si MusicBrainz y Deezer escriben igual ("J. Balvin" → "J Balvin" sí, "C.R.O" → "CRO" no)
  const removes = dropsMarks(lead, off.name) || (loose(off.name) === loose(lead) && punct(off.name) < punct(lead) && !exactAll)
  // si otra fuente tiene el tema con el nombre tal cual, o MusicBrainz conoce un artista que se llama exactamente así,
  // un nombre "parecido" de otra fuente no se propone ("Katy Perry" no es "Katie Perry", "Miley Cyrus" no es "MILEY")
  const kept = named.some((x) => loose(x.raw) === loose(lead) || loose(x.name) === loose(lead))
  const real = off.rel !== 'same' && off.rel !== 'alias' && ev.artists.some((a) => a.source === 'musicbrainz' && a.score >= 90 && loose(a.name) === loose(lead))
  if (off.name !== lead && !stylized(lead) && !removes && !(kept && loose(off.name) !== loose(lead)) && !real) {
    let to: string | null = off.name, conf: Conf = 'media'
    if (loose(off.name) === loose(lead)) {
      const marks = transferMarks(lead, off.name)
      // solo mayúsculas: se sigue a la fuente únicamente si MusicBrainz y Deezer lo escriben igual
      if (caseOnly(off.name, lead)) to = exactAll ? off.name : null
      else if (marks) to = exactAll ? off.name : marks
      // signos o espacios ("Miranda" → "Miranda!", "Locomia" → "Loco Mia"): lo dice MusicBrainz, o dos fuentes igual
      // el nombre de un artista vale para todos sus temas: un cambio de signos, espacios o acentos lo tiene que decir
      // MusicBrainz o dos fuentes igual ("Balvin" → "Balvín" lo decía solo Deezer, y era otro artista)
      const trusted = off.mbName || exactAll
      conf = confirmed && !disagree && trusted ? 'alta' : 'media'
    } else if (off.rel === 'same' || off.rel === 'alias') conf = confirmed && !disagree ? 'alta' : 'media'
    else conf = confirmed && agree.length >= 2 && !disagree ? 'alta' : 'media'
    // un nombre de una sola palabra completado ("Rodrigo" → "Rodrigo Romero") con una sola fuente es demasiado dudoso
    if (off.rel === 'subset' && !/\s/.test(lead) && agree.length < 2) to = null
    if (to && to !== lead && !repeats(replaceLead(t.artist, lead, to))) {
      const how = off.rel === 'alias' ? T.alias(lead, off.name) : off.rel === 'subset' ? T.completo(off.name) : off.rel === 'typo' ? T.malEscrito(off.name) : T.asiLoEscribe(list([off.src]))
      mainTo = { from: lead, to, conf }
      out.push({ field: 'artist', to: replaceLead(t.artist, lead, to), conf, sources: agree.map((x) => x.src), why: `${how} (${conf === 'alta' ? T.confirmado(list(agree.map((x) => x.src))) : disagree ? T.noCoinciden : !confirmed ? T.sinDuracion : T.unaFuente})` })
    }
  }

  // --- título (MusicBrainz o Deezer: Discogs no da el título exacto) ---
  // Decidido el 20/10/2026: el título como lo escribe MusicBrainz, mayúsculas incluidas ("Tarea Fina" → "Tarea
  // fina"). Si solo lo tiene Deezer, se corrigen letras y acentos y las mayúsculas quedan como vienen. Nunca se sacan
  // acentos ni signos, y nunca se cambia solo por espacios o por corchetes en vez de paréntesis.
  const tp = picks.find((p) => p.tm !== 'base' && (p.source === 'musicbrainz' || p.source === 'deezer'))
  if (tp) {
    const o = bareTitle(tp.hit.title)
    const fromMb = tp.source === 'musicbrainz'
    // "…" o comillas tipográficas del usuario cuentan igual que las comunes
    const mine = plainPunct(t.title)
    const other = picks.find((p) => p !== tp && p.tm !== 'base' && !p.hit.titleFromQuery)
    const otherSays = other ? bareTitle(other.hit.title) : null
    const squash = (s: string) => s.replace(/\s+/g, '').replace(/\[/g, '(').replace(/\]/g, ')')
    const punct = (s: string) => (s.match(/[^\p{L}\p{N}\s]/gu) ?? []).length
    if (tp.tm === 'cut') {
      const to = completeCut(t.title, o, fromMb)
      if (to !== t.title) out.push({ field: 'title', to, conf: tp.durOk ? 'alta' : 'media', sources: [tp.source], why: T.cortado(t.title.length, list([tp.source])) })
    } else if (o !== mine && !dropsMarks(mine, o) && punct(o) >= punct(mine) && squash(o).toLowerCase() !== squash(mine).toLowerCase() || (fromMb && caseOnly(o, mine))) {
      // letras y acentos (alineados uno a uno): seguro si la duración coincide y la otra fuente no lo escribe distinto
      const aligned = transferMarks(mine, o)
      if (aligned) {
        const to = fromMb ? o : aligned
        const fight = otherSays != null && loose(otherSays) === loose(o) && transferMarks(mine, otherSays) !== aligned && otherSays.toLowerCase() !== o.toLowerCase()
        if (to !== mine) out.push({ field: 'title', to, conf: tp.durOk && !fight ? 'alta' : 'media', sources: [tp.source], why: `${T.comoEn(caseOnly(o, mine), list([tp.source]))}${fight ? T.loEscribe(list([other!.source]), otherSays!) : ''}` })
      } else {
        // cambian signos: solo si agrega algo ("Its" → "It's", "TÉRMINOS_" → "TÉRMINOS?"): para mirar a mano
        const to = fromMb ? o : restyle(mine, o)
        if (to !== mine) out.push({ field: 'title', to, conf: 'media', sources: [tp.source], why: T.signos(list([tp.source]), o) })
      }
    }
  }
  return { found: out, main: mainTo, keeps: !mainTo && loose(off.name) === loose(lead), confirmed, lead, alias }
}

/** Reconocer un tema sin artista o sin título por su huella acústica (AcoustID). */
/**
 * ¿El nombre del archivo dice otra cosa? ("give it 2 me.mp3" reconocido como "Super Pop"). Si el nombre tiene palabras y
 * ninguna aparece en lo reconocido, conviene mirarlo. Sin nombre útil ("pista 03.mp3") no opina.
 */
export function fileDisagrees(file: string | undefined, artist: string, title: string): boolean {
  if (!file) return false
  const base = file.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')
  const words = fold(base).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^(?:mix|original|remix|edit|feat|mp3|wav|flac|track|pista|audio|escena|version)$/.test(w) && !/^\d+$/.test(w))
  if (!words.length) return false
  const got = loose(`${artist} ${title}`)
  return !words.some((w) => got.includes(loose(w))) && !got.includes(loose(base))
}

export function decideByPrint(t: { artist: string | null; title: string | null; duration: number | null; file?: string }, hits: AcoustHit[]): Found[] {
  const recs = hits.filter((h) => h.score >= 0.8).flatMap((h) => h.recordings.map((r) => ({ r, score: h.score })))
    .filter(({ r }) => t.duration == null || r.length == null || Math.abs(t.duration - r.length) <= 7)
  if (!recs.length) return []
  const groups = new Map<string, { artist: string; title: string; n: number; score: number; odd: boolean }>()
  for (const { r, score } of recs) {
    const artist = creditText(r.credit), title = bareTitle(r.title), k = `${loose(artist)}|${loose(title)}`
    const g = groups.get(k) ?? { artist, title, n: 0, score: 0, odd: true }
    g.n++; g.score = Math.max(g.score, score); g.odd = g.odd && !!r.odd
    groups.set(k, g)
  }
  const ranked = [...groups.values()].sort((a, b) => Number(a.odd) - Number(b.odd) || b.n - a.n || b.score - a.score)
  const top = ranked[0]
  const share = top.n / recs.length
  // si el tema ya tiene uno de los dos datos, tiene que coincidir con lo reconocido
  const clash = (t.artist && !relate(t.artist, top.artist)) || (t.title && !titleMatch(t.title, top.title))
  const named = !t.title?.trim() && fileDisagrees(t.file, top.artist, top.title) // se completa el título: que el archivo no diga otro
  const conf: Conf = top.score >= 0.9 && share >= 0.8 && !clash && !named ? 'alta' : 'media'
  const why = T.acoustid(Math.round(top.score * 100), ranked.length, !!clash, named)
  const out: Found[] = []
  if (!t.artist?.trim()) out.push({ field: 'artist', to: top.artist, conf, why, sources: ['acoustid'] })
  if (!t.title?.trim()) out.push({ field: 'title', to: top.title, conf, why, sources: ['acoustid'] })
  return out
}

/**
 * Lo que reconoció AudD (tipo Shazam) en un tema que nada más identificó: completa lo que falta, siempre para mirar a mano
 * (es una sola fuente y un fragmento de 15 s). Si el tema ya tenía uno de los dos datos, tiene que coincidir.
 */
export function decideByAudd(t: { artist: string | null; title: string | null }, r: AuddResult | null): Found[] {
  if (!r) return []
  const clash = (t.artist?.trim() && !relate(t.artist, r.artist)) || (t.title?.trim() && !titleMatch(t.title, r.title))
  if (clash) return []
  const why = T.audd(r.album ?? null)
  const out: Found[] = []
  if (!t.artist?.trim()) out.push({ field: 'artist', to: r.artist, conf: 'media', why, sources: ['audd'] })
  if (!t.title?.trim()) out.push({ field: 'title', to: bareTitle(r.title), conf: 'media', why, sources: ['audd'] })
  return out
}
