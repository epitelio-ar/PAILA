// Armado de NAPIA (electron-vite): proceso principal, puente y pantalla, en apps/napia/out/. Todo va adentro del armado
// (también @paila/core): en el instalador NAPIA vive en resources/napia, fuera de node_modules, y lo arranca el mismo motor
// de PAILA con --napia (ver apps/paila/electron/arranque.ts). El worker de análisis de PAILA va aparte (out/main/calidad-worker.js):
// revisa la calidad real de lo que baja (electron/calidad.ts).
import fs from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// la clave de AcoustID de fábrica (la misma de PAILA, claves.local.json, que no se sube): para confirmar que lo bajado es el
// tema pedido (electron/huellas.ts). Sin el archivo, NAPIA no pregunta a AcoustID.
const clavesPath = resolve('../../claves.local.json')
const acoustid = fs.existsSync(clavesPath) ? (JSON.parse(fs.readFileSync(clavesPath, 'utf8')) as { acoustid?: string }).acoustid : undefined

export default defineConfig({
  main: { define: { __NAPIA_ACOUSTID__: JSON.stringify(acoustid && !/^PEGAR/i.test(acoustid) ? acoustid : '') }, build: { lib: { entry: { main: resolve('electron/main.ts'), 'calidad-worker': resolve('../../packages/core/analysis/worker.ts') } } } },
  preload: { build: { lib: { entry: resolve('electron/preload.ts') } } },
  renderer: {
    root: 'ui',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('ui/index.html') } },
  },
})
