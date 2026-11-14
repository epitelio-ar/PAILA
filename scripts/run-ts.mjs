// Corre un script TypeScript que usa el núcleo de PAILA (packages/core), sin Electron: lo arma con esbuild y lo ejecuta con Node.
// Uso: node scripts/run-ts.mjs <script.ts> [argumentos…]
// El archivo armado va a node_modules/.cache/paila-run/ para que las dependencias se encuentren como siempre; los paquetes
// de la familia (@paila/core, @paila/shared) van adentro (scripts/externos.mjs).
import { build } from 'esbuild'
import { externos } from './externos.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [entry, ...args] = process.argv.slice(2)
if (!entry) { console.error('Uso: node scripts/run-ts.mjs <script.ts> [argumentos…]'); process.exit(2) }
const dir = path.resolve('node_modules/.cache/paila-run')
fs.mkdirSync(dir, { recursive: true })
const out = path.join(dir, `${path.basename(entry, path.extname(entry))}-${process.pid}.mjs`)
try {
  await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', plugins: [externos] })
  const r = spawnSync(process.execPath, ['--no-warnings', out, ...args], { stdio: 'inherit' })
  process.exitCode = r.status ?? 1
} finally {
  fs.rmSync(out, { force: true })
}
