// Beat This! (Univ. JKU de Linz, 2024, licencia MIT): cada golpe y el primero de cada compás, con una red neuronal
// (modelo ONNX, se corre afuera con onnxruntime). Acá va lo que hace PAILA alrededor del modelo, sin dependencias: el
// espectrograma que espera (22050 Hz, mel de 128 bandas), los pedazos de 30 s y la lectura de los golpes (BPM y compás).
import { getFft } from './fft'
import { tempoFromBeats } from './beats'

export const BT_RATE = 22050
const N_FFT = 1024
const HOP = 441 // 50 cuadros por segundo
export const BT_FPS = 50
export const BT_CHUNK = 1500 // 30 s por pedazo (lo que espera el modelo)
const BORDER = 6
export const BT_MELS = 128

/** Corre el modelo sobre un pedazo de [BT_CHUNK × BT_MELS] y devuelve los "logits" de golpe y de primer golpe del compás. */
export type BeatModel = (spect: Float32Array) => Promise<{ beat: Float32Array; downbeat: Float32Array }>

/**
 * Espectrograma log-mel exactamente como el original: ventana Hann periódica, centrado con reflejo, magnitud dividida por
 * √1024, proyección sobre el banco de filtros (`fb`, [513 × 128]) y log(1 + 1000·x). `mono` a 22050 Hz (promedio de canales).
 */
export function melSpectrogram(mono: Float32Array, fb: Float32Array): Float32Array {
  const pad = N_FFT / 2
  const at = (i: number) => {
    // reflejo en los bordes (center=True, pad_mode='reflect')
    if (i < 0) i = -i
    if (i >= mono.length) i = 2 * (mono.length - 1) - i
    return mono[Math.max(0, Math.min(mono.length - 1, i))] ?? 0
  }
  const frames = 1 + Math.floor(mono.length / HOP)
  const out = new Float32Array(frames * BT_MELS)
  const fft = getFft(N_FFT)
  const win = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT) // periódica
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), mag = new Float64Array(N_FFT / 2 + 1)
  const norm = 1 / Math.sqrt(N_FFT)
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - pad
    for (let i = 0; i < N_FFT; i++) { re[i] = at(start + i) * win[i]; im[i] = 0 }
    fft.run(re, im)
    for (let k = 0; k <= N_FFT / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm
    for (let m = 0; m < BT_MELS; m++) {
      let s = 0
      for (let k = 0; k <= N_FFT / 2; k++) s += mag[k] * fb[k * BT_MELS + m]
      out[f * BT_MELS + m] = Math.log1p(1000 * s)
    }
  }
  return out
}

/**
 * Corre el modelo por pedazos de 30 s que se pisan un poco (como `split_piece` + `aggregate_prediction` con "keep_first"
 * del original) y devuelve los logits de todo el tema, cuadro por cuadro.
 */
export async function predict(spect: Float32Array, model: BeatModel): Promise<{ beat: Float32Array; downbeat: Float32Array }> {
  const T = spect.length / BT_MELS
  const step = BT_CHUNK - 2 * BORDER
  const starts: number[] = []
  for (let s = -BORDER; s < T - BORDER; s += step) starts.push(s)
  if (T > step && starts.length) starts[starts.length - 1] = T - (BT_CHUNK - BORDER)
  const beat = new Float32Array(T).fill(-1000), down = new Float32Array(T).fill(-1000)
  // del último al primero: el primero que cubre un cuadro es el que queda ("keep_first")
  for (let c = starts.length - 1; c >= 0; c--) {
    const s = starts[c]
    const chunk = new Float32Array(BT_CHUNK * BT_MELS) // ceros afuera del tema
    for (let t = Math.max(0, s); t < Math.min(T, s + BT_CHUNK); t++) chunk.set(spect.subarray(t * BT_MELS, (t + 1) * BT_MELS), (t - s) * BT_MELS)
    const r = await model(chunk)
    for (let i = BORDER; i < BT_CHUNK - BORDER; i++) {
      const t = s + i
      if (t < 0 || t >= T) continue
      beat[t] = r.beat[i]; down[t] = r.downbeat[i]
    }
  }
  return { beat, downbeat: down }
}

/** Picos: máximos locales en ±3 cuadros (70 ms) con logit > 0; los pegados se juntan. Devuelve segundos. */
export function peaks(logits: Float32Array): number[] {
  const idx: number[] = []
  for (let t = 0; t < logits.length; t++) {
    if (logits[t] <= 0) continue
    let max = true
    for (let d = -3; d <= 3 && max; d++) if (d && t + d >= 0 && t + d < logits.length && logits[t + d] > logits[t]) max = false
    if (max) idx.push(t)
  }
  // dos picos a 1 cuadro de distancia (empate) cuentan como uno, en el medio
  const out: number[] = []
  for (let i = 0; i < idx.length; i++) {
    if (i + 1 < idx.length && idx[i + 1] - idx[i] <= 1) { out.push((idx[i] + idx[i + 1]) / 2 / BT_FPS); i++ } else out.push(idx[i] / BT_FPS)
  }
  return out
}

export interface BeatResult { beats: number[]; downbeats: number[]; bpm: number | null; beatsPerBar: number | null }

/**
 * Golpes, primeros de compás y BPM. El BPM sale de la mediana de los intervalos entre golpes (lo que cuenta un DJ); el
 * compás, de cuántos golpes hay entre primeros de compás (casi siempre 4).
 */
export function readBeats(beatLogits: Float32Array, downLogits: Float32Array): BeatResult {
  const beats = peaks(beatLogits)
  // cada primero de compás se pega al golpe más cercano
  const downbeats = [...new Set(peaks(downLogits).map((d) => beats.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), beats[0] ?? d)))]
  const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1] }
  const bpm = tempoFromBeats(beats) // los golpes caen en cuadros de 20 ms: se afina con todos (core/analysis/beats.ts)
  const perBar = median(downbeats.slice(1).map((d, i) => beats.filter((b) => b >= downbeats[i] && b < d).length).filter((n) => n >= 2 && n <= 7))
  return { beats, downbeats, bpm, beatsPerBar: perBar }
}

/**
 * Dónde escucha Beat This! para la grilla (para que no tarde una eternidad no escucha el tema entero): `n` pedazos de
 * 29,5 s (lo que entra en una sola pasada del modelo), el primero al principio y los otros repartidos hasta el 80 %.
 * Alcanzan para la grilla de un tema de tempo parejo. Temas cortos: los pedazos que entren.
 */
export function beatThisWindows(duration: number, n = 2): [number, number][] {
  const len = 29.5
  if (duration <= len) return [[0, duration]]
  if (duration <= n * len) {
    const out: [number, number][] = []
    for (let s = 0; s < duration - 5; s += len) out.push([s, Math.min(len, duration - s)])
    return out
  }
  const out: [number, number][] = [[0, len]]
  for (let i = 1; i < n; i++) out.push([Math.round(Math.max(len, (duration * 0.8 - len) * (i / (n - 1))) * 10) / 10, len])
  return out
}
