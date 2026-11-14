// Segunda tanda de la prueba de usabilidad (27/10/2026): recorre TODAS las pantallas de PAILA en uno o varios tamaños de ventana
// (pantallas chicas, zoom de Windows) y en un idioma, y en cada una mide lo que se rompe a la vista:
//   - si el botón principal (el primer `.btn` lleno de la pantalla) se ve sin desplazar;
//   - si algo se sale por la derecha (desplazamiento de costado), textos cortados y controles encimados;
//   - cuánto tarda en abrir (para la biblioteca de 100.000 temas) y si la ventana se congela (un pedido de JS que no vuelve);
//   - textos en castellano que quedaron sin traducir (con --idioma en).
// Además abre Ctrl+K y la ayuda de atajos (?) y mira que entren y que Escape las cierre.
// Abre la app COMPILADA oculta, con una COPIA de la base y en solo mirar (PAILA_SOLO_LECTURA). Antes: `npm run build`.
//   node scripts/run-ts.mjs scripts/pantallas.ts [--tamanos 1366x728,1280x680] [--idioma en] [--datos <carpeta>] [--salida <carpeta>] [--sin-fotos] [--saltar wishlist,dups]
// El tamaño es el de la ventana entera (con la barra de título): una pantalla de 1366×768 maximizada deja 1366×728 (la barra de tareas).
import fs from 'node:fs'
import path from 'node:path'
import { abrirApp, type App } from './conducir'
import { copiaDeLaBase } from './captura.mjs'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }

/** Las pantallas, por el `data-page` de la barra lateral (las de la Biblioteca, por el texto del renglón). */
export const PANTALLAS: { clave: string; barra?: string; biblioteca?: string }[] = [
  { clave: 'home', barra: 'home' }, { clave: 'escuchando', barra: 'escuchando' }, { clave: 'problemas', barra: 'problemas' },
  { clave: 'progress', barra: 'progress' }, { clave: 'stats', barra: 'stats' }, { clave: 'space', barra: 'space' },
  { clave: 'musica', biblioteca: 'Todo|All' },
  { clave: 'tidy', barra: 'tidy' }, { clave: 'online', barra: 'online' }, { clave: 'dups', barra: 'dups' }, { clave: 'organize', barra: 'organize' },
  { clave: 'albums', barra: 'albums' }, { clave: 'comprimidos', barra: 'comprimidos' }, { clave: 'tracklist', barra: 'tracklist' },
  { clave: 'wishlist', barra: 'wishlist' }, { clave: 'inbox', barra: 'inbox' }, { clave: 'volumen', barra: 'volumen' }, { clave: 'silencios', barra: 'silencios' },
  { clave: 'requests', barra: 'requests' }, { clave: 'folderpl', barra: 'folderpl' }, { clave: 'carry', barra: 'carry' },
  { clave: 'rekordbox', barra: 'rekordbox' }, { clave: 'setbuilder', barra: 'setbuilder' }, { clave: 'separar', barra: 'separar' },
  { clave: 'playlists', barra: 'playlists' }, { clave: 'history', barra: 'history' }, { clave: 'trash', barra: 'trash' }, { clave: 'settings', barra: 'settings' },
]

