// Proceso principal de NAPIA (el panel de control para sockseek): ventana propia, nombre, ícono y carpeta de datos propios.
// Se arranca solo (`electron apps/napia`) o con el motor de PAILA y `--napia` (el acceso directo del instalador; ver
// apps/paila/electron/arranque.ts). Los pedidos de la pantalla están en ipc.ts.
// Para desarrollo: NAPIA_USER_DATA usa otra carpeta de datos; NAPIA_SNAPSHOT=archivo.png abre oculta, captura y cierra
// (NAPIA_SNAPSHOT_JS corre algo antes de capturar).
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, Menu } from 'electron'
import { macMenu } from '@paila/shared/menumac'
import { textos } from '@paila/shared/idioma'
import { registerNapia } from './ipc'
import { readListFile } from './ajustes'
import { RegistroPrueba } from '@paila/core/prueba'
import { mirarVentana } from '@paila/core/prueba-espia'

// El aviso al cerrar mientras baja (el idioma lo pone ajustes.ts al arrancar).
const T = textos({
  cortarYCerrar: { es: 'Cortar y cerrar', en: 'Stop and close' },
  seguirBajando: { es: 'Seguir bajando', en: 'Keep downloading' },
  todaviaBaja: { es: 'sockseek todavía está bajando.', en: 'sockseek is still downloading.' },
  siCerras: {
    es: 'Si cerrás, se corta. La próxima vez que abras NAPIA sigue sola donde quedó, con las listas que esperaban en la tanda.',
    en: 'If you close, it stops. The next time you open NAPIA it picks up on its own where it left off, with the lists that were waiting in the batch.',
  },
})

app.setName('NAPIA')
if (process.env.NAPIA_USER_DATA) app.setPath('userData', process.env.NAPIA_USER_DATA)
// En la portable, los datos van al lado del programa (como los de PAILA en PAILA-datos).
else if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'NAPIA-datos'))
else app.setPath('userData', path.join(app.getPath('appData'), 'NAPIA'))
// Su propio botón en la barra de tareas (no se agrupa con PAILA aunque sea el mismo motor).
app.setAppUserModelId('ar.paila.napia')

const snapshot = process.env.NAPIA_SNAPSHOT
// NAPIA_OCULTA=1: la ventana no aparece ni le roba el foco a nadie (scripts/conducir.ts y las capturas de todas las pantallas)
const oculta = !!process.env.NAPIA_OCULTA
let win: BrowserWindow | null = null

/** Un archivo de lista que vino al abrir NAPIA (por ejemplo "Abrir con NAPIA" desde PAILA o el Explorador). */
const listArg = (argv: string[]) => [...argv].reverse().find((a) => /\.(csv|tsv|txt|m3u8?)$/i.test(a) && fs.existsSync(a)) ?? null
/**
 * `--bajar` (desde Sonido de PAILA, MASTERPLAN-5 etapa 5): la lista entra a la tanda y NAPIA empieza a bajar sola, minimizada y sin
 * robar el foco: el avance se ve en PAILA. Solo si le falta algo para bajar (sockseek, la cuenta, la carpeta) se muestra adelante.
 * Al terminar queda minimizada: NAPIA nunca se trae adelante sola (el autor, 13/11; lo cuida tests/sonido-13-11.test.ts).
 */
const bajarSola = (argv: string[]) => argv.includes('--bajar')

