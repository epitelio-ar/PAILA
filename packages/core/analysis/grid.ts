// Grilla de golpes (Fase F): de la lista de golpes que da un detector (degara de Essentia o Beat This!) a la grilla que
// entiende Rekordbox (TEMPO: dónde cae un golpe, a qué BPM y qué número de golpe del compás es). Puro, sin audio. La grilla variable y el 1 del compás en lo tocado suelto, en gridbars.ts.
import { fitLine, median, round3, type Grid, type GridSegment } from './gridbase'
import { phaseRuns, piecesDisagree, variableGrid } from './gridbars'
export type { Grid, GridSegment } from './gridbase'

/** Cuánto pueden correrse los tramos de la grilla recta antes de pasar a la variable (ms): ya se nota al mezclar. */
export const DRIFT_MS = 12
/**
 * Qué parte de los golpes tiene que caer justo en la grilla recta: escuchando el tema entero, y escuchando solo unos
 * pedazos (más exigente: si no, un tema que se mueve despacio pasa por parejo y no se escucha entero). Medido en la
 * corrida del 21/10 (docs/archivo/pruebas/2026-10-21-grillas-vivo.md): los parejos dan 0,8–1, los tocados sin metrónomo 0,1–0,5.
 */
export const MIN_FIT = 0.6
export const MIN_FIT_PARTS = 0.8
/**
 * Qué parte de los golpes tiene que venir a la misma distancia que el anterior (±10 %) para que haya un pulso: en la
 * música da 0,84–1, aun tocada en vivo; en lo hablado o el ruido, 0,25.
 */
export const MIN_EVEN = 0.5

/**
 * Qué tan parejo es el tempo respecto de una grilla recta (a + b·k). Cada golpe se cuenta contra la línea más cercana
 * (hasta un cuarto de golpe: así se ven los que se corrieron). `fit`: qué parte cae justo (±6 % del golpe). `drift`:
 * en cada tramo de 16 golpes seguidos, cuánto se adelanta o se atrasa la mediana (ms, sin signo). Con el tempo que se mueve
 * despacio (tocado sin metrónomo) la mediana de todo el tema queda baja, pero se corren tramos enteros. Los tramos no
 * saltan los huecos (entre los pedazos que se escucharon).
 */
export function steadiness(beats: number[], a: number, b: number): { fit: number; drift: number[] } {
  const k: number[] = [], t: number[] = []
  let tight = 0
  for (const x of beats) {
    const kk = Math.round((x - a) / b), r = Math.abs(x - (a + kk * b))
    if (r < 0.25 * b) { k.push(kk); t.push(x); if (r < 0.06 * b) tight++ }
  }
  const drift: number[] = []
  for (let i = 0; i < k.length; ) {
    let j = i
    while (j + 1 < k.length && k[j + 1] - k[i] < 16 && k[j + 1] - k[j] <= 4) j++
    if (j - i + 1 >= 10) drift.push(Math.round(Math.abs(median(k.slice(i, j + 1).map((kk, n) => t[i + n] - (a + b * kk)))) * 1000))
    i = j + 1
  }
  return { fit: beats.length ? tight / beats.length : 0, drift }
}

/** Período inicial: la mediana de los intervalos entre golpes vecinos. */
function roughPeriod(beats: number[]): number | null {
  const gaps = beats.slice(1).map((x, i) => x - beats[i]).filter((g) => g > 0.25 && g < 1.5)
  if (gaps.length < 8) return null
  return median(gaps)
}

/**
 * Cuánto "encajan" los golpes en una grilla de período `p` (0–1: el largo del promedio de los golpes como ángulos en la
 * rueda del período) y en qué fase. Tolera golpes que faltan o que sobran: es lo que hace firme la grilla.
 */
function comb(beats: number[], p: number): { strength: number; phase: number } {
  let re = 0, im = 0
  const w = (2 * Math.PI) / p
  for (const t of beats) { re += Math.cos(w * t); im += Math.sin(w * t) }
  const ang = Math.atan2(im, re)
  return { strength: Math.hypot(re, im) / beats.length, phase: (((ang / w) % p) + p) % p }
}

