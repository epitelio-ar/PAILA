// Mandar muchos duplicados a la papelera con la app COMPILADA y medir si la ventana sigue respondiendo mientras mueve
// (antes, papelera, restaurar y la limpieza de Espacio movían todo de un tirón en el proceso principal: la ventana quedaba
// congelada). Arma una biblioteca de prueba con N tonos sintéticos y una copia idéntica de cada uno (nada de la Música),
// aprieta «Buscar duplicados» y «Mandar N archivos a la papelera» (scripts/conducir.ts), y mientras mueve la ventana le
// pregunta algo al proceso principal sin parar: si la respuesta más lenta tarda casi lo mismo que toda la tanda, se congeló.
// Después restaura la tanda (lo mismo que «Restaurar» en la Papelera o «Deshacer» en el Historial) y mide igual.
//
//   node scripts/run-ts.mjs scripts/papelera-app.ts --carpeta <carpeta de prueba> [--temas 300] [--capturas <carpeta>]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { DJ_TOOLS_OFFERED } from '@paila/shared/profile'
import { abrirApp, type App } from './conducir'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--carpeta'), capturas = arg('--capturas'), N = Number(arg('--temas', '300'))
if (!base || !/[\\/]papelera-app$/i.test(base) || !(N > 0)) { console.error('Uso: --carpeta <…/papelera-app> [--temas N] [--capturas <carpeta>]'); process.exit(2) }
if (fs.existsSync(base)) { console.error(`Ya existe ${base}: borrala a mano para empezar de nuevo`); process.exit(2) }
const M = path.join(base, 'M'), datos = path.join(base, 'datos')
const log = (...a: unknown[]) => console.log(...a)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const captura = async (app: App, nombre: string) => { if (capturas) await app.captura(path.join(capturas, `papelera-app-${nombre}.png`)) }
const cuantos = (d: string) => fs.existsSync(d) ? fs.readdirSync(d).length : 0

// 1) biblioteca de prueba: N temas distintos (frecuencia y tags propios) y una copia idéntica de cada uno en Copias/
const ffmpeg = findFfmpeg()!
fs.mkdirSync(path.join(M, 'Temas'), { recursive: true }); fs.mkdirSync(path.join(M, 'Copias'), { recursive: true })
for (let i = 0; i < N; i++) {
  const f = path.join(M, 'Temas', `Tema ${i + 1}.mp3`)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${200 + i * 7}:duration=2`, '-metadata', 'artist=Prueba', '-metadata', `title=Tema ${i + 1}`, f])
  fs.copyFileSync(f, path.join(M, 'Copias', `Tema ${i + 1}.mp3`))
}
fs.mkdirSync(datos, { recursive: true })
{
  const lib = new Library(path.join(datos, 'paila.db'), findFfprobe())
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  lib.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(DJ_TOOLS_OFFERED, new Date().toISOString())
  log(`Biblioteca de prueba: ${(lib.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n} archivos (${N} temas y ${N} copias idénticas)`)
  lib.close()
}

/** Mientras corre `accion`, la ventana le pregunta algo chico al proceso principal sin parar y anota cuánto tarda cada respuesta. */
const medir = async (app: App, accion: () => Promise<void>) => {
  await app.js(`(() => { window.__lat = []; window.__stop = false; (async () => {
    while (!window.__stop) { const t = performance.now(); await window.paila.trashBatches(); window.__lat.push(performance.now() - t); await new Promise((r) => setTimeout(r, 10)) }
  })(); return true })()`)
  const t0 = Date.now()
  await accion()
  const total = Date.now() - t0
  const lat = await app.js<number[]>('(window.__stop = true, window.__lat)')
  const max = Math.max(...lat), sorted = [...lat].sort((a, b) => a - b)
  return { total, preguntas: lat.length, max: Math.round(max), mediana: Math.round(sorted[Math.floor(sorted.length / 2)]) }
}

let app: App | null = null
try {
  app = await abrirApp(datos, { log: path.join(base, 'app.log') })
  await espera(1500)
  await app.clic('Duplicados', { dentroDe: 'nav, aside, .sidebar' }).catch(() => app!.clic('Duplicados'))
  await app.esperarTexto('El mismo tema repetido')
  await app.clic('Buscar duplicados')
  await app.esperarTexto(/Mandar [\d.]+ archivos/, 300_000)
  log(`Duplicados: ${(await app.texto()).match(/Mandar [\d.]+ archivos[^\n]*/)?.[0]}`)
  await captura(app, '1-duplicados')

  // 2) mandar a la papelera, midiendo (el tiempo incluye esperar a que el análisis de fondo suelte los temas)
  const mandados = /Se mandaron [\d.]+ archivos a la papelera[^\n]*/
  const ida = await medir(app, async () => {
    await app!.clic('Mandar ')
    await app!.esperarTexto(mandados, 300_000)
  })
  log(`Papelera: ${(await app.texto()).match(mandados)![0]}`)
  log(`  tardó ${ida.total} ms; la ventana preguntó ${ida.preguntas} veces; respuesta más lenta ${ida.max} ms, la del medio ${ida.mediana} ms`)
  log(`  en disco: Copias/ ${cuantos(path.join(M, 'Copias'))} + Temas/ ${cuantos(path.join(M, 'Temas'))} (quedó una de cada par)`)
  await captura(app, '2-mandados')

  // 3) restaurar la tanda (lo que hacen «Restaurar» en la Papelera y «Deshacer» en el Historial), midiendo igual
  const tanda = (await app.js<{ batchId: number }[]>('window.paila.trashBatches()'))[0].batchId
  let vuelta: { moved: number; failed: unknown[] } = { moved: 0, failed: [] }
  const rest = await medir(app, async () => { vuelta = await app!.js(`window.paila.restoreTrash(${tanda})`) })
  log(`Restaurar: volvieron ${vuelta.moved}, fallaron ${vuelta.failed.length}`)
  log(`  tardó ${rest.total} ms; la ventana preguntó ${rest.preguntas} veces; respuesta más lenta ${rest.max} ms, la del medio ${rest.mediana} ms`)
  log(`  en disco: Copias/ ${cuantos(path.join(M, 'Copias'))} + Temas/ ${cuantos(path.join(M, 'Temas'))}`)
  await app.cerrar(); app = null
} catch (e) {
  if (app) {
    log(`Consola de la ventana:\n  ${app.consola.slice(-30).join('\n  ')}`)
    await app.captura(path.join(base, 'error.png')).catch(() => { /* ya no está */ })
    app.matar()
  }
  throw e
}
