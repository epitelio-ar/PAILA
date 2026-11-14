// Prueba de corte real en medio de Organizar (guion: docs/archivo/pruebas/2026-10-21-guion-corte-y-vaciar.md), sobre una COPIA de la
// base apuntando a la copia de la Música. Nunca toca la Música original ni la base real (la base real solo se lee para copiarla).
//   preparar: copia la base (VACUUM INTO, se puede con la app cerrada o abierta), la apunta a la copia y guarda el "antes".
//   cortar:   corre Organizar (o deshacer) en otro proceso y lo MATA (taskkill /F) cuando van N temas movidos.
//   revisar:  "abre PAILA" (recuperación al abrir) y controla que cada tema esté una sola vez y la base coincida con el disco.
//   deshacer: deshace todas las tandas de Organizar (como el Historial) y controla que todo volvió a su lugar.
//   comparar: la copia contra el original, archivo por archivo (tamaño y fecha) y MD5 de una muestra.
// Con la app COMPILADA (scripts/conducir.ts la maneja desde afuera, apretando los mismos botones que una persona):
//   achicar:   deja como Música solo algunas carpetas (las demás, excluidas como desde la app) para un Organizar más chico.
//   app:       abre la app, Organizar → vista previa → Aplicar (o Historial → Deshacer) y la MATA cuando van N temas.
//   abrir:     abre la app (la recuperación al abrir es la de verdad), captura Inicio y la cierra como el usuario.
//   historial: abre la app y deshace desde el Historial cada tanda de Organizar que quedó (aunque esté a medias).
//   controlar: solo controla la consistencia (sin recuperar nada); --original: además, que todo volvió a su lugar.
//
//   node scripts/run-ts.mjs scripts/corte.ts preparar --base <paila.db real> --datos <carpeta> --copia <Música-copia>
//   node scripts/run-ts.mjs scripts/corte.ts cortar   --datos <carpeta> --que organizar|deshacer --en <N>
//   node scripts/run-ts.mjs scripts/corte.ts revisar  --datos <carpeta>
//   node scripts/run-ts.mjs scripts/corte.ts deshacer --datos <carpeta>
//   node scripts/run-ts.mjs scripts/corte.ts comparar --copia <Música-copia> --original <Música> [--muestra 50] [--desde <fecha ISO>]
//   node scripts/run-ts.mjs scripts/corte.ts achicar  --datos <carpeta> --solo "Rock/La Renga|Rock/El Bordo"
//   node scripts/run-ts.mjs scripts/corte.ts app      --datos <carpeta> --que organizar|deshacer --en <N> [--cancelar | --cerrar] [--capturas <carpeta> --nombre <x>]
//   node scripts/run-ts.mjs scripts/corte.ts abrir    --datos <carpeta> [--capturas <carpeta> --nombre <x>]
//   node scripts/run-ts.mjs scripts/corte.ts historial --datos <carpeta> [--capturas <carpeta> --nombre <x>]
//   node scripts/run-ts.mjs scripts/corte.ts controlar --datos <carpeta> [--original]
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findFfmpeg } from '@paila/core/probe'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'
import { recover } from '@paila/core/recovery'
import { AUDIO_EXT } from '@paila/core/files'
import { abrirApp, type App } from './conducir'
import { antesFile, arg, controlar, count, count0, datos, dbFile, fail, log, mode, open, unknownFiles, visibles, type Antes } from './corte-base'


