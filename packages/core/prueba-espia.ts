// El espía de la prueba con personas (PAILA_PRUEBA): lo que corre adentro de una ventana (PAILA o NAPIA) y lo que se anota en
// el registro (core/prueba.ts). Sin electron: recibe el webContents de la ventana. Nada sale de la PC.
import type { HechoPrueba, RegistroPrueba } from './prueba'

/**
 * Lo que corre adentro de la ventana: mira la pantalla (el `data-pagina` que deja Anotar.tsx), los clics (el texto del botón),
 * lo escrito en buscadores, los avisos y las ventanitas, y lo pasa al proceso principal por la consola con "[prueba] ".
 */
export const ESPIA = `(() => {
  if (window.__pailaPrueba) return; window.__pailaPrueba = true
  const mandar = (h) => console.debug('[prueba] ' + JSON.stringify(h))
  const corto = (s, n = 80) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n)
  let ultima = null
  const mirar = () => { const p = document.documentElement.dataset.pagina; if (p && p !== ultima) { ultima = p; mandar({ tipo: 'pantalla', pantalla: p }) } }
  new MutationObserver(mirar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pagina'] })
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null
    if (!t) return
    // también cuenta lo que se toca aunque no sea un botón: el rótulo de una casilla (la prende) y lo que tiene la manito
    // (una fila de la cola, una tarjeta); en la prueba de la persona 2 (01/11) las casillas de Configuración salían como "no es botón"
    const b = t.closest('button, a, [role=button], [role=tab], [role=menuitem], summary, .clickable, input[type=checkbox], input[type=radio], input[type=range], select, label[for], label:has(input)')
      || (getComputedStyle(t).cursor === 'pointer' ? t : null)
    const el = b || t.closest('input, label, tr, li') || t
    const texto = corto(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.value, 60)
    mandar({ tipo: 'clic', texto, boton: !!b })
  }, true)
  const escrito = new Map()
  document.addEventListener('input', (e) => {
    const t = e.target
    if (!(t instanceof HTMLInputElement) || !['text', 'search', ''].includes(t.type)) return
    clearTimeout(escrito.get(t)); escrito.set(t, setTimeout(() => { if (t.value.trim()) mandar({ tipo: 'escribe', donde: corto(t.getAttribute('aria-label') || t.placeholder || 'campo', 40), texto: corto(t.value, 60) }) }, 1500))
  }, true)
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement)) continue
    for (const a of n.matches('.toast') ? [n] : n.querySelectorAll('.toast')) mandar({ tipo: 'aviso', clase: (a.className.match(/toast-(\\w+)/) || [])[1] || 'info', texto: corto(a.innerText, 200) })
    for (const d of n.matches('[role=dialog]') ? [n] : n.querySelectorAll('[role=dialog]')) mandar({ tipo: 'ventana', titulo: corto((d.querySelector('h1, h2, h3') || d).innerText, 80) })
  } }).observe(document.body, { childList: true, subtree: true })
  // cada 15 s, lo que dice cada trabajo en marcha (avance, ritmo, tiempo restante): en la prueba de la persona 1 uno dijo
  // "1,1 búsquedas/min · falta 1 h 24 min" cuando faltaban 5 minutos, y sin esto no se sabe cuál ni por qué (31/10)
  setInterval(() => { for (const j of document.querySelectorAll('.job.running')) mandar({ tipo: 'trabajo', texto: corto(j.innerText, 200) }) }, 15000)
  mirar()
})()`

/** Lo mínimo del webContents de Electron que se usa. */
export interface ContenidoVentana {
  on(ev: 'did-finish-load', f: () => void): unknown
  on(ev: 'console-message', f: (e: unknown) => void): unknown
  executeJavaScript(js: string): Promise<unknown>
}

/** Pone el espía en la ventana y anota lo que manda. `fija`: el nombre de la pantalla, si la ventana no lo dice (NAPIA). */
export function mirarVentana(wc: ContenidoVentana, registro: RegistroPrueba, fija?: string) {
  wc.on('did-finish-load', () => { void wc.executeJavaScript(ESPIA).catch(() => { /* sin espía, la prueba sigue */ }) })
  wc.on('console-message', (e) => {
    const m = (e as { message: string }).message
    if (!m?.startsWith('[prueba] ')) return
    let h: HechoPrueba
    try { h = JSON.parse(m.slice(9)) } catch { return }
    if (h.tipo === 'pantalla') registro.cambio(fija ?? h.pantalla)
    else if (['clic', 'escribe', 'aviso', 'ventana', 'trabajo'].includes(h.tipo)) registro.anotar(fija ? { ...h, pantalla: fija } as HechoPrueba : h)
  })
}
