// Grilla y frases de un tema entero (Fase F): decodifica todo el tema, saca los golpes (degara de Essentia, o Beat This! si
// está la carpeta de modelos) y arma la grilla (core/analysis/grid.ts), la energía por compás y los cue points sugeridos
// (core/analysis/cues.ts). Corre en un worker: es pesado.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { getFft } from './fft'
import { T } from './errores.textos'
import { free } from './dj'
import { fitGrid, type Grid } from './grid'
import { suggestCues, type CueSuggestion } from './cues'
import { createRequire } from 'node:module'
import { BT_RATE, beatThisWindows, melSpectrogram, predict, readBeats, type BeatModel } from './beatthis'

const require = createRequire(import.meta.url)
const SR = 44100

/** Todo el tema en mono, como float de 32 bits, con ffmpeg de un hilo y prioridad baja (lo mismo que el análisis). */
export function decodeMono(ffmpeg: string, file: string, rate = SR, from?: number, seconds?: number, mean = false): Promise<Float32Array> {
  // `mean`: promedio exacto de los dos canales (lo que espera Beat This!)
  const mix = mean ? ['-af', 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1'] : ['-ac', '1']
  const args = ['-threads', '1', '-v', 'error', '-nostdin', ...(from != null ? ['-ss', String(from)] : []), ...(seconds != null ? ['-t', String(seconds)] : []),
    '-i', file, '-map', '0:a:0', '-vn', ...mix, '-ar', String(rate), '-f', 'f32le', 'pipe:1']
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.stderr.on('data', (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000) })
    p.on('error', reject)
    p.on('close', () => {
      // una sola copia: los pedazos van derecho al resultado (un mix de 77 minutos son 400 MB; antes se copiaba tres veces)
      const bytes = chunks.reduce((s, c) => s + c.length, 0)
      if (bytes < rate * 4 * 5) return reject(new Error(err.trim().split('\n').pop() || T.noSeLeyo))
      const out = new Float32Array(Math.floor(bytes / 4))
      const view = new Uint8Array(out.buffer)
      let at = 0
      for (const c of chunks) { const n = Math.min(c.length, view.length - at); view.set(c.subarray(0, n), at); at += n }
      chunks.length = 0
      resolve(out)
    })
  })
}

interface EssentiaBeats {
  arrayToVector(a: Float32Array): unknown
  vectorToArray(v: unknown): Float32Array
  RhythmExtractor2013(v: unknown, maxTempo: number, method: string, minTempo: number): { bpm: number; ticks: unknown }
}
let ess: EssentiaBeats | null = null
const essentia = (): EssentiaBeats => {
  if (!ess) { const lib = require('essentia.js'); ess = new lib.Essentia(lib.EssentiaWASM) as EssentiaBeats }
  return ess
}

/**
 * degara marca cada golpe un poco después de donde lo pone Rekordbox (el ataque): medido contra la grilla de Rekordbox de
 * real en temas sin pérdida (docs/archivo/pruebas/2026-10-21-rekordbox-pro.md).
 */
export const DEGARA_LATENCY = 0.005

/** Los golpes de todo el tema con degara (el mismo método que el BPM de todos los días). */
export function degaraBeats(mono: Float32Array): number[] {
  const e = essentia()
  const v = e.arrayToVector(mono)
  try {
    const r = e.RhythmExtractor2013(v, 208, 'degara', 40)
    const ticks = Array.from(e.vectorToArray(r.ticks))
    free(r)
    return ticks
  } finally { free(v) }
}

/**
 * Cuánto bombo entra en cada momento (flujo espectral hasta ~150 Hz, 100 cuadros por segundo) y la energía de cada cuadro.
 * Con el bombo se ve si la grilla quedó en el contratiempo; con la energía, el 1 del compás, la curva por compás y los cues.
 */
