// El 1 del compás en los temas tocados sueltos (core/analysis/grid.ts): la grilla variable compás por compás, con los cambios
// de tempo de golpe y los compases de 3, y dónde se corre el 1 en una grilla recta (masterplan 3, punto 3). Puro.
import { fitLine, median, round3, type Grid, type GridSegment } from './gridbase'

/**
 * Tempo que se mueve (tocado en vivo): un tramo por compás, como la grilla dinámica de Rekordbox. Cada tramo sale de una
 * recta ajustada a los golpes de alrededor (4 antes y 8 después), así el temblor de cada golpe no hace saltar el BPM.
 * El 1 del compás se cuenta con los golpes del tema y los primeros de compás de Beat This! de alrededor (8 compases para
 * cada lado), no con la grilla recta: en un tema que se mueve, la recta se corre más de medio golpe y el 1 saltaba una
 * negra (Jijiji y La nave del olvido, revisados a oído el 22/10).
 */
export function variableGrid(beats: number[], p: number, phase: number, bpm: number, errorMs: number, a: number, b: number, downbeats?: number[]): Grid | null {
  // se cuenta golpe a golpe: cuántos períodos hay entre uno y el siguiente, con el período de los últimos golpes (no el de
  // todo el tema: en La nave del olvido la intro va a 80 BPM y el resto a 95, y con el de todo el tema la cuenta se perdía)
  const k: number[] = [0], t: number[] = [beats[0]]
  let last = beats[0], lastK = 0
  const recent: number[] = []
  const resyncs: number[] = [] // golpes de la cuenta donde se retomó: el ajuste de un compás no mezcla los de antes y los de después
  let here = p, streak = 0
  for (let i = 1; i < beats.length; i++) {
    // el tema cambió de tempo de golpe (La Sed Verdadera pasa de 73 a 100 BPM a los 130 s): si los últimos golpes vienen
    // parejos entre ellos a otro tempo (que no es el doble ni la mitad), la cuenta sigue con ese
    const jump = tempoJump(beats, i, here)
    if (jump) { here = jump; recent.length = 0 }
    const steps = (beats[i] - last) / here
    let r = Math.round(steps)
    if (r < 1 || Math.abs(steps - r) > 0.25) {
      // la banda "patinó" (un golpe llegó tarde y todo lo que sigue quedó corrido: La nave del olvido, a los 117 s): si los
      // golpes que no entran en la cuenta vienen parejos entre ellos, se retoma la cuenta desde acá
      const gap = (beats[i] - beats[i - 1]) / here
      streak = Math.abs(gap - 1) < 0.15 ? streak + 1 : 0
      if (streak < 3) continue
      r = Math.max(1, r)
      resyncs.push(lastK + r)
    }
    streak = 0
    recent.push((beats[i] - last) / r); if (recent.length > 8) recent.shift()
    here = median(recent)
    lastK += r; last = beats[i]; k.push(lastK); t.push(beats[i])
  }
  // los primeros de compás de Beat This!, contados en la misma cuenta de golpes (el golpe más cercano, a menos de un cuarto)
  const dk: number[] = []
  for (const d of downbeats ?? []) {
    let lo = 0, hi = t.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] < d) lo = m; else hi = m }
    const i = Math.abs(t[lo] - d) <= Math.abs(t[hi] - d) ? lo : hi
    if (Math.abs(t[i] - d) < 0.25 * p) dk.push(k[i])
  }
  const vote = (from: number, to: number) => {
    const v = [0, 0, 0, 0]
    for (const x of dk) if (x >= from && x <= to) v[((x % 4) + 4) % 4]++
    const best = v.indexOf(Math.max(...v))
    return v[best] >= 3 ? best : null
  }
  // sin primeros de compás, el de la grilla recta
  const off = Math.round((t[0] - a) / b)
  const first = vote(-Infinity, Infinity) ?? ((((phase - off) % 4) + 4) % 4)
  const segments: GridSegment[] = []
  let j = 0
  /** Un tramo desde el golpe `kk`, con el número de golpe que le toca (null: el de los primeros de compás de alrededor). */
  const push = (kk: number, beat: number | null) => {
    while (j < k.length && k[j] < kk - 4) j++
    const ks: number[] = [], ts: number[] = []
    const lo = Math.max(-Infinity, ...resyncs.filter((x) => x <= kk)), hi = Math.min(Infinity, ...resyncs.filter((x) => x > kk))
    for (let i = j; i < k.length && k[i] <= kk + 8; i++) if (k[i] >= lo && k[i] < hi) { ks.push(k[i]); ts.push(t[i]) }
    if (ks.length < 6) return // un hueco: sigue el tramo de antes
    const f = fitLine(ks, ts)
    // si cerca de acá el 1 cae en otro golpe (la cuenta se corrió en un hueco), ese tramo empieza con su número de golpe
    const here = vote(kk - 32, kk + 36) ?? first
    segments.push({ start: round3(f.a + f.b * kk), bpm: Math.round((60 / f.b) * 100) / 100, beat: beat ?? ((((kk - here) % 4) + 4) % 4) + 1 })
  }
  // Compases de 3 (un vals, un 6/8): donde los primeros de compás de Beat This! vienen cada 3 golpes durante un rato, cada
  // compás es un tramo que empieza en 1 (Rekordbox cuenta de a 4, pero vuelve a 1 en cada tramo). "Quiero llegar" (Santaolalla,
  // en vivo) arranca con 95 compases de 3 y sigue en 4: contado de a 4, el 1 caía en cualquier golpe.
  const threes = runsOfThree([...new Set(dk)].sort((x, y) => x - y))
  let kk = first
  for (const r of threes) if (kk >= r.from && kk < r.to) kk = r.from + 3 * Math.floor((kk - r.from) / 3) // arranca adentro de uno
  while (kk + 3 <= lastK) {
    const run = threes.find((r) => kk < r.to && kk + 4 > r.from)
    if (!run) { if (kk + 4 > lastK) break; push(kk, null); kk += 4; continue }
    if (kk < run.from) { push(kk, null); kk = run.from; continue } // el compás que queda corto justo antes de pasar a 3
    push(kk, 1)
    kk += 3
  }
  if (segments.length < 2) return null
  return { bpm, segments, errorMs, variable: true }
}

