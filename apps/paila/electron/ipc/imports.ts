// IPC de "Traer tus playlists de Rekordbox" (core/listimport.ts): elegir el rekordbox.xml o el pendrive (y los pendrives
// conectados), la vista previa emparejada en un hilo aparte, buscar por huella lo que no apareció, mirar cada playlist y crear.
// Solo lee el XML y el pendrive; en PAILA solo cambia la base (no pasa por el candado de archivos).
import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { findPdb, readPendrive, readRbXml, type ForeignLibrary } from '@paila/core/listimport'
import { matchInWorker } from '@paila/core/requestserver'
import { analyzePrints } from '@paila/core/analysis/analyze'
import { matchByPrint } from '@paila/core/printmatch'
import type { ImportPreview, ImportSourceKind, RequestDecision } from '@paila/shared/types'
import type { Ctx } from '../context'
import { textos } from '@paila/shared/idioma'

const T = textos({
  noEsXml: {
    es: 'Eso no es un rekordbox.xml: en Rekordbox, Archivo → Exportar colección en formato xml.',
    en: "That isn't a rekordbox.xml: in Rekordbox, File → Export Collection in xml format.",
  },
  elegiXml: { es: 'Elegí el rekordbox.xml que exportaste de Rekordbox', en: 'Choose the rekordbox.xml you exported from Rekordbox' },
  elegiPendrive: { es: 'Elegí el pendrive (o su carpeta PIONEER)', en: 'Choose the USB drive (or its PIONEER folder)' },
  noPendrive: {
    es: 'Ahí no hay un pendrive de Rekordbox: tiene que tener la carpeta PIONEER con rekordbox/export.pdb adentro.',
    en: "There's no Rekordbox USB drive there: it has to have the PIONEER folder with rekordbox/export.pdb inside.",
  },
  buscando: { es: 'Buscando por cómo suenan los temas que no aparecieron', en: "Searching by sound for the tracks that didn't turn up" },
  encontrados: { es: (n: number) => `${n} encontrados por cómo suenan`, en: (n: number) => `${n} found by how they sound` },
})

export function registerImports(c: Ctx) {
  const { imports } = c
  const roots = () => Object.fromEntries(c.lib.roots().filter((r) => r.available).map((r) => [r.id, r.path]))
  const preview = (lib: ForeignLibrary): Promise<ImportPreview> => imports.preview(lib, (entries) =>
    matchInWorker(path.join(__dirname, 'request-worker.js'), { file: path.join(c.userData, 'paila.db'), roots: roots(), entries }))

  /** Los pendrives (o discos) conectados que tienen un export de Rekordbox. */
  ipcMain.handle('traer:pendrives', () => {
    const out: { root: string; label: string }[] = []
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${l}:\\`
      try { if (fs.existsSync(path.join(root, 'PIONEER', 'rekordbox', 'export.pdb'))) out.push({ root, label: `${l}:` }) } catch { /* sin disco */ }
    }
    return out
  })

  ipcMain.handle('traer:pick', async (_e, kind: ImportSourceKind, folder?: string) => {
    if (kind === 'xml' && folder) {
      // soltado en la ventana
      if (!/.xml$/i.test(folder) || !fs.existsSync(folder)) throw new Error(T.noEsXml)
      return preview(readRbXml(folder))
    }
    if (kind === 'xml') {
      const r = await dialog.showOpenDialog(c.win()!, { title: T.elegiXml, filters: [{ name: 'Rekordbox XML', extensions: ['xml'] }], properties: ['openFile'] })
      if (r.canceled || !r.filePaths[0]) return null
      return preview(readRbXml(r.filePaths[0]))
    }
    let dir = folder
    if (!dir) {
      const r = await dialog.showOpenDialog(c.win()!, { title: T.elegiPendrive, properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    if (!findPdb(dir)) throw new Error(T.noPendrive)
    return preview(readPendrive(dir))
  })

  /** Lo que no apareció y cuyo archivo está en esta compu (o en el pendrive): se escucha y se busca por la huella del sonido. */
  ipcMain.handle('traer:prints', (_e, token: string) => c.jobs.run('traer-huella', T.buscando,
    (h) => imports.byPrint(token, async (file, duration) => {
      h.update({ current: path.basename(file) })
      const p = await analyzePrints({ ffmpeg: c.ffmpeg, file, channels: null })
      if (!p.chromaprint) return null
      const best = (await matchByPrint(c.lib.db, p.chromaprint, { duration, limit: 3 }))[0]
      return best?.kind === 'mismo' ? best.fileId : null
    }, (done, total) => h.update({ done, total }), h.cancelled),
    (r) => T.encontrados(r.how.huella)))

  ipcMain.handle('traer:summary', (_e, token: string, decisions: Record<string, RequestDecision | null>) => imports.summary(token, decisions))
  ipcMain.handle('traer:items', (_e, token: string, key: string) => imports.items(token, key))
  ipcMain.handle('traer:create', (_e, token: string, keys: string[], decisions: Record<string, RequestDecision | null>, withDj: boolean, lowToWanted: boolean) => imports.create(token, keys, decisions, withDj, lowToWanted))
}