async function preparar() {
  const base = arg('--base'), copia = arg('--copia')
  if (!base || !copia || !datos) fail('Uso: preparar --base <paila.db> --datos <carpeta> --copia <Música-copia>')
  if (!fs.existsSync(path.join(path.dirname(copia), 'copia-en-uso.lock'))) fail('Falta el aviso copia-en-uso.lock')
  if (fs.existsSync(dbFile)) fail(`Ya hay una base en ${dbFile}: borrala a mano si querés empezar de nuevo`)
  fs.mkdirSync(datos, { recursive: true })
  const src = new DatabaseSync(base, { readOnly: true })
  src.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`)
  src.close()
  // la carpeta de música pasa a ser la copia (mismo disco: cambia la carpeta)
  const rel = path.relative(path.parse(copia).root, copia).split(path.sep).join('/')
  const raw = new DatabaseSync(dbFile)
  raw.prepare('UPDATE roots SET rel_path = ? WHERE id = 1').run(rel)
  raw.close()
  const { lib } = open()
  const antes: Antes = { files: visibles(lib), playlistItems: count(lib, 'SELECT COUNT(*) AS n FROM playlist_items'), batch: count(lib, 'SELECT COALESCE(MAX(batch_id), 0) AS n FROM moves_log'), unknown: unknownFiles(lib, lib.roots()[0].path) }
  fs.writeFileSync(antesFile, JSON.stringify(antes))
  const missing = antes.files.filter((f) => !fs.existsSync(path.join(lib.roots()[0].path, ...f.rel.split('/'))))
  log(`Copia lista: ${antes.files.length} temas visibles, ${antes.playlistItems} lugares en playlists. Temas sin archivo en la copia: ${missing.length}`)
  lib.close()
}

/** El proceso que se va a matar: Organizar (o deshacer) como en la app, con el candado tomado. */
async function hijo() {
  const { lib, rootPath } = open()
  const org = new Organizer(lib.db, rootPath)
  if (arg('--que') === 'deshacer') {
    const b = org.batches().filter((x) => !x.undone && x.files > 0)
    await lib.ops.run('deshaciendo', async () => { for (const x of b) await org.undo(x.batchId) })
  } else {
    const plan = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    log(`PLAN ${plan.moves.length}`)
    await lib.ops.run('organizando', () => org.apply(plan))
  }
  log('TERMINÓ')
  lib.close()
}

async function cortar() {
  const en = Number(arg('--en', '50')), que = arg('--que', 'organizar')
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const before = que === 'deshacer' ? count0(db, 'SELECT COUNT(*) AS n FROM moves_log WHERE undone_at IS NOT NULL') : count0(db, 'SELECT COUNT(*) AS n FROM moves_log')
  const child = spawn(process.execPath, ['scripts/run-ts.mjs', 'scripts/corte.ts', 'hijo', '--datos', datos, '--que', que], { stdio: ['ignore', 'pipe', 'inherit'] })
  child.stdout.on('data', (d) => process.stdout.write(`  [hijo] ${d}`))
  const t0 = Date.now()
  let killed = false
  await new Promise<void>((resolve) => {
    const iv = setInterval(() => {
      const now = que === 'deshacer' ? count0(db, 'SELECT COUNT(*) AS n FROM moves_log WHERE undone_at IS NOT NULL') : count0(db, 'SELECT COUNT(*) AS n FROM moves_log')
      if (now - before >= en) {
        clearInterval(iv)
        killed = true
        try { execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }) } catch { /* ya terminó */ }
        log(`MATADO con ${now - before} anotados (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
        resolve()
      }
    }, 20)
    child.on('exit', () => { clearInterval(iv); if (!killed) log('El proceso terminó antes de matarlo: probá con un --en más chico'); resolve() })
  })
  const pend = count0(db, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')
  log(`Anotaciones del diario sin resolver después del corte: ${pend}`)
  db.close()
}

async function revisar() {
  const { lib, root, rootPath } = open()
  const antes = JSON.parse(fs.readFileSync(antesFile, 'utf8')) as Antes
  const ffmpeg = findFfmpeg()!
  const rep = await lib.ops.run('revisando', () => recover(lib.db, { rootPath, ffmpeg, backupDir: path.join(datos, 'resguardo'), workDirs: [] }))
  const by = new Map<string, number>()
  for (const i of rep.items) by.set(i.result, (by.get(i.result) ?? 0) + 1)
  log(`Recuperación al abrir: ${rep.items.length} avisos ${JSON.stringify(Object.fromEntries(by))}`)
  for (const i of rep.items.filter((x) => x.result !== 'completado')) log(`  ${i.result}: ${i.message}`)
  const bad = controlar(lib, root, antes, false)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : 'Todo consistente: cada tema una vez, la base igual al disco, playlists intactas, diario vacío.')
  log(`Movidos hasta ahora: ${count(lib, `SELECT COUNT(*) AS n FROM moves_log WHERE batch_id > ${antes.batch} AND undone_at IS NULL AND file_id IS NOT NULL`)}`)
  lib.close()
}

