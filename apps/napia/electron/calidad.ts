// La revisión de calidad real de NAPIA (la lógica en packages/core/sockseek/calidad.ts y control.ts): el análisis corre en un
// proceso de Electron aparte, con prioridad baja (el worker de análisis de PAILA, armado como out/main/calidad-worker.js), de a
// un tema por vez: usa lo que sobra del procesador y nunca frena la bajada ni la pantalla. Se cierra cuando no queda nada por
// revisar. ffmpeg y ffprobe son los que trae PAILA (en el instalador, los de su carpeta resources; ver core/probe.ts).
import path from 'node:path'
import { utilityProcess } from 'electron'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { WorkerPool, lowPriority, type Spawner, type WorkerMsg } from '@paila/core/analysis/pool'
import { revisarArchivo, type Revision } from '@paila/core/sockseek/calidad'
import type { Calidad } from '@paila/shared/napia'
import { idioma } from '@paila/shared/idioma'

/** El worker como proceso de Electron con prioridad baja (Windows no deja bajarle la prioridad a un hilo). */
const spawner = (script: string): Spawner => () => {
  // el idioma de ahora, para lo que dice la nota ("MP3 inflado…"; core/analysis/worker.ts)
  const p = utilityProcess.fork(script, [], { serviceName: 'NAPIA - calidad', stdio: 'ignore', env: { ...process.env, PAILA_IDIOMA_PROCESO: idioma() } })
  const queue: WorkerMsg[] = []
  let ready = false, exited = false
  p.once('spawn', () => { lowPriority(p.pid); ready = true; for (const m of queue.splice(0)) p.postMessage(m) })
  p.once('exit', () => { exited = true })
  return {
    get pid() { return p.pid },
    post: (m) => { if (ready) p.postMessage(m); else queue.push(m) },
    onMessage: (cb) => p.on('message', cb),
    onExit: (cb) => p.once('exit', () => cb(new Error('El proceso de calidad se cerró'))),
    kill: () => new Promise((r) => { if (exited) return r(); p.once('exit', () => r()); p.kill() }),
  }
}

export interface Revisor {
  /** Revisa un archivo; null si no se puede (no se encontró ffmpeg o ffprobe): entonces todo pasa sin revisar. */
  revisar: ((file: string, calidad: Calidad) => Promise<Revision>) | null
  /** Cierra el proceso de análisis (vuelve a abrirse solo con el próximo tema). */
  cerrar: () => Promise<void>
}

export function revisorDeCalidad(): Revisor {
  const ffmpeg = findFfmpeg(), ffprobe = findFfprobe()
  if (!ffmpeg || !ffprobe) return { revisar: null, cerrar: async () => {} }
  let pool: WorkerPool | null = null
  return {
    revisar: (file, calidad) => {
      pool ??= new WorkerPool(spawner(path.join(__dirname, 'calidad-worker.js')), 1)
      const p = pool
      return revisarArchivo(file, calidad, { ffmpeg, ffprobe, full: (job) => p.full(job) })
    },
    cerrar: async () => { const p = pool; pool = null; await p?.close() },
  }
}
