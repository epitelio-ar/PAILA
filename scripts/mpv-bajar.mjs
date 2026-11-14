// Baja mpv para la salida "bit perfect" (MASTERPLAN-3, punto 4) y lo deja en apps/paila/recursos/mpv/mpv.exe (no va a git,
// ~120 MB; en el instalador viaja comprimido, ~34 MB). Es el armado para Windows de shinchiro, el que recomienda mpv.io
// (https://github.com/shinchiro/mpv-winbuild-cmake): versión fija y revisada con su huella. shinchiro guarda unos 30 días
// de versiones; si esta ya no está, `npm run mpv:bajar -- --ultima` baja la última y muestra la huella para fijarla acá.
// Licencia: GPL (mpv GPL-2.0 o posterior, con ffmpeg armado --enable-gpl --enable-version3, sin partes no libres): se puede
// repartir con PAILA (AGPL-3.0) diciendo dónde está el código fuente (apps/paila/recursos/mpv/AVISO.txt).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
export const DESTINO = path.join(raiz, 'apps', 'paila', 'recursos', 'mpv')
export const MPV = {
  tag: '20261111',
  archivo: 'mpv-x86_64-20261111-git-bcde6b93cc.7z',
  sha256: 'f259b5fd4b5c395617c948a4fadcdf55bba1c5282fb7c13e88626b3f71072baf',
  commit: 'bcde6b93c',
}
const REPO = 'shinchiro/mpv-winbuild-cmake'

/** ¿Es un mpv que anda? (contesta su versión) */
export function esMpv(exe, run = (e) => spawnSync(e, ['--no-config', '--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout ?? '') {
  return fs.existsSync(exe) && /^mpv v?\d/m.test(run(exe))
}

const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

async function bajar(url, dest) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`No se pudo bajar ${url} (${r.status}). Si esa versión ya no está, probá con --ultima.`)
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

/** La última versión publicada: su etiqueta y el .7z común (x86_64, sin "-v3", que necesita procesadores nuevos). */
async function ultima() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`No se pudo leer la última versión (${r.status})`)
  const j = await r.json()
  const a = j.assets.find((x) => /^mpv-x86_64-\d+-git-[0-9a-f]+\.7z$/.test(x.name))
  if (!a) throw new Error('La última versión no trae el mpv común para Windows')
  return { tag: j.tag_name, archivo: a.name, sha256: null, commit: a.name.match(/git-([0-9a-f]+)/)[1].slice(0, 9) }
}

/** El 7-Zip que trae electron-builder (Windows no abre .7z solo). */
async function sieteZip() {
  const { getPath7za } = await import('app-builder-lib/out/toolsets/7zip.js')
  return getPath7za()
}

async function main() {
  const quiere = process.argv.includes('--ultima') ? await ultima() : MPV
  const exe = path.join(DESTINO, 'mpv.exe')
  if (esMpv(exe) && !process.argv.includes('--ultima')) { console.log(`mpv ya estaba en ${exe}.`); return }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mpv-'))
  try {
    const arch = path.join(tmp, quiere.archivo)
    console.log(`Bajando ${quiere.archivo} (~34 MB)…`)
    await bajar(`https://github.com/${REPO}/releases/download/${quiere.tag}/${quiere.archivo}`, arch)
    const h = sha(arch)
    if (quiere.sha256 && h !== quiere.sha256) throw new Error(`La huella no coincide (${h}): no se usa.`)
    const r = spawnSync(await sieteZip(), ['x', '-y', `-o${tmp}`, arch, 'mpv.exe'], { encoding: 'utf8', timeout: 300_000, windowsHide: true })
    if (r.status !== 0) throw new Error(`No se pudo abrir el .7z: ${(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop()}`)
    if (!esMpv(path.join(tmp, 'mpv.exe'))) throw new Error('El mpv bajado no arranca')
    fs.mkdirSync(DESTINO, { recursive: true })
    fs.copyFileSync(path.join(tmp, 'mpv.exe'), exe)
    console.log(`Listo: ${exe}.`)
    if (!quiere.sha256) console.log(`Para fijar esta versión en scripts/mpv-bajar.mjs: tag '${quiere.tag}', archivo '${quiere.archivo}', sha256 '${h}', commit '${quiere.commit}' (y actualizá el AVISO.txt).`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main().catch((e) => { console.error(e.message); process.exit(1) })
