// Abrir NAPIA desde PAILA ("Bajar con NAPIA" y, en Mac, el menú de la app): instalada o portable es el mismo programa con
// --napia; en desarrollo, apps/paila (su arranque abre apps/napia/out). Si ya estaba abierta, recibe la lista y la carga.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** `extra`: lo que se le pasa a NAPIA (por ejemplo, el archivo de la lista). */
export function abrirNapia(extra: string[] = []) {
  if (app.isPackaged) { spawn(process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, ['--napia', ...extra], { detached: true, stdio: 'ignore' }).unref(); return }
  if (!fs.existsSync(path.join(__dirname, '../../../napia/out/main/main.js'))) throw new Error('NAPIA no está armada (npm run build).')
  spawn(process.execPath, [path.join(__dirname, '../..'), '--napia', ...extra], { detached: true, stdio: 'ignore' }).unref()
}
