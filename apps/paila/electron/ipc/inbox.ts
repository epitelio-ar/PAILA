// IPC de la Bandeja vigilada y la lista «Faltan o suenan mal» por tema. La vigilancia corre acá, en el proceso principal: sigue
// con la ventana minimizada o en otra pantalla, y avisa con una notificación de Windows cuando llega algo para reemplazar.
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from 'electron'
import { describeCandidate } from '@paila/core/replace'
import { WorkerPool } from '@paila/core/analysis/pool'
import { InboxFlow, autoBatch } from '@paila/core/inboxflow'
import { InboxWatcher } from '@paila/core/inboxwatch'
import { DEFAULT_CRITERIA } from '@paila/core/wanted'
import { TidyNamesRunner } from '@paila/core/tidyserver'
import { bandejaCubre, napiaFolder, napiaJsonCandidates } from '@paila/core/sockseek/paila'
import { saveOpts } from './requests'
import { abrirNapia } from '../abrirnapia'
import { listaParaMejorar } from '@paila/core/wanted-napia'
import { SIGUE_NAPIA, carpetasDe, vigilarNapia } from '../enlacenapia'
import { registerSonido } from './sonido'
import { fueraDeLaPrueba } from '@paila/core/prueba'
import type { InboxAddPlan, InboxPlan, InboxWatchState, TidyRule, WantedCriteria, WantedFormat, WantedQue, WantedStatus } from '@paila/shared/types'
import type { Ctx } from '../context'
import { cant, idioma, textos } from '@paila/shared/idioma'

/**
 * Lo que se ve: la notificación de Windows, la ventana de elegir carpeta, la tarea de reemplazar. NO se traducen los nombres
 * de archivos y carpetas ("Faltan o suenan mal <día>", "PAILA - para conseguir.csv", «no-sirvió»).
 */
const T = textos({
  soloPrueba: { es: 'En la prueba, la Bandeja va dentro de la carpeta de la prueba: esa queda afuera.', en: 'In the test, the Inbox goes inside the test folder: that one stays out.' },
  reemplazadosSolos: {
    es: (n: number) => `${n} reemplazado${n > 1 ? 's' : ''} solo${n > 1 ? 's' : ''}`,
    en: (n: number) => `${n} replaced on ${n > 1 ? 'their' : 'its'} own`,
  },
  listos: { es: (n: number) => `${n} listo${n > 1 ? 's' : ''} para reemplazar`, en: (n: number) => `${n} ready to replace` },
  faltaban: { es: (n: number) => `${n} que te faltaba${n > 1 ? 'n' : ''}`, en: (n: number) => `${n} you were missing` },
  titulo: { es: 'PAILA · Bandeja', en: 'PAILA · Inbox' },
  llegaron: { es: (p: string) => `Llegaron temas: ${p}. Miralos en la Bandeja.`, en: (p: string) => `Tracks arrived: ${p}. Have a look in the Inbox.` },
  elegiCarpeta: { es: 'Elegí la carpeta de descargas a vigilar', en: 'Choose the downloads folder to watch' },
  sinBandeja: { es: 'No hay carpeta de Bandeja', en: "There's no Inbox folder" },
  reemplazando: { es: 'Reemplazando con lo de la Bandeja', en: 'Replacing with what came into the Inbox' },
  hecho: {
    es: (rep: number, rej: number, fail: number) => `${rep} reemplazados${rej ? `, ${rej} a «no-sirvió»` : ''}${fail ? `, ${fail} no se pudieron` : ''}`,
    en: (rep: number, rej: number, fail: number) => `${cant(rep, 'replaced', 'replaced')}${rej ? `, ${rej} to «no-sirvió»` : ''}${fail ? `, ${fail} couldn't be done` : ''}`,
  },
  guardarLista: { es: 'Guardar la lista «Faltan o suenan mal»', en: 'Save the "Missing or low quality" list' },
})

const CRITERIA_SETTING = 'wanted.criterios'
const AUTO_SETTING = 'inbox.auto'
/** El worker de análisis de la Bandeja se cierra solo si no se usa en este tiempo. */
const POOL_IDLE_MS = 60_000

