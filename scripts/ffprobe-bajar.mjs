// Deja ffprobe.exe en apps/paila/recursos/ffprobe (no va a git, ~83 MB; el instalador lo lleva a resources\ffprobe). Es el del
// mismo armado que el ffmpeg.exe que trae ffmpeg-static: gyan.dev 6.1.1 "essentials" (el .7z de ese armado trae un ffmpeg.exe
// idéntico byte a byte al de ffmpeg-static). Reemplaza al ffprobe 4.0.2 de ffprobe-static (Zeranoe, 2018) en Windows
// (decidido el 24/10); en Mac sigue el de ffprobe-static por ahora. Licencia GPL-3.0: el código fuente va con cada versión
// (scripts/fuentes-gpl.mjs). Versión fija, revisada con la huella del .7z y la del programa.
// Uso: npm run ffprobe:bajar   (si es una copia de trabajo de git y la carpeta principal ya lo tiene, lo copia de ahí)
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
export const DESTINO = path.join(raiz, 'apps', 'paila', 'recursos', 'ffprobe')
export const FFPROBE = {
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/6.1.1/ffmpeg-6.1.1-essentials_build.7z',
  sha256: '9e1ddfab8eb16c30690eb769fab1301380139dd00026c8da5c667c7aad7e5cc9',
  adentro: 'ffmpeg-6.1.1-essentials_build/bin/ffprobe.exe',
  exe: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
}

const sha = (f) => new Promise((ok, mal) => {
  const h = createHash('sha256')
  fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', mal)
})
/** ¿Es este el ffprobe de gyan.dev 6.1.1? (por su huella: así se revisa en cada armado) */
export const esFfprobe = async (exe) => fs.existsSync(exe) && (await sha(exe)) === FFPROBE.exe

/** La carpeta principal del proyecto, si esta es una copia de trabajo de git (las sesiones trabajan en copias). */
function principal() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: raiz, encoding: 'utf8', timeout: 10_000 })
  const dir = r.status === 0 ? path.dirname(r.stdout.trim()) : null
  return dir && path.resolve(dir) !== raiz ? dir : null
}

async function main() {
  const exe = path.join(DESTINO, 'ffprobe.exe')
  if (await esFfprobe(exe)) { console.log(`ffprobe ya estaba en ${exe}.`); return }
  fs.mkdirSync(DESTINO, { recursive: true })
  const main = principal()
  const deAhi = main && path.join(main, 'apps', 'paila', 'recursos', 'ffprobe', 'ffprobe.exe')
  if (deAhi && (await esFfprobe(deAhi))) { fs.copyFileSync(deAhi, exe); console.log(`Listo: ${exe} (copiado de ${deAhi}).`); return }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-ffprobe-'))
  try {
    const arch = path.join(tmp, path.basename(FFPROBE.url))
    console.log(`Bajando ${path.basename(FFPROBE.url)} (~27 MB)…`)
    const r = await fetch(FFPROBE.url, { redirect: 'follow' })
    if (!r.ok) throw new Error(`No se pudo bajar ${FFPROBE.url} (${r.status})`)
    fs.writeFileSync(arch, Buffer.from(await r.arrayBuffer()))
    const h = await sha(arch)
    if (h !== FFPROBE.sha256) throw new Error(`La huella del .7z no coincide (${h}): no se usa.`)
    // el 7-Zip que trae electron-builder (Windows no abre .7z solo)
    const { getPath7za } = await import('app-builder-lib/out/toolsets/7zip.js')
    const x = spawnSync(await getPath7za(), ['e', '-y', `-o${tmp}`, arch, FFPROBE.adentro], { encoding: 'utf8', timeout: 300_000, windowsHide: true })
    if (x.status !== 0) throw new Error(`No se pudo abrir el .7z: ${(x.stderr || x.stdout || '').trim().split(/\r?\n/).pop()}`)
    if (!(await esFfprobe(path.join(tmp, 'ffprobe.exe')))) throw new Error('El ffprobe.exe del .7z no es el esperado (huella distinta): no se usa.')
    fs.copyFileSync(path.join(tmp, 'ffprobe.exe'), exe)
    console.log(`Listo: ${exe}.`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main().catch((e) => { console.error(e.message); process.exit(1) })
