// IPC del estado de la colección (core/estado.ts; MASTERPLAN-5, etapa 1): un solo pedido con cuánto falta en cada parte, y
// "Dejar como está". Cuando terminan de calcularse los repetidos (leen archivos, van aparte) avisa a la ventana con 'estado:cambio'.
import { ipcMain } from 'electron'
import { Estado } from '@paila/core/estado'
import type { Ctx } from '../context'
import type { GrupoEstado, OrganizeOptions } from '@paila/shared/types'

export function registerEstado(c: Ctx): Estado {
  const estado = new Estado(c.lib.db, {
    pathOf: (id) => c.lib.trackPath(id),
    organizer: c.organizer,
    onCambio: () => c.win()?.webContents.send('estado:cambio'),
  })
  ipcMain.handle('estado:leer', () => estado.leer())
  ipcMain.handle('estado:dejar', (_e, grupo: GrupoEstado, ids: number[] | 'todos', si?: boolean) => estado.dejar(grupo, ids, si ?? true))
  ipcMain.handle('estado:regla', (_e, o: OrganizeOptions) => estado.regla(o))
  return estado
}
