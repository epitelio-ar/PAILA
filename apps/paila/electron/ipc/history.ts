// IPC del Historial único: todo lo que PAILA hizo sobre archivos, con deshacer por tanda (ver core/history.ts).
import { ipcMain } from 'electron'
import { History } from '@paila/core/history'
import type { HistoryKind } from '@paila/shared/types'
import type { Ctx } from '../context'

export function registerHistory(c: Ctx) {
  const history = new History(c.lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, imports: c.imports, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, separar: c.stems, carpetas: c.space.empty, rootPath: c.rootPath })

  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('history:detail', (_e, kind: HistoryKind, id: number) => history.detail(kind, id))
  // Deshacer mueve o escribe archivos: pasa por el candado y el análisis se pausa mientras tanto.
  // "Mejorar playlist" y las listas traídas solo cambian la base (no tocan archivos).
  ipcMain.handle('history:undo', (_e, kind: HistoryKind, id: number) => kind === 'playlist' || kind === 'pedido' || kind === 'listas' ? history.undo(kind, id) : c.withPaused(() => history.undo(kind, id)))
  // deshacer en cadena y "Volver a como estaba" (core/history-cadena.ts): siempre tocan archivos
  ipcMain.handle('history:undoCadena', (_e, kind: HistoryKind, id: number) => c.withPaused(() => history.undo(kind, id, { cadena: true })))
  ipcMain.handle('history:puntos', () => history.puntos())
  ipcMain.handle('history:volver', (_e, tanda: number) => c.withPaused(() => history.volver(tanda)))
}