if (!snapshot && !app.requestSingleInstanceLock()) app.quit()
else {
  const napia = registerNapia({ win: () => win, initialList: bajarSola(process.argv) ? null : listArg(process.argv) })
  /** Una lista de PAILA para bajar sola: true si NAPIA tiene que mostrarse (le falta algo para bajar). */
  const desdePaila = (f: string) => { try { return !!napia.desdePaila(readListFile(f)) } catch { return true } }
  app.on('second-instance', (_e, argv) => {
    if (!win) return
    const f0 = listArg(argv)
    if (f0 && bajarSola(argv) && !desdePaila(f0)) return // ya está bajando: ni se trae adelante
    if (win.isMinimized()) win.restore()
    win.focus()
    const f = listArg(argv)
    if (f && !bajarSola(argv)) win.webContents.send('napia:list', f)
  })

  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    // en Mac, el menú de arriba (Edición para copiar y pegar, Salir), en el idioma de PAILA (lo pone ajustes.ts al arrancar)
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate(macMenu('NAPIA') as never))
    win = new BrowserWindow({
      show: !snapshot && !oculta && !bajarSola(process.argv), width: Number(process.env.PAILA_SNAPSHOT_SIZE?.split('x')[0]) || 1120, height: Number(process.env.PAILA_SNAPSHOT_SIZE?.split('x')[1]) || 860, minWidth: 760, minHeight: 560,
      title: 'NAPIA', icon: path.join(__dirname, '../../build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'), // en Windows, el .ico (cada medida dibujada aparte) backgroundColor: '#0e1013', autoHideMenuBar: true,
      // oculta, Chromium frena la ventana y no dibuja: las capturas por el puerto de depuración se quedarían esperando
      webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: !oculta },
    })
    const inicial = bajarSola(process.argv) ? listArg(process.argv) : null
    if (inicial) win.webContents.once('did-finish-load', () => { const w = win; if (!w || oculta) { if (w) desdePaila(inicial); return } if (desdePaila(inicial)) w.show(); else { w.showInactive(); w.minimize() } })
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(path.join(__dirname, '../renderer/index.html'))
    // Mientras sockseek baja, cerrar pregunta: si sigue, sockseek se corta (lo que estaba a medias se retoma la próxima vez).
    win.on('close', (e) => {
      if (!napia.running() || snapshot) return
      const r = dialog.showMessageBoxSync(win!, { type: 'question', buttons: [T.cortarYCerrar, T.seguirBajando], defaultId: 1, cancelId: 1, title: 'NAPIA', message: T.todaviaBaja, detail: T.siCerras })
      if (r === 1) e.preventDefault()
      else void napia.cancel()
    })
    win.on('closed', () => { win = null })
    // abierta desde una PAILA en prueba con personas: anota en el mismo registro, como pantalla "NAPIA" (antes no se veía qué
    // hacía acá: en la prueba de la persona 1 quedó como 4.301 s quieto en Configuración, 31/10)
    if (process.env.PAILA_PRUEBA_REGISTRO) {
      const reg = new RegistroPrueba(process.env.PAILA_PRUEBA_REGISTRO, undefined, Number(process.env.PAILA_PRUEBA_INICIO) || undefined)
      // bajando sola desde PAILA (minimizada), la persona no fue a NAPIA: recién cuenta si la trae adelante (Sonido: "ida y vuelta")
      const w = win, mirar = () => { mirarVentana(w.webContents, reg, 'NAPIA'); reg.cambio('NAPIA') }
      if (bajarSola(process.argv)) w.once('focus', mirar); else mirar()
      win.on('focus', () => reg.volvio())
    }
    if (snapshot) {
      const w = win
      w.webContents.on('console-message', (e) => console.log(`[interfaz] ${(e as unknown as { message: string }).message}`))
      w.webContents.on('did-finish-load', () => setTimeout(async () => {
        if (process.env.NAPIA_SNAPSHOT_JS) await w.webContents.executeJavaScript(process.env.NAPIA_SNAPSHOT_JS)
        setTimeout(async () => { fs.writeFileSync(snapshot, (await w.webContents.capturePage()).toPNG()); app.quit() }, Number(process.env.NAPIA_SNAPSHOT_WAIT ?? 800))
      }, 2000))
    }
  })

  app.on('window-all-closed', () => { void napia.cancel().finally(() => app.quit()) })
  // app.quit() no pasa por window-all-closed: sockseek nunca queda corriendo solo
  app.on('will-quit', () => napia.killNow())
}
