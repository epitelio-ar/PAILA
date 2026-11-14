// IPC del respaldo de archivos por paso (core/ops/backup.ts): la vista previa de cuánto ocupa y dónde va antes de aplicar
// Cambios pendientes, la lista de respaldos hechos, mandarlos a la papelera de PAILA a mano (nunca solos) y recuperarlos, y elegir
// en qué carpeta van.
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import type { Ctx } from '../context'
import { chosenBackupDir, listBackups, restoreBackup, setBackupDir, trashBackups, trashedBackups } from '@paila/core/ops/backup'
import { textos } from '@paila/shared/idioma'

const T = textos({
  elegir: { es: 'Elegí la carpeta para los respaldos', en: 'Choose the folder for backups' },
  adentro: {
    es: 'Esa carpeta está adentro de tu Música: los respaldos aparecerían como temas repetidos. Elegí otra (o dejá la de fábrica, que PAILA no mira).',
    en: "That folder is inside your Music: the backups would show up as duplicate tracks. Choose another one (or keep the default one, which PAILA doesn't scan).",
  },
  borrando: { es: 'mandando respaldos a la papelera', en: 'sending backups to the trash' },
  recuperando: { es: 'recuperando un respaldo de la papelera', en: 'recovering a backup from the trash' },
})

export function registerRespaldos(c: Ctx) {
  const db = c.lib.db
  const roots = () => c.lib.roots().map((r) => r.path)
  ipcMain.handle('respaldos:plan', (_e, ids?: number[]) => c.changes.backupPlan(ids))
  ipcMain.handle('respaldos:lista', () => listBackups(db))
  // "borrar" los manda a la papelera de PAILA (lo único que borra es Vaciar papelera); con el candado, para que nada esté
  // usando esas carpetas mientras tanto
  const connected = () => c.lib.roots().filter((r) => r.available).map((r) => ({ id: r.id, path: r.path }))
  ipcMain.handle('respaldos:borrar', (_e, ids: number[]) => c.lib.ops.run(T.borrando, () => trashBackups(db, ids, connected())))
  ipcMain.handle('respaldos:papelera', () => trashedBackups(db))
  ipcMain.handle('respaldos:recuperar', (_e, id: number) => c.lib.ops.run(T.recuperando, () => restoreBackup(db, id)))
  ipcMain.handle('respaldos:carpeta', () => chosenBackupDir(db))
  ipcMain.handle('respaldos:elegir', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegir, properties: ['openDirectory', 'createDirectory'] })
    const dir = r.canceled ? null : r.filePaths[0] ?? null
    if (!dir) return null
    // adentro de una carpeta de música (salvo su _PAILA, que el escaneo no mira) los respaldos se escanearían como temas
    const inside = (a: string, b: string) => (path.resolve(a).toLowerCase() + path.sep).startsWith(path.resolve(b).toLowerCase() + path.sep)
    if (roots().some((root) => inside(dir, root) && !inside(dir, path.join(root, '_PAILA')))) return { dir: chosenBackupDir(db), error: T.adentro }
    setBackupDir(db, dir)
    return { dir, error: null }
  })
  ipcMain.handle('respaldos:deFabrica', () => { setBackupDir(db, null); return null })
}
