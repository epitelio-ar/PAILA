// Pedidos de la pantalla de NAPIA: encontrar sockseek y su config, leer listas, elegir dónde baja, correr y cancelar sockseek, la tanda
// (varias listas, una detrás de otra) y su historial, y guardar lo que no se encontró. La lógica está en packages/core/sockseek/; acá solo
// se conecta. Los ajustes (sockseek, la carpeta, las opciones, abrir PAILA), en ajustes.ts; el enlace con PAILA, en enlace.ts; Un disco, en disco.ts.
// El puerto: mientras sockseek baja, NAPIA lo abre en el router (UPnP o NAT-PMP, renovado cada 20 minutos) y lo cierra al terminar; a los
// 25 s pregunta al servidor de Soulseek si desde afuera se llega. El firewall de Windows (core/sockseek/firewall.ts) se mira al probar el
// puerto y al empezar; "Arreglarlo" lo cambia con el permiso de Windows (con NAPIA_RED_FALSA, firewall y router inventados). El router
// trabado: cada 5 s mira si hay conexión; dos veces seguidas no, es la avalancha de búsquedas (la evita el sockseek con freno).
// Dónde queda lo bajado (core/sockseek/carpetas.ts): MúsicaNAPIA o la que elijas, una subcarpeta por lista; sockseek trabaja en los datos
// de NAPIA (trabajo, indices) y cada tema pasa a la carpeta de la lista cuando termina (las acciones al terminar de su config se pisan).
// La calidad real: cada tema terminado se revisa; lo trucho va a <lista>/descartados y, al terminar su tramo de 25, se busca en otra fuente
// (core/sockseek/tramos.ts y control.ts; el análisis, en calidad.ts; correr sockseek, en correr.ts). Una fuente muy lenta, o un tema que ya
// suena trucho en un pedazo (core/sockseek/muestra.ts), no frena la lista: se corta y va a otra fuente (core/sockseek/lentitud.ts). Lo que
// quedó a medio bajar de esas fuentes se borra cuando la lista termina sola. Con "Arreglar los nombres", lo que sirve llega con el nombre y
// los tags de la lista (core/sockseek/nombres.ts). napia.json guarda dónde está sockseek, la carpeta (la lee PAILA) y las opciones; nunca la cuenta.
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { DEFAULT_LISTEN_PORT } from '@paila/core/sockseek/config'
import { buildArgs, commandLine, listFileName, listRows } from '@paila/core/sockseek/args'
import { sockseekCsv, type ExportTrack } from '@paila/core/listexport'
import { anotarBajados, carpetaLista, limpiarAMedias, rutasTrabajo } from '@paila/core/sockseek/carpetas'
import { arreglarArchivo } from '@paila/core/sockseek/nombres'
import { findFfmpeg } from '@paila/core/probe'
import { ControlCalidad } from '@paila/core/sockseek/control'
import { ListaEnTramos } from '@paila/core/sockseek/tramos'
import { huellaTuya, reconocer } from './huellas'
import { SockseekRun, killTree } from '@paila/core/sockseek/run'
import { PANTALLA_WINDOWS, arreglarFirewall, leerFirewall, routerFalso } from '@paila/core/sockseek/firewall-sistema'
import { abrirPuerto, datosDeRed, hayConexion, probarDesdeAfuera, type Apertura } from '@paila/core/sockseek/router'
import { saltearTenes } from '@paila/core/sockseek/yatenes'
import type { FinLista } from '@paila/core/sockseek/enlace'; import { faltaNapia } from '@paila/core/sockseek/enlace-armar'
import { enlazarConPaila } from './enlace'
import { registerDisco } from './disco'
import { congelarTanda, guardarTanda, retomarTanda } from '@paila/core/sockseek/tanda-guardada'
import { Tanda, entradaDe, frenaLaTanda, leerHistorial, resumir, sacarDelHistorial, sumarAlHistorial } from '@paila/core/sockseek/tanda'
import { variantes } from '@paila/core/sockseek/reintento'
import type { Busqueda, NapiaList, NapiaOptions, PuertoInfo, RunStatus, SockseekInfo, TandaEstado, TandaItem, TrackProgress, YaTenes } from '@paila/shared/napia'
import { T, problemas } from './ipc.textos'
import { registerAjustes } from './ajustes'
import { registerNotas } from './notas'
import { revisorDeCalidad } from './calidad'
import { correr, extraArgs, muestrasDe, otraFuente, vigilarCorrida } from './correr'

