// Tono al estilo KeyFinder (Ibrahim Sha'ath, el que usa Mixxx; GPL-3, compatible con la AGPL de PAILA), escrito de nuevo en
// TypeScript a partir de cómo funciona: el tema entero a 4410 Hz, un espectro por semitono en 6 octavas desde La0 (27,5 Hz),
// el promedio de todo el tema y la comparación con los perfiles de tono de Sha'ath. Sin dependencias.
import { getFft } from './fft'

export const KF_RATE = 4410 // el tema se lee a esta frecuencia (ffmpeg hace el filtro y la bajada)
const FRAME = 16384
const HOP = 4096
const OCTAVES = 6
const BANDS = OCTAVES * 12
const LOW_HZ = 27.5
const STRETCH = 0.8 // ancho de cada banda, en semitonos (KeyFinder: directSkStretch)

// Perfiles de tono de Sha'ath (los mismos que el perfil "shaath" de Essentia), empezando en la tónica.
const MAJOR = [7.23900502618145, 3.50351166725158, 3.58445177536649, 2.84511816478676, 5.81898892118567, 4.55865057415321, 2.44778850545506, 6.99473192146406, 3.39106613673758, 4.55614256288104, 4.07415460517836, 4.45540327863547]
const MINOR = [7.00255045060284, 3.14360279052646, 4.35904343960577, 5.40366550868127, 3.67524478380717, 4.08890119310038, 4.01984799101155, 6.65062905018104, 4.62893932717681, 3.13478262645458, 5.84305055993828, 3.08787005061416]
const NAMES = ['A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab'] // empezando en La (la banda 0 es La0)

/** Pesos de cada banda sobre los "bins" de la FFT (una campana de coseno de ±0,8 semitonos alrededor de cada nota). */
let kernel: { bin: number; band: number; w: number }[] | null = null
function getKernel() {
  if (kernel) return kernel
  kernel = []
  const binHz = KF_RATE / FRAME
  for (let b = 0; b < BANDS; b++) {
    const f = LOW_HZ * 2 ** (b / 12)
    const lo = Math.floor((f * 2 ** (-STRETCH / 12)) / binHz), hi = Math.ceil((f * 2 ** (STRETCH / 12)) / binHz)
    let sum = 0
    const row: { bin: number; band: number; w: number }[] = []
    for (let k = Math.max(1, lo); k <= hi && k < FRAME / 2; k++) {
      const d = 12 * Math.log2((k * binHz) / f)
      if (Math.abs(d) >= STRETCH) continue
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / STRETCH)
      row.push({ bin: k, band: b, w }); sum += w
    }
    for (const r of row) kernel.push({ ...r, w: r.w / (sum || 1) }) // cada banda pesa lo mismo, tenga los bins que tenga
  }
  return kernel
}

/** Cromagrama promedio del tema (72 bandas) a partir del audio mono a 4410 Hz. */
export function chromagram(mono: Float32Array): Float64Array {
  const fft = getFft(FRAME)
  const k = getKernel()
  const out = new Float64Array(BANDS)
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME)
  // ventana de Blackman (la de KeyFinder) en vez de la Hann de getFft
  const win = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (FRAME - 1))
  let frames = 0
  for (let off = 0; off + FRAME <= mono.length; off += HOP) {
    for (let i = 0; i < FRAME; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0 }
    fft.run(re, im)
    for (const { bin, band, w } of k) out[band] += w * Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin])
    frames++
  }
  if (frames) for (let b = 0; b < BANDS; b++) out[b] /= frames
  return out
}

export interface KeyGuess { key: string; minor: boolean; score: number }

/** El tono que mejor se parece al cromagrama (similitud de coseno contra los 24 tonos). */
export function keyFromChroma(chroma: Float64Array): KeyGuess | null {
  const pc = new Float64Array(12)
  for (let b = 0; b < BANDS; b++) pc[b % 12] += chroma[b]
  if (!pc.some((x) => x > 0)) return null
  const cos = (profile: number[], tonic: number) => {
    let dot = 0, a = 0, p = 0
    for (let i = 0; i < 12; i++) { const x = pc[(tonic + i) % 12], y = profile[i]; dot += x * y; a += x * x; p += y * y }
    return dot / Math.sqrt(a * p)
  }
  let best: KeyGuess | null = null
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const s = cos(minor ? MINOR : MAJOR, t)
      if (!best || s > best.score) best = { key: NAMES[t] + (minor ? 'm' : ''), minor, score: s }
    }
  }
  return best
}

/** Tono de un tema entero leído a 4410 Hz (mono). */
export function keyFinder(mono: Float32Array): KeyGuess | null {
  if (mono.length < KF_RATE * 10) return null
  return keyFromChroma(chromagram(mono))
}
