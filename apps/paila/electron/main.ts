// Proceso principal de PAILA: ventana, ciclo de vida de la app y análisis en segundo plano.
// Los pedidos de la interfaz (IPC) están en electron/ipc/, uno por área; los servicios en electron/context.ts.
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from 'electron'
import { abrirNapiaLabel, macMenu } from '@paila/shared/menumac'
import { abrirNapia } from './abrirnapia'
import { Deezer } from '@paila/core/online/sources'
import { OnlineCache } from '@paila/core/online/http'
import { Library } from '@paila/core/library'
import { escanearAlAbrir } from '@paila/core/escaneo-al-abrir'
import { markSeen, pendingRoots, recover, report } from '@paila/core/recovery'
import { RecoveryWatch } from '@paila/core/recoverywatch'
import { RootsWatch } from '@paila/core/rootswatch'
import { guardWith } from '@paila/core/ops/checks'
import type { RecoveryReport } from '@paila/shared/types'
import { Jobs } from '@paila/core/jobs'
import { backupDaily } from '@paila/core/backup'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { WorkerPool } from '@paila/core/analysis/pool'
import { Slots } from '@paila/core/analysis/slots'
import { soloLectura } from '@paila/core/journal'
import { IntensityControl, utilitySpawner } from './intensity'
import { TableServer } from '@paila/core/tableserver'
import { createServices, type Ctx } from './context'
import { audioResponse } from './media'
import { registerEstilo } from './ipc/estilo'
import { leerIdioma, registerIdioma } from './ipc/idioma'
import { pasarTextosAlIdioma } from '@paila/core/textosidioma'
import { idioma, ponerIdioma } from '@paila/shared/idioma'
import { T } from './main.textos'
import { registerLibrary } from './ipc/library'; import { registerDiscos } from './ipc/discos'
import { registerTags } from './ipc/tags'
import { registerPlaylists } from './ipc/playlists'
import { registerCleanup } from './ipc/cleanup'
import { registerDj } from './ipc/dj'
import { registerQuality } from './ipc/quality'
import { registerInbox } from './ipc/inbox'
import { registerHistory } from './ipc/history'
import { registerAdvanced } from './ipc/advanced'
import { registerOnline } from './ipc/online'
import { registerGenres } from './ipc/genres'
import { coverResponse, registerAlbums } from './ipc/albums'
import { registerRequests } from './ipc/requests'
import { registerImports } from './ipc/imports'
import { registerLlevar } from './ipc/llevar'
import { registerBitPerfect } from './bitperfect'
import { registerTabla } from './ipc/tabla'
import { registerCarry } from './ipc/carry'
import { registerSets } from './ipc/sets'
import { registerArchives } from './ipc/archives'
import { registerEnergia } from './ipc/energia'
import { registerRecortar } from './ipc/recortar'
import { registerSeparar, separando } from './ipc/separar'
import { registerRespaldos } from './ipc/respaldos'
import { ponerLoTraido, registerMudanza, restaurarVentana } from './ipc/mudanza'
import type { GridEngine } from './gridengine'
import { registerUpdates } from './updates'
import { registerDiagnostic, startErrorLog } from './diagnostic'
import { registerChequeo } from './chequeo'
import { registerNotas } from './ipc/notas'
import { registerPrueba } from './prueba'

