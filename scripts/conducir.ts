// Maneja la app COMPILADA desde afuera, como si alguien apretara los botones: la abre con otra carpeta de datos
// (PAILA_USER_DATA) y el puerto de depuración de Chromium, y por ese puerto aprieta botones, lee la pantalla y saca capturas.
// Lo usan las pruebas de corte real (scripts/corte.ts app|abrir|historial) y de Vaciar papelera (scripts/vaciar.ts).
// `matar()` hace taskkill /F sobre ESE proceso y sus hijos (nunca sobre otros Electron abiertos).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { rutaApp, rutaElectron } from './app-ruta.mjs'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface App {
  pid: number
  /** Evalúa JavaScript en la ventana (con await) y devuelve el resultado. */
  js<T = unknown>(expr: string): Promise<T>
  /** Aprieta el botón (o enlace) cuyo texto es `texto` (o empieza así). Falla si no está. */
  clic(texto: string, opciones?: { dentroDe?: string }): Promise<void>
  /** Escribe en un campo (como si se tipeara: React se entera). */
  escribir(selector: string, texto: string): Promise<void>
  /** Espera a que aparezca un texto en la pantalla. */
  esperarTexto(texto: string | RegExp, ms?: number): Promise<void>
  /** El texto visible de la pantalla. */
  texto(): Promise<string>
  captura(archivo: string): Promise<void>
  /** Aprieta una tecla de verdad (como el teclado: llega a lo que tiene el foco), con Ctrl, Mayús o Alt si se piden. */
  tecla(key: string, mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean }): Promise<void>
  /** Cierra como el usuario (cierra la ventana) y espera a que termine el proceso. */
  cerrar(): Promise<void>
  /** Corte: mata el proceso y sus hijos sin dejarlo hacer nada más. */
  matar(): void
  terminado: Promise<number | null>
  /** Lo que la ventana escribió en la consola, sus errores y si se recargó (para entender una falla). */
  consola: string[]
}

/**
 * `napia`: abre NAPIA (el mismo motor con --napia) en vez de PAILA. `soloLectura`: PAILA_SOLO_LECTURA, para una copia de la base que
 * apunta a la Música de verdad (ningún Aplicar o Deshacer toca archivos). `tamano`: "1600x1000". `argumentos`: de más (NAPIA: una lista).
 */
