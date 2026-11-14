// Prueba con la app del "disco que vuelve" (masterplan 4, 4A.3): si el disco se desenchufa en medio de algo y vuelve con PAILA
// abierta, lo que quedó a medias se resuelve sin reabrir (core/recoverywatch.ts). Con una biblioteca de prueba armada acá
// (nunca la Música): "desenchufar" es renombrar su carpeta (PAILA ve el disco como desconectado) y "enchufar", devolverle el nombre.
//   preparar --carpeta <D:\PAILA-trabajo\disco-vuelve> [--temas 600]: arma la biblioteca de prueba y su base.
//   app --carpeta <…> --caso desenchufar|cortar [--en 150] [--capturas <carpeta>]:
//     desenchufar: Organizar con la app abierta; a los N movidos se desenchufa, se espera y se vuelve a enchufar.
//     cortar: a los N movidos se corta la app (taskkill), se abre con el disco desenchufado y se enchufa con la app abierta.
//   En los dos: que el diario quede sin nada pendiente sin reabrir, y que cada tema esté una sola vez (base = disco).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { abrirApp, type App } from './conducir'
import { controlar, unknownFiles, visibles, type Antes } from './corte-base'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const mode = process.argv[2]
const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const carpeta = arg('--carpeta'), M = path.join(carpeta, 'M'), FUERA = path.join(carpeta, 'M-desenchufado')
const datos = path.join(carpeta, 'datos'), dbFile = path.join(datos, 'paila.db'), antesFile = path.join(datos, 'antes.json')
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const fail = (m: string) => { console.error(m); process.exit(2) }
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n
if (!carpeta || /[\\/]Música([\\/]|$)/i.test(carpeta)) fail('Uso: --carpeta <carpeta de prueba> (nunca dentro de la Música)')

async function preparar() {
  const n = Number(arg('--temas', '600'))
  fs.rmSync(carpeta, { recursive: true, force: true })
  fs.mkdirSync(path.join(M, 'Sueltos'), { recursive: true }); fs.mkdirSync(datos, { recursive: true })
  const base = path.join(carpeta, 'base.mp3')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-b:a', '128k', base])
  for (let i = 0; i < n; i++) {
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', base, '-c', 'copy', '-metadata', `artist=Artista ${i % 20}`, '-metadata', `album=Disco ${i % 7}`,
      '-metadata', `title=Tema ${i}`, '-metadata', `track=${(i % 12) + 1}`, path.join(M, 'Sueltos', `tema-${i}.mp3`)])
  }
  fs.rmSync(base)
  const lib = new Library(dbFile, findFfprobe())
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const antes: Antes = { files: visibles(lib), playlistItems: 0, batch: 0, unknown: unknownFiles(lib, M) }
  fs.writeFileSync(antesFile, JSON.stringify(antes))
  log(`Biblioteca de prueba lista: ${antes.files.length} temas en ${M}`)
  lib.close()
}

/** Renombra la carpeta (con reintentos: Windows a veces la tiene ocupada un instante). */
async function mover(de: string, a: string) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(de, a); return } catch (e) { if (i >= 50) throw e; await espera(100) }
  }
}

async function app() {
  const caso = arg('--caso'), en = Number(arg('--en', '150'))
  const capturas = arg('--capturas'), foto = async (a: App, nombre: string) => { if (capturas) await a.captura(path.join(capturas, `disco-vuelve-${caso}-${nombre}.png`)) }
  if (!fs.existsSync(antesFile)) fail('Primero: preparar')
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const movidos = () => count(db, 'SELECT COUNT(*) AS n FROM moves_log')
  const pendientes = () => count(db, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')
  let a = await abrirApp(datos, { log: path.join(datos, 'app.log') })
  await espera(2500)
  await a.clic('Organizar carpetas', { dentroDe: 'nav, aside, .sidebar' }).catch(() => a.clic('Organizar carpetas'))
  await a.clic('Ver vista previa')
  await a.esperarTexto(/Aplicar: mover [\d.]+ temas/, 120_000)
  await a.clic('Aplicar: mover'); await a.clic('Sí, aplicar')
  const t0 = Date.now()
  while (movidos() < en && Date.now() - t0 < 120_000) await espera(2)
  if (caso === 'cortar') { a.matar(); await a.terminado; log(`App cortada con ${movidos()} movidos; pendientes en el diario: ${pendientes()}`) }
  await mover(M, FUERA)
  log(`Disco "desenchufado" con ${movidos()} movidos`)
  if (caso === 'cortar') {
    a = await abrirApp(datos, { log: path.join(datos, 'app.log') })
    await espera(4000)
    log(`Abierta con el disco desenchufado: pendientes ${pendientes()}`)
  } else {
    let antes = -1
    for (let i = 0; i < 100 && movidos() !== antes; i++) { antes = movidos(); await espera(300) }
    await espera(2000)
    log(`Organizar paró en ${movidos()} movidos; pendientes en el diario: ${pendientes()}`)
  }
  await foto(a, 'desenchufado')
  const quedaron = pendientes()
  await espera(3000)
  await mover(FUERA, M)
  const t1 = Date.now()
  log('Disco "enchufado" de nuevo, con la app abierta')
  while (pendientes() > 0 && Date.now() - t1 < 60_000) await espera(200)
  log(`Pendientes: ${quedaron} → ${pendientes()} en ${((Date.now() - t1) / 1000).toFixed(1)} s, sin reabrir`)
  await espera(2000)
  await foto(a, 'enchufado')
  await a.cerrar()
  db.close()
  const lib = new Library(dbFile, findFfprobe())
  const bad = controlar(lib, M, JSON.parse(fs.readFileSync(antesFile, 'utf8')) as Antes, false)
  lib.close()
  log(bad.length ? `MAL:\n  ${bad.slice(0, 20).join('\n  ')}` : 'Todo coherente: cada tema una sola vez, la base igual al disco, nada pendiente')
}

if (mode === 'preparar') await preparar()
else if (mode === 'app') await app()
else fail('Modos: preparar | app')
