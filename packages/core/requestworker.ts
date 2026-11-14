// Hilo de la vista previa de "Traer una lista" (core/requests.ts): abre la base solo para leer, empareja la lista con la
// biblioteca y devuelve la vista previa (o, con `entries`, el emparejamiento de temas ya leídos: Rekordbox, pendrive). Así,
// con 100.000 temas, la ventana no se congela mientras empareja. Uno por pedido.
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { Requests } from './requests'
import type { Playlists } from './playlists'
import type { Wanted } from './wanted'
import type { PreviewJob } from './requestserver'

const job = workerData as PreviewJob
try {
  const db = new DatabaseSync(job.file, { readOnly: true })
  const file = db.prepare('SELECT root_id AS root, rel_path AS rel FROM files WHERE id = ?')
  // las rutas, con la carpeta de cada raíz que mandó el proceso principal (con la letra de unidad de hoy)
  const pathOf = (id: number) => {
    const f = file.get(id) as { root: number; rel: string } | undefined
    const base = f && job.roots[f.root]
    return base ? path.join(base, ...f.rel.split('/')) : null
  }
  // la vista previa no guarda nada: no hacen falta las playlists ni la lista «Faltan o suenan mal»
  const req = new Requests(db, null as unknown as Playlists, null as unknown as Wanted, pathOf)
  const out = job.entries ? { items: req.match(job.entries) } : { preview: req.preview(job.text, job.fileName, job.name) }
  db.close()
  parentPort!.postMessage({ ok: true, ...out })
} catch (e) {
  parentPort!.postMessage({ ok: false, error: (e as Error).message })
}
