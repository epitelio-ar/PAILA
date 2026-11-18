// Arma PAILA para Mac: un .dmg para Apple Silicon (arm64) y otro para Intel (x64), sin la firma de Apple (firma "ad hoc", la
// mínima para que una Mac con Apple Silicon lo deje correr; la de Apple se decide más adelante). Solo corre en una Mac: lo usa GitHub
// (.github/workflows/mac.yml). Antes de cada procesador deja en su lugar lo que es propio de él: ffmpeg (ffmpeg-static baja
// uno solo, el de la Mac que arma), mpv (scripts/mpv-mac.mjs) y el sockseek con freno (apps/napia/sockseek-freno/armar.sh,
// en apps/napia/recursos/sockseek-mac/<arch>). Beat This! es el mismo para los dos (npm run modelos:armar).
// Uso: npm run dist:mac   o   node scripts/armar-mac.mjs [--arch arm64,x64] [--dir]   (--dir: solo la .app, sin .dmg)
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESTINO as MODELOS, problemas } from './modelos-beat-this.mjs'
import { MPV_MAC, prepararMpvMac } from './mpv-mac.mjs'

const raiz = path.resolve(import.meta.dirname, '..')
const app = path.join(raiz, 'apps', 'paila')
const require = createRequire(path.join(app, 'package.json'))
export const ARCHS = ['arm64', 'x64']
/** Cómo llama `lipo` a cada procesador. */
const LIPO = { arm64: 'arm64', x64: 'x86_64' }
export const sockseekMac = (arch) => path.join(raiz, 'apps', 'napia', 'recursos', 'sockseek-mac', arch, 'sockseek')

const lipo = (f) => (spawnSync('lipo', ['-archs', f], { encoding: 'utf8', timeout: 30_000 }).stdout ?? '').split(/\s+/).filter(Boolean)

/** Lo que falta para armar ese procesador (vacío = todo listo). */
export function faltan(arch, existe = fs.existsSync) {
  const mal = []
  if (!existe(path.join(raiz, 'apps', 'napia', 'out', 'main', 'main.js'))) mal.push('NAPIA no está armada (npm run build)')
  if (!existe(path.join(app, 'out', 'main', 'main.js'))) mal.push('PAILA no está armada (npm run build)')
  if (!existe(sockseekMac(arch))) mal.push(`falta el sockseek con freno para ${arch}: bash apps/napia/sockseek-freno/armar.sh osx-${arch} apps/napia/recursos/sockseek-mac/${arch}`)
  return mal
}

/** Pone en node_modules/ffmpeg-static el ffmpeg de ese procesador (el paquete baja uno solo: el de la Mac que arma). */
function ffmpegPara(arch) {
  const dir = path.dirname(require.resolve('ffmpeg-static/package.json'))
  const bin = path.join(dir, 'ffmpeg')
  if (fs.existsSync(bin) && lipo(bin).includes(LIPO[arch])) return
  for (const f of [bin, `${bin}.README`, `${bin}.LICENSE`]) fs.rmSync(f, { force: true })
  const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { cwd: dir, stdio: 'inherit', timeout: 600_000, env: { ...process.env, npm_config_platform: 'darwin', npm_config_arch: arch } })
  if (r.status !== 0 || !lipo(bin).includes(LIPO[arch])) throw new Error(`No se pudo bajar el ffmpeg de Mac para ${arch}`)
}

/**
 * La lista de archivos de la app para Mac: la de `build.files` (pensada para Windows: deja afuera todos los de ffprobe-static,
 * porque Windows usa el de gyan.dev de recursos/ffprobe) con los de Windows afuera y solo el de Mac de este procesador (el
 * otro son ~70 MB). Va entera y reemplaza a la de arriba: una lista de solo exclusiones en `build.mac.files` haría que
 * electron-builder copie la carpeta entera. Ojo: pasada como objeto en `build({ config })`, electron-builder la SUMA a la de
 * package.json (une las listas) y la exclusión de Windows `!…/bin/darwin/**` seguía valiendo: las .dmg de la 1.0.0 y la 1.0.1
 * salieron sin ffprobe. Por eso va en un archivo de configuración entero (configMac), que reemplaza al "build" de package.json.
 */