export async function abrirApp(datos: string, opciones: { puerto?: number; log?: string; napia?: boolean; soloLectura?: boolean; tamano?: string; argumentos?: string[] } = {}): Promise<App> {
  // se comprueba antes de abrir nada: con una ruta mala Electron muestra una ventana de error
  const ELECTRON = rutaElectron(), APP = rutaApp()
  const puerto = opciones.puerto ?? 9339
  const salida = opciones.log ? fs.openSync(opciones.log, 'a') : 'ignore'
  const hijo: ChildProcess = spawn(ELECTRON, [`--remote-debugging-port=${puerto}`, APP, ...(opciones.napia ? ['--napia'] : []), ...(opciones.argumentos ?? [])], {
    env: {
      ...process.env, PAILA_USER_DATA: datos, PAILA_OCULTA: '1', ELECTRON_RENDERER_URL: '',
      ...(opciones.napia ? { NAPIA_USER_DATA: datos, NAPIA_OCULTA: '1' } : {}), ...(opciones.soloLectura ? { PAILA_SOLO_LECTURA: '1' } : {}), ...(opciones.tamano ? { PAILA_SNAPSHOT_SIZE: opciones.tamano } : {}),
    },
    stdio: ['ignore', salida, salida],
  })
  const terminado = new Promise<number | null>((r) => hijo.on('exit', (c) => r(c)))
  let vivo = true
  void terminado.then(() => { vivo = false })
  // la ventana aparece en la lista del puerto de depuración cuando cargó la interfaz
  let ws: WebSocket | null = null
  for (let i = 0; i < 300 && !ws; i++) {
    if (!vivo) throw new Error('La app se cerró al abrir')
    try {
      const pages = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[]
      const p = pages.find((x) => x.type === 'page' && /index\.html/.test(x.url))
      if (p) {
        const s = new WebSocket(p.webSocketDebuggerUrl)
        await new Promise((res, rej) => { s.onopen = res; s.onerror = rej })
        ws = s
      }
    } catch { /* todavía no */ }
    if (!ws) await espera(200)
  }
  if (!ws) throw new Error('No apareció la ventana de PAILA')
  let id = 0
  const pend = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>()
  const consola: string[] = []
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data))
    if (m.method === 'Runtime.consoleAPICalled') consola.push(`${m.params.type}: ${m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ')}`.slice(0, 500))
    else if (m.method === 'Runtime.exceptionThrown') consola.push(`ERROR: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`.slice(0, 800))
    else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) consola.push(`(la ventana cargó de nuevo: ${m.params.frame.url})`)
    pend.get(m.id)?.(m); pend.delete(m.id)
  }
  const cdp = (method: string, params: object = {}, ms = 60_000) => new Promise<any>((res, rej) => {
    const n = ++id
    // un pedido que nunca vuelve (ventana que no dibuja, app colgada) falla en vez de dejar todo esperando
    const t = setTimeout(() => { pend.delete(n); rej(new Error(`La ventana no contestó ${method} en ${ms / 1000} s`)) }, ms)
    pend.set(n, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result) })
    ws!.send(JSON.stringify({ id: n, method, params }))
  })
  const js = async <T>(expr: string): Promise<T> => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`En la ventana: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value as T
  }
  const texto = () => js<string>('document.body.innerText')
  const esperarTexto = async (t: string | RegExp, ms = 30_000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const s = await texto().catch(() => '')
      if (typeof t === 'string' ? s.toLowerCase().includes(t.toLowerCase()) : t.test(s)) return
      await espera(150)
    }
    throw new Error(`No apareció "${t}" en ${ms / 1000} s`)
  }
  await cdp('Runtime.enable'); await cdp('Page.enable')
  // oculta, la ventana no tiene el foco y el teclado no le llega (ni se ve el contorno del foco): se le hace creer que sí
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { /* Electron viejo */ })
  // la interfaz tiene que haber arrancado (React montado)
  for (let i = 0; i < 100; i++) { if ((await texto().catch(() => '')).length > 20) break; await espera(200) }
  // sin animaciones: las capturas salen enteras
  await js(`document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>')`)
  return {
    pid: hijo.pid!,
    js,
    texto,
    esperarTexto,
    async clic(t, o = {}) {
      const ok = await js<boolean>(`(() => {
        const t = ${JSON.stringify(t)}, root = ${o.dentroDe ? `document.querySelector(${JSON.stringify(o.dentroDe)})` : 'document'}
        if (!root) return false
        const els = [...root.querySelectorAll('button, a, [role=button], [role=tab]')].filter((e) => !e.disabled && e.offsetParent !== null)
        const el = els.find((e) => e.textContent.trim() === t) ?? els.find((e) => e.textContent.trim().startsWith(t))
        if (!el) return false
        el.scrollIntoView({ block: 'center' }); el.click(); return true
      })()`)
      if (!ok) throw new Error(`No encontré el botón "${t}"`)
    },
    async escribir(selector, t) {
      const ok = await js<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
        set.call(el, ${JSON.stringify(t)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true
      })()`)
      if (!ok) throw new Error(`No encontré el campo ${selector}`)
    },
    async tecla(key, mods = {}) {
      const especiales: Record<string, [string, number]> = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27], ' ': ['Space', 32], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Delete: ['Delete', 46], Home: ['Home', 36], End: ['End', 35] }
      const [code, vk] = especiales[key] ?? [/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '', key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0]
      const modifiers = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.shift ? 8 : 0)
      const texto = key === 'Enter' ? '\r' : key.length === 1 && !mods.ctrl && !mods.alt ? key : undefined
      await cdp('Input.dispatchKeyEvent', { type: texto ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(texto ? { text: texto } : {}) })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
    },
    async captura(archivo) {
      // una ventana oculta que no cambia no dibuja cuadros nuevos y la captura se queda esperando: antes de cada intento se le fuerza uno
      let r: { data: string } | null = null
      for (let intento = 0; !r; intento++) {
        await js(`document.documentElement.style.outlineOffset = '${intento % 2}px'; document.documentElement.getBoundingClientRect(); 0`)
        try { r = await cdp('Page.captureScreenshot', { format: 'png' }, 4_000) } catch (e) { if (intento >= 8) throw e }
      }
      fs.mkdirSync(path.dirname(archivo), { recursive: true })
      fs.writeFileSync(archivo, Buffer.from(r.data, 'base64'))
    },
    async cerrar() {
      // sin esperar la respuesta: la ventana se cierra antes de contestar, y una promesa que nunca vuelve dejaba a Node
      // terminar callado (sin correr lo que seguía)
      void js('window.close()').catch(() => { /* ya se cerró */ })
      const t = await Promise.race([terminado, espera(60_000).then(() => 'tarde')])
      if (t === 'tarde') throw new Error('La app no se cerró en 60 s')
    },
    matar() {
      // primero el proceso principal, al instante (TerminateProcess, lo mismo que taskkill /F): es el que mueve los archivos.
      // taskkill /T tarda unos 200 ms en armar el árbol, y en ese tiempo Organizar mueve decenas de temas más.
      try { process.kill(hijo.pid!, 'SIGKILL') } catch { /* ya terminó */ }
      // después, sus hijos (ventana, placa de video, análisis): siguen anotados con el padre muerto
      const ps = `function k($p){Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" | ForEach-Object { k $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}; k ${hijo.pid}`
      try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', timeout: 30_000 }) } catch { /* ya no estaban */ }
    },
    terminado,
    consola,
  }
}
