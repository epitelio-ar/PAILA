// Separar voz, el trabajo pesado (corre en su propio proceso, stems/worker.ts): leer el tema con ffmpeg (estéreo, 44,1 kHz),
// pasarlo por el modelo (onnxruntime-node de la carpeta bajada, en el procesador) y escribir lo que sale en FLAC de 24 bits:
// la acapella y el instrumental (modo 'voz', MDX-Net) o voz, batería, bajo e instrumental (modo 'cuatro', HT-Demucs, stems/demucs.ts).
// No toca la Música: escribe donde le digan (la carpeta de trabajo de stems/separar.ts).
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { INST_HQ3, STEMS_RATE, mdxSeparate, type MdxModel, type Stereo } from '../analysis/stems'
import { lowPriority } from '../lowpriority'
import { CUATRO_MODEL, MAX_MODELS, STEMS_MODEL } from './modelo'
import { DEMUCS_N, demucsBagSeparate, demucsSeparate, type DemucsBag, type DemucsModel } from './demucs'
import { textos } from '@paila/shared/idioma'

const T = textos({
  noSeLee: { es: (e: string) => `No se pudo leer el tema: ${e}`, en: (e: string) => `Couldn't read the track: ${e}` },
  noSeEscribe: { es: (e: string) => `No se pudo escribir el archivo: ${e}`, en: (e: string) => `Couldn't write the file: ${e}` },
  corto: { es: 'El tema es demasiado corto para separarlo', en: 'The track is too short to separate' },
})

/** Cómo se separa: en voz e instrumental, o en 4 (voz, batería, bajo y resto). */
export type StemsModo = 'voz' | 'cuatro' | 'max'
export type StemsSalida = 'acapella' | 'instrumental' | 'bateria' | 'bajo' | 'resto'
/** Lo que sale de cada modo (las partes de stems/separar.ts). */
export const PARTES_DE: Record<StemsModo, readonly StemsSalida[]> = {
  voz: ['acapella', 'instrumental'],
  cuatro: ['acapella', 'bateria', 'bajo', 'resto'],
  max: ['acapella', 'bateria', 'bajo', 'resto'],
}

export interface StemsJob {
  /** El tema (ruta completa). */
  file: string
  modo: StemsModo
  /** A dónde va cada parte (rutas completas, .flac): las de PARTES_DE[modo]. */
  salidas: Partial<Record<StemsSalida, string>>
  /** La carpeta bajada (stems/modelo.ts). */
  dir: string
  ffmpeg: string
  threads: number
}

type Ort = {
  Tensor: new (t: string, d: Float32Array, s: number[]) => unknown
  InferenceSession: { create(p: string, o: unknown): Promise<{ inputNames: string[]; outputNames: string[]; run(f: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>; release(): Promise<void> }> }
}

const sesion = (dir: string, file: string, threads: number) => {
  const ort = createRequire(path.join(dir, 'npm', 'package.json'))('onnxruntime-node') as Ort
  return { ort, s: ort.InferenceSession.create(path.join(dir, file), { executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all', logSeverityLevel: 3 }) }
}

/** Carga el modelo de la carpeta bajada (una vez por proceso y por cantidad de hilos). */
export async function loadStemsModel(dir: string, threads: number): Promise<MdxModel> {
  const { ort, s: p } = sesion(dir, STEMS_MODEL, threads), s = await p
  return async (spec, dims) => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', spec, dims) }))[s.outputNames[0]].data
}

/** Lo mismo para separar en 4 (HT-Demucs). */
export async function loadCuatroModel(dir: string, threads: number, file = CUATRO_MODEL): Promise<DemucsModel & { soltar(): Promise<void> }> {
  const { ort, s: p } = sesion(dir, file, threads), s = await p
  const run = async (mix: Float32Array) => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', mix, [1, 2, DEMUCS_N]) }))[s.outputNames[0]].data
  return Object.assign(run, { soltar: () => s.release() })
}

/** Máxima calidad: los cuatro especialistas, que se cargan de a uno cuando hacen falta. */
export const loadMaxBag = (dir: string, threads: number): DemucsBag => ({
  cargar: async (i) => { const m = await loadCuatroModel(dir, threads, MAX_MODELS[i]); return { run: m, soltar: m.soltar } },
})

/** El tema entero en estéreo a 44,1 kHz (un tema mono sale igual en los dos canales). */
export function decodeStereo(ffmpeg: string, file: string): Promise<Stereo> {
  return new Promise((ok, mal) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-ar', String(STEMS_RATE), '-'], { windowsHide: true })
    lowPriority(p.pid)
    const partes: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => partes.push(d))
    p.stderr.on('data', (d: Buffer) => { err += d })
    p.on('error', (e) => mal(new Error(T.noSeLee(e.message))))
    p.on('close', (c) => {
      if (c) return mal(new Error(T.noSeLee(err.trim().split('\n').pop() || String(c))))
      const b = Buffer.concat(partes), n = Math.floor(b.length / 8)
      const f = new Float32Array(b.buffer, b.byteOffset, n * 2)
      const L = new Float32Array(n), R = new Float32Array(n)
      for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1] }
      ok([L, R])
    })
  })
}

