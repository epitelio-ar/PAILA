// Filtrar, ordenar y resumir los temas de la tabla, sin React. Con bibliotecas chicas lo hace la interfaz; desde ~20.000
// temas lo hace el proceso principal (core/tableindex.ts) con estas mismas funciones, así se ve y se ordena igual.
import type { CollectionKind, Grade, Track } from './types'
import { display, PROBLEM_TESTS, SORT_VALUES, type ProblemKey, type SortKey } from './trackinfo'

/** Desde cuántos temas la tabla se filtra y pagina en el proceso principal en vez de mandar todo a la interfaz. */
export const BIG_LIBRARY = 20_000

// El texto donde se busca, armado una vez por tema (los temas se vuelven a armar cada vez que se recarga la tabla).
const haystacks = new WeakMap<Track, string>()
const haystack = (t: Track) => {
  let h = haystacks.get(t)
  if (h == null) {
    const d = display(t)
    h = `${d.artist} ${d.title} ${t.album || ''} ${t.genre || ''} ${t.rel}`.toLowerCase()
    haystacks.set(t, h)
  }
  return h
}

export interface TableFilter {
  /** Palabras de la búsqueda (todas tienen que estar). */
  words: string[]
  kind: CollectionKind | 'todo'
  /** Filtro de problema (PROBLEM_TESTS), o null. */
  test: ((t: Track) => boolean) | null
  /** Posición de cada tema en la playlist abierta (null = no hay playlist abierta: se filtra por colección). */
  inPl: Map<number, number> | null
}

export function filterTracks(tracks: Track[], f: TableFilter): Track[] {
  return tracks.filter((t) => {
    if (f.inPl) { if (!f.inPl.has(t.id)) return false } else if (f.kind !== 'todo' && t.kind !== f.kind) return false
    if (f.test && !f.test(t)) return false
    if (!f.words.length) return true
    const hay = haystack(t)
    return f.words.every((w) => hay.includes(w))
  })
}

// Igual que localeCompare('es', { numeric: true }), pero armado una sola vez (con miles de temas, mucho más rápido).
const collator = new Intl.Collator('es', { numeric: true })

/**
 * Ordena por el valor de una columna. Los vacíos van siempre al final, ordenes como ordenes. Cambia `list`.
 * Los textos se comparan con el comparador de idioma una sola vez por valor distinto (artistas, discos y géneros se
 * repiten mucho): cada valor pasa a ser su puesto, y la lista se ordena por número. Da exactamente el mismo orden.
 */
export function sortTracks(list: Track[], value: (t: Track) => string | number, dir: 1 | -1): Track[] {
  const n = list.length
  const vals = list.map(value)
  const texts = [...new Set(vals.filter((v): v is string => typeof v === 'string' && v !== ''))].sort(collator.compare)
  // con números y textos mezclados (no pasa con las columnas de hoy) se compara como siempre, de a pares
  if (texts.length && vals.some((v) => typeof v === 'number' && v !== 0)) return sortPairs(list, vals, dir)
  const rank = new Map<string, number>()
  texts.forEach((s, i) => rank.set(s, i > 0 && collator.compare(texts[i - 1], s) === 0 ? rank.get(texts[i - 1])! : i))
  const key = new Float64Array(n), empty = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const v = vals[i]
    if (v === '' || v === 0) empty[i] = 1
    else key[i] = typeof v === 'number' ? v : rank.get(v)!
  }
  // se ordenan las posiciones (el orden de JavaScript es estable: los empates quedan como estaban)
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => empty[a] - empty[b] || (key[a] - key[b]) * dir)
  const sorted = idx.map((i) => list[i])
  for (let i = 0; i < n; i++) list[i] = sorted[i]
  return list
}

function sortPairs(list: Track[], vals: (string | number)[], dir: 1 | -1): Track[] {
  const key = new Map(list.map((t, i) => [t.id, vals[i]]))
  return list.sort((a, b) => {
    const x = key.get(a.id)!, y = key.get(b.id)!
    const ex = x === '' || x === 0, ey = y === '' || y === 0
    if (ex !== ey) return ex ? 1 : -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))) * dir
  })
}