/**
 * Si los 8 golpes que terminan en `i` vienen parejos entre ellos (7 de 8 a ±12 % de la mediana: en vivo, cuando el tema
 * cambia de parte, la banda tarda en asentarse) a un tempo que se aparta más de 15 % del de la cuenta
 * (`here`, segundos por golpe), el período nuevo; si no, null. El doble y la mitad no cuentan: son Beat This! marcando las
 * corcheas o salteando un golpe, no un cambio de tempo.
 */
export function tempoJump(beats: number[], i: number, here: number): number | null {
  if (i < 8) return null
  const gaps: number[] = []
  for (let n = i - 7; n <= i; n++) gaps.push(beats[n] - beats[n - 1])
  const med = median(gaps)
  if (gaps.filter((g) => Math.abs(g - med) > 0.12 * med).length > 1) return null
  const ratio = med / here
  if (Math.abs(ratio - 1) <= 0.15 || Math.abs(ratio - 0.5) < 0.05 || Math.abs(ratio - 2) < 0.2) return null
  return med
}

/** Desde cuántos compases seguidos con el 1 en el mismo golpe se da por bueno que el 1 se corrió (en una grilla recta). */
export const MIN_PHASE_RUN = 8

/** En qué golpe de la grilla recta (0–3) cae cada primero de compás de Beat This!, en orden (`k`: su golpe en la grilla). */
function downbeatPhases(downbeats: number[], a: number, b: number): { k: number; ph: number }[] {
  const out: { k: number; ph: number }[] = []
  for (const d of [...downbeats].sort((x, y) => x - y)) {
    const kk = Math.round((d - a) / b)
    if (Math.abs(d - (a + kk * b)) < 0.25 * b) out.push({ k: kk, ph: ((kk % 4) + 4) % 4 })
  }
  return out
}

/** Tramos de al menos MIN_PHASE_RUN primeros de compás seguidos con el 1 en el mismo golpe de la grilla recta. */
export function phaseRuns(downbeats: number[], a: number, b: number): { k: number; ph: number }[] {
  const ps = downbeatPhases(downbeats, a, b)
  const runs: { k: number; ph: number }[] = []
  for (let i = 0; i < ps.length; ) {
    let j = i
    while (j + 1 < ps.length && ps[j + 1].ph === ps[i].ph) j++
    if (j - i + 1 >= MIN_PHASE_RUN) runs.push(ps[i])
    i = j + 1
  }
  return runs
}

/**
 * Los pedazos que escuchó Beat This! (separados por más de 5 s sin primeros de compás) no están de acuerdo en dónde cae el 1:
 * en al menos dos, 6 o más primeros de compás y el 60 % en el mismo golpe, pero no en el mismo.
 */
export function piecesDisagree(downbeats: number[], a: number, b: number): boolean {
  const ps = downbeatPhases(downbeats, a, b)
  const sure = new Set<number>()
  for (let i = 0; i < ps.length; ) {
    let j = i
    while (j + 1 < ps.length && (ps[j + 1].k - ps[j].k) * b < 5) j++
    const v = [0, 0, 0, 0]
    for (let n = i; n <= j; n++) v[ps[n].ph]++
    const best = v.indexOf(Math.max(...v))
    if (j - i + 1 >= 6 && v[best] >= 0.6 * (j - i + 1)) sure.add(best)
    i = j + 1
  }
  return sure.size > 1
}

/** Desde cuántos compases seguidos de 3 se cuenta de a 3: menos que eso son tropiezos de Beat This! en un tema de 4. */
export const MIN_THREES = 8

/**
 * Tramos donde los primeros de compás (en golpes de la cuenta, ordenados) vienen cada 3 golpes, o cada 6 (uno que Beat This!
 * no marcó), al menos MIN_THREES compases seguidos. `from` y `to`: el primero y el último de compás del tramo.
 */
export function runsOfThree(dk: number[]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = []
  let i = 0
  while (i < dk.length - 1) {
    let j = i
    while (j + 1 < dk.length && (dk[j + 1] - dk[j] === 3 || dk[j + 1] - dk[j] === 6)) j++
    if ((dk[j] - dk[i]) / 3 >= MIN_THREES) runs.push({ from: dk[i], to: dk[j] })
    i = Math.max(j, i + 1)
  }
  return runs
}
