// Decide el género de un tema juntando lo que dicen Discogs (los estilos de los discos donde está el tema), Last.fm (las
// etiquetas del tema y, con menos peso, las del artista) y MusicBrainz. Puro: no lee la base ni pide nada a internet.
// Un solo género por tema, de la lista cerrada de core/genrewords.ts, y con el nivel de detalle elegido (estilo o general).
import { canonGenre, discogsParent, isParent, type GenreInfo } from './genrewords'
import type { LastfmTag } from './online/lastfm'
import type { GenreLevel, GenreSource } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

// de dónde salió cada voto (se ve como motivo; los géneros mismos no se traducen). Cada nota empieza con la fuente y ":".
const T = textos({
  discogs: {
    es: (n: number, total: number) => `Discogs: ${n} de ${total} ${total === 1 ? 'disco' : 'discos'}`,
    en: (n: number, total: number) => `Discogs: ${n} of ${total} ${total === 1 ? 'release' : 'releases'}`,
  },
  tema: { es: 'tema', en: 'track' },
  artista: { es: 'artista', en: 'artist' },
})
export type { GenreLevel, GenreSource }

/** Un disco de Discogs donde está el tema: sus estilos y sus géneros generales (los viejos de la caché no traen géneros). */
export interface DiscogsRelease {
  styles: string[]; genres?: string[]
  /** recopilación de varios artistas: pesa la mitad */
  various?: boolean
  /** disco de remixes de un tema que no es un remix: pesa poco (los de un hit de pop son de house: "Bad Romance" no es House) */
  remix?: boolean
}
const relWeight = (r: DiscogsRelease) => (r.various ? 0.5 : 1) * (r.remix ? 0.25 : 1)
export interface GenreEvidence {
  discogs?: DiscogsRelease[]
  lastfmTrack?: LastfmTag[]
  lastfmArtist?: LastfmTag[]
  musicbrainz?: string | null
}
export interface GenrePick {
  genre: string
  conf: 'alta' | 'media'
  sources: GenreSource[]
  /** En palabras: qué dijo cada fuente. */
  why: string
  /** Otros géneros que también tuvieron peso (para mostrarlos). */
  others: string[]
}

/** Lo mínimo para proponer algo: menos que esto es ruido (una etiqueta suelta de un artista). */
const MIN_SCORE = 0.3

interface Vote { info: GenreInfo; score: number; from: Set<GenreSource>; by: Partial<Record<GenreSource, number>>; order: number; notes: string[] }

/** Los votos de cada fuente, por género (todavía sin elegir nivel). */
function votes(ev: GenreEvidence): Vote[] {
  const out = new Map<string, Vote>()
  let order = 0
  const add = (info: GenreInfo | null, score: number, src: GenreSource, note: string) => {
    if (!info || score <= 0) return
    const v = out.get(info.name) ?? { info, score: 0, from: new Set<GenreSource>(), by: {}, order: order++, notes: [] }
    v.score += score; v.by[src] = (v.by[src] ?? 0) + score; v.from.add(src); if (!v.notes.includes(note)) v.notes.push(note)
    out.set(info.name, v)
  }
  // Discogs: cada estilo pesa según en cuántos de los discos aparece (con un solo disco, un poco menos)
  const rel = ev.discogs ?? []
  const total = rel.reduce((s, r) => s + relWeight(r), 0)
  if (total > 0) {
    const share = new Map<string, { info: GenreInfo; w: number; n: number }>()
    for (const r of rel) {
      const seen = new Set<string>()
      for (const s of r.styles) {
        const info = canonGenre(s)
        if (!info || seen.has(info.name)) continue
        seen.add(info.name)
        const e = share.get(info.name) ?? { info, w: 0, n: 0 }
        e.w += relWeight(r); e.n++
        share.set(info.name, e)
      }
    }
    const cap = rel.length === 1 ? 0.7 : 1
    for (const e of share.values()) add(e.info, (e.w / total) * cap, 'discogs', T.discogs(e.n, rel.length))
  }
  // Last.fm: solo las etiquetas que son géneros, y solo las que usa bastante gente
  const tags = (list: LastfmTag[] | undefined, weight: number, min: number, what: string) => {
    let used = 0
    const max = Math.max(1, ...(list ?? []).map((t) => t.count))
    for (const t of list ?? []) {
      if (used >= 6) break
      const info = canonGenre(t.name, true)
      if (!info || (t.count / max) * 100 < min) continue
      used++
      add(info, weight * (t.count / max), 'lastfm', `Last.fm (${what}): "${t.name}"`)
    }
  }
  tags(ev.lastfmTrack, 0.8, 15, T.tema)
  tags(ev.lastfmArtist, 0.45, 25, T.artista)
  // MusicBrainz guarda solo su etiqueta más votada, y a veces es cualquier cosa ("Comfortably Numb" → Electronic): acompaña, nunca decide sola
  if (ev.musicbrainz) add(canonGenre(ev.musicbrainz), 0.2, 'musicbrainz', `MusicBrainz: "${ev.musicbrainz}"`)
  return [...out.values()]
}

