// Hilo de Arreglar nombres (core/tidyserver.ts): abre la base solo para leer y hace una de tres cosas. Los nombres que Ordenar
// suma sola (core/revision-armar.ts, ~2 s con 5.000 temas), cuenta cuánto propone
// cada perfil (`tidyProfiles`, core/tidy.ts), o calcula los nombres limpios de la lista «Faltan o suenan mal» (`namesTidy`,
// core/wanted-limpios.ts). Cada una es una pasada entera por la Música (~6 s con 100.000 temas): acá no traba la ventana. Uno por pedido.
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { ponerIdioma } from '@paila/shared/idioma'
import { tidyProfiles } from './tidy'
import { proponerNombres } from './revision-armar'
import { namesTidy } from './wanted-limpios'
import type { ArmarJob, NamesJob, ProfilesJob } from './tidyserver'

const job = workerData as ProfilesJob | NamesJob | ArmarJob
try {
  ponerIdioma(job.idioma)
  const db = new DatabaseSync(job.file, { readOnly: true })
  let result: unknown
  if (job.nombres) result = namesTidy(db, job.rules)
  else {
    const file = db.prepare('SELECT root_id AS root, rel_path AS rel FROM files WHERE id = ?')
    // las rutas, con la carpeta de cada raíz que mandó el proceso principal (con la letra de unidad de hoy)
    const roots = job.roots
    const pathOf = (id: number) => {
      const f = file.get(id) as { root: number; rel: string } | undefined
      const base = f && roots[f.root]
      return base ? path.join(base, ...f.rel.split('/')) : null
    }
    result = 'armar' in job ? proponerNombres({ db, pathOf, reglas: job.rules }) : tidyProfiles(db, pathOf, job.rules, job.changes)
  }
  db.close()
  parentPort!.postMessage({ ok: true, result })
} catch (e) {
  parentPort!.postMessage({ ok: false, error: (e as Error).message })
}