/** Escribe [L, R] en FLAC de 24 bits (ffmpeg lee las muestras por la entrada). */
export function writeFlac(ffmpeg: string, [L, R]: Stereo, out: string): Promise<void> {
  return new Promise((ok, mal) => {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', String(STEMS_RATE), '-i', '-', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', out], { windowsHide: true })
    lowPriority(p.pid)
    let err = ''
    p.stderr.on('data', (d: Buffer) => { err += d })
    p.on('error', (e) => mal(new Error(T.noSeEscribe(e.message))))
    p.on('close', (c) => (c ? mal(new Error(T.noSeEscribe(err.trim().split('\n').pop() || String(c)))) : ok()))
    p.stdin.on('error', () => { /* lo dice el 'close' */ })
    // de a pedazos de ~1 MB, sin armar el tema entero intercalado en memoria
    const step = 131072
    let i = 0
    const next = () => {
      while (i < L.length) {
        const n = Math.min(step, L.length - i), f = new Float32Array(n * 2)
        for (let k = 0; k < n; k++) { f[2 * k] = L[i + k]; f[2 * k + 1] = R[i + k] }
        i += n
        if (!p.stdin.write(Buffer.from(f.buffer))) { p.stdin.once('drain', next); return }
      }
      p.stdin.end()
    }
    next()
  })
}

/** Separa un tema: lee, corre el modelo de su modo y escribe un archivo por parte. Devuelve cuánto duraba (s). */
export async function separarArchivo(job: StemsJob, model: MdxModel | DemucsModel | DemucsBag, on: { onChunk?: (done: number, total: number) => void; cancelled?: () => boolean } = {}): Promise<{ seconds: number }> {
  const [L, R] = await decodeStereo(job.ffmpeg, job.file)
  if (L.length < STEMS_RATE) throw new Error(T.corto)
  const sale: Partial<Record<StemsSalida, Stereo>> = {}
  if (job.modo !== 'voz') {
    const r = job.modo === 'max' ? await demucsBagSeparate(model as DemucsBag, L, R, on) : await demucsSeparate(model as DemucsModel, L, R, on)
    Object.assign(sale, { acapella: r.voz, bateria: r.bateria, bajo: r.bajo, resto: r.resto })
  } else {
    const r = await mdxSeparate(INST_HQ3, model as MdxModel, L, R, on)
    Object.assign(sale, { acapella: r.vocals, instrumental: r.instrumental })
  }
  for (const p of PARTES_DE[job.modo]) await writeFlac(job.ffmpeg, sale[p]!, job.salidas[p]!)
  return { seconds: L.length / STEMS_RATE }
}