/** Lo que muestra la tabla: colección, problema, búsqueda, playlist abierta y orden. */
export interface TableQuery {
  kind: CollectionKind | 'todo'
  problem: ProblemKey | null
  /** El texto buscado, tal como se escribió. */
  query: string
  /** Los temas de la playlist abierta, en orden (null = no hay playlist abierta). */
  plIds: number[] | null
  sort: { key: SortKey; dir: 1 | -1 }
}

const NOTA = /^(?:nota|grade):(a\+|[a-df])$/

/** Los temas a la vista, en orden. `sort` = false: solo filtra (los temas ya vienen ordenados). */
export function queryTracks(tracks: Track[], q: TableQuery, sort = true): Track[] {
  const all = q.query.toLowerCase().split(/\s+/).filter(Boolean)
  // "nota:F" (o "grade:F"): solo los temas con esa nota (tocar una nota en Análisis busca así)
  const notas = all.filter((w) => NOTA.test(w)).map((w) => w.replace(NOTA, '$1').toUpperCase())
  const words = all.filter((w) => !NOTA.test(w))
  const inPl = q.plIds ? new Map(q.plIds.map((id, i) => [id, i])) : null
  const prob = q.problem ? PROBLEM_TESTS[q.problem] : null
  const test = notas.length ? (t: Track) => (!prob || prob(t)) && notas.includes(t.grade ?? '') : prob
  const list = filterTracks(tracks, { words, kind: q.kind, test, inPl })
  if (!sort) return list
  if (inPl && q.sort.key === 'order') return list.sort((a, b) => (inPl.get(a.id)! - inPl.get(b.id)!) * q.sort.dir)
  const value = q.sort.key === 'order' ? SORT_VALUES.artist : SORT_VALUES[q.sort.key]
  return sortTracks(list, value, q.sort.dir)
}

/** Puntaje de cada nota para el promedio de Inicio. */
export const GRADE_SCORE: Record<Grade, number> = { 'A+': 100, A: 100, B: 85, C: 65, D: 35, F: 0 }

/** Los números de la barra lateral, la barra de abajo e Inicio. */
export interface LibraryStats {
  /** Cuántos temas y bytes hay por colección (y en total, `todo`). */
  counts: Record<string, { n: number; bytes: number }>
  /** De la colección Música: */
  music: {
    total: number; byGrade: Record<string, number>; graded: number; size: number; tagged: number; full: number; score: number | null
    problems: Record<ProblemKey, { count: number; bytes: number }>
    /** Bytes por extensión, de mayor a menor. */
    byExt: [string, number][]
  }
}

export function libraryStats(tracks: Track[]): LibraryStats {
  const counts: LibraryStats['counts'] = { todo: { n: 0, bytes: 0 } }
  const byGrade: Record<string, number> = {}
  const byExt: Record<string, number> = {}
  const keys = Object.keys(PROBLEM_TESTS) as ProblemKey[]
  const problems = Object.fromEntries(keys.map((k) => [k, { count: 0, bytes: 0 }])) as LibraryStats['music']['problems']
  let total = 0, sum = 0, graded = 0, size = 0, tagged = 0, full = 0
  for (const t of tracks) {
    counts[t.kind] ??= { n: 0, bytes: 0 }
    counts[t.kind].n++; counts[t.kind].bytes += t.size
    counts.todo.n++; counts.todo.bytes += t.size
    if (t.kind !== 'musica') continue
    total++
    size += t.size
    byExt[t.ext] = (byExt[t.ext] || 0) + t.size
    if (t.artist && t.title) tagged++
    if (t.album && t.year && t.genre) full++
    for (const k of keys) if (PROBLEM_TESTS[k](t)) { problems[k].count++; problems[k].bytes += t.size }
    if (!t.grade) continue
    byGrade[t.grade] = (byGrade[t.grade] || 0) + 1
    sum += GRADE_SCORE[t.grade]; graded++
  }
  return {
    counts,
    music: { total, byGrade, graded, size, tagged, full, score: graded ? Math.round(sum / graded) : null, problems, byExt: Object.entries(byExt).sort((a, b) => b[1] - a[1]) },
  }
}

