// IPC de las Notas de uso (core/notasdeuso.ts): saca la captura de la ventana, guarda la nota en la carpeta de datos y
// muestra la lista. La captura se saca al apretar "Anotar" (antes de que la cajita tape la pantalla) y espera acá hasta guardar.
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { Ctx } from '../context'
import type { NotaNueva } from '@paila/shared/types'
import { CARPETA_NOTAS, armarPedido, guardarNota, listarNotas } from '@paila/core/notasdeuso'

export function registerNotas(c: Ctx) {
  const carpeta = path.join(c.userData, CARPETA_NOTAS)
  let captura: Buffer | null = null
  ipcMain.handle('notas:capturar', async () => {
    captura = null
    try { captura = (await c.win()?.webContents.capturePage())?.toPNG() ?? null } catch { /* sin captura: la nota vale igual */ }
  })
  ipcMain.handle('notas:guardar', (_e, n: NotaNueva) => { const png = captura; captura = null; return guardarNota(carpeta, n, png) })
  ipcMain.handle('notas:lista', () => listarNotas(carpeta))
  // abre el pedido ya escrito en el navegador: nada se manda solo, la persona lo revisa y aprieta enviar
  ipcMain.handle('notas:mandar', async (_e, hora: string, via: 'github' | 'mail') => {
    const nota = listarNotas(carpeta).find((x) => x.hora === hora)
    if (nota) await shell.openExternal(armarPedido(nota, app.getVersion(), via).url)
  })
  ipcMain.handle('notas:carpeta', async () => { fs.mkdirSync(carpeta, { recursive: true }); await shell.openPath(carpeta) })
}
