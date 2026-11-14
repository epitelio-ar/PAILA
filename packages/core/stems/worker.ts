// Proceso de Separar voz: recibe un tema, avisa el avance y contesta cuando terminó (stems/correr.ts). En la app es un proceso
// de Electron aparte con prioridad baja (apps/paila/electron/separar.ts); en los tests, un hilo. El modelo queda cargado
// entre un tema y otro mientras el proceso siga abierto.
import { parentPort } from 'node:worker_threads'
import type { MdxModel } from '../analysis/stems'
import type { DemucsBag, DemucsModel } from './demucs'
import { loadCuatroModel, loadMaxBag, loadStemsModel, separarArchivo, type StemsJob } from './correr'
import { esIdioma, ponerIdioma } from '@paila/shared/idioma'

export type StemsIn = { type: 'separar'; id: number; job: StemsJob } | { type: 'cortar' }
export type StemsOut = { type: 'avance'; id: number; done: number; total: number } | { type: 'listo'; id: number; seconds: number } | { type: 'error'; id: number; error: string }

const elegido = process.env.PAILA_IDIOMA_PROCESO
if (esIdioma(elegido)) ponerIdioma(elegido)

let model: { key: string; run: MdxModel | DemucsModel | DemucsBag } | null = null
let cortar = false

async function handle(m: StemsIn, reply: (r: StemsOut) => void) {
  if (m.type === 'cortar') { cortar = true; return }
  cortar = false
  try {
    // un modelo cargado por vez (el de 4 pesa ~170 MB): al cambiar de modo se carga el otro
    const key = `${m.job.modo}|${m.job.dir}|${m.job.threads}`
    // (en máxima calidad no queda ninguno cargado: los cuatro se cargan y se sueltan de a uno por tema)
    if (model?.key !== key) { model = null; model = { key, run: m.job.modo === 'max' ? loadMaxBag(m.job.dir, m.job.threads) : m.job.modo === 'cuatro' ? await loadCuatroModel(m.job.dir, m.job.threads) : await loadStemsModel(m.job.dir, m.job.threads) } }
    const r = await separarArchivo(m.job, model.run, { onChunk: (done, total) => reply({ type: 'avance', id: m.id, done, total }), cancelled: () => cortar })
    reply({ type: 'listo', id: m.id, seconds: r.seconds })
  } catch (e) {
    reply({ type: 'error', id: m.id, error: (e as Error).message })
  }
}

// Proceso de Electron (utilityProcess): los mensajes llegan envueltos en `data`.
const electronPort = (process as unknown as { parentPort?: { on(ev: 'message', cb: (e: { data: StemsIn }) => void): void; postMessage(m: unknown): void } }).parentPort

if (parentPort) parentPort.on('message', (m: StemsIn) => void handle(m, (r) => parentPort!.postMessage(r)))
else if (electronPort) electronPort.on('message', (e) => void handle(e.data, (r) => electronPort.postMessage(r)))
else process.on('message', (m: StemsIn) => void handle(m, (r) => process.send?.(r)))
