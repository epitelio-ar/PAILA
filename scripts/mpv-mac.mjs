// mpv para la salida "bit perfect" en Mac (core/mpv.ts: CoreAudio exclusivo). Es el armado oficial de mpv para macOS
// (https://github.com/mpv-player/mpv/releases, versión fija y revisada con su huella), uno por procesador: Apple Silicon
// (pide macOS 14 o más nuevo) e Intel (macOS 15 o más nuevo). Queda en apps/paila/recursos/mpv-mac/<arm64|x64>/mpv.app (no
// va a git); el armado para Mac lo lleva a resources/mpv. Solo corre en una Mac (usa `ditto` para abrir el .zip sin romper
// los atajos de adentro de mpv.app). Licencia: GPL (mpv GPL-2.0 o posterior); el aviso está en apps/paila/recursos/mpv/AVISO.txt.
// Uso: node scripts/mpv-mac.mjs [arm64|x64 …]   (sin nada: los dos)
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
export const DESTINO_MAC = path.join(raiz, 'apps', 'paila', 'recursos', 'mpv-mac')
export const MPV_MAC = {
  tag: 'v0.41.0',
  arm64: { archivo: 'mpv-v0.41.0-macos-14-arm.zip', sha256: '5c96f9b21355fc0a11d2e2161ad65f33031070e9fb3f6bd9865fb459b94587e6', lipo: 'arm64' },
  x64: { archivo: 'mpv-v0.41.0-macos-15-intel.zip', sha256: '41003617ab4f7784394b5ddea7ce51b3e0838e8cfc8166ad1a378b2eda3b583c', lipo: 'x86_64' },
}
/** Dónde queda el programa adentro de mpv.app. */
export const mpvMacExe = (arch, base = DESTINO_MAC) => path.join(base, arch, 'mpv.app', 'Contents', 'MacOS', 'mpv')

const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

/** La primera mpv.app que aparece adentro de una carpeta (el .zip puede traerla suelta o dentro de otra carpeta). */
export function buscarApp(dir, hondo = 3) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const p = path.join(dir, e.name)
    if (e.name === 'mpv.app') return p
    const r = hondo > 0 ? buscarApp(p, hondo - 1) : null
    if (r) return r
  }
  return null
}

/** ¿El mpv de esa carpeta es del procesador pedido? (lipo -archs) */
const esDe = (exe, lipo) => (spawnSync('lipo', ['-archs', exe], { encoding: 'utf8', timeout: 30_000 }).stdout ?? '').split(/\s+/).includes(lipo)

/** Deja mpv.app de ese procesador en su lugar. Devuelve qué hizo. */
export async function prepararMpvMac(arch, base = DESTINO_MAC) {
  const quiere = MPV_MAC[arch]
  if (!quiere) throw new Error(`Procesador desconocido: ${arch} (arm64 o x64)`)
  const exe = mpvMacExe(arch, base)
  if (fs.existsSync(exe) && esDe(exe, quiere.lipo)) return 'ya estaba'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mpv-mac-'))
  try {
    const zip = path.join(tmp, quiere.archivo)
    const r = await fetch(`https://github.com/mpv-player/mpv/releases/download/${MPV_MAC.tag}/${quiere.archivo}`, { redirect: 'follow' })
    if (!r.ok) throw new Error(`No se pudo bajar ${quiere.archivo} (${r.status})`)
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()))
    const h = sha(zip)
    if (h !== quiere.sha256) throw new Error(`La huella de ${quiere.archivo} no coincide (${h}): no se usa.`)
    const abierto = path.join(tmp, 'abierto')
    const d = spawnSync('ditto', ['-x', '-k', zip, abierto], { encoding: 'utf8', timeout: 300_000 })
    if (d.status !== 0) throw new Error(`No se pudo abrir ${quiere.archivo}: ${(d.stderr ?? '').trim()}`)
    // el .zip de mpv trae mpv.tar.gz (así guarda los permisos y los atajos de adentro): se abre también
    for (const t of fs.readdirSync(abierto).filter((f) => f.endsWith('.tar.gz'))) {
      const x = spawnSync('tar', ['-xzf', path.join(abierto, t), '-C', abierto], { encoding: 'utf8', timeout: 300_000 })
      if (x.status !== 0) throw new Error(`No se pudo abrir ${t}: ${(x.stderr ?? '').trim()}`)
    }
    const app = buscarApp(abierto)
    if (!app) throw new Error(`${quiere.archivo} no trae mpv.app`)
    if (!esDe(path.join(app, 'Contents', 'MacOS', 'mpv'), quiere.lipo)) throw new Error(`El mpv de ${quiere.archivo} no es para ${arch}`)
    fs.rmSync(path.join(base, arch), { recursive: true, force: true })
    fs.mkdirSync(path.join(base, arch), { recursive: true })
    const c = spawnSync('ditto', [app, path.join(base, arch, 'mpv.app')], { encoding: 'utf8', timeout: 300_000 })
    if (c.status !== 0) throw new Error(`No se pudo copiar mpv.app: ${(c.stderr ?? '').trim()}`)
    return `bajado (${quiere.archivo})`
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

async function main() {
  if (process.platform !== 'darwin') { console.error('mpv para Mac se prepara en una Mac (lo hace GitHub: .github/workflows/mac.yml).'); process.exit(1) }
  const archs = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  for (const arch of archs.length ? archs : ['arm64', 'x64']) console.log(`mpv para Mac (${arch}): ${await prepararMpvMac(arch)}.`)
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main().catch((e) => { console.error(e.message); process.exit(1) })