export function envelopes(mono: Float32Array, sr = SR): { bass: Float32Array; energy: Float32Array; fps: number } {
  const n = sr >= 44100 ? 2048 : 1024, hop = Math.round(sr / 100) // ~21,5 Hz por banda a 44,1 y a 22,05 kHz
  const frames = Math.max(0, Math.floor((mono.length - n) / hop) + 1)
  const fft = getFft(n)
  const bass = new Float32Array(frames), energy = new Float32Array(frames)
  const re = new Float64Array(n), im = new Float64Array(n)
  const bins = 8
  let prev = new Float64Array(bins), cur = new Float64Array(bins)
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = 0; i < n; i++) { const x = mono[f * hop + i]; re[i] = x * fft.win[i]; im[i] = 0; e += x * x }
    fft.run(re, im)
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const d = cur[k] - prev[k]
      if (d > 0) bass[f] += d
    }
    energy[f] = e / n
    const t = prev; prev = cur; cur = t
  }
  return { bass, energy, fps: sr / hop }
}

export interface GridAnalysis {
  grid: Grid | null
  /** Energía de cada compás (0–1, relativa al compás más fuerte del tema): la curva de energía y los cues. */
  barEnergy: number[]
  cues: CueSuggestion[]
  method: 'degara' | 'beatthis'
  /** Cuánto tardó (ms). */
  ms: number
  /** En qué se fue el tiempo (ms): leer el audio, el modelo (Beat This!) y el resto. */
  stages?: { decode: number; model: number; rest: number }
  /** Cuántos pedazos de 29,5 s escuchó Beat This! (3, o el tema entero si el tempo no es parejo o el 1 se corre). */
  windows?: number
}

export interface GridJob { ffmpeg: string; file: string }

/**
 * Lo que hace la grilla con los golpes ya detectados: ajusta la grilla (con los primeros de compás si los hay, si no con
 * los acentos), mide la energía de cada compás y sugiere los cues. Separado para usarlo con degara y con Beat This!.
 */
export function gridFromBeats(beats: number[], env: ReturnType<typeof envelopes>, duration: number, downbeats?: number[], latency = 0, sparse = false): { grid: Grid | null; barEnergy: number[]; cues: CueSuggestion[] } {
  const { energy, bass, fps } = env
  // bombo en ±20 ms de un momento
  const bassAt = (t: number) => {
    const c = Math.round(t * fps)
    let m = 0
    for (let i = Math.max(0, c - 2); i <= Math.min(bass.length - 1, c + 2); i++) m = Math.max(m, bass[i])
    return m
  }
  // energía de los 0,4 s que siguen a un golpe
  const beatEnergy = (t: number) => {
    const a = Math.max(0, Math.round(t * fps)), b = Math.min(energy.length, a + Math.round(0.4 * fps))
    let s = 0
    for (let i = a; i < b; i++) s += energy[i]
    return Math.sqrt(s / Math.max(1, b - a))
  }
  const grid = fitGrid(beats, { downbeats, beatEnergy, latency, bassAt, sparse })
  if (!grid) return { grid: null, barEnergy: [], cues: [] }
  // energía de cada compás según la grilla
  const s0 = grid.segments[0]
  const barLen = 240 / grid.bpm
  const firstBar = s0.start + ((5 - s0.beat) % 4) * (60 / s0.bpm)
  const bars: number[] = []
  for (let t = firstBar; t + barLen <= duration + 0.01 && bars.length < 2000; t += barLen) {
    const a = Math.floor(t * fps), b = Math.min(energy.length, Math.floor((t + barLen) * fps))
    let s = 0
    for (let i = a; i < b; i++) s += energy[i]
    bars.push(b > a ? Math.sqrt(s / (b - a)) : 0)
  }
  const top = Math.max(1e-9, ...bars)
  const barEnergy = bars.map((x) => Math.round((x / top) * 1000) / 1000)
  return { grid, barEnergy, cues: suggestCues(barEnergy, firstBar, barLen) }
}

/** Beat This! marca los golpes un poco después que Rekordbox (medido igual que degara). */
export const BEATTHIS_LATENCY = 0.004

/** Lo que oye Beat This! en unos pedazos del tema (`[desde, cuánto]`, en segundos). */
export type Listen = (ws: [number, number][]) => Promise<{ beats: number[]; downbeats: number[] }>

