// Deja el sockseek con freno de NAPIA en su lugar: apps/napia/recursos/sockseek/sockseek.exe (no va al repositorio: pesa
// ~116 MB). Ahí lo busca NAPIA en desarrollo, y en el programa instalado si algún día el instalador lo lleva (lo decide
// ver docs/DECISIONES.md). Ver apps/napia/sockseek-freno/LEEME.md.
// Uso: npm run sockseek:freno                  → lo arma (armar.ps1: necesita el SDK de .NET 10 y git) y lo copia
//      npm run sockseek:freno -- --desde <exe> → copia uno ya armado
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
const destino = path.join(raiz, 'apps', 'napia', 'recursos', 'sockseek', 'sockseek.exe')
const args = process.argv.slice(2)
let origen = args.includes('--desde') ? path.resolve(args[args.indexOf('--desde') + 1]) : null

if (!origen) {
  // una carpeta de ruta corta: con más de 260 caracteres el armado de .NET falla
  const trabajo = path.join(os.homedir(), 'sockseek-freno')
  const r = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(raiz, 'apps', 'napia', 'sockseek-freno', 'armar.ps1'), '-Trabajo', trabajo], { stdio: 'inherit' })
  if (r.status !== 0) { console.error('No se pudo armar el sockseek con freno (¿está el SDK de .NET 10? winget install Microsoft.DotNet.SDK.10)'); process.exit(1) }
  origen = path.join(trabajo, 'publicado', 'sockseek.exe')
}

const version = (exe) => (spawnSync(exe, ['--version'], { encoding: 'utf8' }).stdout ?? '').trim()
const v = version(origen)
if (!/-napia\b/.test(v)) { console.error(`${origen} no es el sockseek con freno (versión: ${v || 'desconocida'})`); process.exit(1) }
fs.mkdirSync(path.dirname(destino), { recursive: true })
fs.copyFileSync(origen, destino)
console.log(`Listo: ${destino} (${v})`)
