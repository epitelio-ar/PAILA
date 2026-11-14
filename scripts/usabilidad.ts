// Prueba de usabilidad con tareas (27/10/2026): hace cada tarea como la haría alguien que solo mira la pantalla (sin Ctrl+K), desde el
// Inicio, y mide lo que cuesta: clics, pantallas, palabras a la vista en cada pantalla (sin desplazar), cuántas veces hubo que
// desplazar para encontrar el botón y en qué paso no se encontró. Saca una captura por paso.
// Abre la app COMPILADA oculta con una COPIA de la base y en solo mirar (PAILA_SOLO_LECTURA): buscar duplicados o nombres lee la Música,
// pero ningún Aplicar toca archivos. Antes: `npm run build`.
//   node scripts/run-ts.mjs scripts/usabilidad.ts [--barra (solo mide la barra lateral)] [--salida <carpeta>] [--tareas duplicados,nombres] [--datos <carpeta>]
import fs from 'node:fs'
import path from 'node:path'
import { abrirApp, type App } from './conducir'
import { copiaDeLaBase } from './captura.mjs'
import { seccionDe } from '../apps/paila/ui/src/secciones'
import type { PageKey } from '../apps/paila/ui/src/nav'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }

/** Un paso: apretar algo de la barra lateral (`barra`) o un botón por su texto (`boton`), o escribir en un campo; después, esperar un texto. */
type Paso = { barra?: string; boton?: string | RegExp; escribir?: { selector: string; texto: string }; esperar?: string | RegExp; /** esperar a que este texto se vaya (una búsqueda en marcha) */ hastaQueNo?: string; ms?: number }
interface Tarea { clave: string; persona: string; meta: string; pasos: Paso[] }

const LISTA = ['Daft Punk - One More Time', 'Charly García - Demoliendo Hoteles', 'Soda Stereo - De Música Ligera', 'Bad Bunny - Tití Me Preguntó', 'Fleetwood Mac - Dreams'].join('\n')

export const TAREAS: Tarea[] = [
  { clave: 'duplicados', persona: 'mucha música, nada de DJ', meta: 'Sacá los temas repetidos', pasos: [
    { barra: 'dups' }, { boton: 'Buscar duplicados', hastaQueNo: 'Buscando', ms: 300_000 },
  ] },
  { clave: 'nombres', persona: 'mucha música, nada de DJ', meta: 'Arreglá los nombres raros', pasos: [
    { barra: 'tidy' }, { boton: 'Analizar mi Música', hastaQueNo: 'Analizando', ms: 300_000 },
  ] },
  { clave: 'pendrive', persona: 'primera vez', meta: 'Llevá tu playlist al pendrive', pasos: [
    { barra: 'carry' },
  ] },
  { clave: 'spotify', persona: 'primera vez', meta: 'Traé una lista de Spotify y conseguí lo que falta', pasos: [
    { barra: 'requests' }, { escribir: { selector: 'textarea', texto: LISTA } }, { boton: /^Ver qué tengo/, esperar: /tenés|falta/i, ms: 60_000 },
  ] },
  { clave: 'rekordbox', persona: 'DJ apurado', meta: 'Exportá a Rekordbox', pasos: [
    { barra: 'rekordbox' },
  ] },
]

const MEDIR = `(() => {
  const main = document.querySelector('main') || document.querySelector('.main') || document.body
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const palabras = (t) => (t.match(/[\\p{L}\\p{N}]+/gu) || []).length
  let arriba = 0
  const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentElement; if (!p || !vis(p)) continue
    const r = p.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) arriba += palabras(n.textContent)
  }
  const botones = [...main.querySelectorAll('button, a, select, input[type=checkbox]')].filter((b) => { if (!vis(b)) return false; const r = b.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 })
  return { palabras: arriba, controles: botones.length, botones: botones.map((b) => b.textContent.trim()).filter(Boolean).slice(0, 40) }
})()`