/** El tema entero, en pedazos de 29,5 s. */
export function wholeWindows(dur: number): [number, number][] {
  const all: [number, number][] = []
  for (let s = 0; s < dur - 1; s += 29.5) all.push([s, Math.min(29.5, dur - s)])
  return all
}

/**
 * Qué grilla lleva un tema con Beat This!: primero se escuchan unos pedazos (`ws`); si ahí el tempo es parejo, grilla
 * recta. Si no y se puede escuchar el tema entero (`whole`: con la placa de video), se escucha todo y la grilla va
 * compás por compás donde el tempo se mueve; con el procesador tardaría minutos, así que queda sin grilla.
 */
export async function beatThisGrid(dur: number, env: ReturnType<typeof envelopes>, ws: [number, number][], listen: Listen, whole: boolean) {
  const got = await listen(ws)
  const r = gridFromBeats(got.beats, env, dur, got.downbeats, BEATTHIS_LATENCY, true)
  if (r.grid || !whole) return r
  const all = wholeWindows(dur)
  if (all.length <= ws.length) return r
  const every = await listen(all)
  return gridFromBeats(every.beats, env, dur, every.downbeats, BEATTHIS_LATENCY)
}

/**
 * Grilla de un tema con Beat This! (`model`): el tema entero a 22050 Hz una sola vez; el modelo escucha `windows` pedazos
 * de 29,5 s (2 con el procesador, 3 con la placa de video: core/analysis/beatrun.ts).
 */
export async function analyzeGridBeatThis(job: GridJob, model: BeatModel, fb: Float32Array, windows: number): Promise<GridAnalysis> {
  const t0 = Date.now()
  const y = await decodeMono(job.ffmpeg, job.file, BT_RATE, undefined, undefined, true)
  const decode = Date.now() - t0
  let modelMs = 0, heard = 0
  const dur = y.length / BT_RATE
  const listen = async (ws: [number, number][]) => {
    heard += ws.length
    const beats: number[] = [], downbeats: number[] = []
    for (const [from, len] of ws) {
      const part = y.subarray(Math.floor(from * BT_RATE), Math.floor((from + len) * BT_RATE))
      const spect = melSpectrogram(part, fb)
      const tm = Date.now()
      const r = await predict(spect, model)
      modelMs += Date.now() - tm
      const got = readBeats(r.beat, r.downbeat)
      beats.push(...got.beats.map((t) => t + from)); downbeats.push(...got.downbeats.map((t) => t + from))
    }
    return { beats, downbeats }
  }
  const env = envelopes(y, BT_RATE)
  const ws = beatThisWindows(dur, windows)
  const r = await beatThisGrid(dur, env, ws, listen, windows >= 3)
  const pieces = heard
  // para desarrollo: PAILA_GRID_BEATS=<carpeta> guarda los golpes de los pedazos y los del tema entero (scripts/grilla-vivo.ts --golpes)
  const dump = process.env.PAILA_GRID_BEATS
  if (dump) {
    const sparse = await listen(ws)
    const whole = await listen(wholeWindows(dur))
    const name = job.file.replace(/[\\/:*?"<>|]/g, '_').slice(-120)
    fs.mkdirSync(dump, { recursive: true })
    fs.writeFileSync(`${dump}/${name}.json`, JSON.stringify({ file: job.file, dur, windows: ws, sparse, whole }))
  }
  const ms = Date.now() - t0
  return { ...r, method: 'beatthis', ms, stages: { decode, model: modelMs, rest: ms - decode - modelMs }, windows: pieces }
}

/** Grilla con degara: el tema entero, unos segundos por tema. */
export async function analyzeGrid(job: GridJob): Promise<GridAnalysis> {
  const t0 = Date.now()
  const mono = await decodeMono(job.ffmpeg, job.file)
  const beats = degaraBeats(mono)
  const env = envelopes(mono)
  const r = gridFromBeats(beats, env, mono.length / SR, undefined, DEGARA_LATENCY)
  return { ...r, method: 'degara', ms: Date.now() - t0 }
}
