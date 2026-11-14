// IPC del modo avanzado: el inspector de un tema (lee la base en solo lectura), la cola del análisis, el registro de operaciones y
// "reanalizar este tema" (ver core/advanced.ts y core/inspector.ts).
import path from 'node:path'
import { ipcMain } from 'electron'
import type { AdvInspectResult } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
import { analysisQueue, operationLog, reanalyzeTrack } from '@paila/core/advanced'
import { ErrorLog } from '@paila/core/errorlog'
import { History } from '@paila/core/history'
import { findTrack, inspectTrack, openReadOnly } from '@paila/core/inspector'
import { inspectionText } from '@paila/core/inspector-texto'
import type { Ctx } from '../context'

const T = textos({
  ninguno: { es: 'No encontré ningún tema con eso. Probá con el número, la ruta o un pedazo del nombre.', en: "I couldn't find any track with that. Try the number, the path or part of the name." },
  varios: { es: 'Hay varios temas parecidos: elegí uno.', en: 'There are several similar tracks: pick one.' },
})

export function registerAdvanced(c: Ctx) {
  // el inspector mira la base por una conexión de solo lectura: aunque algo fallara, no podría escribir
  ipcMain.handle('adv:inspect', (_e, ref: string, asistentes: boolean): AdvInspectResult => {
    const db = openReadOnly(c.lib.db.location()!)
    try {
      const r = findTrack(db, String(ref))
      if (!r) return { ok: false, choices: [], mensaje: T.ninguno }
      if ('choices' in r) return { ok: false, choices: r.choices, mensaje: T.varios }
      const data = inspectTrack(db, r.found, { assistants: asistentes })!
      return { ok: true, data, texto: inspectionText(data) }
    } finally { db.close() }
  })

  ipcMain.handle('adv:queue', () => analysisQueue(c.lib.db, c.lib.status))

  ipcMain.handle('adv:oplog', () => {
    const history = new History(c.lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, carpetas: c.space.empty, rootPath: c.rootPath })
    return { ops: operationLog(c.lib.db, history.list()), errores: new ErrorLog(path.join(c.userData, 'registro')).read(40).reverse() }
  })

  ipcMain.handle('adv:reanalyze', (_e, id: number) => {
    const msg = reanalyzeTrack(c.lib.db, id)
    void c.analyze()
    return msg
  })
}
