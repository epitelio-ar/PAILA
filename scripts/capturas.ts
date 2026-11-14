// `npm run capturas`: recorre TODAS las pantallas de PAILA y de NAPIA, en los dos estilos (sobrio e historieta) y en cabina, en
// castellano y en inglés, y deja las capturas en una carpeta con fecha (capturas/2026-10-22_1530/paila/sobrio/home.png…; el
// inglés en paila/sobrio.en/…) más un `indice.json`. Sirve para ver el
// antes y el después de un cambio de interfaz sin abrir la app: `npm run capturas:comparar -- <carpeta-antes> <carpeta-despues>`.
// Abre la app COMPILADA oculta (antes: `npm run build`), de a una ventana por modo, con una COPIA de la base de esta PC y en modo
// solo mirar (PAILA_SOLO_LECTURA): ningún Aplicar o Deshacer toca la Música de nadie. No necesita ni toca la base real.
//
//   npm run capturas                                  todo, en capturas/<fecha>
//   npm run capturas -- --solo paila|napia            una sola de las dos
//   npm run capturas -- --modos sobrio,cabina         solo esos modos (sobrio, historieta, cabina)
//   npm run capturas -- --salida <carpeta> --datos <carpeta-de-datos> --tamano 1600x1000
//   --pantallas home,library                          solo esas pantallas de PAILA (la clave de la barra lateral)
//   --idiomas es,en                                   en qué idiomas (de fábrica los dos; el inglés va en <modo>.en/)
//   --escala 1.25                                     como una pantalla con esa escala de Windows (1.25 = 125 %)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { abrirApp, type App } from './conducir'
import { capturar, copiaDeLaBase } from './captura.mjs'

export type Modo = 'sobrio' | 'historieta' | 'cabina'
export const MODOS: Modo[] = ['sobrio', 'historieta', 'cabina']
export type Idioma = 'es' | 'en'
export interface Captura { app: 'paila' | 'napia'; modo: Modo; idioma?: Idioma; pantalla: string; archivo: string }
/** La carpeta de un modo: en castellano, la de siempre (así se comparan corridas viejas); en inglés, `<modo>.en`. */
export const carpetaModo = (modo: Modo, idioma: Idioma) => (idioma === 'es' ? modo : `${modo}.en`)