/**
 * El período que mejor encaja con todos los golpes, buscado fino (de a 0,005 BPM) alrededor del de la mediana. Si un
 * número redondo de BPM encaja casi igual (la mayoría de los temas electrónicos se producen así), se queda con ese.
 */
function bestPeriod(beats: number[], p0: number, allowRound = true): { p: number; phase: number; strength: number; round: boolean } {
  const bpm0 = 60 / p0
  let best = { p: p0, ...comb(beats, p0), round: false }
  for (let bpm = bpm0 * 0.98; bpm <= bpm0 * 1.02; bpm += 0.005) {
    const c = comb(beats, 60 / bpm)
    if (c.strength > best.strength) best = { p: 60 / bpm, ...c, round: false }
  }
  if (allowRound) for (const r of [Math.round(60 / best.p), Math.round((60 / best.p) * 2) / 2]) {
    const c = comb(beats, 60 / r)
    if (Math.abs(r - 60 / best.p) < 0.08 && c.strength >= best.strength * 0.985) return { p: 60 / r, ...c, round: true }
  }
  return best
}

/**
 * El 1 del compás. Con los primeros de compás de Beat This!, por votos. Si no, con la energía de cada golpe (`beatEnergy`):
 * en la música para bailar lo nuevo entra en el 1 de una frase, así que gana el resto (0–3) donde más sube la energía de
 * los 4 golpes que siguen contra los 4 de antes. Sin nada, el primer golpe es el 1. Devuelve el resto del 1.
 */
function barPhase(k: number[], a: number, b: number, downbeats: number[] | undefined, beatEnergy: ((time: number) => number) | undefined): number {
  const votes = [0, 0, 0, 0]
  if (downbeats?.length) {
    for (const d of downbeats) { const kk = Math.round((d - a) / b); votes[((kk % 4) + 4) % 4]++ }
    return votes.indexOf(Math.max(...votes))
  }
  if (!beatEnergy || !k.length) return ((k[0] ?? 0) % 4 + 4) % 4
  const lo = k[0], hi = k[k.length - 1]
  const e = new Map<number, number>()
  for (let kk = lo; kk <= hi; kk++) e.set(kk, beatEnergy(a + kk * b))
  const sum = (from: number) => { let s = 0; for (let i = 0; i < 4; i++) s += e.get(from + i) ?? 0; return s }
  for (let kk = lo + 4; kk + 4 <= hi; kk++) {
    const before = sum(kk - 4), after = sum(kk)
    const jump = Math.max(0, after - before) / Math.max(1e-9, before + after)
    votes[((kk % 4) + 4) % 4] += jump * jump
  }
  return votes.indexOf(Math.max(...votes))
}

export interface FitOptions {
  /** Primeros de compás (Beat This!). */
  downbeats?: number[]
  /** Energía alrededor de un golpe (para adivinar el 1 sin Beat This!). */
  beatEnergy?: (time: number) => number
  /** Cuánto corregir la posición de los golpes del detector (segundos; degara los marca un poco tarde). */
  latency?: number
  /**
   * Los golpes vienen de unos pedazos del tema y no de todo (Beat This!): no se puede armar una grilla compás por compás.
   * Si el tempo no es parejo, null (y quien llama decide si escucha el tema entero).
   */
  sparse?: boolean
  /** Golpes de graves (bombo) alrededor de un momento: si caen en el medio de la grilla, el detector se enganchó en el contratiempo. */
  bassAt?: (time: number) => number
}

/**
 * Si el detector siguió el contratiempo (el hi-hat entre bombo y bombo), la grilla queda medio golpe corrida: se compara
 * cuánto bombo cae en la grilla y cuánto medio golpe después, y se corre si el medio gana claro (30 % más).
 */