let win: BrowserWindow | null = null
let lib: Library
let pool: WorkerPool | null = null
let intensity: IntensityControl
let table: TableServer | null = null
let gridEngine: GridEngine | null = null
let stopBitPerfect: (() => Promise<void>) | null = null
let rootsWatch: RootsWatch | null = null
const ffprobe = findFfprobe()
const ffmpeg = findFfmpeg()
// El reproductor pide el audio a paila://audio/<id> (con Range, para poder adelantar).
protocol.registerSchemesAsPrivileged([{ scheme: 'paila', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

// Para desarrollo: PAILA_USER_DATA usa otra carpeta de datos (PAILA_PRUEBA la pone sola: electron/prueba.ts); PAILA_SNAPSHOT=archivo.png abre la ventana oculta, guarda una captura, muestra los mensajes de la interfaz en consola y cierra.
if (process.env.PAILA_USER_DATA) app.setPath('userData', process.env.PAILA_USER_DATA)
// Versión portable (PAILA-portable.exe): los datos van en una carpeta al lado del programa, así viajan con el SSD o el pendrive.
else if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'PAILA-datos'))
const snapshot = process.env.PAILA_SNAPSHOT
// PAILA_OCULTA=1: la ventana no aparece ni le roba el foco a nadie (las pruebas que manejan la app desde afuera,
// scripts/conducir.ts: se veían "dos PAILA abiertas"). Sigue andando entera, con capturas por el puerto de depuración.
const oculta = !!process.env.PAILA_OCULTA
// registro de errores (para Exportar diagnóstico) y cuánto tardó en abrir, por partes (ms desde que arrancó el proceso) hasta
// que la biblioteca se ve (`ui`). Con PAILA_ARRANQUE=1 lo escribe en la consola y se cierra (scripts/arranque.ts).
const errorLog = startErrorLog(app.getPath('userData'))
const arranque: Record<string, number> = { main: Math.round(performance.now()) }
const marca = (k: string) => { arranque[k] ??= Math.round(performance.now()) }
/** Lo que puede esperar a que la biblioteca se vea (un segundo después, o a los 20 s si la ventana nunca avisa). */
const despuesDeAbrir: (() => void)[] = []
const hacerLoDeDespues = () => { for (const fn of despuesDeAbrir.splice(0)) try { fn() } catch (e) { console.error(e) } }
ipcMain.once('ui:lista', (_e, deLaInterfaz: Record<string, number>) => {
  for (const [k, v] of Object.entries(deLaInterfaz ?? {})) arranque[k] = Math.round(v - performance.timeOrigin)
  marca('ui')
  if (process.env.PAILA_ARRANQUE) { console.log(`[arranque] ${JSON.stringify(arranque)}`); app.quit(); return }
  setTimeout(hacerLoDeDespues, 1000)
})
/** Un aviso a la interfaz. Al cerrar, el análisis todavía avisa un rato y la ventana ya no existe: entonces no se manda. */
const sendUi = (channel: string, payload: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload) }

// Una sola PAILA por carpeta de datos (la misma base): si ya hay una abierta, la segunda la trae al frente y se cierra sin
// tocar la base (21/10/2026 se pudieron abrir dos sobre la misma). Electron arma el candado con la carpeta de datos, así que
// PAILA_USER_DATA (una copia de prueba) y NAPIA (la suya) pueden estar abiertas al mismo tiempo.
const first = app.requestSingleInstanceLock()
if (!first) app.quit()
/** "Ver en PAILA" desde NAPIA: `--bandeja=<carpeta>` abre la Bandeja con lo que llegó ahí; `--buscar=<texto>`, tu copia de un tema (va como "?texto"). */
const bandejaArg = (argv: string[]) => { const a = [...argv].reverse().find((x) => /^--(bandeja|buscar)=/i.test(x)); return a ? (/^--buscar=/i.test(a) ? '?' : '') + a.replace(/^--\w+=/, '').replace(/^"|"$/g, '') || null : null }
let bandejaPedida = bandejaArg(process.argv)
ipcMain.handle('inbox:pedida', () => { const b = bandejaPedida; bandejaPedida = null; return b })
/** `--rekordbox=<rekordbox.xml>`: abre Rekordbox y cabina con la vista previa de "Traer tus playlists" de ese archivo (también para las capturas). */
let rekordboxPedido = (() => { const a = [...process.argv].reverse().find((x) => x.toLowerCase().startsWith('--rekordbox=')); return a ? a.slice('--rekordbox='.length).replace(/^"|"$/g, '') || null : null })()
ipcMain.handle('traer:pedido', () => { const x = rekordboxPedido; rekordboxPedido = null; return x })
app.on('second-instance', (_e, argv) => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.setAlwaysOnTop(true); win.focus(); win.setAlwaysOnTop(false) // Windows no deja pasar al frente a un programa de atrás (había que hacer Alt+Tab)
  const b = bandejaArg(argv)
  if (b) sendUi('inbox:ir', b)
})

