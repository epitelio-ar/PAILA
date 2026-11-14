// Mide cuánto texto y cuántos botones tiene cada pantalla de PAILA (repaso de experiencia del 27/10): palabras visibles en el
// cuerpo, palabras en la primera pantalla (sin desplazar), botones, ⓘ, y cuánto alto se comen los avisos de arriba.
// Abre la app COMPILADA oculta con una COPIA de la base y en solo mirar (como `npm run capturas`). Antes: `npm run build`.
//   node scripts/run-ts.mjs scripts/medir-texto.ts [--salida medidas.json] [--tamano 1600x1000]
import fs from 'node:fs'
import { abrirApp } from './conducir'
import { copiaDeLaBase } from './captura.mjs'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }

const MEDIR = `(() => {
  const main = document.querySelector('main') || document.querySelector('.main') || document.body
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const palabras = (t) => (t.match(/[\\p{L}\\p{N}]+/gu) || []).length
  const alto = window.innerHeight
  let total = 0, arriba = 0
  const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentElement; if (!p || !vis(p)) continue
    const k = palabras(n.textContent); if (!k) continue
    total += k
    const r = p.getBoundingClientRect(); if (r.top < alto && r.bottom > 0) arriba += k
  }
  const botones = [...main.querySelectorAll('button, a')].filter(vis)
  const textos = botones.map((b) => b.textContent.trim()).filter(Boolean)
  const repetidos = Object.entries(textos.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {})).filter(([, c]) => c > 1).map(([t, c]) => t + ' ×' + c)
  const infos = [...main.querySelectorAll('*')].filter((e) => vis(e) && e.children.length === 0 && /^ⓘ$|^i$/.test(e.textContent.trim())).length
    + main.querySelectorAll('[class*=info], [aria-label*=Ayuda], [aria-label*=ayuda]').length
  const titulo = main.querySelector('h1')
  const avisos = titulo ? Math.round(titulo.getBoundingClientRect().top) : null
  return { total, arriba, botones: botones.length, repetidos, infos, tituloEnY: avisos, h1: titulo?.textContent.trim() ?? null }
})()`

const datos = copiaDeLaBase('paila-medir')
const app = await abrirApp(datos, { puerto: 9431, soloLectura: true, tamano: arg('--tamano') ?? '1600x1000' })
const out: Record<string, unknown>[] = []
try {
  await espera(3000)
  await app.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  const paginas: { page: string; label: string }[] = await app.js(`[...document.querySelectorAll('[data-page]')].map((b) => ({ page: b.dataset.page, label: b.textContent.trim() }))`)
  for (const { page, label } of paginas) {
    await app.js(`document.querySelector('[data-page=${JSON.stringify(page)}]')?.click()`)
    await espera(2500)
    const m = await app.js<Record<string, unknown>>(MEDIR)
    out.push({ page, label, ...m })
    console.log(page.padEnd(12), JSON.stringify(m))
  }
} finally {
  await app.cerrar().catch(() => app.matar())
}
fs.writeFileSync(arg('--salida') ?? 'medidas-texto.json', JSON.stringify(out, null, 2))