async function deshacer() {
  const { lib, root, rootPath } = open()
  const antes = JSON.parse(fs.readFileSync(antesFile, 'utf8')) as Antes
  const org = new Organizer(lib.db, rootPath)
  const t0 = Date.now()
  for (const b of org.batches().filter((x) => x.batchId > antes.batch && !x.undone)) {
    const r = await lib.ops.run('deshaciendo', () => org.undo(b.batchId))
    log(`Tanda ${b.batchId}: ${r.moved} temas y ${r.extras} acompañantes de vuelta, ${r.failed.length} fallas${r.failed.length ? `: ${r.failed.slice(0, 5).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  }
  log(`Deshacer: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const bad = controlar(lib, root, antes, true)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : 'Todo volvió a su lugar.')
  lib.close()
}

function comparar() {
  const copia = arg('--copia'), original = arg('--original'), n = Number(arg('--muestra', '50'))
  if (!copia || !original) fail('Uso: comparar --copia <Música-copia> --original <Música>')
  const list = (root: string) => {
    const files = new Map<string, fs.Stats>(), dirs = new Set<string>()
    for (const f of fs.readdirSync(root, { recursive: true }) as string[]) {
      const st = fs.statSync(path.join(root, f))
      const rel = f.split(path.sep).join('/')
      if (st.isDirectory()) dirs.add(rel); else files.set(rel, st)
    }
    return { files, dirs }
  }
  const a = list(original), b = list(copia)
  const faltan = [...a.files.keys()].filter((r) => !b.files.has(r))
  const sobran = [...b.files.keys()].filter((r) => !a.files.has(r))
  const todos = [...a.files.keys()].filter((r) => b.files.has(r) && (a.files.get(r)!.size !== b.files.get(r)!.size || Math.abs(a.files.get(r)!.mtimeMs - b.files.get(r)!.mtimeMs) > 2000))
  // --desde <fecha>: lo que cambió en el ORIGINAL después de empezar la prueba (y la copia tiene su fecha de antes) no es de la
  // prueba: lo cambió otro (el 22/10 alguien aplicó el volumen parejo con otra PAILA en medio de la corrida)
  const desde = arg('--desde') ? Date.parse(arg('--desde')) : Infinity
  const delOriginal = todos.filter((r) => a.files.get(r)!.mtimeMs > desde && b.files.get(r)!.mtimeMs < desde)
  const distintos = todos.filter((r) => !delOriginal.includes(r))
  const carpetas = [...b.dirs].filter((d) => !a.dirs.has(d))
  log(`Original ${a.files.size} archivos, copia ${b.files.size}. Faltan ${faltan.length}, sobran ${sobran.length}, distintos ${distintos.length}, carpetas de más ${carpetas.length}${delOriginal.length ? ` (aparte, ${delOriginal.length} que cambiaron en el original después de empezar, no en la copia)` : ''}`)
  for (const [t, l] of [['falta', faltan], ['sobra', sobran], ['distinto', distintos], ['carpeta de más', carpetas]] as const) for (const r of l.slice(0, 15)) log(`  ${t}: ${r}`)
  const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
  const audio = [...a.files.keys()].filter((r) => AUDIO_EXT.has(path.extname(r).slice(1).toLowerCase()) && b.files.has(r) && !delOriginal.includes(r))
  let bad = 0
  for (let i = 0; i < Math.min(n, audio.length); i++) {
    const r = audio[Math.floor(Math.random() * audio.length)]
    if (md5(path.join(original, ...r.split('/'))) !== md5(path.join(copia, ...r.split('/')))) { bad++; log(`  MD5 distinto: ${r}`) }
  }
  log(`MD5 de ${Math.min(n, audio.length)} temas al azar: ${bad} distintos`)
}

/** Deja como Música solo las carpetas de --solo (el resto, excluido con la regla de la app) y vuelve a sacar el "antes". */
async function achicar() {
  const solo = arg('--solo').split('|').map((s) => s.trim()).filter(Boolean)
  if (!solo.length) fail('Uso: achicar --datos <carpeta> --solo "Carpeta/Sub|Otra"')
  const { lib, root, rootPath } = open()
  for (const s of solo) if (!fs.existsSync(path.join(root, ...s.split('/')))) fail(`No existe ${s} en la copia`)
  lib.setRule(1, '', 'excluir')
  for (const s of solo) lib.setRule(1, s, 'musica')
  const antes: Antes = { files: visibles(lib), playlistItems: count(lib, 'SELECT COUNT(*) AS n FROM playlist_items'), batch: count(lib, 'SELECT COALESCE(MAX(batch_id), 0) AS n FROM moves_log'), unknown: unknownFiles(lib, root) }
  fs.writeFileSync(antesFile, JSON.stringify(antes))
  const org = new Organizer(lib.db, rootPath)
  const plan = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
  const fuera = plan.moves.filter((m) => !solo.some((s) => m.from.startsWith(`${s}/`)))
  log(`Quedan ${antes.files.length} temas visibles. Organizar movería ${plan.moves.length} (+${plan.extras.length} acompañantes), saltea ${plan.skipped.length}, choques ${plan.conflicts}. Fuera de las carpetas elegidas: ${fuera.length}`)
  const abiertas = org.batches().filter((b) => !b.undone && b.files > 0)
  if (abiertas.length) log(`OJO: ya hay ${abiertas.length} tandas de Organizar sin deshacer en la base`)
  lib.close()
}

const capturaDe = (nombre: string) => { const dir = arg('--capturas'); return dir ? path.join(dir, `${nombre}.png`) : null }
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Ir a una pantalla desde la barra de la izquierda. */
async function ir(app: App, boton: string, titulo: string) {
  await app.clic(boton, { dentroDe: 'nav, aside, .sidebar' }).catch(() => app.clic(boton))
  await app.esperarTexto(titulo)
}

/** Abre la app compilada y espera a que la recuperación al abrir haya terminado (el diario sin nada pendiente). */
let abierta: App | null = null
async function abrirYEsperar(): Promise<App> {
  const app = abierta = await abrirApp(datos, { log: path.join(datos, 'app.log') })
  const db = new DatabaseSync(dbFile, { readOnly: true })
  for (let i = 0; i < 150 && count0(db, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL'); i++) await espera(200)
  db.close()
  await espera(1500)
  return app
}

/** Marca (data-corte) la primera tanda de Organizar del Historial que todavía se puede deshacer. */
const marcarTandaOrganizar = (app: App) => app.js<boolean>(`(() => {
  document.querySelectorAll('[data-corte]').forEach((e) => e.removeAttribute('data-corte'))
  const box = [...document.querySelectorAll('.box')].find((b) => b.querySelector('.pill')?.textContent === 'Organizar carpetas' && !b.classList.contains('skipped') && [...b.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Deshacer'))
  if (!box) return false
  box.setAttribute('data-corte', '1'); return true
})()`)

/** El corte con la app de verdad: se aprieta Aplicar (o Deshacer en el Historial) y se mata el proceso cuando van N temas. */
async function appCorte() {
  const en = Number(arg('--en', '50')), que = arg('--que', 'organizar'), nombre = arg('--nombre', `corte-${que}-${en}`)
  const antes = JSON.parse(fs.readFileSync(antesFile, 'utf8')) as Antes
  const app = await abrirYEsperar()
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const hechos = () => count0(db, que === 'deshacer'
    ? `SELECT COUNT(*) AS n FROM moves_log WHERE batch_id > ${antes.batch} AND undone_at IS NOT NULL`
    : `SELECT COUNT(*) AS n FROM moves_log WHERE batch_id > ${antes.batch}`)
  const antesDeEmpezar = hechos()
  if (que === 'deshacer') {
    await ir(app, 'Historial', 'Todo lo que PAILA hizo')
    if (!await marcarTandaOrganizar(app)) fail('No hay tanda de Organizar para deshacer')
    await app.clic('Deshacer', { dentroDe: '[data-corte]' })
    await app.clic('Sí, deshacer', { dentroDe: '[data-corte]' })
  } else {
    await ir(app, 'Organizar carpetas', 'Organizar carpetas')
    await app.clic('Ver vista previa')
    await app.esperarTexto(/Aplicar: mover [\d.]+ temas/, 120_000)
    log(`Vista previa: ${(await app.texto()).match(/Aplicar: mover [\d.]+ temas/)![0]}`)
    const c = capturaDe(`${nombre}-vista-previa`); if (c) await app.captura(c)
    await app.clic('Aplicar: mover')
    await app.clic('Sí, aplicar')
  }
  const t0 = Date.now()
  let matado = false, termino = false, capturado = false
  const cancelar = process.argv.includes('--cancelar'), cerrarVentana = process.argv.includes('--cerrar')
  void app.terminado.then(() => { termino = true })
  while (Date.now() - t0 < 120_000 && !termino) {
    const n = hechos() - antesDeEmpezar
    // a mitad de camino, una captura: que la ventana responda mientras mueve (antes del 22/10 quedaba congelada)
    const ca = capturaDe(`${nombre}-avance`)
    if (ca && !capturado && n >= en / 2) { capturado = true; await app.captura(ca); log(`Captura del avance con ${hechos() - antesDeEmpezar} anotados`) }
    if (n >= en && cerrarVentana) {
      // --cerrar: como apretar la X de la ventana en medio de la operación (así se cortó sola a los 178 el 22/10)
      void app.js('window.close()').catch(() => { /* se cerró */ })
      log(`Cerré la ventana con ${n} anotados`)
      const salio = await Promise.race([app.terminado.then(() => true), espera(20_000).then(() => false)])
      if (salio) log(`La app se cerró: quedaron ${hechos() - antesDeEmpezar} anotados de la tanda`)
      else {
        // la pregunta ("PAILA está trabajando") es de Windows: no se contesta desde acá. Se deja terminar y se la cierra.
        let antes = -1
        for (let i = 0; i < 60 && hechos() !== antes; i++) { antes = hechos(); await espera(1000) }
        log(`La app siguió abierta (pregunta antes de cerrar) y la operación terminó entera: ${hechos() - antesDeEmpezar} anotados`)
        app.matar()
      }
      matado = true
      break
    }
    if (n >= en && cancelar) {
      // --cancelar: en vez de matarla, apretar Cancelar como una persona y esperar a que termine
      await app.clic('Cancelar', { dentroDe: '.job.running' }).catch(() => app.clic('Cancelar'))
      log(`Apreté Cancelar con ${n} anotados`)
      await app.esperarTexto(/Cancelado|Se movieron [\d.]+ temas/, 60_000)
      await espera(1000)
      log(`Al cancelar quedaron ${hechos() - antesDeEmpezar} anotados. En pantalla: ${(await app.texto()).match(/Se movieron[^\n]*/)?.[0] ?? '(sin mensaje)'}`)
      const cc = capturaDe(`${nombre}-cancelado`); if (cc) await app.captura(cc)
      await app.cerrar(); matado = true
      break
    }
    if (n >= en) {
      const cuando = new Date().toISOString()
      app.matar(); matado = true
      log(`MATADO a las ${cuando}, ${((Date.now() - t0) / 1000).toFixed(2)} s después de apretar: ${n} anotados al decidir, ${hechos() - antesDeEmpezar} al morir`)
      break
    }
    await espera(5)
  }
  if (!matado && termino) log(`La app se cerró sola a los ${((Date.now() - t0) / 1000).toFixed(1)} s (código ${await app.terminado}), con ${hechos() - antesDeEmpezar} anotados`)
  else if (!matado) { log(`No se llegó a matar (van ${hechos() - antesDeEmpezar}): cierro la app`); await app.cerrar() }
  await app.terminado
  log(`Anotaciones del diario sin resolver después del corte: ${count0(db, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')}`)
  db.close()
}

/** Reabrir después del corte: la recuperación al abrir es la de la app. Captura Inicio (el aviso) y cierra. */
async function abrir() {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const pend = count0(db, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')
  db.close()
  const app = await abrirYEsperar()
  const c = capturaDe(arg('--nombre', 'abrir')); if (c) await app.captura(c)
  const aviso = (await app.texto()).split('\n').filter((l) => /a medias|No se hizo|Terminado|Vuelto atrás|Para revisar|se cort/i.test(l)).slice(0, 6)
  log(`Al abrir: ${pend} anotaciones pendientes antes de abrir. Aviso en Inicio: ${aviso.length ? aviso.join(' / ') : '(ninguno)'}`)
  await app.cerrar()
}

/** Deshace desde el Historial, de a una, cada tanda de Organizar que se pueda deshacer. */
async function historial() {
  const app = await abrirYEsperar()
  await ir(app, 'Historial', 'Todo lo que PAILA hizo')
  const c0 = capturaDe(`${arg('--nombre', 'historial')}-antes`); if (c0) await app.captura(c0)
  let n = 0
  const t0 = Date.now()
  while (await marcarTandaOrganizar(app)) {
    if (++n > 20) fail('Demasiadas tandas')
    await app.clic('Deshacer', { dentroDe: '[data-corte]' })
    await app.clic('Sí, deshacer', { dentroDe: '[data-corte]' })
    await app.esperarTexto(/Se deshizo en [\d.]+ temas[^\n]*/, 300_000)
    log(`Tanda deshecha: ${(await app.texto()).match(/Se deshizo en [\d.]+ temas[^\n]*/)![0]}`)
    await espera(500)
  }
  log(`Deshechas ${n} tandas desde el Historial en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const c = capturaDe(`${arg('--nombre', 'historial')}-despues`); if (c) await app.captura(c)
  await app.cerrar()
}

function controlarModo() {
  const { lib, root } = open()
  const antes = JSON.parse(fs.readFileSync(antesFile, 'utf8')) as Antes
  const original = process.argv.includes('--original')
  const bad = controlar(lib, root, antes, original)
  const movidos = count(lib, `SELECT COUNT(*) AS n FROM moves_log WHERE batch_id > ${antes.batch} AND undone_at IS NULL AND file_id IS NOT NULL`)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : `${original ? 'Todo volvió a su lugar' : 'Todo consistente'}: cada tema una vez, la base igual al disco, playlists intactas, diario vacío.`)
  log(`Temas movidos (sin deshacer): ${movidos}. Diario por resultado: ${JSON.stringify(lib.db.prepare('SELECT result, COUNT(*) AS n FROM op_journal GROUP BY result').all())}`)
  lib.close()
  if (bad.length) process.exitCode = 1
}

const run: Record<string, () => unknown> = { preparar, hijo, cortar, revisar, deshacer, comparar, achicar, app: appCorte, abrir, historial, controlar: controlarModo }
if (!run[mode]) fail('Uso: preparar | cortar | revisar | deshacer | comparar | achicar | app | abrir | historial | controlar (ver el encabezado)')
try { await run[mode]() } catch (e) {
  // si algo falló con la app abierta: captura de cómo estaba la pantalla y se cierra (que no quede colgada)
  const a = abierta as App | null
  if (a) { await a.captura(path.join(datos, 'error.png')).catch(() => { /* ya no está */ }); a.matar() }
  throw e
}
