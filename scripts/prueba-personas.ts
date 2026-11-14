// Prueba con personas (docs/prueba-personas/): arma la carpeta de música de prueba, la vuelve al principio para la próxima persona
// y pone los accesos directos en el escritorio. Tu Música solo se lee; todo se escribe en la carpeta de la prueba.
//
//   npm run prueba -- armar      [--desde "D:/Música"] [--carpeta D:/PAILA-trabajo/prueba-personas] [--semilla 27] [--nueva]
//   npm run prueba -- reiniciar  [--persona "Ana"]     (Empezar de nuevo: música y base como al principio; los registros quedan)
//   npm run prueba -- acceso     [--exe <PAILA.exe>]   (escritorio: "PAILA · prueba" y "PAILA · empezar de nuevo")
//
// Carpeta: original/ (la música desordenada de referencia, no se toca) · Música/ (la que usa la persona) · Para la prueba/ (la
// lista de Spotify) · PENDRIVE/ (hace de pendrive) · datos/ (la base de PAILA en modo prueba) · registros/ (uno por vez que se abre)
// · napia-datos/ y Descargas NAPIA/ (NAPIA abierta desde la prueba: sus datos y lo que baja).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { rutaApp, rutaElectron } from './app-ruta.mjs'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { armarMusica, azar, elegirLista, leerTags, listaSpotify, listar, paraLista, trampasDe, type Hecho, type Tema } from './prueba-personas-armar'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const orden = process.argv[2]
const carpeta = path.resolve(arg('--carpeta', 'D:/PAILA-trabajo/prueba-personas'))
const original = path.join(carpeta, 'original')
const log = (s: string) => console.log(s)
const fin = (s: string): never => { console.error(s); process.exit(1) }

/** Vuelve la carpeta de la prueba al principio. Si la PAILA de prueba está abierta, no toca nada y avisa. */
function reiniciar(persona: string) {
  if (!fs.existsSync(path.join(original, 'Música'))) fin(`No está ${original}\\Música: primero "npm run prueba -- armar".`)
  const datos = path.join(carpeta, 'datos')
  if (fs.existsSync(datos)) {
    // con PAILA abierta la base está tomada y Windows no deja moverla: así se sabe sin tocar nada
    try { fs.renameSync(datos, datos + '-borrando') } catch { fin('La PAILA de prueba está abierta: cerrala y volvé a "Empezar de nuevo".') }
    fs.rmSync(datos + '-borrando', { recursive: true, force: true })
  }
  // NAPIA de la prueba (napia-datos y lo que bajó) también vuelve a cero: la próxima persona la ve como la primera vez
  try { for (const d of ['napia-datos', 'Descargas NAPIA']) fs.rmSync(path.join(carpeta, d), { recursive: true, force: true }) } catch { fin('NAPIA está abierta: cerrala y volvé a "Empezar de nuevo".') }
  for (const d of ['Música', 'PENDRIVE', 'Para la prueba']) fs.rmSync(path.join(carpeta, d), { recursive: true, force: true })
  log('Copiando la música de la prueba…')
  fs.cpSync(path.join(original, 'Música'), path.join(carpeta, 'Música'), { recursive: true, preserveTimestamps: true })
  fs.cpSync(path.join(original, 'Para la prueba'), path.join(carpeta, 'Para la prueba'), { recursive: true })
  fs.mkdirSync(path.join(carpeta, 'PENDRIVE'), { recursive: true })
  fs.mkdirSync(path.join(carpeta, 'registros'), { recursive: true })
  if (persona) fs.writeFileSync(path.join(carpeta, 'persona.txt'), persona + '\n')
  else fs.rmSync(path.join(carpeta, 'persona.txt'), { force: true })
  log(`Listo: todo como al principio${persona ? ` para ${persona}` : ''}. Los registros de antes siguen en ${path.join(carpeta, 'registros')}.`)
}

