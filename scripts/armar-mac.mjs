// Arma PAILA para Mac: un .dmg para Apple Silicon (arm64) y otro para Intel (x64), sin la firma de Apple (firma "ad hoc", la
// mínima para que una Mac con Apple Silicon lo deje correr; la de Apple se decide más adelante). Solo corre en una Mac: lo usa GitHub
// (.github/workflows/mac.yml). Antes de cada procesador deja en su lugar lo que es propio de él: ffmpeg (ffmpeg-static baja
// uno solo, el de la Mac que arma), ffprobe (el del mismo armado que ese ffmpeg, revisado con su huella), mpv (scripts/mpv-mac.mjs) y el sockseek con freno (apps/napia/sockseek-freno/armar.sh,
// en apps/napia/recursos/sockseek-mac/<arch>). Beat This! es el mismo para los dos (npm run modelos:armar).
// Uso: npm run dist:mac   o   node scripts/armar-mac.mjs [--arch arm64,x64] [--dir]   (--dir: solo la .app, sin .dmg)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
 * ffprobe de Mac: el del mismo armado que el ffmpeg de Mac (la versión b6.1.1 de ffmpeg-static trae los dos juntos), fijado
 * por su huella. El de ffprobe-static no sirve: el de "Apple Silicon" es en realidad de Intel (en una Mac M1–M4 solo anda con
 * Rosetta; lo encontró la prueba del armado el 19/11) y el de Intel es un 4.0.2 de 2018 armado por Zeranoe, que ya no existe.
 * Va en el mismo lugar (node_modules/ffprobe-static/bin/darwin/<arch>), donde PAILA lo busca (packages/core/probe.ts).
 */
export const FFPROBE_MAC = {
  tag: 'b6.1.1',
  arm64: { version: '6.0', sha256: 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64' },
  x64: { version: '6.1.1', sha256: 'fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0' },
}
export const urlFfprobeMac = (arch) => `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFPROBE_MAC.tag}/ffprobe-darwin-${arch}`
const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')
/** ¿Es ese archivo el ffprobe de Mac esperado para ese procesador? (por su huella) */
export const esFfprobeMac = (f, arch) => fs.existsSync(f) && sha256(f) === FFPROBE_MAC[arch]?.sha256

/** Pone en node_modules/ffprobe-static el ffprobe de Mac de ese procesador (FFPROBE_MAC), revisado con su huella. */
async function ffprobePara(arch) {
  const dir = path.join(path.dirname(require.resolve('ffprobe-static/package.json')), 'bin', 'darwin', arch)
  const bin = path.join(dir, 'ffprobe')
  if (!esFfprobeMac(bin, arch)) {
    const r = await fetch(urlFfprobeMac(arch), { redirect: 'follow' })
    if (!r.ok) throw new Error(`No se pudo bajar el ffprobe de Mac para ${arch} (${r.status})`)
    const tmp = `${bin}.bajando`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()))
    if (!esFfprobeMac(tmp, arch)) { fs.rmSync(tmp, { force: true }); throw new Error(`El ffprobe de Mac para ${arch} no es el esperado (huella distinta): no se usa.`) }
    fs.renameSync(tmp, bin)
  }
  fs.chmodSync(bin, 0o755)
  if (!lipo(bin).includes(LIPO[arch])) throw new Error(`El ffprobe de Mac para ${arch} no es de ese procesador: ${lipo(bin).join(' ')}`)
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
      await ffprobePara(arch)
      await armar(arch, soloApp)
    }
  } finally {
    // node_modules vuelve a tener el ffmpeg de esta Mac (el que usan los tests)
    try { ffmpegPara(os.arch() === 'arm64' ? 'arm64' : 'x64') } catch (e) { console.error(e.message) }
  }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main().catch((e) => { console.error(e.message); process.exit(1) })