function createWindow() {
  win = new BrowserWindow({
    show: !snapshot && !oculta,
    // PAILA_SNAPSHOT_SIZE=1600x1000: tamaño de la captura (para comparar con los bocetos)
    width: Number(process.env.PAILA_SNAPSHOT_SIZE?.split('x')[0]) || 1400,
    height: Number(process.env.PAILA_SNAPSHOT_SIZE?.split('x')[1]) || 880,
    minWidth: 900,
    minHeight: 560,
    title: 'PAILA',
    // en Windows, el .ico: trae cada medida dibujada aparte y Windows elige la justa para la barra y el título (el .png lo achica a su manera)
    icon: path.join(__dirname, '../../build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#15171a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
      // oculta, Chromium frena los relojes de la ventana: la interfaz tiene que seguir al día igual
      backgroundThrottling: !oculta,
    },
  })
  // la ventana oculta de la placa de video (Beat This!) no tiene que dejar abierto el programa
  win.on('closed', () => gridEngine?.close())
  if (!snapshot && !oculta) win.maximize()
  win.webContents.once('did-finish-load', () => marca('cargada'))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  if (snapshot) {
    const w = win
    w.webContents.on('console-message', (e) => console.log(`[interfaz] ${(e as unknown as { message: string }).message}`))
    w.webContents.on('did-finish-load', () => setTimeout(async () => {
      if (process.env.PAILA_SNAPSHOT_JS) await w.webContents.executeJavaScript(process.env.PAILA_SNAPSHOT_JS)
      setTimeout(async () => {
        fs.writeFileSync(snapshot, (await w.webContents.capturePage()).toPNG())
        app.quit()
      }, 800)
    }, 2500))
  }
}

/**
 * Analiza lo pendiente en segundo plano, con workers en procesos aparte de prioridad baja (igual que su ffmpeg) para no
 * trabar la app. Cuántos a la vez lo decide la intensidad elegida, y cambia en el momento (electron/intensity.ts).
 */
async function analyze() {
  // mientras se calcula la grilla o se separa una voz el análisis espera (lo vuelve a pedir ipc/dj.ts al terminar); abierta solo para mirar
  // (PAILA_SOLO_LECTURA, capturas y pruebas con una copia de la base) no se pone a escuchar la Música de nadie
  // `pool` armado = ya hay un análisis corriendo o esperando a que PAILA termine de cambiar archivos (Library.analyze)
  if (!ffmpeg || lib.status.running || gridEngine?.active || separando.activo || soloLectura() || pool) return
  const slots = new Slots(intensity.workers())
  pool ??= new WorkerPool(utilitySpawner(path.join(__dirname, 'analysis-worker.js')), slots.size)
  const mine = pool
  lib.onAbort = () => { slots.close(); mine.abort() }
  intensity.attach(slots, mine)
  try { await lib.analyze(mine, ffmpeg, slots) } finally { intensity.detach(); lib.onAbort = null; await pool?.close(); pool = null }
}

/** Después de cada escaneo: lo que llegó por la Bandeja y ya está en la Música entra a la playlist de su pedido. */
let afterScan: (() => void) | null = null
async function scanThenAnalyze() {
  try {
    const s = await lib.scan()
    try { afterScan?.() } catch (e) { console.error('No se pudieron revisar los pedidos:', e) }
    if (s.outcome === 'ok') await analyze() // detenido o con error: no sigue (se mira el dato, no el texto de la fase)
  } catch { /* el estado ya muestra el error */ }
}

