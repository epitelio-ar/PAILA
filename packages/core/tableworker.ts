// Hilo de la tabla grande: abre la base solo para leer (aparte de la conexión del proceso principal) y atiende los pedidos
// de core/tableserver.ts con un TrackIndex (core/tableindex.ts).
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { TrackIndex } from './tableindex'
import type { TableRequest } from './tableserver'

const db = new DatabaseSync((workerData as { file: string }).file, { readOnly: true })
const index = new TrackIndex()

parentPort!.on('message', (m: TableRequest) => {
  try {
    const result = m.op === 'load' ? index.load(db) : m.op === 'query' ? index.view(m.q, m.from) : index.rows(m.ids)
    parentPort!.postMessage({ seq: m.seq, ok: true, result })
  } catch (e) {
    parentPort!.postMessage({ seq: m.seq, ok: false, error: (e as Error).message })
  }
})