export function archivosMac(files, arch) {
  const otro = ARCHS.find((a) => a !== arch)
  const afuera = ['!node_modules/ffprobe-static/bin/darwin/**', '!node_modules/ffprobe-static/bin/win32/**']
  return [...files.filter((f) => !afuera.includes(f)), '!node_modules/ffprobe-static/bin/win32/**', `!node_modules/ffprobe-static/bin/darwin/${otro}/**`]
}

/** La configuración entera de electron-builder para ese procesador: el "build" de package.json con la lista de archivos de Mac. */
export function configMac(build, arch) {
  return { ...build, files: archivosMac(build.files, arch) }
}

/** Escribe configMac en un archivo y devuelve su ruta: electron-builder lo lee EN LUGAR del "build" de package.json. */
export function archivoConfigMac(arch, dir = os.tmpdir()) {
  const build = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).build
  const f = path.join(dir, `paila-electron-builder-mac-${arch}.json`)
  fs.writeFileSync(f, JSON.stringify(configMac(build, arch), null, 2))
  return f
}

async function armar(arch, soloApp) {
  const { build, Platform, Arch } = require('electron-builder')
  const config = archivoConfigMac(arch)
  const hechos = await build({ projectDir: app, targets: Platform.MAC.createTarget(soloApp ? ['dir'] : ['dmg'], Arch[arch]), config, publish: 'never' })
  for (const dmg of hechos.filter((f) => f.endsWith('.dmg'))) comprimir(dmg)
}

/**
 * El .dmg de electron-builder viene con una compresión floja (zlib o lzfse): pesaba más del doble que el instalador de
 * Windows, que va con LZMA. Se pasa a LZMA (formato ULMO, que la Mac abre desde macOS 10.15; PAILA pide 12). El .blockmap
 * (para actualizar de a pedazos) ya no sirve: en Mac PAILA no se actualiza sola.
 */
export function comprimir(dmg, run = spawnSync) {
  const tmp = dmg.replace(/\.dmg$/, '-lzma.dmg')
  fs.rmSync(tmp, { force: true })
  const r = run('hdiutil', ['convert', dmg, '-format', 'ULMO', '-o', tmp], { encoding: 'utf8', stdio: 'inherit', timeout: 1_800_000 })
  if (r.status !== 0) throw new Error(`No se pudo comprimir ${path.basename(dmg)} con LZMA`)
  fs.renameSync(tmp, dmg)
  fs.rmSync(`${dmg}.blockmap`, { force: true })
}

async function main() {
  if (process.platform !== 'darwin') { console.error('El armado para Mac corre en una Mac (lo hace GitHub: .github/workflows/mac.yml).'); process.exit(1) }
  const args = process.argv.slice(2)
  const archs = args.includes('--arch') ? args[args.indexOf('--arch') + 1].split(',') : ARCHS
  const soloApp = args.includes('--dir')
  const sinModelo = await problemas(MODELOS, false)
  if (sinModelo.length) throw new Error(`Falta Beat This! (npm run modelos:armar -- --bajar):\n- ${sinModelo.join('\n- ')}`)
  try {
    for (const arch of archs) {
      if (!MPV_MAC[arch]) throw new Error(`Procesador desconocido: ${arch} (arm64 o x64)`)
      const mal = faltan(arch)
      if (mal.length) throw new Error(`No se puede armar para ${arch}:\n- ${mal.join('\n- ')}`)
      console.log(`mpv para Mac (${arch}): ${await prepararMpvMac(arch)}.`)
      ffmpegPara(arch)
      await armar(arch, soloApp)
    }
  } finally {
    // node_modules vuelve a tener el ffmpeg de esta Mac (el que usan los tests)
    try { ffmpegPara(os.arch() === 'arm64' ? 'arm64' : 'x64') } catch (e) { console.error(e.message) }
  }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main().catch((e) => { console.error(e.message); process.exit(1) })