/** Junta los votos en los géneros generales (Deep House y Techno suman para Electronic). */
function toGeneral(vs: Vote[], ev: GenreEvidence): Vote[] {
  const out = new Map<string, Vote>()
  // un estilo que está en dos géneros (Hardcore, Electro): manda el género que Discogs le puso a esos discos
  const dgParents = new Set((ev.discogs ?? []).flatMap((r) => (r.genres ?? []).map(discogsParent).filter((x): x is string => !!x)))
  for (const v of vs) {
    let parent = v.info.parent
    if (dgParents.size && !dgParents.has(parent) && v.from.has('discogs') && dgParents.size === 1) parent = [...dgParents][0]
    const g = out.get(parent) ?? { info: { name: parent, parent }, score: 0, from: new Set<GenreSource>(), by: {}, order: v.order, notes: [] }
    g.score += v.score; for (const f of v.from) g.from.add(f); for (const [k, x] of Object.entries(v.by) as [GenreSource, number][]) g.by[k] = (g.by[k] ?? 0) + x; for (const n of v.notes) if (!g.notes.includes(n)) g.notes.push(n)
    g.order = Math.min(g.order, v.order)
    out.set(parent, g)
  }
  return [...out.values()]
}

/** El peso de cada género en lo que dijo internet de este tema (para armar el desempate de toda la biblioteca). */
export function genreVotes(ev: GenreEvidence): { name: string; parent: string; score: number }[] {
  return votes(ev).map((v) => ({ name: v.info.name, parent: v.info.parent, score: v.score }))
}

/**
 * El género para un tema, o null si nada alcanza. `prior`: cuánto se usa cada género en la biblioteca y en las demás
 * propuestas; desempata cuando dos pesan casi lo mismo (Discogs da los estilos de un disco en orden alfabético: Dillom
 * es "Horrorcore, Trap" y gana Trap, que es lo que más tenés). Así, además, quedan pocos géneros distintos.
 */
export function decideGenre(ev: GenreEvidence, level: Exclude<GenreLevel, 'biblioteca'> = 'estilo', prior?: (name: string) => number): GenrePick | null {
  const raw = votes(ev)
  const vs = (level === 'general' ? toGeneral(raw, ev) : raw).sort((a, b) => b.score - a.score || a.order - b.order)
  if (!vs.length || vs[0].score < MIN_SCORE) return null
  let win = vs[0]
  if (prior) win = vs.filter((v) => v.score >= vs[0].score * 0.9).reduce((b, v) => (prior(v.info.name) > prior(b.info.name) ? v : b), win)
  if (level === 'estilo') {
    // "Electronic" o "Rock" a secas, si hay un estilo de ese género con peso, es mejor el estilo: más preciso
    if (isParent(win.info.name)) {
      const child = vs.find((v) => v !== win && v.info.parent === win.info.name && !isParent(v.info.name) && v.score >= win.score * 0.5)
      if (child) win = child
    }
  }
  const family = (v: Vote) => v.info.name === win.info.name || v.info.parent === win.info.name || win.info.parent === v.info.name
  // lo que suma al ganador: él mismo y sus parientes (el género general de un estilo, o un estilo de un género)
  const from = new Set<GenreSource>()
  for (const v of vs) if (family(v)) for (const f of v.from) from.add(f)
  // dos estilos del mismo género (Trap y Horrorcore) no hacen dudar: dudar es entre familias (Reggae o Rock)
  const rival = vs.find((v) => !family(v) && v.info.parent !== win.info.parent)
  const dg = (ev.discogs ?? []).length
  const strongDiscogs = dg >= 2 && (win.by.discogs ?? 0) >= 0.6
  const close = !!rival && rival.score >= win.score * 0.85
  // un hit de pop o latino del que Discogs tiene los simples con remixes: "Electronic, Pop" y estilo House. Sin Last.fm
  // que lo confirme, queda en media (corrida del 23/10: "Bad Romance" y "Las de la Intuición" salían House)
  const dgFamilies = new Set((ev.discogs ?? []).flatMap((r) => (r.genres ?? []).map(discogsParent)).filter(Boolean))
  const crossover = win.info.parent === 'Electronic' && !['Synth Pop', 'New Wave', 'Electronic'].includes(win.info.name) && [...dgFamilies].some((g) => g !== 'Electronic') && !from.has('lastfm')
  // alta: Discogs y Last.fm de acuerdo, o varios discos de Discogs que dicen lo mismo (MusicBrainz solo suma)
  const conf: GenrePick['conf'] = !close && !crossover && ((from.has('discogs') && from.has('lastfm')) || strongDiscogs) ? 'alta' : 'media'
  // qué dijo cada fuente: lo del ganador primero y una nota por fuente ("Discogs: 4 de 4" y no también la del género general)
  const notes: string[] = [], said = new Set<string>()
  for (const v of [win, ...vs.filter((x) => x !== win && family(x))]) for (const t of v.notes) { const src = t.split(':')[0]; if (!said.has(src)) { said.add(src); notes.push(t) } }
  return {
    genre: win.info.name, conf, sources: [...from].sort(),
    why: [...new Set(notes)].slice(0, 4).join(' · '),
    others: vs.filter((v) => !family(v) && v.score >= MIN_SCORE).slice(0, 3).map((v) => v.info.name),
  }
}
