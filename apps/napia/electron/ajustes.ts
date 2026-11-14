// NAPIA: sus ajustes y lo que se lee sin bajar nada: dónde está sockseek y su config (sin la cuenta), las listas (archivo o
// texto pegado), la carpeta donde guarda (MúsicaNAPIA o la que elijas; la primera vez se confirma), las opciones, el estilo
// de PAILA, lo que ya se bajó de una lista y abrir PAILA (o su Bandeja). Lo guarda en napia.json (su carpeta de datos), nunca la cuenta de Soulseek.
// La corrida, el puerto y la tanda están en ipc.ts.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { parseList } from '@paila/core/listparse'
import { CONFIG_TEMPLATE, configCandidates, findSockseek, readConfig, tieneFreno, type FindEnv } from '@paila/core/sockseek/config'
import { resumenIndice } from '@paila/core/sockseek/indexcsv'
import { infoDisco, rutasTrabajo } from '@paila/core/sockseek/carpetas'
import { isProgramOpen, isWindowOpen } from '@paila/core/sockseek/run'
import { bandejaFolder, pailaDbCandidates } from '@paila/core/sockseek/paila'
import { readPailaLibrary } from '@paila/core/sockseek/yatenes'
import type { Destino, NapiaList, NapiaOptions, SockseekInfo } from '@paila/shared/napia'
import { esIdioma, idiomaDelSistema, ponerIdioma, textos, type Idioma } from '@paila/shared/idioma'

// Los títulos de las ventanas de elegir archivo o carpeta. El sockseek.conf que arma NAPIA (CONFIG_TEMPLATE) no se traduce.
const T = textos({
  dondeSockseek: { es: 'Dónde está sockseek', en: 'Where is sockseek' },
  elegiLista: { es: 'Elegí la lista', en: 'Choose the list' },
  listas: { es: 'Listas (CSV, texto, m3u)', en: 'Lists (CSV, text, m3u)' },
  dondeGuardar: { es: 'Dónde guardar lo que baje', en: 'Where to save what you download' },
})

const SOCKSEEK_PAGE = 'https://github.com/fiso64/sockseek/releases'
interface Saved { exe?: string | null; destino?: string | null; options?: NapiaOptions }
const DEFAULTS: NapiaOptions = { calidad: 'buena', sacarRemaster: true, primeros: null, saltearTenes: true, arreglarNombres: true }

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Lee una lista de archivo: UTF-8 (con o sin BOM) o UTF-16 (algunos Excel). */
export function readListFile(f: string): NapiaList {
  const buf = fs.readFileSync(f)
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
  return toList(parseList(text, f), path.basename(f, path.extname(f)))
}
const toList = (p: ReturnType<typeof parseList>, name: string): NapiaList => ({
  name, source: p.source, skipped: p.skipped,
  // `tengo`: la copia que ya tenés, si la lista viene de la lista «Faltan o suenan mal» de PAILA (se busca una mejor)
  tracks: p.entries.map((e) => ({ artist: e.artist, title: e.title, album: e.album, duration: e.duration, ...(e.tengo ? { reemplaza: e.tengo } : {}), ...(e.otraVersion ? { otraVersion: true } : {}) })),
})

/** Abierta desde el Finder, una app de Mac ve un PATH mínimo: se suman las carpetas de Homebrew, donde suele estar sockseek. */
const macPath = (p = '') => (process.platform === 'darwin' ? [p, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(path.delimiter) : p)

/** El idioma que eligió PAILA (userData/idioma.json, al lado de su base); sin PAILA, el del sistema. También para el menú de Mac. */
export function idiomaNapia(): Idioma {
  if (esIdioma(process.env.PAILA_IDIOMA)) return process.env.PAILA_IDIOMA
  for (const db of pailaDbCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.PAILA_USER_DATA)) {
    try { const i = (JSON.parse(fs.readFileSync(path.join(path.dirname(db), 'idioma.json'), 'utf8')) as { idioma?: unknown }).idioma; if (esIdioma(i)) return i } catch { /* sin PAILA o sin elegir */ }
  }
  return idiomaDelSistema(app.getPreferredSystemLanguages())
}

