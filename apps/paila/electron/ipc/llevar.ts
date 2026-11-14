// IPC de exportar a Traktor, Serato, VirtualDJ y Engine DJ (core/djexport.ts). Traktor: se elige dónde guardar el .nml. Los demás:
// se escribe en sus carpetas (con copia de lo de antes), y solo con el programa cerrado. La grilla de Serato
// dentro de los archivos va a Cambios pendientes: nada se escribe en la música hasta que lo apliques.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { DjExport, driveOf, engineDb, vdjHomeOf } from '@paila/core/djexport'
import { macLabelOf } from '@paila/core/volumes-mac'
import type { DjApp, DjExportOptions, DjExportResult } from '@paila/shared/types'
import type { Ctx } from '../context'
import { textos } from '@paila/shared/idioma'

// Lo que se ve. El nombre que se propone para el archivo ("PAILA para Traktor.nml") no se traduce: es un archivo que se crea.
const T = textos({
  guardarTraktor: { es: 'Guardar la colección para Traktor', en: 'Save the collection for Traktor' },
  coleccionTraktor: { es: 'Colección de Traktor', en: 'Traktor collection' },
  candado: { es: (app: string) => `exportando a ${app}`, en: (app: string) => `exporting to ${app}` },
  cerra: { es: (app: string) => `Cerrá ${app} antes de exportar: al cerrarse vuelve a guardar su base y borraría lo que exporta PAILA.`, en: (app: string) => `Close ${app} before exporting: when it closes it saves its database again and would erase what PAILA exports.` },
})

/** Cómo se llama cada programa en el Administrador de tareas. */
const PROCESS: Record<DjApp, RegExp> = { traktor: /^traktor/i, serato: /^serato dj/i, virtualdj: /^virtualdj/i, engine: /^engine (dj|prime)/i }

/**
 * ¿Está abierto? (Serato y VirtualDJ reescriben su base al cerrarse: con el programa abierto se perdería lo exportado.)
 * En Windows, con la lista de tareas; en Mac, con `ps` (el nombre del programa es lo último de su ruta).
 */
function running(appName: DjApp): Promise<boolean> {
  const mac = process.platform === 'darwin'
  if (!mac && process.platform !== 'win32') return Promise.resolve(false)
  const [cmd, args] = mac ? ['ps', ['-axo', 'comm=']] : ['tasklist', ['/FO', 'CSV', '/NH']]
  return new Promise((ok) => execFile(cmd, args, { windowsHide: true, timeout: 15_000 }, (err, out) => {
    if (err) return ok(false)
    ok(String(out).split(/\r?\n/).some((l) => PROCESS[appName].test(mac ? path.posix.basename(l.trim()) : l.replace(/^"/, ''))))
  }))
}

const NAME: Record<DjApp, string> = { traktor: 'Traktor', serato: 'Serato', virtualdj: 'VirtualDJ', engine: 'Engine DJ' }

export function registerLlevar(c: Ctx) {
  // VirtualDJ nuevo guarda lo suyo en AppData\Local (Windows) o en ~/Library/Application Support (Mac)
  const mac = process.platform === 'darwin'
  const vdjData = mac ? app.getPath('appData') : process.env.LOCALAPPDATA
  // Engine DJ, en la carpeta Música de verdad (la que Windows o la Mac tengan como tal, aunque se haya movido)
  const dj = new DjExport(c.rekordbox, os.homedir(), vdjHomeOf(vdjData, app.getPath('documents')), mac ? macLabelOf('/') : '', path.join(app.getPath('music'), 'Engine Library'))
  ipcMain.handle('dj:place', async (_e, which: DjApp) => {
    const drive = driveOf(c.lib.roots()[0]?.path ?? os.homedir())
    const folder = which === 'serato' ? dj.seratoDir(drive) : which === 'virtualdj' ? dj.vdjDir(drive) : which === 'engine' ? dj.engineDir(drive) : null
    return { folder, running: which === 'traktor' ? false : await running(which), missing: which === 'engine' && !fs.existsSync(engineDb(dj.engineHome)) }
  })
  ipcMain.handle('dj:export', async (_e, which: DjApp, scope: 'todo' | 'playlists', ids: number[], opts: DjExportOptions): Promise<DjExportResult | null> => {
    const o = { scope, playlistIds: ids, grid: opts.grid, suggestedCues: opts.suggestedCues, pailaWhenMoving: opts.pailaWhenMoving }
    if (which === 'traktor') {
      const r = await dialog.showSaveDialog(c.win()!, { title: T.guardarTraktor, defaultPath: 'PAILA para Traktor.nml', filters: [{ name: T.coleccionTraktor, extensions: ['nml'] }] })
      if (r.canceled || !r.filePath) return null
      const dest = r.filePath
      return c.lib.ops.run(T.candado(NAME.traktor), () => dj.traktor({ ...o, dest }))
    }
    if (await running(which)) throw new Error(T.cerra(NAME[which]))
    // escribe archivos por el motor (ops/copy.ts): va con el candado de operaciones
    if (which === 'virtualdj') return c.lib.ops.run(T.candado(NAME.virtualdj), () => dj.virtualdj(o))
    if (which === 'engine') return c.lib.ops.run(T.candado(NAME.engine), () => dj.engine(o))
    const res = await c.lib.ops.run(T.candado(NAME.serato), () => dj.serato(o))
    if (opts.intoFiles) {
      const ch = dj.seratoChanges(o)
      c.changes.stageMany(ch.items.map((i) => ({ id: i.id, field: 'serato' as const, value: i.value })))
      res.staged = ch.items.length
      res.alreadyIn = ch.alreadyIn
      res.skipped.push(...ch.unreadable)
    }
    return res
  })
}
