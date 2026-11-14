// Modo prueba (PAILA_PRUEBA=<carpeta de la prueba>; scripts/prueba-personas.ts la arma): para ver a alguien que nunca vio PAILA
// usarla. Datos propios en <carpeta>/datos y, con la base vacía, la carpeta <carpeta>/Música ya puesta y escaneándose. Anota en
// <carpeta>/registros/<hora>.jsonl (core/prueba.ts) pantallas, botones tocados, avisos, errores y tareas cumplidas. Nada sale de la PC.
// Ctrl+Mayús+F1…F6 (el autor, si quiere) marca que empieza esa tarea. Se carga al importarse: antes de que se registre ningún pedido.
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { RegistroPrueba, VigiaTareas, archivoRegistro } from '@paila/core/prueba'
import { mirarVentana } from '@paila/core/prueba-espia'
import type { Ctx } from './context'

const carpeta = process.env.PAILA_PRUEBA ? path.resolve(process.env.PAILA_PRUEBA) : null
// la carpeta de datos de la prueba (salvo que se pida otra a mano): así nunca toca la base de verdad
if (carpeta) process.env.PAILA_USER_DATA ??= path.join(carpeta, 'datos')
// y NAPIA ("Bajar con NAPIA") hereda las dos: sus datos en <carpeta>/napia-datos, y la Bandeja y la base, las de la prueba
if (carpeta) process.env.NAPIA_USER_DATA ??= path.join(carpeta, 'napia-datos')
const registro = carpeta ? new RegistroPrueba(archivoRegistro(path.join(carpeta, 'registros'))) : null
// NAPIA, abierta desde esta PAILA, anota en el mismo registro (con la misma hora de arranque): así se ve qué hizo ahí
if (registro) { process.env.PAILA_PRUEBA_REGISTRO = registro.archivo; process.env.PAILA_PRUEBA_INICIO = String(registro.desde) }
/** Hasta que la carpeta de prueba no está puesta, la interfaz no pide el estado (si no, mostraría el asistente de primera vez). */
let lista: Promise<unknown> = Promise.resolve()

if (registro) {
  // cada pedido de la interfaz que falla queda anotado (lo que la persona ve, si lo ve, lo anota el espía de la pantalla)
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (canal, fn) => handle(canal, async (e, ...a) => {
    if (canal === 'state') await lista
    try { return await fn(e, ...a) } catch (err) {
      registro.anotar({ tipo: 'error', donde: canal, texto: String((err as Error)?.message ?? err).slice(0, 300) })
      throw err
    }
  })
}

function espiar(w: BrowserWindow) {
  if (!registro) return
  mirarVentana(w.webContents, registro)
  // se fue a NAPIA (u otra ventana) y volvió: la pantalla se anota de nuevo, así el tiempo de afuera no queda en la de PAILA
  let afuera = false
  w.on('blur', () => { afuera = true })
  w.on('focus', () => { if (afuera) { afuera = false; registro.volvio() } })
  // Ctrl+Mayús+F1…F10: "empieza la tarea N" (la 1 es el calentamiento) (lo aprieta quien observa; la persona no lo necesita)
  w.webContents.on('before-input-event', (e, i) => {
    // no Ctrl+Alt+número: en un teclado en castellano es AltGr (AltGr+2 escribe "@") y marcaba tareas sin querer
    if (i.type === 'keyDown' && i.control && i.shift && /^F([1-9]|10)$/.test(i.key)) { e.preventDefault(); registro.anotar({ tipo: 'marca', tarea: Number(i.key.slice(1)) }) } // no llega a la ventana (F2 edita el título)
  })
}

/** Con PAILA_PRUEBA: pone la carpeta de música de la prueba si la base está vacía, mira la ventana y las tareas. */
export function registerPrueba(c: Ctx) {
  if (!registro || !carpeta) return
  const musica = path.join(carpeta, 'Música')
  const persona = (() => { try { return fs.readFileSync(path.join(carpeta, 'persona.txt'), 'utf8').trim() } catch { return '' } })() // la deja "Empezar de nuevo"
  registro.anotar({ tipo: 'inicio', version: app.getVersion(), musica, ...(persona ? { persona } : {}) })
  if (!c.lib.roots().length && fs.existsSync(musica)) {
    lista = c.lib.addRoot(musica, []).then(() => { void c.scanThenAnalyze() })
      .catch((e) => registro.anotar({ tipo: 'error', donde: 'carpeta de prueba', texto: String((e as Error)?.message ?? e) }))
  }
  app.on('browser-window-created', (_e, w) => espiar(w))
  // los falsos repetidos del kit (scripts/prueba-personas-armar.ts): para anotar si alguien tiró uno que no era copia
  const trampas = (() => { try { return JSON.parse(fs.readFileSync(path.join(carpeta, 'trampas.json'), 'utf8')) as string[] } catch { return [] } })()
  const vigia = new VigiaTareas(c.lib.db, registro, trampas)
  const cada = setInterval(() => { try { vigia.revisar() } catch { /* la base ocupada: la próxima vuelta */ } }, 3000)
  // antes que el de main.ts, que cierra la base
  app.prependOnceListener('window-all-closed', () => { clearInterval(cada); try { vigia.revisar(true) } catch { /* base ya cerrada */ } registro.anotar({ tipo: 'fin' }) })
}
