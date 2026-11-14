// Dónde están la app compilada de PAILA y el Electron para abrirla, comprobado ANTES de abrir nada: si falta algo, falla en la
// consola con lo que hay que hacer. Con una ruta mala, Electron abre su propia ventana de error ("Unable to find Electron app"),
// que no tiene que verse nunca (pasó el 22/10). Las copias de trabajo (git worktree) pueden no tener node_modules propio:
// se busca hacia arriba.
import fs from 'node:fs'
import path from 'node:path'

/** Carpeta de la app (`apps/paila`), buscando desde la carpeta de trabajo hacia arriba. Falla si no está armada (`npm run build`). */
export function rutaApp(desde = process.cwd()) {
  for (let d = path.resolve(desde); ; d = path.dirname(d)) {
    const app = path.join(d, 'apps', 'paila')
    if (fs.existsSync(path.join(app, 'package.json'))) {
      if (!fs.existsSync(path.join(app, 'out', 'main', 'arranque.js'))) throw new Error(`La app no está armada en ${app}. Primero: npm run build`)
      return app
    }
    if (path.dirname(d) === d) throw new Error(`No encuentro apps/paila desde ${desde}: corré el comando desde la carpeta del repositorio.`)
  }
}

/** Dónde está el programa de Electron adentro de node_modules/electron/dist, en cada sistema. */
const ELECTRON = process.platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : process.platform === 'win32' ? ['electron.exe'] : ['electron']

/** El electron.exe de este repositorio o de la carpeta de arriba. Falla si no está (`npm install` y `npx install-electron`). */
export function rutaElectron(desde = process.cwd()) {
  for (let d = path.resolve(desde); ; d = path.dirname(d)) {
    const f = path.join(d, 'node_modules', 'electron', 'dist', ...ELECTRON)
    if (fs.existsSync(f)) return f
    if (path.dirname(d) === d) throw new Error('No encuentro Electron (node_modules/electron/dist/electron.exe). Primero: npm install y npx install-electron')
  }
}

/** Un archivo de un paquete de npm (por ejemplo `vitest/vitest.mjs`), de este repositorio o de la carpeta de arriba. */
export function rutaModulo(rel, desde = process.cwd()) {
  for (let d = path.resolve(desde); ; d = path.dirname(d)) {
    const f = path.join(d, 'node_modules', ...rel.split('/'))
    if (fs.existsSync(f)) return f
    if (path.dirname(d) === d) throw new Error(`No encuentro node_modules/${rel}. Primero: npm install`)
  }
}
