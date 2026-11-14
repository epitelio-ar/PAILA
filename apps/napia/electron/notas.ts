// "Anotar" en NAPIA (el mismo botón y atajo que en PAILA): saca la captura de la ventana y guarda la nota con NAPIA como pantalla.
// Va a la carpeta de notas de PAILA (notas-de-uso, al lado de su base) para que se vean juntas en Configuración → Notas de uso;
// sin PAILA instalada, a la de NAPIA. Nada sale de la PC (core/notasdeuso.ts).
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { CARPETA_NOTAS, guardarNota } from '@paila/core/notasdeuso'
import { pailaDbCandidates } from '@paila/core/sockseek/paila'
import type { NotaNueva } from '@paila/shared/types'

/** La carpeta de notas: la de PAILA si su carpeta de datos existe; si no, la de NAPIA. */
export function carpetaDeNotas(appData: string | undefined, portableDir: string | undefined, propia: string): string {
  for (const db of pailaDbCandidates(appData, portableDir, process.env.PAILA_USER_DATA)) if (fs.existsSync(path.dirname(db))) return path.join(path.dirname(db), CARPETA_NOTAS)
  return path.join(propia, CARPETA_NOTAS)
}

export function registerNotas({ win }: { win: () => BrowserWindow | null }) {
  let captura: Buffer | null = null
  ipcMain.handle('notas:capturar', async () => {
    captura = null
    try { captura = (await win()?.webContents.capturePage())?.toPNG() ?? null } catch { /* sin captura: la nota vale igual */ }
  })
  ipcMain.handle('notas:guardar', (_e, n: NotaNueva) => {
    const png = captura; captura = null
    return guardarNota(carpetaDeNotas(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, app.getPath('userData')), { ...n, pantalla: `NAPIA · ${n.pantalla}` }, png)
  })
}