function offbeatFix(a: number, b: number, from: number, to: number, bassAt: (time: number) => number): number {
  let on = 0, off = 0
  for (let kk = from; kk <= to; kk++) { on += bassAt(a + kk * b); off += bassAt(a + (kk + 0.5) * b) }
  return off > on * 1.3 ? a + b / 2 : a
}

/**
 * La grilla recta que mejor encaja con los golpes (ya ordenados y sin la latencia): t = a + b·k. Cada golpe con su número
 * en la grilla; los que caen lejos quedan afuera, y se afina con mínimos cuadrados. null si hay pocos golpes.
 */
export function straightLine(beats: number[], allowRound = true): { a: number; b: number; k: number[]; t: number[]; p0: number } | null {
  const p0 = roughPeriod(beats)
  if (!p0) return null
  const best = bestPeriod(beats, p0, allowRound)
  let a = best.phase, b = best.p
  let k: number[] = [], t: number[] = []
  for (let pass = 0; pass < 3; pass++) {
    k = []; t = []
    for (const x of beats) { const kk = Math.round((x - a) / b); if (Math.abs(x - (a + kk * b)) < 0.06 * b) { k.push(kk); t.push(x) } }
    if (k.length < 8) return null
    const f = best.round ? null : fitLine(k, t)
    // con un BPM redondo que encaja, se mantiene el BPM y solo se afina la fase
    if (best.round) a = t.reduce((s, x, i) => s + x - k[i] * b, 0) / t.length // promedio: los golpes de Beat This! vienen en cuadros de 20 ms
    else if (f) { a = f.a; b = f.b }
  }
  // el BPM redondo, solo si no hace correr la grilla: en un tema largo, 0,02 BPM de diferencia ya se notan al final
  if (best.round && drift75(beats, a, b) > DRIFT_MS) {
    const free = straightLine(beats, false)
    if (free && drift75(beats, free.a, free.b) < drift75(beats, a, b)) return free
  }
  return { a, b, k, t, p0 }
}

/** Cuánto se corren los tramos de una grilla recta: el 75 % se corre menos que esto (ms). */
const drift75 = (beats: number[], a: number, b: number) => { const d = steadiness(beats, a, b).drift.sort((x, y) => x - y); return d.length ? d[Math.floor(d.length * 0.75)] : 0 }

/**
 * La grilla de un tema a partir de sus golpes (segundos). Si el tempo es parejo (casi todo lo electrónico), un solo tramo
 * desde el principio del tema; si se mueve más de lo que se nota (los golpes no caen en la recta, o tramos enteros se
 * corren más de DRIFT_MS), un tramo por compás. null si hay pocos golpes o no hay un pulso.
 */