const t0 = Date.now()
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** El nombre de carpeta de una captura: `2026-10-22_1530`. */
export function nombreFecha(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/** Deja la ventana en un modo: sobrio (el de siempre), historieta o cabina (sobrio con alto contraste). */
export async function ponerModo(app: App, modo: Modo) {
  await app.js(`(() => {
    const h = document.documentElement, ev = (n) => window.dispatchEvent(new CustomEvent(n))
    const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
    if (${JSON.stringify(modo)} === 'historieta') { h.dataset.estilo = 'historieta'; guardar('paila.estilo', 'historieta') } else { delete h.dataset.estilo; guardar('paila.estilo', 'actual') }
    if (${JSON.stringify(modo)} === 'cabina') { h.dataset.cabina = '1'; guardar('paila.cabina', '1') } else { delete h.dataset.cabina; guardar('paila.cabina', '0') }
    ev('paila-estilo'); ev('paila-cabina')
  })()`)
  await espera(600)
}

/** Espera a que la pantalla deje de cambiar (el texto igual dos veces seguidas), hasta `max` ms. */
export async function quieta(app: App, max = 7000) {
  let antes = ''
  for (let t = 0; t < max; t += 350) {
    const ahora = await app.js<string>('document.body.innerText.length + "|" + document.querySelectorAll("img").length').catch(() => '')
    if (ahora === antes && t > 0) return
    antes = ahora
    await espera(350)
  }
}


/** Las pantallas de PAILA que se ven en la barra lateral (la clave de cada una está en `data-page`). */
async function paginasDeLaBarra(app: App): Promise<{ page: string; label: string }[]> {
  return app.js(`[...document.querySelectorAll('[data-page]')].map((b) => ({ page: b.dataset.page, label: b.textContent.trim() }))`)
}

/** Las capturas de PAILA en un modo. Cada pantalla es una clave estable (`home`, `library`…): así se pueden comparar entre corridas. */
async function capturarPaila(datos: string, carpeta: string, modo: Modo, idioma: Idioma, o: { tamano: string; puerto: number; solo?: string[]; escala?: number }): Promise<Captura[]> {
  const out: Captura[] = []
  const app = await abrirApp(datos, { puerto: o.puerto, soloLectura: true, tamano: o.tamano, argumentos: o.escala ? [`--force-device-scale-factor=${o.escala}`] : [] })
  try {
    await ponerModo(app, modo)
    await espera(2500) // que la interfaz termine de cargar sus datos
    // alguna ventana de bienvenida o aviso abierto: se cierra para ver la pantalla de abajo
    await app.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    const dir = path.join(carpeta, 'paila', carpetaModo(modo, idioma))
    const sacar = async (pantalla: string) => {
      console.log(`  ${pantalla} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
      await quieta(app)
      const archivo = path.join(dir, `${pantalla}.png`)
      await app.captura(archivo)
      out.push({ app: 'paila', modo, idioma, pantalla, archivo: path.relative(carpeta, archivo).split(path.sep).join('/') })
    }
    const quiere = (p: string) => !o.solo?.length || o.solo.includes(p)
    for (const { page } of await paginasDeLaBarra(app)) {
      if (!quiere(page)) continue
      await app.js(`document.querySelector('[data-page=${JSON.stringify(page)}]')?.click()`)
      await espera(700)
      await sacar(page)
    }
    // lo que no es una pantalla de la barra: la tabla con su panel, el buscador de todo (Ctrl+K) y el muestrario (Ctrl+Mayús+M)
    if (quiere('library')) {
      // por el rótulo: el texto entero del botón es "Todo4.705" (con la cantidad pegada). Antes se buscaba con /^(Todo|All)\b/ dentro
      // de comillas invertidas, donde \b es un retroceso: el clic en "Todo" nunca encontraba el botón y la captura salía con otra pantalla
      await app.js(`[...document.querySelectorAll('.side-item')].find((b) => ['Todo', 'All'].includes(b.querySelector('.side-label')?.textContent.trim()))?.click()`)
      await espera(1500)
      await sacar('biblioteca')
      await app.js(`document.querySelector('.tbody .tr')?.click()`)
      await espera(1500)
      await sacar('biblioteca-panel')
    }
    if (quiere('buscador')) {
      await app.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))`)
      await espera(500)
      await sacar('buscador')
      await app.js(`document.querySelector('.palette input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    }
    if (quiere('muestrario')) {
      await app.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, shiftKey: true }))`)
      await espera(800)
      await sacar('muestrario')
    }
  } finally {
    await app.cerrar().catch(() => app.matar())
  }
  return out
}

/**
 * NAPIA es una sola pantalla en tres pasos: vacía, y con una lista cargada. Se captura con su modo de captura (una ventana por foto,
 * scripts/captura.mjs): la ventana oculta de NAPIA no dibuja para el puerto de depuración y la captura se quedaba esperando.
 */
async function capturarNapia(carpeta: string, modo: Modo, idioma: Idioma, escala?: number): Promise<Captura[]> {
  const out: Captura[] = []
  const lista = path.join(carpeta, 'lista-de-prueba.csv')
  fs.writeFileSync(lista, ['Artist,Title,Album,Length', 'Daft Punk,One More Time,Discovery,320', 'Charly García,Demoliendo Tinieblas,Clics Modernos,214', ''].join('\n'))
  for (const [pantalla, argumentos] of [['vacia', []], ['con-lista', [lista]]] as [string, string[]][]) {
    const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-capturas-'))
    const archivo = path.join(carpeta, 'napia', carpetaModo(modo, idioma), `${pantalla}.png`)
    console.log(`  napia ${pantalla}`)
    try {
      capturar({ napia: true, datos, salida: archivo, tamano: '1120x860', cabina: modo === 'cabina', argumentos, escala, espera: 2500, limite: 120_000,
        js: modo === 'historieta' ? "document.documentElement.dataset.estilo = 'historieta'; window.dispatchEvent(new CustomEvent('paila-estilo')); await esperar(600)" : '' })
      out.push({ app: 'napia', modo, idioma, pantalla, archivo: path.relative(carpeta, archivo).split(path.sep).join('/') })
    } finally { try { fs.rmSync(datos, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch { /* Electron todavía la suelta: es una carpeta temporal */ } }
  }
  fs.rmSync(lista, { force: true })
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const solo = valor('--solo'), tamano = valor('--tamano') ?? '1600x1000', escala = valor('--escala') ? Number(valor('--escala')) : undefined
  const modos = (valor('--modos')?.split(',') ?? MODOS) as Modo[]
  for (const m of modos) if (!MODOS.includes(m)) { console.error(`Modo desconocido: ${m}. Son: ${MODOS.join(', ')}`); process.exit(2) }
  const idiomas = (valor('--idiomas')?.split(',') ?? ['es', 'en']) as Idioma[]
  for (const i of idiomas) if (i !== 'es' && i !== 'en') { console.error(`Idioma desconocido: ${i}. Son: es, en`); process.exit(2) }
  const carpeta = path.resolve(valor('--salida') ?? path.join('capturas', nombreFecha()))
  if (fs.existsSync(path.join(carpeta, 'indice.json'))) { console.error(`${carpeta} ya tiene capturas: elegí otra carpeta con --salida.`); process.exit(2) }
  const datos = valor('--datos') ?? copiaDeLaBase('paila-capturas-datos')
  fs.mkdirSync(carpeta, { recursive: true })
  const todas: Captura[] = []
  let puerto = 9361
  try {
    for (const idioma of idiomas) {
      process.env.PAILA_IDIOMA = idioma // la app lo toma al abrir, sin cambiar lo guardado
      for (const modo of modos) {
        if (solo !== 'napia') { console.log(`PAILA · ${modo} · ${idioma}…`); todas.push(...await capturarPaila(datos, carpeta, modo, idioma, { tamano, puerto: puerto++, solo: valor('--pantallas')?.split(','), escala })) }
        if (solo !== 'paila') { console.log(`NAPIA · ${modo} · ${idioma}…`); todas.push(...await capturarNapia(carpeta, modo, idioma, escala)) }
      }
    }
  } finally {
    let commit = ''
    try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim() } catch { /* sin git */ }
    fs.writeFileSync(path.join(carpeta, 'indice.json'), JSON.stringify({ fecha: new Date().toISOString(), commit, tamano, escala: escala ?? 1, modos, idiomas, capturas: todas }, null, 1))
  }
  console.log(`Listo: ${todas.length} capturas en ${carpeta}`)
}

if (process.argv[1] && /capturas(-[0-9a-f]+)?\.m?[jt]s$/.test(process.argv[1])) await main()
