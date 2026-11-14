// El estilo de la ventana (actual o historieta, ver @paila/diseno/src/estilo.ts): lo elige la pantalla y PAILA lo deja en
// userData/estilo.json, de donde lo lee NAPIA al abrir (así las dos se ven igual).
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'

export function registerEstilo() {
  ipcMain.handle('estilo:set', (_e, estilo: string) => {
    if (estilo !== 'actual' && estilo !== 'historieta') return
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'estilo.json'), JSON.stringify({ estilo })) } catch { /* sin disco: vale solo en PAILA */ }
  })
}