export function fitGrid(beatsIn: ArrayLike<number>, opts: FitOptions = {}): Grid | null {
  const lat = opts.latency ?? 0
  const beats = Array.from(beatsIn).filter((x) => Number.isFinite(x) && x >= 0).map((x) => x - lat).sort((x, y) => x - y)
  const line = straightLine(beats)
  if (!line) return null
  let { a } = line
  const { b, k, t, p0 } = line
  const resid = k.map((kk, i) => Math.abs(t[i] - (a + b * kk)))
  const steady = steadiness(beats, a, b)
  const driftMs = drift75(beats, a, b)
  if (opts.bassAt && !opts.downbeats?.length) {
    const fixed = offbeatFix(a, b, k[0], k[k.length - 1], opts.bassAt)
    a = fixed
  }
  const errorMs = Math.round(median(resid) * 1000 * 10) / 10
  const phase = barPhase(k, a, b, opts.downbeats, opts.beatEnergy)
  const bpm = Math.round((60 / b) * 100) / 100
  // la grilla recta alcanza si los golpes no se apartan (en todo el tema y en cada tramo) y cubren casi todo el tema
  if (errorMs <= 15 && driftMs <= DRIFT_MS && steady.fit >= (opts.sparse ? MIN_FIT_PARTS : MIN_FIT)) {
    const runs = opts.downbeats?.length ? phaseRuns(opts.downbeats, a, b) : []
    // en los pedazos, el 1 cae en otro golpe según el pedazo: hay que escuchar el tema entero para saber dónde cambia
    if (opts.sparse && piecesDisagree(opts.downbeats ?? [], a, b)) return null
    const k0 = Math.ceil(-a / b - 1e-9) // el primer golpe de la grilla que cae dentro del tema
    // Tocado sin click (BPM no redondo) y escuchado entero: donde el 1 se corre de golpe por 8 compases o más (la banda metió
    // un compás de 2: Juguetes perdidos, en vivo), un punto más al mismo BPM que vuelve a empezar en 1, como los puntos extra
    // de Rekordbox. Lo producido con click (BPM redondo, casi todo lo electrónico) no cambia: ahí es Beat This! que duda.
    const human = !opts.sparse && Math.abs(bpm * 2 - Math.round(bpm * 2)) > 0.01
    const from = human && runs.length ? runs[0].ph : phase
    const segments: GridSegment[] = [{ start: round3(a + b * k0), bpm, beat: ((((k0 - from) % 4) + 4) % 4) + 1 }]
    if (human) {
      let cur = from
      for (const r of runs.slice(1)) if (r.ph !== cur) { segments.push({ start: round3(a + b * r.k), bpm, beat: 1 }); cur = r.ph }
    }
    return { bpm, segments, errorMs, variable: false, driftMs }
  }
  if (opts.sparse) return null
  // sin pulso (una entrevista, un tema sin ritmo): los golpes no vienen parejos uno detrás del otro
  let even = 0
  for (let i = 2; i < beats.length; i++) { const x = beats[i - 1] - beats[i - 2], y = beats[i] - beats[i - 1]; if (Math.abs(y - x) < 0.1 * x) even++ }
  if (even < MIN_EVEN * (beats.length - 2)) return null
  const v = variableGrid(beats, p0, phase, bpm, errorMs, a, b, opts.downbeats)
  return v && { ...v, driftMs }
}


/** Los golpes de una grilla entre dos momentos (para dibujarla o comparar dos grillas). */
export function gridBeats(segments: GridSegment[], from: number, to: number): { time: number; beat: number }[] {
  const out: { time: number; beat: number }[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i], end = segments[i + 1]?.start ?? Infinity
    const p = 60 / s.bpm
    for (let n = Math.max(0, Math.ceil((from - s.start) / p - 1e-9)); ; n++) {
      const time = s.start + n * p
      if (time >= end - 1e-6 || time > to) break
      out.push({ time, beat: ((s.beat - 1 + n) % 4) + 1 })
    }
  }
  return out
}

/** El golpe de la grilla más cercano a un momento (para comparar grillas): cuánto se corre y qué número de golpe es. */
export function nearestBeat(segments: GridSegment[], time: number): { offset: number; beat: number } | null {
  if (!segments.length) return null
  let s = segments[0]
  for (const x of segments) if (x.start <= time) s = x
  const p = 60 / s.bpm
  const n = Math.round((time - s.start) / p)
  return { offset: time - (s.start + n * p), beat: ((((s.beat - 1 + n) % 4) + 4) % 4) + 1 }
}

/**
 * Entre qué BPM se mueve un tema con grilla variable (para mostrar algo honesto en vez de un solo número): del 10 % al 90 %
 * de los compases, así un compás suelto (un redoble, un corte) no estira el rango. null si la grilla es recta.
 */
export function tempoRange(segments: GridSegment[]): { lo: number; hi: number } | null {
  if (segments.length < 2) return null
  const xs = segments.map((s) => s.bpm).sort((a, b) => a - b)
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))]
  return { lo: Math.round(at(0.1) * 10) / 10, hi: Math.round(at(0.9) * 10) / 10 }
}

/** Corre toda la grilla (por ejemplo, para el desfase de los MP3 en Rekordbox). */
export const shiftGrid = (segments: GridSegment[], by: number): GridSegment[] => segments.map((s) => ({ ...s, start: round3(s.start + by) }))
