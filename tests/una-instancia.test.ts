// Una sola PAILA por carpeta de datos (apps/paila/electron/main.ts): el 21/10/2026 se pudieron abrir dos sobre la misma
// base. Abre la app compilada dos veces con la misma carpeta de datos de prueba: la segunda se tiene que cerrar sola, sin
// abrir la base ni la ventana. Necesita el armado (npm run build); sin él, se saltea.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electron: string = require('electron')
const app = path.resolve('apps/paila')
// El armado tiene que ser más nuevo que el código del proceso principal: con uno viejo (de antes de la regla de una sola
// instancia, o de otra rama) el test fallaba sin que el código estuviera mal. Si está viejo, se saltea y lo dice.
const newest = (dir: string): number => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).mtimeMs), 0)
const mainJs = path.join(app, 'out/main/main.js')
const built = fs.existsSync(mainJs) && fs.statSync(mainJs).mtimeMs >= newest(path.join(app, 'electron'))
if (fs.existsSync(mainJs) && !built) console.warn('[una-instancia] El armado (apps/paila/out) es más viejo que el código: se saltea. Corré npm run build y repetí.')

function open(userData: string, shot: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PAILA_USER_DATA: userData, PAILA_SNAPSHOT: shot }
  delete env.ELECTRON_RUN_AS_NODE
  const p = spawn(electron, [app], { env, stdio: 'ignore', windowsHide: true })
  const t0 = Date.now()
  const exit = new Promise<number>((r) => p.on('exit', () => r(Date.now() - t0)))
  return { p, exit }
}

describe.skipIf(!built || process.platform !== 'win32')('una sola PAILA a la vez', () => {
  it('la segunda con la misma carpeta de datos se cierra sola; la primera sigue', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-una-'))
    try {
      const first = open(path.join(dir, 'datos'), path.join(dir, 'primera.png'))
      await new Promise((r) => setTimeout(r, 2500))
      const second = open(path.join(dir, 'datos'), path.join(dir, 'segunda.png'))
      const ms = await second.exit
      expect(ms).toBeLessThan(15_000)
      await first.exit
      expect(fs.existsSync(path.join(dir, 'primera.png'))).toBe(true)
      expect(fs.existsSync(path.join(dir, 'segunda.png'))).toBe(false)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }, 90_000)
})
