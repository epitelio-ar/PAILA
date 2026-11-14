// Antes de armar el instalador o la portable (npm run dist / pack): deja en su lugar lo que no va en git y el instalador
// lleva adentro. Si ya está, no toca nada; si falta, lo busca donde suele estar y lo copia; si no lo encuentra, corta y
// dice en una línea qué falta y cómo conseguirlo.
// - el sockseek con freno de NAPIA (apps/napia/recursos/sockseek/sockseek.exe; decidido el 21/10): de
//   PAILA_SOCKSEEK, de la carpeta principal del proyecto (si esta es una copia de trabajo de git), de lo que arma
//   `npm run sockseek:freno` o de PAILA instalada. Solo sirve el que dice "-napia" en su versión.
// - Beat This! (apps/paila/recursos/modelos, scripts/modelos-beat-this.mjs): de PAILA_MODELOS, de la carpeta principal o
//   de PAILA instalada, revisado con las huellas del modelo.
// - mpv para la salida "bit perfect" (apps/paila/recursos/mpv/mpv.exe, scripts/mpv-bajar.mjs): de PAILA_MPV, de la carpeta
//   principal o de PAILA instalada; si no está en ningún lado, `npm run mpv:bajar`.
// - ffprobe de gyan.dev 6.1.1, el mismo armado que ffmpeg (apps/paila/recursos/ffprobe/ffprobe.exe, scripts/ffprobe-bajar.mjs):
//   de PAILA_FFPROBE, de la carpeta principal o de PAILA instalada, revisado con su huella; si no, `npm run ffprobe:bajar`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESTINO as MODELOS, armar, problemas } from './modelos-beat-this.mjs'
import { DESTINO as MPV, esMpv } from './mpv-bajar.mjs'
import { DESTINO as FFPROBE, esFfprobe } from './ffprobe-bajar.mjs'

const raiz = path.resolve(import.meta.dirname, '..')
const SOCKSEEK = path.join(raiz, 'apps', 'napia', 'recursos', 'sockseek')
const LICENCIAS = ['AVISO.txt', 'LICENCIA-sockseek-AGPL-3.0.txt', 'LICENCIA-Soulseek.NET-GPL-3.0.txt', 'NOTICE-Soulseek.NET.txt', 'LICENSE']

/** La carpeta principal del proyecto, si esta es una copia de trabajo de git (las sesiones trabajan en copias). */
function principal() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: raiz, encoding: 'utf8', timeout: 10_000 })
  const dir = r.status === 0 ? path.dirname(r.stdout.trim()) : null
  return dir && path.resolve(dir) !== raiz ? dir : null
}
/** Donde instala PAILA el instalador (por usuario). */
const instalada = () => (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'PAILA', 'resources') : null)

/** Dónde buscar cada cosa, en orden. */
export function fuentes(env = process.env, main = principal(), inst = instalada()) {
  return {
    sockseek: [
      env.PAILA_SOCKSEEK && (env.PAILA_SOCKSEEK.toLowerCase().endsWith('.exe') ? env.PAILA_SOCKSEEK : path.join(env.PAILA_SOCKSEEK, 'sockseek.exe')),
      main && path.join(main, 'apps', 'napia', 'recursos', 'sockseek', 'sockseek.exe'),
      path.join(os.homedir(), 'sockseek-freno', 'publicado', 'sockseek.exe'),
      inst && path.join(inst, 'napia', 'recursos', 'sockseek', 'sockseek.exe'),
    ].filter(Boolean),
    modelos: [env.PAILA_MODELOS, main && path.join(main, 'apps', 'paila', 'recursos', 'modelos'), inst && path.join(inst, 'modelos')].filter(Boolean),
    mpv: [env.PAILA_MPV, main && path.join(main, 'apps', 'paila', 'recursos', 'mpv', 'mpv.exe'), inst && path.join(inst, 'mpv', 'mpv.exe')].filter(Boolean),
    ffprobe: [env.PAILA_FFPROBE, main && path.join(main, 'apps', 'paila', 'recursos', 'ffprobe', 'ffprobe.exe'), inst && path.join(inst, 'ffprobe', 'ffprobe.exe')].filter(Boolean),
  }
}

const version = (exe) => (spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout ?? '').trim()
/** ¿Es el sockseek con freno? (el común no frena las conexiones y a mucha gente le traba el router) */
export const conFreno = (exe, ver = version) => fs.existsSync(exe) && /-napia\b/.test(ver(exe))