export function registerInbox(c: Ctx) {
  const { lib, inbox, wanted, replacer } = c
  const rules = (): TidyRule[] | undefined => { try { const v = c.setting('tidy.reglas'); return v ? JSON.parse(v) as TidyRule[] : undefined } catch { return undefined } }
  const criteria = (): WantedCriteria => { try { return { ...DEFAULT_CRITERIA, ...JSON.parse(c.setting(CRITERIA_SETTING) ?? '{}') } } catch { return DEFAULT_CRITERIA } }
  const folder = () => { const d = c.setting('inbox_dir'); return d && fs.existsSync(d) ? d : null }
  const auto = () => c.setting(AUTO_SETTING) === '1'

  // un worker para analizar la calidad de lo que llega (se cierra solo cuando no hay nada que revisar)
  let pool: WorkerPool | null = null
  let poolTimer: ReturnType<typeof setTimeout> | null = null
  const describe = async (file: string) => {
    if (poolTimer) clearTimeout(poolTimer)
    pool ??= new WorkerPool(path.join(__dirname, 'analysis-worker.js'), 1)
    try { return await describeCandidate(pool, c.ffprobe, c.ffmpeg, file) } finally {
      poolTimer = setTimeout(() => { void pool?.close(); pool = null }, POOL_IDLE_MS)
    }
  }
  const flow = new InboxFlow(lib.db, inbox, wanted, replacer, { ffprobe: c.ffprobe, describe, inRekordbox: (ids) => [...c.rekordbox.exportedIds(ids)] })

  let processed = 0
  /** Cuántos reemplazó solo el modo automático desde que se abrió PAILA. */
  let autoHechos = 0
  const state = (): InboxWatchState => ({
    folder: c.setting('inbox_dir'), watching: watcher.watching, queue: watcher.pending, current: watcher.current, lastFullScan: watcher.lastFullScan, auto: auto(), error: watcher.error, processed, autoHechos,
  })
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  const push = () => { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; c.send('inbox:update', state()) }, 300) }

  // notificación de Windows si la ventana no está a la vista (se juntan las de unos segundos)
  const news = { done: 0, ready: 0, missing: 0 }
  let notifyTimer: ReturnType<typeof setTimeout> | null = null
  const notify = (what: keyof typeof news) => {
    const w = c.win()
    if (!Notification.isSupported() || (w && w.isVisible() && w.isFocused() && !w.isMinimized())) return
    news[what]++
    notifyTimer ??= setTimeout(() => {
      notifyTimer = null
      const { done, ready, missing } = news
      news.done = news.ready = news.missing = 0
      const parts = [done ? T.reemplazadosSolos(done) : '', ready ? T.listos(ready) : '', missing ? T.faltaban(missing) : ''].filter(Boolean)
      const n = new Notification({ title: T.titulo, body: T.llegaron(parts.join(', ')) })
      n.on('click', () => { const win = c.win() ?? BrowserWindow.getAllWindows()[0]; win?.show(); win?.focus() })
      n.show()
    }, 5000)
  }

  const handle = async (file: string) => {
    const r = await flow.evaluate(file)
    processed++
    const dir = folder()
    // modo automático (apagado de fábrica): solo con confianza (core/inboxflow.ts, autoItem); lo del día, una tanda del Historial
    const item = auto() && dir ? flow.autoItem(dir, file) : null
    if (item) {
      try {
        const done = await c.withPaused(() => flow.apply(dir!, { replace: [item], reject: [], rekordbox: 0 }, {}, autoBatch()))
        if (done.replaced) { autoHechos += done.replaced; notify('done'); push(); return }
      } catch { /* el candado estaba tomado: queda para "Reemplazar todos" (o para la próxima revisión) */ }
    }
    if (r.decision === 'reemplazar') notify('ready')
    if (r.decision === 'falta') notify('missing')
    push()
  }
  const watcher = new InboxWatcher({ handle, list: (p) => inbox.expand(p), canWork: () => !lib.ops.busy, onState: push })
  const restart = () => { const d = folder(); if (d) watcher.start(d); else watcher.stop(); push() }
  restart()

  // ---- bandeja ----
  ipcMain.handle('inbox:pick', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegiCarpeta, properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    if (fueraDeLaPrueba(process.env.PAILA_PRUEBA, r.filePaths[0])) throw new Error(T.soloPrueba)
    c.setSetting('inbox_dir', r.filePaths[0])
    restart()
    return r.filePaths[0]
  })
  // la carpeta de NAPIA, para ofrecerla como Bandeja (solo si la Bandeja todavía no la cubre)
  const napia = () => napiaFolder(napiaJsonCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.NAPIA_USER_DATA))
  ipcMain.handle('inbox:napia', () => { const n = napia(); return n && !bandejaCubre(c.setting('inbox_dir'), n) ? n : null })
  ipcMain.handle('inbox:useNapia', () => {
    const n = napia()
    if (!n) return null
    fs.mkdirSync(n, { recursive: true })
    c.setSetting('inbox_dir', n); c.setSetting(SIGUE_NAPIA, '1')
    restart()
    return n
  })
  // Sonido, una sola historia (ipc/sonido.ts): el estado de NAPIA arriba, mandarle lo que falta y lo que llega al Aplicar único
  const resultados = () => { const d = folder(); return d ? flow.results(d).filter((r) => { try { return !inbox.ignored(r.path) } catch { return false } }) : [] }
  const sonido = registerSonido(c, { flow, carpeta: folder, bandeja: state, resultados, wanted: () => wanted.list(criteria(), rules()),
    lista: async (que) => { const l = await listaParaNapia(false, null, que); return l && { path: l.path, count: l.count, bandeja: l.bandeja } } })
  // el enlace con NAPIA: su bajada en la barra de trabajos, la Bandeja que sigue su carpeta y lo que no consiguió (enlacenapia.ts)
  const dejar = vigilarNapia({ jobs: c.jobs, db: lib.db, carpetasNapia: () => carpetasDe(napiaJsonCandidates(app.getPath('appData'), process.env.PORTABLE_EXECUTABLE_DIR, process.env.NAPIA_USER_DATA)),
    setting: (k) => c.setting(k), setSetting: (k, v) => c.setSetting(k, v), raices: () => lib.roots().map((r) => r.path), alMirar: (e) => sonido.enlace(e),
    cambiarBandeja: (d) => { fs.mkdirSync(d, { recursive: true }); c.setSetting('inbox_dir', d); restart() }, cambioLista: () => c.send('want:limpios', false) })
  app.once('will-quit', dejar)
  ipcMain.handle('napia:traer', () => abrirNapia())
  // "Buscar mejor copia con NAPIA" desde un tema o una selección: esos temas, con la copia que ya tenés, como una lista aparte
  ipcMain.handle('napia:mejorar', (_e, ids: number[]) => {
    const text = listaParaMejorar(lib.db, ids)
    if (!text.trim()) return 0
    const file = path.join(app.getPath('userData'), 'napia', 'PAILA - mejorar estos temas.csv')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, 'utf8')
    abrirNapia([file])
    return text.trim().split(/\r?\n/).length - 1
  })
  ipcMain.handle('inbox:state', () => state())
  ipcMain.handle('inbox:results', () => resultados())
  ipcMain.handle('inbox:rescan', async () => { await watcher.rescan(); return state() })
  ipcMain.handle('inbox:recheck', async (_e, p: string) => { const r = await flow.evaluate(p, { force: true }); push(); return r })
  // al prenderlo, lo que ya estaba esperando también se mira (sin esperar la revisión de cada 3 minutos)
  ipcMain.handle('inbox:auto', (_e, on: boolean) => { c.setSetting(AUTO_SETTING, on ? '1' : '0'); if (on) void watcher.rescan(); push(); return on })
  ipcMain.handle('inbox:plan', () => { const d = folder(); return d ? flow.plan(d) : { replace: [], reject: [], rekordbox: 0 } })
  ipcMain.handle('inbox:apply', (_e, plan: InboxPlan) => {
    const d = folder()
    if (!d) throw new Error(T.sinBandeja)
    return c.jobs.run('inbox', T.reemplazando,
      (h) => c.withPaused(() => flow.apply(d, plan, { progress: (done, total, current) => h.update({ done, total, current }), cancelled: h.cancelled }), h),
      (r) => T.hecho(r.replaced, r.rejected, r.failed.length))
      .finally(push)
  })
  // "Pasar a tu Música": lo que llegó y no tenías (core/inboxadd.ts). Mueve archivos: candado y análisis en pausa; después
  // escanea (así aparecen en la biblioteca) y analiza.
  ipcMain.handle('inbox:addPlan', () => { const d = folder(); return c.inboxAdd.plan(d ? flow.results(d).filter((r) => { try { return !inbox.ignored(r.path) } catch { return false } }) : []) })
  ipcMain.handle('inbox:addApply', async (_e, plan: InboxAddPlan, chosen: string[]) => {
    // con la Bandeja elegida, también saca los ZIP que quedaron sin temas (core/inboxflow.ts, addToMusic)
    const r = await c.withPaused(() => { const d = folder(); return d ? flow.addToMusic(d, c.inboxAdd, plan, chosen) : c.inboxAdd.apply(plan, chosen) })
    push()
    if (r.added) void c.scanThenAnalyze()
    return r
  })
  ipcMain.handle('inbox:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('inbox:inspect', (_e, paths: string[]) => inbox.inspect(paths, { includeIgnored: true }))
  ipcMain.handle('inbox:ignore', (_e, p: string) => inbox.ignore(p))

  // ---- faltan o suenan mal (por tema) ----
  // los nombres limpios ("Arreglar nombres", una pasada por toda la Música) en un hilo aparte: la lista sale enseguida con los
  // nombres de los tags y la pantalla la vuelve a pedir cuando llega el aviso (usabilidad, 2.ª tanda, P1)
  const nombres = new TidyNamesRunner(path.join(__dirname, 'tidy-worker.js'))
  wanted.limpios.enHilo((r) => nombres.run({ file: path.join(c.userData, 'paila.db'), idioma: idioma(), rules: r, nombres: true }), (l) => c.send('want:limpios', l))
  ipcMain.handle('want:criteria', () => criteria())
  ipcMain.handle('want:list', (_e, crit?: WantedCriteria, playlistId?: number | null) => {
    if (crit) c.setSetting(CRITERIA_SETTING, JSON.stringify(crit))
    return wanted.list(crit ?? criteria(), rules(), playlistId)
  })
  // el tema se guarda con su nombre limpio: se espera al hilo (si ya terminó, no espera nada)
  ipcMain.handle('want:status', async (_e, key: string, s: WantedStatus, note?: string) => { await wanted.limpios.limpiar(rules()); wanted.setStatus(key, s, note, rules()) })
  ipcMain.handle('want:missing', (_e, artist: string, title: string, refFileId: number | null) => wanted.addMissing(artist, title, refFileId))
  ipcMain.handle('want:export', async (_e, format: WantedFormat, onlyNew: boolean, playlistId?: number | null, que?: WantedQue) => {
    const day = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(c.win()!, saveOpts(T.guardarLista, `Faltan o suenan mal ${day}`, format))
    if (r.canceled || !r.filePath) return null
    await wanted.limpios.limpiar(rules())
    const out = wanted.export(format, criteria(), { onlyNew, rules: rules(), playlistId, que })
    fs.writeFileSync(r.filePath, out.text, 'utf8')
    return { path: r.filePath, count: out.count, marked: out.marked }
  })
  // "Bajar con NAPIA": la misma lista para sockseek, en los datos de PAILA, y NAPIA abierta con ella (si ya estaba abierta,
  // la recibe y la carga). Siempre el mismo archivo: NAPIA guarda en "Música\NAPIA\PAILA - para conseguir" y, la próxima
  // vez, lo que ya bajó lo saltea. Lleva la nota de cada copia que tenés: NAPIA se queda solo con una claramente mejor.
  // Sonido (ipc/sonido.ts) manda la misma lista, pero NAPIA la baja sola (--bajar)
  ipcMain.handle('want:napia', async (_e, onlyNew: boolean, playlistId?: number | null, que: WantedQue = 'todo') => {
    const l = await listaParaNapia(onlyNew, playlistId, que)
    if (l) abrirNapia([l.path])
    return l
  })
  async function listaParaNapia(onlyNew: boolean, playlistId: number | null | undefined, que: WantedQue) {
    await wanted.limpios.limpiar(rules())
    const out = wanted.export('napia-csv', criteria(), { onlyNew, rules: rules(), playlistId, que })
    if (!out.count) return null
    // cada parte con su nombre: en NAPIA es otra lista (y otra carpeta), y se puede bajar una antes que la otra
    const file = path.join(app.getPath('userData'), 'napia', `PAILA - ${que === 'calidad' ? 'mejorar calidad' : que === 'faltan' ? 'lo que falta' : 'para conseguir'}.csv`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, out.text, 'utf8')
    // si la Bandeja todavía no vigila ninguna carpeta, vigila la de NAPIA: si no, lo bajado se queda ahí y nunca llega a la
    // Música (prueba con personas, 31/10). Solo mira: lo que llega igual pasa por "Pasar a tu Música" o, si es mejor, por Sonido.
    let bandeja: string | null = null
    if (!folder()) {
      bandeja = napia() ?? (process.env.PAILA_PRUEBA ? path.join(process.env.PAILA_PRUEBA, 'Descargas NAPIA') : path.join(app.getPath('music'), 'NAPIA'))
      fs.mkdirSync(bandeja, { recursive: true })
      c.setSetting('inbox_dir', bandeja); c.setSetting(SIGUE_NAPIA, '1')
      restart()
    }
    return { path: file, count: out.count, marked: out.marked, bandeja }
  }
}
