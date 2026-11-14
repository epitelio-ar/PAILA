// Hilo aparte para descomprimir con libarchive (archive/libarchive.ts): recibe un pedido, lo hace y contesta. Quien lo
// abrió lo cierra al terminar, así la memoria que usó libarchive vuelve enseguida.
import { parentPort } from 'node:worker_threads'
import { libExtract, type LibJob } from './libarchive'
import { esIdioma, ponerIdioma } from '@paila/shared/idioma'

parentPort?.on('message', async (job: LibJob & { idioma?: unknown }) => {
  if (esIdioma(job.idioma)) ponerIdioma(job.idioma) // los errores que contesta salen en el idioma de la app
  // lo que viaja entre hilos llega como Uint8Array: libarchive.ts espera Buffer
  const pieces = job.pieces.map((p) => (p instanceof Uint8Array ? Buffer.from(p.buffer, p.byteOffset, p.byteLength) : p))
  try { parentPort!.postMessage({ ok: true, result: await libExtract({ ...job, pieces }) }) } catch (e) { parentPort!.postMessage({ ok: false, error: (e as Error).message }) }
})
