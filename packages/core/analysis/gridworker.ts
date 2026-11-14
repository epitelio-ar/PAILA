// Proceso de la grilla (Fase F): lee el audio, calcula la grilla y las frases de un tema por vez, sin trabar el proceso
// principal. Con Beat This! en el procesador carga el modelo acá; con la placa de video le pasa cada pedazo al proceso
// principal (que lo corre en una ventana oculta, apps/paila/electron/beatgpu.ts) y espera la respuesta. En la app es un
// proceso de Electron aparte (apps/paila/electron/gridengine.ts): un mix de 77 minutos llena más de 1 GB de audio, y como
// hilo del proceso principal lo dejaba sin responder (y a las escrituras que estaban en curso; punto 1 real del 24/10).
// En los scripts corre como hilo.
import fs from 'node:fs'
import path from 'node:path'
import { parentPort } from 'node:worker_threads'
import { analyzeGrid, analyzeGridBeatThis, type GridAnalysis } from './gridscan'
import { loadBeatThis, type BeatThis } from './beatrun'
import type { BeatModel } from './beatthis'
import { esIdioma, ponerIdioma, textos } from '@paila/shared/idioma'

// los errores salen en el idioma de PAILA (el proceso principal lo deja en el entorno al abrir: apps/paila/electron/main.ts)
const elegido = process.env.PAILA_IDIOMA_PROCESO
if (esIdioma(elegido)) ponerIdioma(elegido)
const T = textos({ sinRespuesta: { es: 'La placa de video no respondió', en: "The graphics card didn't respond" } })

export type GridEngineKind = 'degara' | 'cpu' | 'gpu'
export type GridWorkerIn =
  | { type: 'job'; id: number; ffmpeg: string; file: string; engine: GridEngineKind; modelsDir: string | null; windows: number }
  | { type: 'logits'; req: number; beat?: Float32Array; downbeat?: Float32Array; error?: string }
export type GridWorkerOut =
  | { type: 'model'; id: number; req: number; spect: Float32Array }
  /** Escuchó un pedazo con el procesador: sigue vivo (la app saltea un tema que pasa mucho sin avanzar). */
  | { type: 'alive'; id: number }
  | { type: 'done'; id: number; result?: GridAnalysis; error?: string }

// Proceso de Electron (utilityProcess, la app): los mensajes llegan envueltos en `data` y se copian. Como hilo, directo.
const electronPort = (process as unknown as { parentPort?: { on(ev: 'message', cb: (e: { data: GridWorkerIn }) => void): void; postMessage(m: unknown): void } }).parentPort
const send = (m: GridWorkerOut, transfer: ArrayBuffer[] = []) => (parentPort ? parentPort.postMessage(m, transfer) : electronPort?.postMessage(m))
let cpu: Promise<BeatThis> | null = null
let fb: Float32Array | null = null
let nextReq = 1
const waiting = new Map<number, { resolve: (r: { beat: Float32Array; downbeat: Float32Array }) => void; reject: (e: Error) => void }>()

const filterbank = (dir: string) => {
  if (!fb) { const b = fs.readFileSync(path.join(dir, 'beat-this', 'mel-filterbank.bin')); fb = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) }
  return fb
}

async function run(m: Extract<GridWorkerIn, { type: 'job' }>): Promise<GridAnalysis> {
  if (m.engine === 'degara' || !m.modelsDir) return analyzeGrid({ ffmpeg: m.ffmpeg, file: m.file })
  if (m.engine === 'cpu') {
    cpu ??= loadBeatThis(m.modelsDir)
    const bt = await cpu
    const model: BeatModel = async (spect) => { const r = await bt.model(spect); send({ type: 'alive', id: m.id }); return r }
    return analyzeGridBeatThis({ ffmpeg: m.ffmpeg, file: m.file }, model, bt.fb, m.windows)
  }
  const model: BeatModel = (spect) => new Promise((resolve, reject) => {
    const req = nextReq++
    waiting.set(req, { resolve, reject })
    send({ type: 'model', id: m.id, req, spect }, [spect.buffer as ArrayBuffer])
  })
  return analyzeGridBeatThis({ ffmpeg: m.ffmpeg, file: m.file }, model, filterbank(m.modelsDir), m.windows)
}

function handle(m: GridWorkerIn) {
  if (m.type === 'logits') {
    const w = waiting.get(m.req)
    waiting.delete(m.req)
    if (!w) return
    if (m.error || !m.beat || !m.downbeat) w.reject(new Error(m.error ?? T.sinRespuesta))
    else w.resolve({ beat: m.beat, downbeat: m.downbeat })
    return
  }
  run(m).then((result) => send({ type: 'done', id: m.id, result }), (e: Error) => send({ type: 'done', id: m.id, error: e.message }))
}

if (parentPort) parentPort.on('message', handle)
else electronPort?.on('message', (e) => handle(e.data))
