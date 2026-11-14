// Del lado del proceso principal: habla con el hilo de la tabla grande (core/tableworker.ts). El hilo arranca la primera
// vez que la biblioteca pasa de BIG_LIBRARY temas; con bibliotecas chicas no existe.
import { Worker } from 'node:worker_threads'
import type { TableQuery } from '@paila/shared/tableview'
import type { TableLoad } from './tableindex'
import { textos } from '@paila/shared/idioma'

const T = textos({ cerrada: { es: 'La tabla se cerró', en: 'The table closed' } })

type Req = { op: 'load' } | { op: 'query'; q: TableQuery; from: number } | { op: 'rows'; ids: number[] }
export type TableRequest = { seq: number } & Req

export class TableServer {
  private worker: Worker | null = null
  private seq = 0
  private calls = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>()

  /** `script`: el hilo ya armado (out/main/table-worker.js); `dbFile`: la base de PAILA. */
  constructor(private script: string, private dbFile: string) {}

  private start(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(this.script, { workerData: { file: this.dbFile } })
    w.on('message', (m: { seq: number; ok: boolean; result?: unknown; error?: string }) => {
      const c = this.calls.get(m.seq)
      this.calls.delete(m.seq)
      if (c) m.ok ? c.resolve(m.result) : c.reject(new Error(m.error))
    })
    // si el hilo se cae, lo que esperaba falla y el próximo pedido arranca uno nuevo
    const down = (e: Error) => {
      if (this.worker !== w) return
      this.worker = null
      for (const c of this.calls.values()) c.reject(e)
      this.calls.clear()
    }
    w.on('error', down)
    w.on('exit', () => down(new Error(T.cerrada)))
    this.worker = w
    return w
  }

  private call<T>(req: Req): Promise<T> {
    const w = this.start()
    const seq = ++this.seq
    return new Promise((resolve, reject) => {
      this.calls.set(seq, { resolve: resolve as (r: unknown) => void, reject })
      w.postMessage({ ...req, seq })
    })
  }

  /** Vuelve a leer los temas de la base. Devuelve cuántos son y los números de la barra lateral e Inicio. */
  load() { return this.call<TableLoad>({ op: 'load' }) }
  /** Los ids a la vista, en orden, y las filas que se ven desde la posición `from`. */
  query(q: TableQuery, from = 0) { return this.call<{ ids: number[]; rows: unknown[][] }>({ op: 'query', q, from }) }
  /** Las filas de estos temas (arreglos en el orden de TRACK_FIELDS). */
  rows(ids: number[]) { return this.call<unknown[][]>({ op: 'rows', ids }) }

  /** Cierra el hilo (la biblioteca volvió a ser chica, o se cierra la app). */
  async close() {
    const w = this.worker
    this.worker = null
    for (const c of this.calls.values()) c.reject(new Error(T.cerrada))
    this.calls.clear()
    if (w) await w.terminate()
  }
}
