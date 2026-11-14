import fs from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Claves de aplicación de PAILA (Discogs, AcoustID y, opcional, Last.fm) para el instalador: se leen de claves.local.json (en la raíz del
// repositorio), que no se sube (.gitignore). Sin ese archivo PAILA anda igual: cada uno pega sus claves en Configuración.
// Formato: { "discogsKey": "…", "discogsSecret": "…", "acoustid": "…", "lastfm": "…" }
const clavesPath = resolve('../../claves.local.json')
// Los valores vacíos o que siguen diciendo "PEGAR ACÁ…" (la plantilla) no cuentan como clave.
const leidas: Record<string, unknown> = fs.existsSync(clavesPath) ? JSON.parse(fs.readFileSync(clavesPath, 'utf8')) : {}
const claves = Object.fromEntries(Object.entries(leidas).filter(([, v]) => typeof v === 'string' && v.trim() && !/^PEGAR/i.test(v.trim())))

export default defineConfig({
  main: {
    // Los paquetes de la familia (@paila/…) van como devDependencies: se meten adentro del armado, no se buscan en node_modules.
    plugins: [externalizeDepsPlugin()],
    define: { __PAILA_CLAVES__: JSON.stringify(claves) },
    // El worker de análisis, el hilo de la tabla grande y el de la vista previa de Traer una lista van en archivos aparte
    // (out/main/analysis-worker.js, table-worker.js, request-worker.js y archive-worker.js, el que descomprime ZIP y RAR).
    // El programa arranca por arranque.js: abre PAILA (main.js) o, con --napia, NAPIA (ver electron/arranque.ts).
    build: { lib: { entry: { arranque: resolve('electron/arranque.ts'), main: resolve('electron/main.ts'), 'analysis-worker': resolve('../../packages/core/analysis/worker.ts'), 'table-worker': resolve('../../packages/core/tableworker.ts'), 'grid-worker': resolve('../../packages/core/analysis/gridworker.ts'), 'request-worker': resolve('../../packages/core/requestworker.ts'), 'archive-worker': resolve('../../packages/core/archive/worker.ts'), 'tidy-worker': resolve('../../packages/core/tidyworker.ts'), 'stems-worker': resolve('../../packages/core/stems/worker.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve('electron/preload.ts') } },
  },
  renderer: {
    root: 'ui',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('ui/index.html') } },
  },
})