app.whenReady().then(() => {
  if (!first) return // la segunda: no abre la base ni la ventana
  marca('lista')
  // el idioma antes que nada: los nombres de lo que hace PAILA ("revisando…") y los avisos salen en el elegido
  ponerIdioma(leerIdioma())
  // los procesos aparte (análisis, grilla) arrancan en este idioma: ver core/analysis/worker.ts
  process.env.PAILA_IDIOMA_PROCESO = idioma()
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  ponerLoTraido(userData) // lo traído de otra compu (Configuración → Pasar a otra compu) va a su lugar antes de abrir la base
  lib = new Library(path.join(userData, 'paila.db'), ffprobe, (s) => sendUi('scan:status', s))
  // la nota y los errores guardados, en el idioma elegido (si se cambió desde la última vez: core/textosidioma.ts)
  try { pasarTextosAlIdioma(lib.db, idioma()) } catch (e) { console.error('[idioma] no se pudieron pasar los textos', e) }
  // el motor de operaciones exige el candado: nada que escriba archivos corre sin tomarlo (core/ops/checks.ts)
  guardWith(lib.db, lib.ops)
  marca('base')
  // Respaldo diario de la base (playlists, análisis, historial) en userData/respaldos. Si falla, la app sigue igual. Copiar la
  // base frena un rato: va cuando la biblioteca ya se ve, salvo que haya quedado algo a medias de la vez anterior (ahí, antes
  // de resolverlo, como siempre).
  const respaldar = () => { try { backupDaily(lib.db, path.join(userData, 'respaldos')) } catch (e) { console.error('No se pudo respaldar la base:', e) } }
  const aMedias = pendingRoots(lib.db)
  if (aMedias.roots.length || aMedias.outside) respaldar()
  else { despuesDeAbrir.push(respaldar); setTimeout(hacerLoDeDespues, 20_000) }

  const jobs = new Jobs((list) => sendUi('jobs:update', list))
  // Cerrar la ventana con PAILA cambiando archivos (Organizar, papelera, deshacer, copiar): antes se cerraba igual, en el
  // medio y sin avisar. Lo hecho quedaba bien anotado, pero la tanda quedaba a medias y nadie se enteraba (corte con la
  // app, 22/10). Ahora pregunta; "Frenar y cerrar" pide Cancelar y cierra cuando la operación suelta el candado.
  let closing = false
  const askBeforeClose = (w: BrowserWindow) => w.on('close', (e) => {
    const what = lib.ops.unsafeToClose
    if (closing || !what) return
    e.preventDefault()
    void dialog.showMessageBox(w, {
      type: 'warning', title: T.trabajando, buttons: [T.seguir, T.frenar], defaultId: 0, cancelId: 0, noLink: true,
      message: T.esta(what),
      detail: T.siCerras,
    }).then(async ({ response }) => {
      if (response !== 1 || closing) return
      closing = true
      jobs.cancelAll()
      await lib.ops.free()
      if (!w.isDestroyed()) w.close()
    })
  })
  const candidates = new Map<number, string>()
  let candidateSeq = 0
  const services = createServices({ lib, ffprobe: ffprobe!, ffmpeg: ffmpeg!, userData, version: app.getVersion() })
  // Pasada precisa: Deezer como segunda opinión del BPM, solo si está prendido (Configuración → Deezer)
  const dz = new Deezer()
  const dzCache = new OnlineCache(lib.db)
  lib.secondOpinion = () => ((lib.db.prepare("SELECT value FROM settings WHERE key = 'online.deezer'").get() as { value: string } | undefined)?.value === '0' ? null : { dz, cache: dzCache })
  // Antes de escanear, analizar o tocar cualquier archivo: ¿quedó algo a medias de la vez anterior (corte de luz, cuelgue,
  // cierre forzado)? Se resuelve con el candado tomado, así nada más arranca mientras tanto (ver core/recovery.ts).
  const bootAt = new Date().toISOString()
  const recoveryDeps = {
    rootPath: services.rootPath, ffmpeg: ffmpeg!, backupDir: path.join(userData, 'resguardo'),
    // carpetas de trabajo de convertir, achicar y recortar silencios: lo que quede ahí al abrir es de una corrida cortada
    workDirs: [path.join(userData, 'shrink'), path.join(userData, 'convert'), path.join(userData, 'recortes')], inboxWork: path.join(userData, 'inbox-zip'),
  }
  const recovering: Promise<RecoveryReport> = lib.ops.run(T.revisando, () => recover(lib.db, recoveryDeps))
    .catch((e) => { console.error('No se pudo revisar el diario:', e); return { items: [], pending: 0 } })
  // Con la app abierta: si quedó algo a medias en un disco que no estaba, se resuelve cuando vuelve (core/recoverywatch.ts)
  const recoveryWatch = new RecoveryWatch(lib.db, { ...recoveryDeps, lock: lib.ops, onResolved: (r, n) => win?.webContents.send('recovery:update', { report: r, resolved: n }) })
  void recovering.then(() => recoveryWatch.start())
  // El puntito de cada disco en la barra lateral, en el momento en que se desconecta o vuelve (core/rootswatch.ts). Si
  // vuelve uno: se termina lo que quedó a medias ahí y, si había análisis pendiente, sigue solo.
  rootsWatch = new RootsWatch(() => lib.roots(), (roots, back) => {
    win?.webContents.send('roots:update', roots)
    if (!back.length) return
    void recoveryWatch.check()
    void recovering.then(() => { if (!lib.status.running && (lib.pendingAnalysis() || lib.pendingPrints() || lib.pendingQuality() || lib.pendingSilence() || lib.pendingStyle() || lib.pendingPrecise())) analyze() })
  })
  rootsWatch.start()
  ipcMain.handle('recovery:get', async () => { await recovering; return report(lib.db, bootAt) })
  ipcMain.handle('recovery:seen', async () => { await recovering; markSeen(lib.db); return report(lib.db, bootAt) })
  const setting = (k: string) => (lib.db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
  const setSetting = (k: string, v: string) => { lib.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, v) }
  table = new TableServer(path.join(__dirname, 'table-worker.js'), path.join(userData, 'paila.db'))
  intensity = new IntensityControl(lib, setting, setSetting, (i) => sendUi('intensity', i))
  const ctx: Ctx = {
    win: () => win,
    send: sendUi,
    userData, ffprobe: ffprobe!, ffmpeg: ffmpeg!, lib,
    ...services,
    jobs,
    // Todo lo que mueve o escribe archivos pasa por acá: toma el candado de operaciones (nunca dos a la vez, ni durante
    // un escaneo) y pausa el análisis mientras dura.
    recoveryCheck: () => recoveryWatch.check(),
    withPaused: (fn, wait) => lib.ops.run(T.cambiando, async () => {
      // PAILA pausa el análisis sola y lo prende cuando terminaron todos los que lo pausaron (core/libraryjob.ts `hold`)
      const release = lib.hold(T.cambiando)
      // los temas que ya se estaban leyendo terminan solos: se espera a que suelten los archivos
      try { await lib.idle(); return await fn() } finally { release() }
    }, { wait }),
    setting,
    setSetting,
    analyze, scanThenAnalyze, intensity, table,
    candidates,
    registerCandidate: (p) => { const id = -(++candidateSeq); candidates.set(id, p); return id },
  }

  registerLibrary(ctx); registerDiscos(ctx)
  registerEstilo()
  registerIdioma((i) => { try { pasarTextosAlIdioma(lib.db, i) } catch (e) { console.error('[idioma] no se pudieron pasar los textos', e) } lib.pasarIdioma(i) })
  // en Mac, el menú de arriba (Edición para copiar y pegar, Salir) con "Abrir NAPIA": no hay acceso directo como en Windows.
  // Va después de registerIdioma, para salir en el idioma elegido (si se cambia, se ve al volver a abrir PAILA)
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate(macMenu('PAILA', { label: abrirNapiaLabel(), click: () => { try { abrirNapia() } catch (e) { dialog.showErrorBox('NAPIA', (e as Error).message) } } }) as never))
  registerTags(ctx)
  registerPlaylists(ctx)
  registerCleanup(ctx)
  gridEngine = registerDj(ctx, __dirname)
  registerQuality(ctx)
  registerInbox(ctx)
  registerHistory(ctx)
  registerAdvanced(ctx)
  registerOnline(ctx)
  registerGenres(ctx)
  registerAlbums(ctx)
  registerRequests(ctx)
  registerImports(ctx)
  registerLlevar(ctx)
  stopBitPerfect = registerBitPerfect(ctx)
  registerTabla(ctx)
  registerCarry(ctx)
  registerSets(ctx)
  registerArchives(ctx)
  registerEnergia(ctx)
  registerRecortar(ctx)
  registerSeparar(ctx, __dirname)
  registerRespaldos(ctx)
  registerMudanza(ctx)
  registerUpdates(ctx)
  registerDiagnostic(ctx, errorLog, () => arranque.ui ?? null)
  registerChequeo(ctx, errorLog)
  registerNotas(ctx); registerPrueba(ctx)
  afterScan = () => { if (services.requests.sync()) sendUi('requests:changed', null) }
  // paila://tapa/<huella> = una tapa guardada (pantalla Discos); lo demás, paila://audio/<id>
  // paila://modelo/… = la página y el modelo de Beat This! para la placa de video (electron/beatgpu.ts)
  protocol.handle('paila', (req) => { const u = new URL(req.url); return u.host === 'tapa' ? coverResponse(req, ctx) : u.host === 'modelo' ? gridEngine!.gpu.serve(u) : audioResponse(req, lib, ffmpeg, path.join(userData, 'cache'), candidates) })
  marca('servicios')
  createWindow()
  if (win) { askBeforeClose(win); restaurarVentana(win, userData) }
  setTimeout(() => { void recovering.then(() => { if (escanearAlAbrir({ carpetas: lib.roots().length, ocupada: lib.status.running || !!lib.ops.busy, snapshot: !!snapshot })) void scanThenAnalyze(); else if (!lib.status.running && (lib.pendingAnalysis() || lib.pendingPrints() || lib.pendingQuality() || lib.pendingSilence() || lib.pendingStyle() || lib.pendingPrecise())) analyze() }) }, snapshot ? 600_000 : 3000) // al abrir: escanea solo (core/escaneo-al-abrir.ts) o sigue el análisis que quedó
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (!first) return
  rootsWatch?.stop()
  gridEngine?.close()
  void stopBitPerfect?.()
  lib?.stop()
  pool?.close()
  void table?.close()
  lib?.close()
  // también en Mac: la base ya se cerró, así que PAILA no puede quedar abierta sin ventana (como hacen otros programas de Mac)
  app.quit()
})
