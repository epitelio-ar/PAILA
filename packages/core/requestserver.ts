// Del lado del proceso principal: corre la vista previa de "Traer una lista" en un hilo aparte (core/requestworker.ts),
// para que la ventana siga respondiendo con bibliotecas grandes. El hilo se cierra al terminar.
import { Worker } from 'node:worker_threads'
import type { RequestItem, RequestPreview } from '@paila/shared/types'
import type { ForeignEntry } from './requests'

/** Lo que recibe el hilo: la base, la carpeta de cada raíz (por id) y la lista. */
export interface PreviewJob { file: string; roots: Record<number, string>; text: string; fileName?: string; name?: string; /** Temas ya leídos (core/listimport.ts): solo emparejarlos. */ entries?: ForeignEntry[] }

/** `script`: el hilo ya armado (out/main/request-worker.js). */
export function previewInWorker(script: string, job: PreviewJob): Promise<RequestPreview> {
  return run<{ preview: RequestPreview }>(script, job).then((r) => r.preview)
}

/** Empareja temas ya leídos (Rekordbox, pendrive) con la biblioteca, en el hilo aparte. */
export function matchInWorker(script: string, job: Omit<PreviewJob, 'text'> & { entries: ForeignEntry[] }): Promise<RequestItem[]> {
  return run<{ items: RequestItem[] }>(script, { ...job, text: '' }).then((r) => r.items)
}

function run<T>(script: string, job: PreviewJob): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(script, { workerData: job })
    let done = false
    w.once('message', (m: { ok: boolean; error?: string } & T) => {
      done = true
      if (m.ok) resolve(m); else reject(new Error(m.error))
      void w.terminate()
    })
    w.once('error', (e) => { if (!done) { done = true; reject(e) } })
    w.once('exit', () => { if (!done) { done = true; reject(new Error('La vista previa se cortó: probá de nuevo')) } })
  })
}