function armar() {
  const desde = path.resolve(arg('--desde', 'D:/Música'))
  const semilla = Number(arg('--semilla', '27'))
  const dentro = (a: string, b: string) => { const r = path.relative(b, a); return !r.startsWith('..') && !path.isAbsolute(r) }
  if (dentro(carpeta, desde) || dentro(desde, carpeta)) fin('La carpeta de la prueba no puede estar adentro de tu Música (ni al revés).')
  const ffmpeg = findFfmpeg(), ffprobe = findFfprobe()
  if (!ffmpeg || !ffprobe) fin('Falta ffmpeg o ffprobe del proyecto (npm install; npm run ffprobe:bajar).')
  const archivoSel = path.join(carpeta, 'seleccion.json')
  let sel: { semilla: number; desde: string; temas: Tema[]; faltan: Tema[] }
  if (fs.existsSync(archivoSel) && !process.argv.includes('--nueva')) {
    sel = JSON.parse(fs.readFileSync(archivoSel, 'utf8'))
    const perdidos = [...sel.temas, ...sel.faltan].filter((t) => !fs.existsSync(t.src))
    if (perdidos.length) fin(`${perdidos.length} temas de seleccion.json ya no están (por ejemplo ${perdidos[0].src}). Armá otra con --nueva.`)
    log(`Uso la elección guardada (${sel.temas.length} temas, semilla ${sel.semilla}).`)
  } else {
    log(`Leyendo ${desde} (solo lectura)…`)
    const todos = listar(desde)
    log(`  ${todos.length} temas candidatos.`)
    const { mezclar } = azar(semilla)
    const porCarpeta = new Map<string, typeof todos>()
    for (const t of todos) { const d = path.posix.dirname(t.rel); porCarpeta.set(d, [...(porCarpeta.get(d) ?? []), t]) }
    // unos 10 discos enteros (hasta 8 temas cada uno) y el resto sueltos de todos lados, hasta 270
    const discos = mezclar([...porCarpeta.entries()].filter(([, ts]) => ts.length >= 6)).slice(0, 10).flatMap(([, ts]) => ts.slice(0, 8))
    const elegidos = new Set(discos.map((t) => t.src))
    const resto = mezclar(todos.filter((t) => !elegidos.has(t.src)))
    const sueltos = resto.splice(0, Math.max(0, 270 - discos.length))
    log('Leyendo tags…')
    const conTags = (xs: typeof todos): Tema[] => xs.map((t) => ({ ...t, ...leerTags(ffprobe!, t.src) }))
    const temas = conTags([...discos, ...sueltos])
    const faltan: Tema[] = []
    for (const t of resto) { if (faltan.length >= 14) break; const x = conTags([t])[0]; if (paraLista(x) && !temas.some((y) => y.artist === x.artist && y.title === x.title)) faltan.push(x) }
    sel = { semilla, desde, temas, faltan }
    fs.mkdirSync(carpeta, { recursive: true })
    fs.writeFileSync(archivoSel, JSON.stringify(sel, null, 1))
  }
  fs.rmSync(original, { recursive: true, force: true })
  log(`Copiando y desordenando en ${original}…`)
  const hechos = armarMusica({ desde: sel.desde, destino: path.join(original, 'Música'), temas: sel.temas, semilla: sel.semilla, ffmpeg: ffmpeg!, aviso: log })
  const { tiene, faltan } = elegirLista(hechos, sel.temas, sel.faltan, sel.semilla)
  fs.mkdirSync(path.join(original, 'Para la prueba'), { recursive: true })
  fs.writeFileSync(path.join(original, 'Para la prueba', 'Para el viaje.csv'), listaSpotify(tiene, faltan, sel.semilla))
  fs.writeFileSync(path.join(carpeta, 'LEEME.txt'), leeme(sel.desde, sel.semilla, hechos, tiene, faltan), 'utf8')
  fs.writeFileSync(path.join(carpeta, 'trampas.json'), JSON.stringify(trampasDe(hechos), null, 1))
  reiniciar('')
  log(`Listo: ${hechos.length} archivos. Qué se desordenó: ${path.join(carpeta, 'LEEME.txt')}`)
}

function leeme(desde: string, semilla: number, hechos: Hecho[], tiene: Tema[], faltan: Tema[]) {
  const cuenta = new Map<string, number>()
  for (const h of hechos) { const k = h.que.replace(/ de .*?:/, ':'); cuenta.set(k, (cuenta.get(k) ?? 0) + 1) }
  return [
    'PRUEBA CON PERSONAS: la música de prueba', '',
    `Armada el ${new Date().toLocaleString('es-AR')} con "npm run prueba -- armar" (semilla ${semilla}), copiando de ${desde}.`,
    'Los originales no se tocaron: todo lo de abajo se hizo sobre las copias. "Empezar de nuevo" vuelve Música/ a como está en original/Música.', '',
    'RESUMEN', ...[...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`), '',
    `LISTA DE SPOTIFY (Para la prueba/Para el viaje.csv, ${tiene.length + faltan.length} temas)`,
    `  Están en la Música de la prueba (${tiene.length}):`, ...tiene.map((t) => `    ${t.artist} - ${t.title}`),
    `  Faltan (${faltan.length}):`, ...faltan.map((t) => `    ${t.artist} - ${t.title}`), '',
    'ARCHIVO POR ARCHIVO (en Música/  <-  de dónde salió: qué se le hizo)', ...hechos.map((h) => `  ${h.dst}\n      <- ${h.src}: ${h.que}`), '',
  ].join('\r\n')
}

/** El escritorio de esta PC (puede estar en OneDrive). */
const escritorio = () => { try { return execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim() } catch { return path.join(process.env.USERPROFILE ?? '', 'Desktop') } }

function acceso() {
  const exe = arg('--exe')
  // sin --exe: la PAILA armada de este repositorio (rutaApp falla si falta `npm run build`)
  const app = rutaApp(), repo = path.resolve(app, '..', '..')
  const abrir = exe ? `start "" "${path.resolve(exe)}"` : `start "" "${rutaElectron()}" "${app}"`
  const esc = escritorio()
  const cmd = (lineas: string[]) => ['@echo off', 'chcp 65001 >nul', ...lineas].join('\r\n') + '\r\n'
  fs.writeFileSync(path.join(esc, 'PAILA · prueba.cmd'), cmd([`set "PAILA_PRUEBA=${carpeta}"`, abrir]))
  fs.writeFileSync(path.join(esc, 'PAILA · empezar de nuevo.cmd'), cmd([
    'echo Empezar de nuevo: la musica y PAILA vuelven a como estaban al principio (los registros quedan).',
    'set /p "PERSONA=Nombre de la proxima persona (o Enter): "',
    `cd /d "${repo}"`, `node scripts\\run-ts.mjs scripts\\prueba-personas.ts reiniciar --carpeta "${carpeta}" --persona "%PERSONA%"`, 'pause',
  ]))
  log(`En ${esc}: "PAILA · prueba.cmd" (abre ${exe ? path.resolve(exe) : `la PAILA armada de ${repo}`}) y "PAILA · empezar de nuevo.cmd".`)
}

if (orden === 'armar') armar()
else if (orden === 'reiniciar') reiniciar(arg('--persona').trim())
else if (orden === 'acceso') acceso()
else fin('Uso: npm run prueba -- armar | reiniciar [--persona "Ana"] | acceso [--exe <PAILA.exe>]')