/** El mapeo dura una hora y se renueva cada 20 minutos: si NAPIA se cae, el router lo cierra solo. */
const LEASE = 3600, RENOVAR = 20 * 60_000, PRUEBA_AFUERA = 25_000, VIGILAR = 5_000

const routerInfo = (a: Apertura): PuertoInfo['router'] => (a.ok
  ? { ok: true, via: a.mapeo.via, nombre: a.mapeo.router, confirmado: a.mapeo.confirmado, dobleNat: a.mapeo.dobleNat, externalIp: a.mapeo.externalIp }
  : { ok: false, motivo: a.motivo, detalle: a.detalle, nombre: a.router })

export function registerNapia({ win, initialList }: { win: () => BrowserWindow | null; initialList: string | null }) {
  const { load, save, info, destino, pailaLib, opciones } = registerAjustes({ win, initialList })
  registerNotas({ win })

  // ---------- el puerto ----------
  let puerto: PuertoInfo | null = null
  let apertura: Extract<Apertura, { ok: true }> | null = null
  let renovar: NodeJS.Timeout | null = null
  /** El router de verdad, o el inventado de NAPIA_RED_FALSA (así las pantallas de prueba no le hablan a ningún router). */
  const abrir = (port: number, lease: number) => routerFalso() ?? abrirPuerto(port, { lease })
  const puertoBase = (i: SockseekInfo): PuertoInfo => {
    const port = i.listenPort ?? DEFAULT_LISTEN_PORT
    return { port, desde: i.listenPort ? 'config' : 'sockseek', router: null, afuera: null, firewall: puerto?.firewall ?? null, gateway: puerto?.gateway ?? null, ipLocal: puerto?.ipLocal ?? null, probando: true }
  }
  /** Le pide al router que abra el puerto un momento y lo vuelve a cerrar: para saber antes de bajar si va a andar. */
  async function probarPuerto(): Promise<PuertoInfo> {
    const i = info()
    const p = puertoBase(i)
    puerto = p
    const [a, red, firewall] = await Promise.all([abrir(p.port, 120), datosDeRed(), i.exe ? leerFirewall(i.exe) : null])
    // si mientras tanto arrancó una bajada, el mapeo (el mismo puerto) ya es de ella: no se borra
    if (a.ok && !(run && !current.finished)) await a.cerrar()
    if (puerto === p) puerto = { ...p, router: routerInfo(a), ...red, firewall, probando: false }
    return puerto ?? p
  }
  async function cerrarPuerto() {
    if (renovar) { clearInterval(renovar); renovar = null }
    const a = apertura
    apertura = null
    if (a) await a.cerrar().catch(() => {})
  }

  // ---------- la corrida ----------
  // `run`: el sockseek que está corriendo (el de un tramo o el que busca otra fuente); `principal`: la lista, en tramos
  let run: SockseekRun | null = null
  let principal: ListaEnTramos<ExportTrack> | null = null
  let control: ControlCalidad | null = null
  const revisor = revisorDeCalidad()
  let runId = 0
  let closing: Promise<void> = Promise.resolve()
  /** El cierre de la lista que baja (revisión, otras fuentes, historial): cortar lo espera entero antes de contestar. */
  let cerrandoLista: Promise<void> = Promise.resolve()
  let current: { id: string | null; name: string; folder: string | null; freno: boolean; trabado: boolean; saltear: boolean; cortado: boolean; inicio: string; finished: RunStatus['finished'] } = { id: null, name: '', folder: null, freno: false, trabado: false, saltear: false, cortado: false, inicio: '', finished: null }
  let vigilar: NodeJS.Timeout | null = null
  // la tanda y el historial (core/sockseek/tanda.ts); guardada: si NAPIA se cierra bajando, sigue sola al abrirla (tanda-guardada.ts)
  const tanda = new Tanda(), tandaFile = path.join(app.getPath('userData'), 'tanda.json'), retomar = retomarTanda(tanda, tandaFile)
  const historialFile = () => path.join(app.getPath('userData'), 'historial.json')
  const tandaEstado = (): TandaEstado => ({ items: tanda.items, frenada: tanda.frenada })
  const pushTanda = () => { guardarTanda(tandaFile, tanda); win()?.webContents.send('napia:tanda', tandaEstado()) }
  const disco = registerDisco({ info, destino, opciones, revisor, onCambio: pushTanda }) // Un disco: primero la carpeta entera de una persona
  const status = (): RunStatus => {
    const p = principal
    // con nombre y solución: el router trabado (visto en vivo) o "no se conecta con nadie" (el patrón del registro)
    const nadie = !!p && p.nadieConecta(!!current.finished)
    const problem = p?.problem ?? (current.trabado ? { kind: 'routerTrabado' as const, text: problemas.routerTrabado(current.freno) }
      : nadie ? { kind: 'noConecta' as const, text: problemas.noConecta(current.freno) } : null)
    return {
      running: !!run && !current.finished, tandaId: current.id, listName: current.name || null, folder: current.folder,
      tracks: p?.tracks ?? [], counts: p?.counts() ?? { espera: 0, buscando: 0, bajando: 0, bajado: 0, yaEstaba: 0, noEncontrado: 0, fallo: 0, cancelado: 0 },
      peerErrors: p?.peerErrors ?? 0, problem,
      puerto: run ? puerto : null, finished: current.finished, log: [...(p?.log ?? []), ...(run && p && !p.esTramo(run) ? run.progress.log : [])].slice(-200),
      calidad: control?.cuenta() ?? null,
    }
  }
  let timer: NodeJS.Timeout | null = null
  const push = () => { if (!timer) timer = setTimeout(() => { timer = null; win()?.webContents.send('napia:status', status()) }, 150) }

  /** Lo que ya tenés en PAILA, según las opciones. */
  const yaTenes = (list: NapiaList, lib?: ReturnType<typeof pailaLib>): YaTenes => {
    const options = opciones()
    return options.saltearTenes ? saltearTenes(list.tracks, lib === undefined ? pailaLib() : lib) : { faltan: list.tracks, tenes: [], mejorar: [] }
  }
  /** Cuántos temas de cada lista en espera se van a buscar (cambia con las opciones y con lo que entra a PAILA). */
  const contarTanda = () => {
    const espera = tanda.enEspera
    if (!espera.length) return
    const options = opciones()
    const lib = options.saltearTenes ? pailaLib() : null
    for (const it of espera) it.aBajar = listRows(yaTenes(it.list, lib).faltan, options).length
  }
  ipcMain.handle('napia:setOptions', (_e, o: NapiaOptions) => { save({ ...load(), options: o }); contarTanda(); pushTanda(); return o })
  ipcMain.handle('napia:yaTenes', (_e, list: NapiaList) => yaTenes(list))

  ipcMain.handle('napia:puerto', async (_e, probar?: boolean) => {
    if (run && !current.finished) return puerto ?? puertoBase(info())
    return probar || !puerto ? probarPuerto() : puerto
  })
  // solo la puerta de enlace que encontró NAPIA, nunca una dirección que venga de la pantalla
  ipcMain.handle('napia:openRouter', () => { if (puerto?.gateway) void shell.openExternal(`http://${puerto.gateway}/`) })
  // el firewall solo necesita sockseek (no la cuenta); lo que se lee queda en el puerto
  const conFirewall = (f: PuertoInfo['firewall']) => { if (puerto) puerto = { ...puerto, firewall: f }; return f }
  ipcMain.handle('napia:firewall', async () => { const exe = info().exe; return conFirewall(exe ? await leerFirewall(exe) : null) })
  ipcMain.handle('napia:arreglarFirewall', async () => {
    const exe = info().exe
    if (!exe) return { resultado: 'nada' as const, firewall: null }
    const r = await arreglarFirewall(exe)
    conFirewall(r.firewall)
    return r
  })
  // solo las dos pantallas de Windows conocidas; con la red inventada no se abre nada
  ipcMain.handle('napia:abrirWindows', (_e, que: keyof typeof PANTALLA_WINDOWS) => { if (!process.env.NAPIA_RED_FALSA && PANTALLA_WINDOWS[que]) void shell.openExternal(PANTALLA_WINDOWS[que]) })
  /**
   * Baja una lista de la tanda. Si nada de la lista hay que buscarlo (todo está en PAILA), la da por terminada sin abrir
   * sockseek. Al terminar, la anota en el historial y sigue con la próxima (si la tanda no se frenó).
   */
  function bajar(item: TandaItem) {
    const i = info()
    if (!i.exe) throw new Error(T.sinSockseek)
    const d = destino()
    if (!d.confirmado) throw new Error(T.confirmaCarpeta)
    const options = opciones()
    const list = item.list
    const name = listFileName(list.name)
    const ya = yaTenes(list)
    const rows = listRows(ya.faltan, options)
    const folder = path.join(d.folder, carpetaLista(name))
    const inicio = new Date().toISOString()
    tanda.empezar(item.id, folder)
    current = { id: item.id, name, folder, freno: i.freno, trabado: false, saltear: false, cortado: false, inicio, finished: null }
    control = null
    if (!rows.length) {
      run = null; principal = null
      current.finished = { at: inicio, cancelled: false, exitCode: 0 }
      tanda.terminar(item.id, { resumen: resumir([], ya.tenes.length), cortada: false })
      anotar(item, [], inicio)
      pushTanda(); push()
      setImmediate(seguirSolo)
      return
    }
    const csv = path.join(app.getPath('userData'), 'listas', `${name}.csv`)
    fs.mkdirSync(path.dirname(csv), { recursive: true })
    // sockseek trabaja en los datos de NAPIA; lo terminado pasa a <destino>/<lista> (siempre la misma: lo nuevo se suma)
    const trabajo = rutasTrabajo(app.getPath('userData'), name)
    fs.mkdirSync(trabajo.trabajo, { recursive: true }); fs.mkdirSync(path.dirname(trabajo.indice), { recursive: true })
    const p = puertoBase(i)
    const argsDe = (csvPath: string, indexPath: string, vetados: string[] = []) => [...buildArgs({ csvPath, outputDir: trabajo.trabajo, options, listenPort: p.port, freno: i.freno, indexPath, sinAcciones: true, vetados }), ...extraArgs()]
    const args = argsDe(csv, trabajo.indice)
    // cada tema terminado se revisa (la calidad real) y pasa de la carpeta de trabajo a la de la lista, o a descartados
    // lo que viene a reemplazar una copia tuya (desde la lista «Faltan o suenan mal») tiene que ser claramente mejor que esa
    const tuyas = new Map(rows.filter((r) => r.reemplaza).map((r) => [`${r.artist}|${r.title}`.toLowerCase(), r.reemplaza!]))
    const ffmpeg = findFfmpeg()
    const ctl = control = new ControlCalidad({ trabajo: trabajo.trabajo, carpeta: folder, calidad: options.calidad, revisar: revisor.revisar, onCambio: push,
      tuya: (f) => tuyas.get(`${f.artist}|${f.title}`.toLowerCase()) ?? null, huellaTuya, reconocer,
      arreglar: options.arreglarNombres !== false ? (f, file) => arreglarArchivo(ffmpeg, f, file) : undefined })
    const id = ++runId; puerto = p
    // la lista en tramos: lo trucho de cada tramo va a otra fuente apenas termina (core/sockseek/tramos.ts); se vigilan las
    // fuentes lentas y un pedazo de cada tema mientras baja (correr.ts)
    const muestras = (carpeta: string) => muestrasDe(carpeta, ffmpeg, revisor, options.calidad)
    const vigilarDe = (r: SockseekRun) => (ctl.activa ? vigilarCorrida(r, ctl, false, lista.anotar, push, muestras(trabajo.carpeta)) : () => {})
    const otra = otraFuente({ nombre: name, rows, listas: path.dirname(csv), indices: path.dirname(trabajo.indice), exe: i.exe, argsDe, control: ctl, anotar: (l) => lista.anotar(l), onCambio: push,
      alArrancar: (r) => { run = r }, datos: app.getPath('userData'), muestras: (c) => (ctl.activa ? muestras(c) : null) })
    const lista: ListaEnTramos<ExportTrack> = principal = new ListaEnTramos<ExportTrack>({ rows, indice: trabajo.indice, control: ctl, vigilar: vigilarDe, otra, frenar: () => current.cortado || frenaLaTanda(status().problem?.kind),
      correr: (filas, tracks) => {
        fs.writeFileSync(csv, sockseekCsv(filas))
        const r: SockseekRun = run = correr(i.exe!, args, tracks, () => { ctl.ver(lista.tracks); push() })
        r.progress.log.push(`> ${commandLine(path.basename(i.exe!), args)}`); push()
        return r
      } })
    pushTanda()
    // el puerto se abre mientras sockseek entra a Soulseek y busca (antes de que alguien se quiera conectar)
    void Promise.all([abrir(p.port, LEASE), datosDeRed(), leerFirewall(i.exe)]).then(async ([a, red, firewall]) => {
      if (id !== runId) { if (a.ok) await a.cerrar(); return }
      puerto = { ...(puerto ?? p), router: routerInfo(a), ...red, firewall: firewall ?? p.firewall, probando: false }
      // sockseek terminó antes de que contestara el router: se dice qué contestó, y se cierra
      if (current.finished) { if (a.ok) await a.cerrar(); push(); return }
      if (a.ok) { apertura = a; renovar = setInterval(() => { void a.renovar() }, RENOVAR) }
      lista.anotar(a.ok ? T.puertoAbierto(p.port, a.mapeo.via === 'upnp' ? 'UPnP' : 'NAT-PMP', a.mapeo.confirmado) : T.puertoNo(p.port, a.detalle))
      push()
    })
    setTimeout(async () => {
      if (id !== runId || current.finished) return
      const r = await probarDesdeAfuera(p.port)
      if (id !== runId || !puerto) return
      puerto = { ...puerto, afuera: r }
      if (r) lista.anotar(T.pruebaAfuera(p.port, r))
      push()
    }, PRUEBA_AFUERA)
    // el router trabado: dos pruebas seguidas sin conexión mientras sockseek trabaja
    let fallas = 0
    if (vigilar) clearInterval(vigilar)
    vigilar = setInterval(async () => {
      if (id !== runId || current.finished) return
      const ok = await hayConexion()
      if (id !== runId || current.finished) return
      fallas = ok ? 0 : fallas + 1
      if (fallas === 2 && !current.trabado) {
        current.trabado = true
        lista.anotar(T.trabado)
        push()
      }
    }, VIGILAR)
    cerrandoLista = lista.bajar().then(async (end) => {
      if (vigilar) { clearInterval(vigilar); vigilar = null }
      void revisor.cerrar()
      ctl.reparto.cerrar(lista.tracks, trabajo.indice)
      // lo que llegó de otra fuente después de que la de la lista iba lenta: al índice, para saltearlo la próxima vez
      const fila = new Map(rows.map((r) => [`${r.artist}|${r.title}`.toLowerCase(), r]))
      try { anotarBajados(trabajo.indice, ctl.rescatados.filter((f) => f.path).map((f) => ({ ...fila.get(`${f.artist}|${f.title}`.toLowerCase()), artist: f.artist, title: f.title, path: f.path! }))) } catch { /* sin permiso: se vuelve a buscar */ }
      const cortada = end.cancelled || current.cortado
      // lo que quedó a medio bajar (una fuente lenta que se cortó): si la lista terminó sola, ya no se retoma
      if (!cortada) limpiarAMedias([trabajo.carpeta, rutasTrabajo(app.getPath('userData'), `${name} - otra fuente`).carpeta])
      current.finished = { at: new Date().toISOString(), cancelled: cortada, exitCode: end.exitCode }
      // cómo terminó: el resumen y, si hubo un problema que va a pasar igual con la próxima, la tanda se frena
      tanda.terminar(item.id, { resumen: resumir(lista.tracks, ya.tenes.length), cortada, saltear: current.saltear, problema: status().problem })
      anotar(item, lista.tracks, inicio)
      closing = cerrarPuerto()
      pushTanda(); push()
      void closing.then(seguirSolo)
    }).catch(() => { /* cortar no se queda esperando para siempre */ })
  }

  /** La lista terminada va al historial (si llegó a pasar algo). */
  function anotar(item: TandaItem, tracks: TrackProgress[], inicio: string) {
    const e = entradaDe(item, tracks, inicio, new Date().toISOString())
    if (e) fin = { lista: e.lista, hora: Date.now(), bajados: e.bajados, cortada: e.cortada, noConseguidos: e.faltan.map((f) => ({ artist: f.artist, title: f.title })) }
    if (e) { try { sumarAlHistorial(historialFile(), e); win()?.webContents.send('napia:historial') } catch { /* sin permiso: no se guarda */ } }
  }

  // el enlace con PAILA (enlace.ts): en qué anda, lo último que pasó, qué le falta para bajar y cómo terminó la última lista, cada 2 s
  let fin: FinLista | null = null
  const enlace = enlazarConPaila(() => ({ st: status(), fin, enEspera: tanda.enEspera.length, carpeta: load().destino ?? null }), () => faltaNapia(info(), destino().confirmado))

  /** La próxima de la tanda, si hay y no está frenada. Si no puede arrancar (sin sockseek, sin carpeta), se frena con el motivo. */
  function seguir() {
    if (run && !current.finished) return
    const next = tanda.siguiente()
    if (!next) return
    if (disco.pendiente(next)) { void disco.correr(next, (folder) => { tanda.empezar(next.id, folder); pushTanda() }).then((sigue) => { if (sigue) seguirSolo() }); return }
    try { bajar(next) } catch (e) {
      tanda.frenada = { motivo: (e as Error).message }
      pushTanda()
      throw e
    }
  }

  /** Lo mismo, cuando nadie espera la respuesta (al terminar una lista): si no puede, la tanda queda frenada con el motivo. */
  const seguirSolo = () => { try { seguir() } catch { /* quedó frenada con el motivo */ } }
  if (retomar) setTimeout(() => { contarTanda(); seguirSolo() }, 4000)

  ipcMain.handle('napia:start', () => {
    if (run && !current.finished) return status()
    tanda.seguir()
    contarTanda()
    seguir()
    return status()
  })
  // "Cortar" frena la tanda (lo que falta queda en espera); "Saltear esta lista" corta la actual y sigue con la próxima
  ipcMain.handle('napia:cancel', async (_e, saltear?: boolean) => {
    if (run && !current.finished) { current.saltear = !!saltear; current.cortado = true }
    await disco.cortar(); await run?.cancel(); await cerrandoLista; await closing
    return status()
  })
  // ---------- la tanda ----------
  const cambia = (fn: () => void) => { fn(); pushTanda(); return tandaEstado() }
  ipcMain.handle('napia:tanda', () => tandaEstado())
  const sumar = (list: NapiaList, reintento?: boolean) => {
    let aBajar: number | null = null
    try { aBajar = listRows(yaTenes(list).faltan, opciones()).length } catch { /* se sabe al empezar */ }
    return tanda.sumar(list, { aBajar, reintento })
  }
  ipcMain.handle('napia:sumarATanda', (_e, list: NapiaList, reintento?: boolean) => cambia(() => sumar(list, reintento)))
  ipcMain.handle('napia:sacarDeTanda', (_e, id: string) => cambia(() => tanda.sacar(id)))
  ipcMain.handle('napia:renombrarEnTanda', (_e, id: string, name: string) => cambia(() => tanda.renombrar(id, name)))
  ipcMain.handle('napia:moverEnTanda', (_e, id: string, delta: number) => cambia(() => tanda.mover(id, delta)))
  ipcMain.handle('napia:deNuevoEnTanda', (_e, id: string) => cambia(() => { tanda.deNuevo(id); contarTanda() }))
  ipcMain.handle('napia:limpiarTanda', () => cambia(() => tanda.limpiar()))
  // ---------- historial y reintento ----------
  ipcMain.handle('napia:historial', () => leerHistorial(historialFile()))
  ipcMain.handle('napia:sacarDelHistorial', (_e, id: string) => sacarDelHistorial(historialFile(), id))
  ipcMain.handle('napia:variantes', (_e, temas: Busqueda[]) => temas.map((t) => variantes(t)))
  ipcMain.handle('napia:status', () => status())
  ipcMain.handle('napia:openFolder', (_e, p: string) => { if (fs.existsSync(p)) void shell.openPath(p); else if (fs.existsSync(path.dirname(p))) void shell.openPath(path.dirname(p)) })
  // lo que no se bajó de la última lista (o los temas que mande la pantalla, desde el historial)
  ipcMain.handle('napia:saveMissing', async (_e, temas?: Busqueda[], nombre?: string) => {
    const missing = temas ?? (principal?.tracks ?? []).filter((t) => t.state === 'noEncontrado' || t.state === 'fallo' || t.calidad?.estado === 'soloFalsa')
    const w = win()
    if (!missing.length || !w) return null
    const r = await dialog.showSaveDialog(w, { title: T.guardarFaltan, defaultPath: path.join(app.getPath('documents'), `${listFileName(nombre ?? current.name)} - no se encontraron.txt`), filters: [{ name: T.texto, extensions: ['txt'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, missing.map((t) => (t.artist ? `${t.artist} - ${t.title}` : t.title)).join('\r\n') + '\r\n')
    return r.filePath
  })
  return {
    /** Una lista que mandó PAILA para bajar sola (--bajar, desde Sonido): a la tanda sin repetirla y, si NAPIA está lista, arranca. Devuelve qué le falta. */
    desdePaila: (list: NapiaList) => {
      const ya = tanda.items.find((i) => i.list.name === list.name && i.estado !== 'bajando')
      if (ya) { ya.list = list; tanda.deNuevo(ya.id) } else if (!tanda.items.some((i) => i.list.name === list.name)) sumar(list)
      enlace.mirarDeNuevo()
      const falta = faltaNapia(info(), destino().confirmado)
      if (!falta) { tanda.seguir(); contarTanda(); seguirSolo() }
      pushTanda()
      return falta
    },
    running: () => !!run && !current.finished,
    cancel: async () => { congelarTanda(tandaFile, tanda); tanda.frenada = { motivo: T.seCerro }; current.cortado = true; await run?.cancel(); await cerrandoLista; await closing; await revisor.cerrar() },
    /** Al salir de golpe (sin pasar por cerrar la ventana): corta sockseek ya, sin esperar (el puerto vence solo en una hora). */
    killNow: () => { if (run?.pid && !current.finished) killTree(run.pid); void cerrarPuerto(); void revisor.cerrar() },
  }
}