/** Lo que se mide en la pantalla abierta (corre adentro de la ventana). */
export const MEDIR = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
  const main = document.querySelector('main') || document.body
  const W = innerWidth, H = innerHeight
  const mr = main.getBoundingClientRect()
  const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 60)
  // el botón principal: el primer botón lleno (no fantasma, no peligro, no chico) de la pantalla
  const prim = [...main.querySelectorAll('button.btn:not(.ghost):not(.danger):not(.small)')].find(vis)
  let principal = null
  if (prim) { const r = prim.getBoundingClientRect(); principal = { texto: txt(prim), arriba: Math.round(r.top), abajo: Math.round(r.bottom), aLaVista: r.top >= mr.top && r.bottom <= Math.min(H, mr.bottom) && r.right <= W } }
  // ¿algo se sale por la derecha? (sin contar lo que está adentro de algo que se desplaza de costado a propósito, como la tabla)
  const seDesplazaDeCostado = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden' || s.overflowX === 'clip') && p !== document.documentElement) return p } return null }
  const salen = []
  for (const el of main.querySelectorAll('*')) {
    if (salen.length >= 8) break
    if (!vis(el) || el.children.length > 0 && !el.innerText) continue
    const r = el.getBoundingClientRect()
    if (r.right > Math.min(W, mr.right) + 2 && r.left < W) { const c = seDesplazaDeCostado(el); if (!c || c === main) salen.push({ que: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''), texto: txt(el), derecha: Math.round(r.right) }) }
  }
  // textos cortados: la caja es más chica que su texto (con "…" o sin)
  const cortados = []
  for (const el of main.querySelectorAll('button, .btn, .tab, label, h1, h2, h3, .side-label, .count, th, .th, span, a')) {
    if (cortados.length >= 12) break
    if (!vis(el) || !el.innerText || el.innerText.trim().length <= 2 || el.children.length > 2) continue
    const s = getComputedStyle(el)
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2) cortados.push(txt(el))
  }
  // controles encimados: dos botones o campos que se pisan (sin que uno esté adentro del otro)
  const ctl = [...main.querySelectorAll('button, input, select, textarea, a')].filter(vis).map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.bottom > 0 && x.r.top < H).slice(0, 400)
  const encimados = []
  for (let i = 0; i < ctl.length && encimados.length < 6; i++) for (let j = i + 1; j < ctl.length && encimados.length < 6; j++) {
    const a = ctl[i], b = ctl[j]
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
    if (x > 4 && y > 4) encimados.push(txt(a.el) + ' ⟷ ' + txt(b.el))
  }
  // lo que tapa la parte de abajo (reproductor, Cambios pendientes): cuánto alto le queda a la pantalla
  const pagina = document.querySelector('main .page') || main
  return { ventana: W + 'x' + H, alto: Math.round(mr.height), desplazable: Math.round(main.scrollHeight - main.clientHeight), costado: document.documentElement.scrollWidth > W + 1 || main.scrollWidth > main.clientWidth + 2, principal, salen, cortados, encimados, texto: main.innerText.slice(0, 20000) }
})()`

/** Palabras que delatan un texto en castellano en la interfaz en inglés (las comunes; con tildes o eñe, casi seguro). */
const CASTELLANO = /\b(que|los|las|del|una|para|con|por|tus|temas?|carpetas?|todavía|también|después|ningún|ninguna|cambios|buscar|ver|abrir|elegir|tenés|podés|está|están|música|calidad|papelera)\b|[áéíóúñ¿¡]/i

export function sinTraducir(texto: string): string[] {
  const nombres = /Música|Deezer|MusicBrainz|Rekordbox|Serato|Traktor|Charly|García|Soda|Tití|Bad Bunny|F:\\|\.mp3|\.flac/i
  return [...new Set(texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 2 && CASTELLANO.test(l) && !nombres.test(l)))]
}

async function ir(app: App, p: (typeof PANTALLAS)[number]) {
  if (p.barra) return app.js<boolean>(`(() => { const b = document.querySelector('[data-page=${JSON.stringify(p.barra)}]'); if (!b) return false; b.click(); return true })()`)
  // la Biblioteca arranca plegada: se abre su grupo primero
  await app.js(`(() => { const t = [...document.querySelectorAll('.side-group-title')].find((b) => /^(Biblioteca|Library)$/i.test(b.textContent.trim())); if (t && !t.classList.contains('open')) t.click(); return 0 })()`)
  await espera(200)
  return app.js<boolean>(`(() => { const re = new RegExp('^(${p.biblioteca})'); const b = [...document.querySelectorAll('.side-item')].find((e) => re.test(e.querySelector('.side-label')?.textContent ?? '')); if (!b) return false; b.click(); return true })()`)
}

/** Espera a que la pantalla quede quieta (el texto deja de cambiar) y devuelve cuánto tardó. Si la ventana no contesta, la da por congelada. */
async function hastaQuieta(app: App, maxMs = 20_000) {
  const t0 = Date.now()
  let antes = '', quieta = 0
  while (Date.now() - t0 < maxMs) {
    const r = await Promise.race([app.js<string>(`(document.querySelector('main')?.innerText ?? '').length + ':' + (document.querySelector('main')?.innerText ?? '').slice(0, 400)`), espera(5_000).then(() => null)])
    if (r === null) return { ms: Date.now() - t0, congelada: true }
    if (r === antes) { if (++quieta >= 3) return { ms: Date.now() - t0 - 300, congelada: false } } else { quieta = 0; antes = r }
    await espera(100)
  }
  return { ms: maxMs, congelada: false, sinQuietarse: true }
}

/** Ctrl+K y la ayuda de atajos: que entren en la ventana, que el pie no quede tapado y que Escape cierre. */
async function ventanas(app: App) {
  const tecla = (key: string, extra = '') => app.js(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true${extra} })); 0`)
  const caja = (sel: string) => app.js<{ arriba: number; abajo: number; alto: number } | null>(`(() => { const m = document.querySelector(${JSON.stringify(sel)}); if (!m) return null; const r = m.getBoundingClientRect(); return { arriba: Math.round(r.top), abajo: Math.round(r.bottom), alto: innerHeight, recortada: m.scrollHeight > m.clientHeight + 2 } })()`)
  const out: Record<string, unknown> = {}
  await tecla('k', ', ctrlKey: true'); await espera(400)
  out.ctrlK = await caja('.palette')
  await tecla('Escape'); await espera(300)
  out.ctrlKCerroConEscape = !(await caja('.palette'))
  await app.js(`document.activeElement?.blur?.(); 0`)
  await tecla('?'); await espera(400)
  out.atajos = await caja('.modal.atajos')
  await tecla('Escape'); await espera(300)
  out.atajosCerroConEscape = !(await caja('.modal.atajos'))
  return out
}

