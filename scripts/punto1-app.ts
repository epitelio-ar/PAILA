// Punto 1 sobre la Música de verdad (docs/pruebas/2026-10-24-punto-1-real.md): maneja la PAILA instalada que ya está abierta
// oculta (PAILA_OCULTA=1) con el puerto de depuración, sin tocar la pantalla de nadie. Cada llamada se conecta, hace una cosa y se
// va: la app sigue abierta (la búsqueda de nombres y el análisis siguen de fondo). Mismos botones y mismo motor que con el mouse.
//   abrir:   abre la PAILA instalada oculta (con --visible, a la vista), sobre la base de esta PC, con el puerto (deja el
//            proceso corriendo y dice su número)
//   texto:   el texto visible de la pantalla          ir <pantalla>: va a una pantalla por Ctrl+K (como el buscador de la app)
//   clic <texto> [--dentro <selector>]: aprieta el botón que dice eso      js <expresión>: evalúa en la ventana (con await)
//   captura <archivo.png>      frente: trae la ventana al frente
//
//   node scripts/run-ts.mjs scripts/punto1-app.ts abrir [--exe <PAILA.exe>]
//   node scripts/run-ts.mjs scripts/punto1-app.ts texto|captura <png>|clic <texto>|js <expr>|ir <pantalla> [--puerto 9341]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { arg, fail, log, mode } from './corte-base'

const PUERTO = Number(arg('--puerto', '9341'))
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function conectar() {
  let url: string | undefined
  for (let i = 0; i < 150 && !url; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[]
      url = pages.find((x) => x.type === 'page' && /index\.html/.test(x.url))?.webSocketDebuggerUrl
    } catch { /* todavía no */ }
    if (!url) await espera(200)
  }
  if (!url) fail(`No hay ninguna PAILA con el puerto ${PUERTO}`)
  const ws = new WebSocket(url!)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pend = new Map<number, (m: { result?: any; error?: { message: string } }) => void>()
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); pend.delete(m.id) }
  const cdp = (method: string, params: object = {}, ms = 120_000) => new Promise<any>((res, rej) => {
    const n = ++id
    const t = setTimeout(() => { pend.delete(n); rej(new Error(`La ventana no contestó ${method}`)) }, ms)
    pend.set(n, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const js = async <T>(expr: string): Promise<T> => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`En la ventana: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value as T
  }
  return { ws, cdp, js }
}

async function main() {
  if (mode === 'abrir') {
    const exe = arg('--exe') || path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'PAILA', 'PAILA.exe')
    if (!fs.existsSync(exe)) fail(`No está ${exe}`)
    // --visible: el autor quiere verla trabajar (24/10); igual con el puerto, para seguir manejándola desde acá
    const visible = process.argv.includes('--visible')
    const env: NodeJS.ProcessEnv = { ...process.env, ...(visible ? {} : { PAILA_OCULTA: '1' }) }
    for (const k of ['PAILA_USER_DATA', 'PAILA_SOLO_LECTURA', 'ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE', ...(visible ? ['PAILA_OCULTA'] : [])]) delete env[k]
    const hijo = spawn(exe, [`--remote-debugging-port=${PUERTO}`], { env, detached: true, stdio: 'ignore' })
    hijo.unref()
    log(`PAILA abierta ${visible ? 'a la vista' : 'oculta'}: proceso ${hijo.pid}, puerto ${PUERTO}`)
    const { ws, js } = await conectar()
    for (let i = 0; i < 150; i++) { if ((await js<string>('document.body.innerText').catch(() => '')).length > 20) break; await espera(200) }
    log(await js<string>('document.title'))
    ws.close()
    return
  }
  const { ws, cdp, js } = await conectar()
  try {
    const a = process.argv[3] ?? ''
    if (mode === 'texto') log(await js<string>('document.body.innerText'))
    else if (mode === 'js') log(JSON.stringify(await js(`(async () => (${a}))()`), null, 1))
    else if (mode === 'clic') {
      const dentro = arg('--dentro')
      const ok = await js<boolean>(`(() => {
        const t = ${JSON.stringify(a)}, root = ${dentro ? `document.querySelector(${JSON.stringify(dentro)})` : 'document'}
        if (!root) return false
        const els = [...root.querySelectorAll('button, a, [role=button], [role=tab], label')].filter((e) => !e.disabled && e.offsetParent !== null)
        const el = els.find((e) => e.textContent.trim() === t) ?? els.find((e) => e.textContent.trim().startsWith(t))
        if (!el) return false
        el.scrollIntoView({ block: 'center' }); el.click(); return true
      })()`)
      if (!ok) fail(`No encontré el botón "${a}"`)
      log(`Apretado: ${a}`)
    } else if (mode === 'ir') {
      // Ctrl+K y la pantalla por su nombre, como desde el teclado
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); 0`)
      await espera(300)
      const ok = await js<boolean>(`(() => { const i = document.querySelector('input[type=search], input[placeholder]'); if (!i) return false
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value').set; set.call(i, ${JSON.stringify(a)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      if (!ok) fail('No se abrió Ctrl+K')
      await espera(300)
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0`)
      await espera(800)
      log((await js<string>('document.body.innerText')).slice(0, 600))
    } else if (mode === 'frente') {
      // trae la ventana al frente (PAILA a veces no pasa al frente con un clic: el autor, 24/10)
      await cdp('Page.bringToFront')
      log('Ventana al frente')
    } else if (mode === 'captura') {
      let r: { data: string } | null = null
      for (let intento = 0; !r; intento++) {
        await js(`document.documentElement.style.outlineOffset = '${intento % 2}px'; document.documentElement.getBoundingClientRect(); 0`)
        try { r = await cdp('Page.captureScreenshot', { format: 'png' }, 4_000) } catch (e) { if (intento >= 8) throw e }
      }
      fs.mkdirSync(path.dirname(a), { recursive: true })
      fs.writeFileSync(a, Buffer.from(r.data, 'base64'))
      log(`→ ${a}`)
    } else fail(`Modo desconocido: ${mode}`)
  } finally { ws.close() }
}
await main()