/** Deja el sockseek con freno en su lugar. Devuelve qué hizo, o null si no lo encontró. */
export function prepararSockseek(candidatos, destino = SOCKSEEK, ver = version) {
  const faltanLicencias = LICENCIAS.filter((f) => !fs.existsSync(path.join(destino, f)))
  if (faltanLicencias.length) throw new Error(`Faltan los avisos de licencia del sockseek (${faltanLicencias.join(', ')}) en ${destino}: vienen con el repositorio (git checkout -- apps/napia/recursos).`)
  const exe = path.join(destino, 'sockseek.exe')
  if (fs.existsSync(exe)) return 'ya estaba'
  const origen = candidatos.find((c) => path.resolve(c) !== path.resolve(exe) && conFreno(c, ver))
  if (!origen) return null
  fs.copyFileSync(origen, exe)
  return `copiado de ${origen}`
}

/** Deja Beat This! en su lugar. Devuelve qué hizo, o null si no lo encontró. */
export async function prepararModelos(candidatos, destino = MODELOS, huellas = true) {
  if (!(await problemas(destino, false)).length) return 'ya estaba'
  for (const c of candidatos) {
    if (path.resolve(c) === path.resolve(destino) || !fs.existsSync(c) || (await problemas(c, huellas)).length) continue
    armar(c, destino)
    return `copiado de ${c}`
  }
  return null
}

/** Deja mpv en su lugar (con su aviso de licencia). Devuelve qué hizo, o null si no lo encontró. */
export function prepararMpv(candidatos, destino = MPV, anda = esMpv) {
  if (!fs.existsSync(path.join(destino, 'AVISO.txt'))) throw new Error(`Falta el aviso de licencia de mpv (AVISO.txt) en ${destino}: viene con el repositorio (git checkout -- apps/paila/recursos/mpv).`)
  const exe = path.join(destino, 'mpv.exe')
  if (anda(exe)) return 'ya estaba'
  const origen = candidatos.find((c) => path.resolve(c) !== path.resolve(exe) && anda(c))
  if (!origen) return null
  fs.copyFileSync(origen, exe)
  return `copiado de ${origen}`
}

/** Deja ffprobe en su lugar (el de gyan.dev 6.1.1, revisado con su huella). Devuelve qué hizo, o null si no lo encontró. */
export async function prepararFfprobe(candidatos, destino = FFPROBE, anda = esFfprobe) {
  const exe = path.join(destino, 'ffprobe.exe')
  if (await anda(exe)) return 'ya estaba'
  for (const c of candidatos) {
    if (path.resolve(c) === path.resolve(exe) || !(await anda(c))) continue
    fs.mkdirSync(destino, { recursive: true })
    fs.copyFileSync(c, exe)
    return `copiado de ${c}`
  }
  return null
}

/** Deja las cuatro cosas en su lugar. Devuelve lo que hizo y, si algo falta, una línea por cada cosa con cómo conseguirla. */
export async function preparar(f = fuentes(), destinos = { sockseek: SOCKSEEK, modelos: MODELOS, mpv: MPV, ffprobe: FFPROBE }, opts = {}) {
  const hechos = [], faltan = []
  const s = prepararSockseek(f.sockseek, destinos.sockseek, opts.ver)
  if (s) hechos.push(`sockseek con freno: ${s}.`)
  else faltan.push('Falta el sockseek con freno: armalo con "npm run sockseek:freno" (necesita el SDK de .NET 10) o decí dónde está con PAILA_SOCKSEEK=<sockseek.exe>.')
  const m = await prepararModelos(f.modelos, destinos.modelos, opts.huellas)
  if (m) hechos.push(`Beat This!: ${m}.`)
  else faltan.push('Falta Beat This!: "npm run modelos:armar -- --desde <carpeta de modelos>" o PAILA_MODELOS=<carpeta> (cómo se arma: docs/compartir.md, sección 2).')
  const v = prepararMpv(f.mpv ?? [], destinos.mpv ?? MPV, opts.mpv)
  if (v) hechos.push(`mpv: ${v}.`)
  else faltan.push('Falta mpv (para la salida "bit perfect"): bajalo con "npm run mpv:bajar" o decí dónde está con PAILA_MPV=<mpv.exe>.')
  const p = await prepararFfprobe(f.ffprobe ?? [], destinos.ffprobe ?? FFPROBE, opts.ffprobe)
  if (p) hechos.push(`ffprobe: ${p}.`)
  else faltan.push('Falta ffprobe (el de gyan.dev 6.1.1, para leer los archivos): bajalo con "npm run ffprobe:bajar" o decí dónde está con PAILA_FFPROBE=<ffprobe.exe>.')
  return { hechos, faltan }
}

async function main() {
  const { hechos, faltan } = await preparar()
  for (const h of hechos) console.log(h)
  if (faltan.length) { console.error(faltan.join('\n')); process.exit(1) }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main()
