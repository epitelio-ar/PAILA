// IPC de playlists: crear y editar, carpetas → playlists, mejorar playlist, exportar a pendrive, orden armónico.
import { dialog, ipcMain, shell } from 'electron'
import type { ExportOptions } from '@paila/core/export'
import { analyzeFolders, createFromFolders } from '@paila/core/folderplaylists'
import type { Ctx } from '../context'
import { cant, textos } from '@paila/shared/idioma'

/** Lo que se ve (ventanas, avisos, la tarea de copiar). El nombre del .m3u8 que se propone es el de la playlist. */
const T = textos({
  guardar: { es: 'Guardar playlist', en: 'Save playlist' },
  guardados: { es: (n: number, p: string) => `Se guardaron ${n} temas en ${p}`, en: (n: number, p: string) => `Saved ${cant(n, 'track', 'tracks')} to ${p}` },
  importar: { es: 'Importar playlist', en: 'Import playlist' },
  importada: {
    es: (n: number, faltan: number) => `Importada con ${n} temas${faltan ? `; ${faltan} no están en tu biblioteca` : ''}.`,
    en: (n: number, faltan: number) => `Imported with ${cant(n, 'track', 'tracks')}${faltan ? `; ${faltan} aren't in your library` : ''}.`,
  },
  elegiDestino: { es: 'Elegí el pendrive o la carpeta de destino', en: 'Choose the USB drive or the destination folder' },
  copiando: { es: 'Copiando la playlist', en: 'Copying the playlist' },
  copiandoAlPendrive: { es: 'copiando una playlist al pendrive', en: 'copying a playlist to a USB drive' },
  copiados: {
    es: (c: number, v: number, f: number) => `${c} copiados, ${v} convertidos${f ? `, ${f} fallaron` : ''}`,
    en: (c: number, v: number, f: number) => `${c} copied, ${v} converted${f ? `, ${f} failed` : ''}`,
  },
})

export function registerPlaylists(c: Ctx) {
  const { lib, playlists, improver, playlistOps, exporter, rekordbox } = c

  ipcMain.handle('pl:tree', () => playlists.tree())
  ipcMain.handle('pl:create', (_e, n: string, k: 'list' | 'folder' | 'smart', p: number | null, r?: object) => { playlists.create(n, k, p, r ?? null); return playlists.tree() })
  ipcMain.handle('pl:rename', (_e, id: number, n: string) => { playlists.rename(id, n); return playlists.tree() })
  ipcMain.handle('pl:rules', (_e, id: number, r: object) => { playlists.setRules(id, r); return playlists.tree() })
  // borrar se anota en el Historial (se deshace, con los pedidos de Traer una lista enganchados de nuevo)
  ipcMain.handle('pl:delete', (_e, id: number) => { playlistOps.remove(id); return playlists.tree() })
  ipcMain.handle('pl:deleteInfo', (_e, id: number) => ({ requests: playlistOps.requestsIfRemoved(id) }))
  ipcMain.handle('pl:tracks', (_e, id: number) => playlists.trackIds(id))
  ipcMain.handle('pl:add', (_e, id: number, t: number[]) => playlists.addTracks(id, t))
  ipcMain.handle('pl:remove', (_e, id: number, t: number[]) => playlists.removeTracks(id, t))
  ipcMain.handle('pl:move', (_e, id: number, t: number, to: number) => playlists.moveTrack(id, t, to))
  ipcMain.handle('pl:harmonic', (_e, id: number) => { playlists.setOrder(id, rekordbox.harmonicOrder(playlists.trackIds(id))) })
  ipcMain.handle('pl:export', async (_e, id: number) => {
    const name = playlists.tree().find((n) => n.id === id)?.name ?? 'playlist'
    const r = await dialog.showSaveDialog(c.win()!, { title: T.guardar, defaultPath: `${name.replace(/[<>:"/\\|?*]/g, '_')}.m3u8`, filters: [{ name: 'Playlist M3U8', extensions: ['m3u8'] }] })
    if (r.canceled || !r.filePath) return null
    const n = playlists.exportM3u8(id, r.filePath)
    return T.guardados(n, r.filePath)
  })
  ipcMain.handle('pl:import', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.importar, properties: ['openFile'], filters: [{ name: 'Playlist M3U / M3U8', extensions: ['m3u', 'm3u8'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const o = playlists.importM3u(r.filePaths[0])
    return T.importada(o.found, o.missing.length)
  })

  // Carpetas → Playlists
  ipcMain.handle('fp:analyze', () => analyzeFolders(lib.db))
  ipcMain.handle('fp:create', (_e, dirs: string[]) => createFromFolders(lib.db, playlists, analyzeFolders(lib.db).filter((p) => dirs.includes(p.dir))))

  // Mejorar playlist
  ipcMain.handle('imp:propose', (_e, id: number) => improver.propose(id, playlists.trackIds(id)))
  ipcMain.handle('imp:apply', (_e, items: { playlistId: number; currentId: number; betterId: number }[]) => improver.apply(items))
  ipcMain.handle('imp:undo', (_e, id: number) => improver.undo(id))

  // Limpiar y fusionar playlists
  ipcMain.handle('plops:previewClean', (_e, id: number) => playlistOps.previewClean(id))
  ipcMain.handle('plops:clean', (_e, id: number, drop: number[]) => playlistOps.clean(id, drop))
  ipcMain.handle('plops:previewMerge', (_e, ids: number[]) => playlistOps.previewMerge(ids))
  ipcMain.handle('plops:merge', (_e, ids: number[], name: string, removeOriginals: boolean) => playlistOps.merge(ids, name, removeOriginals))

  // Playlist → pendrive o carpeta
  const plName = (id: number) => playlists.tree().find((n) => n.id === id)?.name ?? 'Playlist'
  ipcMain.handle('exp:pick', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegiDestino, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('exp:plan', (_e, id: number, o: ExportOptions) => exporter.plan(plName(id), playlists.trackIds(id), o))
  ipcMain.handle('exp:run', (_e, id: number, o: ExportOptions) => c.jobs.run('export', T.copiando, (h) => lib.ops.run(T.copiandoAlPendrive, async () => {
    const plan = exporter.plan(plName(id), playlists.trackIds(id), o)
    h.update({ total: plan.items.length })
    const r = await exporter.run(plan, (p) => h.update({ done: p.done, total: p.total, current: p.current, errors: p.errors }), h.cancelled)
    h.update({ problems: r.failed })
    return r
  }), (r) => T.copiados(r.copied, r.converted, r.failed.length)))
  ipcMain.handle('exp:open', (_e, p: string) => shell.openPath(p))
}
