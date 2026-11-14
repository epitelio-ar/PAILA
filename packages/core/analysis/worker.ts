// Worker de análisis: recibe un trabajo, devuelve las mediciones. Corre como hilo (tests), como proceso de Node
// (mediciones) o como proceso de Electron (la app, con prioridad baja): ver core/analysis/pool.ts.
import { parentPort } from 'node:worker_threads'
import { analyzeFile, analyzePrecise, analyzePrints } from './analyze'
import { analyzeSilence } from './silence'
import { analyzeStyle } from './effnetrun'
import type { WorkerMsg } from './pool'
import { esIdioma, ponerIdioma } from '@paila/shared/idioma'

// los errores que se ven (y se guardan con el tema) salen en el idioma de PAILA: lo pasa la app al abrir el proceso
const elegido = process.env.PAILA_IDIOMA_PROCESO
if (esIdioma(elegido)) ponerIdioma(elegido)

// memoria del proceso del worker (como hilo no tiene sentido: sería la del proceso entero)
const mb = () => (parentPort ? undefined : Math.round(process.memoryUsage().rss / 1e6))

async function handle(m: WorkerMsg, reply: (r: unknown) => void) {
  try {
    const result = m.type === 'prints' ? await analyzePrints(m.job) : m.type === 'precise' ? await analyzePrecise(m.job)
      : m.type === 'silence' ? await analyzeSilence(m.job) : m.type === 'style' ? await analyzeStyle(m.job) : await analyzeFile(m.job)
    reply({ ok: true, result, mb: mb() })
  } catch (e) {
    reply({ ok: false, error: (e as Error).message, mb: mb() })
  }
}

// Proceso de Electron (utilityProcess): los mensajes llegan envueltos en `data`.
const electronPort = (process as unknown as { parentPort?: { on(ev: 'message', cb: (e: { data: WorkerMsg }) => void): void; postMessage(m: unknown): void } }).parentPort

if (parentPort) parentPort.on('message', (m: WorkerMsg) => handle(m, (r) => parentPort!.postMessage(r)))
else if (electronPort) electronPort.on('message', (e) => handle(e.data, (r) => electronPort.postMessage(r)))
else process.on('message', (m) => handle(m as WorkerMsg, (r) => process.send?.(r as never)))