async function main() {
  const tamanos = (arg('--tamanos') ?? '1366x728,1280x680,1536x824,1093x574').split(',')
  const idioma = arg('--idioma')
  const salida = path.resolve(arg('--salida') ?? 'pantallas')
  const fotos = !process.argv.includes('--sin-fotos')
  const datos = arg('--datos') ?? copiaDeLaBase('paila-pantallas')
  fs.mkdirSync(salida, { recursive: true })
  const todo: Record<string, unknown[]> = {}
  for (const tam of tamanos) {
    const app = await abrirApp(datos, { puerto: 9483, soloLectura: true, tamano: tam })
    const filas: unknown[] = []
    try {
      await espera(3000)
      if (idioma) {
        await app.js(`window.paila.setIdioma(${JSON.stringify(idioma)}).then(() => location.reload())`).catch(() => { /* se recargó antes de contestar */ })
        await espera(4000)
        await app.js(`document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>'); 0`)
      }
      await app.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`)
      const saltar = arg('--saltar')?.split(',') ?? []
      for (const p of PANTALLAS.filter((x) => !saltar.includes(x.clave))) {
        const t0 = Date.now()
        const ok = await ir(app, p).catch(() => false)
        if (!ok) { filas.push({ pantalla: p.clave, falta: true }); console.log(`${tam} ${p.clave}: no está en la barra`); continue }
        const q = await hastaQuieta(app)
        const m = await Promise.race([app.js<Record<string, unknown>>(MEDIR), espera(20_000).then(() => ({ congelada: true }))]) as Record<string, any>
        const { texto, ...resto } = m
        const fila = { pantalla: p.clave, abre: Date.now() - t0, quieta: q.ms, congelada: q.congelada || !!m.congelada, ...resto, ...(idioma ? { sinTraducir: sinTraducir(texto ?? '') } : {}) }
        filas.push(fila)
        if (fotos) await app.captura(path.join(salida, `${tam}${idioma ? '-' + idioma : ''}`, `${p.clave}.png`)).catch(() => { /* congelada */ })
        console.log(`${tam} ${p.clave}: ${fila.quieta} ms · principal ${m.principal ? (m.principal.aLaVista ? 'a la vista' : `ABAJO (${m.principal.arriba} px) «${m.principal.texto}»`) : '—'}${m.costado ? ' · SE SALE DE COSTADO' : ''}${m.salen?.length ? ` · salen ${m.salen.length}` : ''}${m.cortados?.length ? ` · cortados ${m.cortados.length}` : ''}${m.encimados?.length ? ` · encimados ${m.encimados.length}` : ''}${fila.congelada ? ' · CONGELADA' : ''}${idioma && (fila as any).sinTraducir.length ? ` · sin traducir ${(fila as any).sinTraducir.length}` : ''}`)
      }
      await ir(app, PANTALLAS[0])
      await espera(800)
      filas.push({ ventanas: await ventanas(app) })
    } finally { await app.cerrar().catch(() => app.matar()) }
    todo[tam] = filas
    fs.writeFileSync(path.join(salida, `pantallas${idioma ? '-' + idioma : ''}.json`), JSON.stringify(todo, null, 1))
  }
}

if (process.argv[1] && /pantallas(-[0-9a-f]+|-\d+)?\.m?[jt]s$/.test(process.argv[1])) await main()