/** ¿Se ve sin desplazar? Para la barra lateral, dentro de su parte que se desplaza; para un botón, dentro de la ventana. */
async function aLaVista(app: App, p: Paso): Promise<boolean | null> {
  if (p.barra) return app.js(`(() => { const b = document.querySelector('[data-page=${JSON.stringify(p.barra)}]'); if (!b) return null; const s = b.closest('.side-scroll') ?? document.body; const r = b.getBoundingClientRect(), q = s.getBoundingClientRect(); return r.top >= q.top && r.bottom <= q.bottom })()`)
  if (p.boton) {
    const re = typeof p.boton === 'string' ? `^${p.boton.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : p.boton.source
    return app.js(`(() => { const re = new RegExp(${JSON.stringify(re)}); const b = [...document.querySelectorAll('button, a')].find((e) => re.test(e.textContent.trim()) && e.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()`)
  }
  return true
}

async function hacer(app: App, p: Paso) {
  if (p.barra) { await app.js(`(() => { const b = document.querySelector('[data-page=${JSON.stringify(p.barra)}]'); b.scrollIntoView({ block: 'center' }); b.click() })()`); return }
  if (p.escribir) { await app.escribir(p.escribir.selector, p.escribir.texto); return }
  if (typeof p.boton === 'string') { await app.clic(p.boton); return }
  if (p.boton) {
    const ok = await app.js<boolean>(`(() => { const re = new RegExp(${JSON.stringify(p.boton.source)}); const b = [...document.querySelectorAll('button, a')].find((e) => re.test(e.textContent.trim()) && e.offsetParent && !e.disabled); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true })()`)
    if (!ok) throw new Error(`No encontré el botón ${p.boton}`)
  }
}

/** La barra lateral sola: cuánto ocupa el pie y a qué altura (desde arriba de la barra) queda cada herramienta, sin desplazar. */
export const MEDIR_BARRA = `(() => {
  const side = document.querySelector('.side'), sc = document.querySelector('.side-scroll'), foot = document.querySelector('.side-foot')
  const s0 = sc.getBoundingClientRect()
  const pos = {}
  for (const b of document.querySelectorAll('.side-scroll [data-page]')) { const r = b.getBoundingClientRect(); pos[b.dataset.page] = { desdeArriba: Math.round(r.top - s0.top), aLaVista: r.top >= s0.top && r.bottom <= s0.bottom } }
  return { alturaBarra: Math.round(side.getBoundingClientRect().height), pie: Math.round(foot.getBoundingClientRect().height), zonaQueSeDesplaza: Math.round(s0.height), contenido: sc.scrollHeight, renglonesDePlaylist: document.querySelectorAll('.pl-item').length, herramientas: pos }
})()`

async function barra(salida: string, datos: string) {
  const app = await abrirApp(datos, { puerto: 9481, soloLectura: true, tamano: '1600x1000' })
  try {
    await espera(3000)
    const m = await app.js(MEDIR_BARRA)
    await app.captura(path.join(salida, 'barra.png'))
    fs.writeFileSync(path.join(salida, 'barra.json'), JSON.stringify(m, null, 1))
    console.log(JSON.stringify(m))
  } finally { await app.cerrar().catch(() => app.matar()) }
}

async function main() {
  const salida = path.resolve(arg('--salida') ?? 'usabilidad')
  const solo = arg('--tareas')?.split(',')
  const datos = arg('--datos') ?? copiaDeLaBase('paila-usabilidad')
  fs.mkdirSync(salida, { recursive: true })
  if (process.argv.includes('--barra')) { await barra(salida, datos); return }
  const resultados: unknown[] = []
  for (const t of TAREAS.filter((x) => !solo || solo.includes(x.clave))) {
    const app = await abrirApp(datos, { puerto: 9481, soloLectura: true, tamano: '1600x1000' })
    const r = { tarea: t.clave, persona: t.persona, meta: t.meta, clics: 0, desplazamientos: 0, palabras: 0, pantallas: [] as unknown[], falla: null as string | null }
    try {
      await espera(3000)
      await app.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      const inicio = await app.js<{ palabras: number }>(MEDIR)
      r.palabras += inicio.palabras
      for (const [i, p] of t.pasos.entries()) {
        // desde las pestañas (01/11), la barra lateral muestra solo las partes de la pestaña elegida: primero se toca la pestaña
        if (p.barra && !(await app.js<boolean>(`!!document.querySelector('[data-page=${JSON.stringify(p.barra)}]')`))) {
          const s = seccionDe(p.barra as PageKey)
          if (s) { await app.js(`document.querySelector('.pestana[data-seccion=${s.id}]')?.click()`); r.clics++; await espera(800) }
        }
        const vista = await aLaVista(app, p)
        if (vista === null) { r.falla = `paso ${i + 1}: no está ${JSON.stringify(p.barra ?? String(p.boton))}`; break }
        if (!vista) r.desplazamientos++
        await hacer(app, p)
        if (!p.escribir) r.clics++
        if (p.hastaQueNo) {
          await espera(1500)
          const t0 = Date.now()
          while (Date.now() - t0 < (p.ms ?? 30_000) && (await app.texto()).includes(p.hastaQueNo)) await espera(1000)
        }
        if (p.esperar) await app.esperarTexto(p.esperar, p.ms ?? 30_000).catch((e) => { r.falla = `paso ${i + 1}: ${(e as Error).message}` })
        await espera(1500)
        const m = await app.js<{ palabras: number; controles: number; botones: string[] }>(MEDIR)
        r.palabras += m.palabras
        const foto = path.join(salida, `${t.clave}-${i + 1}.png`)
        await app.captura(foto)
        r.pantallas.push({ paso: i + 1, aLaVista: vista, ...m, foto: path.basename(foto) })
        console.log(`${t.clave} ${i + 1}: a la vista ${vista} · ${m.palabras} palabras · ${m.controles} controles`)
        if (r.falla) break
      }
    } catch (e) { r.falla = (e as Error).message } finally { await app.cerrar().catch(() => app.matar()) }
    resultados.push(r)
  }
  fs.writeFileSync(path.join(salida, 'usabilidad.json'), JSON.stringify(resultados, null, 1))
  for (const x of resultados as { tarea: string; clics: number; desplazamientos: number; palabras: number; falla: string | null }[]) console.log(`${x.tarea.padEnd(11)} clics ${x.clics} · desplazar ${x.desplazamientos} · palabras ${x.palabras}${x.falla ? ` · FALLA ${x.falla}` : ''}`)
}

if (process.argv[1] && /usabilidad(-[0-9a-f]+|-\d+)?\.m?[jt]s$/.test(process.argv[1])) await main()