export function registerAjustes({ win, initialList }: { win: () => BrowserWindow | null; initialList: string | null }) {
  const savedFile = () => path.join(app.getPath('userData'), 'napia.json')
  const load = (): Saved => { try { return JSON.parse(fs.readFileSync(savedFile(), 'utf8')) } catch { return {} } }
  const save = (s: Saved) => { fs.mkdirSync(path.dirname(savedFile()), { recursive: true }); fs.writeFileSync(savedFile(), JSON.stringify(s, null, 2)) }
  // el sockseek con freno: el que viene con NAPIA (apps/napia/recursos/sockseek; instalado, resources/napia/recursos/sockseek,
  // si el instalador lo lleva) y, si no, uno copiado en su carpeta de datos. Lo deja ahí `npm run sockseek:freno`.
  const frenoDirs = () => [path.join(__dirname, '../../recursos/sockseek'), path.join(app.getPath('userData'), 'sockseek')]
  // en Mac, sockseek (.NET) toma ~/.config como su carpeta de datos: ahí va su configuración
  const env = (): FindEnv => ({ localAppData: process.env.LOCALAPPDATA, appData: process.platform === 'darwin' ? path.join(os.homedir(), '.config') : process.env.APPDATA, home: os.homedir(), pathVar: macPath(process.env.PATH), chosen: load().exe, frenoDirs: frenoDirs() })

  const versions = new Map<string, string | null>()
  const version = (exe: string) => {
    if (!versions.has(exe)) {
      const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
      const v = (r.stdout ?? '').trim().match(/^\d+(?:\.\d+)+\S*/m)?.[0] ?? null
      // si no contestó a tiempo (la compu muy ocupada), no se recuerda: si no, avisaría toda la sesión que no tiene freno
      if (v || !r.error) versions.set(exe, v)
      return v
    }
    return versions.get(exe) ?? null
  }

  function info(): SockseekInfo {
    const e = env()
    const found = findSockseek(e)
    const exe = found?.exe ?? null
    const cands = configCandidates(e, exe)
    const config = cands.find((f) => fs.existsSync(f)) ?? null
    let conf = { hasUser: false, hasPass: false, outputDir: null as string | null, onComplete: false, moveTo: [] as string[], listenPort: null as number | null }
    if (config) { try { conf = readConfig(fs.readFileSync(config, 'utf8'), os.homedir()) } catch { /* sin permiso: se ve como vacía */ } }
    const v = exe ? version(exe) : null
    return { exe, exeFrom: found?.from ?? null, version: v, freno: tieneFreno(v), config, configDefault: cands[1] ?? cands[0], ...conf, soulseekQtOpen: isProgramOpen('SoulseekQt.exe') }
  }

  // en la prueba con personas (PAILA_PRUEBA), lo bajado queda dentro de la carpeta de la prueba
  const porDefecto = () => process.env.PAILA_PRUEBA ? path.join(process.env.PAILA_PRUEBA, 'Descargas NAPIA') : path.join(app.getPath('music'), 'NAPIA')
  /** Música\NAPIA o la que elegiste; "confirmado" cuando quedó guardada en napia.json (la primera vez se pregunta). */
  function destino(): Destino {
    const bandeja = bandejaFolder(pailaDbCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.PAILA_USER_DATA))
    const saved = load().destino ?? null
    const folder = saved ?? porDefecto()
    let disco = null
    try { disco = infoDisco(folder) } catch { /* sin datos del disco */ }
    return { folder, porDefecto: same(folder, porDefecto()), confirmado: !!saved, bandeja, disco }
  }

  ipcMain.handle('napia:info', () => info())
  ipcMain.handle('napia:chooseExe', async () => {
    const w = win()
    const r = w ? await dialog.showOpenDialog(w, { title: T.dondeSockseek, properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'sockseek', extensions: ['exe'] }] } : {}) }) : null
    if (r && !r.canceled && r.filePaths[0]) save({ ...load(), exe: r.filePaths[0] })
    return info()
  })
  ipcMain.handle('napia:openConfig', () => {
    const i = info()
    const f = i.config ?? i.configDefault
    if (!f) return null
    if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, CONFIG_TEMPLATE) }
    // el Bloc de notas: los .conf no tienen programa asociado en Windows
    if (process.platform === 'win32') spawn('notepad.exe', [f], { detached: true, stdio: 'ignore' }).unref()
    // en Mac, con TextEdit (open -t): un .conf tampoco tiene programa asociado
    else if (process.platform === 'darwin') spawn('open', ['-t', f], { detached: true, stdio: 'ignore' }).unref()
    else void shell.openPath(f)
    return f
  })
  ipcMain.handle('napia:openSockseekPage', () => shell.openExternal(SOCKSEEK_PAGE))
  ipcMain.handle('napia:openList', async (_e, given?: string) => {
    let f = given
    if (!f) {
      const w = win()
      const r = w ? await dialog.showOpenDialog(w, { title: T.elegiLista, properties: ['openFile'], filters: [{ name: T.listas, extensions: ['csv', 'tsv', 'txt', 'm3u', 'm3u8'] }] }) : null
      if (!r || r.canceled || !r.filePaths[0]) return null
      f = r.filePaths[0]
    }
    return readListFile(f)
  })
  ipcMain.handle('napia:parseText', (_e, text: string, name: string) => toList(parseList(text), name))
  ipcMain.handle('napia:initialList', () => (initialList && fs.existsSync(initialList) ? readListFile(initialList) : null))
  ipcMain.handle('napia:destino', () => destino())
  ipcMain.handle('napia:confirmDestino', () => { save({ ...load(), destino: destino().folder }); return destino() })
  ipcMain.handle('napia:chooseDestino', async (_e, reset?: boolean) => {
    if (reset) { save({ ...load(), destino: porDefecto() }); return destino() }
    const w = win(), d = destino()
    const r = w ? await dialog.showOpenDialog(w, { title: T.dondeGuardar, defaultPath: fs.existsSync(d.folder) ? d.folder : path.dirname(d.folder), properties: ['openDirectory', 'createDirectory'] }) : null
    if (r && !r.canceled && r.filePaths[0]) save({ ...load(), destino: r.filePaths[0] })
    return destino()
  })
  ipcMain.handle('napia:options', () => ({ ...DEFAULTS, ...load().options }))
  /** La biblioteca de PAILA (su base, en solo lectura), para no bajar lo que ya tenés. */
  const pailaLib = () => readPailaLibrary(pailaDbCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.PAILA_USER_DATA))
  // el estilo que eligió PAILA (userData/estilo.json, al lado de su base): NAPIA se ve igual
  const estiloPaila = () => {
    for (const db of pailaDbCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.PAILA_USER_DATA)) {
      try { const e = (JSON.parse(fs.readFileSync(path.join(path.dirname(db), 'estilo.json'), 'utf8')) as { estilo?: string }).estilo; if (e === 'actual' || e === 'historieta') return e } catch { /* sin PAILA o sin elegir */ }
    }
    return null
  }
  ipcMain.handle('napia:estilo', estiloPaila)
  // y si se cambia en PAILA con NAPIA abierta, NAPIA lo sigue (antes había que cerrarla y abrirla: prueba de la persona 1, 31/10).
  // Se mira cada 2 s: es leer un archivo chiquito, y fs.watch en Windows avisa de más o se pierde cambios.
  let ultimo = estiloPaila()
  const mirar = setInterval(() => {
    const e = estiloPaila()
    if (e && e !== ultimo) { ultimo = e; win()?.webContents.send('napia:estilo', e) }
  }, 2000)
  app.once('will-quit', () => clearInterval(mirar))
  // el idioma que eligió PAILA: lo pide el preload al abrir, sin esperar. También vale para lo que dice el proceso
  // principal (ventanas de elegir carpeta, errores, el menú de Mac).
  ponerIdioma(idiomaNapia())
  ipcMain.on('napia:idioma', (e) => { const i = idiomaNapia(); ponerIdioma(i); e.returnValue = i })
  ipcMain.handle('napia:previous', (_e, name: string) => {
    const r = rutasTrabajo(app.getPath('userData'), name)
    return resumenIndice(r.indice, r.carpeta)
  })
  // abrir PAILA (o su Bandeja, con lo que llegó a una carpeta)
  // `tema`: en vez de la Bandeja, tu copia de ese tema en la Biblioteca (cada fila de lo que se baja: el autor, 1/11)
  ipcMain.handle('napia:verEnPaila', (_e, folder: string, tema?: string) => {
    // instalada o portable: el mismo programa sin --napia es PAILA (si ya está abierta, recibe el pedido y va a la Bandeja)
    const arg = tema ? `--buscar=${tema}` : `--bandeja=${folder}`
    if (app.isPackaged) { spawn(process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, [arg], { detached: true, stdio: 'ignore' }).unref(); return 'abierto' }
    const dir = path.join(__dirname, '../../../paila')
    if (!fs.existsSync(path.join(dir, 'package.json'))) return 'noEsta'
    spawn(process.execPath, [dir, arg], { detached: true, stdio: 'ignore' }).unref()
    return 'abierto'
  })
  ipcMain.handle('napia:openPaila', () => {
    if (isWindowOpen('PAILA')) return 'yaAbierto'
    // instalada o portable: el mismo programa sin --napia es PAILA; en desarrollo, la carpeta apps/paila
    if (app.isPackaged) { spawn(process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, [], { detached: true, stdio: 'ignore' }).unref(); return 'abierto' }
    const dir = path.join(__dirname, '../../../paila')
    if (!fs.existsSync(path.join(dir, 'package.json'))) return 'noEsta'
    spawn(process.execPath, [dir], { detached: true, stdio: 'ignore' }).unref()
    return 'abierto'
  })


  return { load, save, info, destino, pailaLib, opciones: (): NapiaOptions => ({ ...DEFAULTS, ...load().options }) }
}
