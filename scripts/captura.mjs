// Captura una pantalla de PAILA (o NAPIA) sin tocar nada: abre la app compilada oculta, con una carpeta de datos aparte,
// va a la pantalla pedida por Ctrl+K, corre lo que se le pida y guarda la foto. Es la base de las capturas antes/después
// y del video. Antes: `npm run build`.
//
//   npm run captura -- "Análisis"                               → captura-analisis.png
//   npm run captura -- "Inicio" --salida x.png --cabina --tamano 1920x1080
//   npm run captura -- "Música" --js "await esperar(500); document.querySelector('.tbody .tr').click()" --espera 6000
//   npm run captura -- --napia --salida napia.png
//   --limite <segundos>: cuánto se espera en total antes de darla por colgada (120 de fábrica)
//   --arg <x>: se le pasa a la app al abrirla (por ejemplo --arg "--bandeja=C:\carpeta", el "Ver en PAILA" de NAPIA)
//
// Datos: --datos <carpeta> (o PAILA_USER_DATA). Sin eso, usa una COPIA de la base de esta PC en una carpeta temporal
// (nunca la base real). La copia apunta a la Música de verdad: por eso la app se abre SOLO PARA MIRAR (PAILA_SOLO_LECTURA,
// no toca ningún archivo aunque el guion apriete Aplicar o Deshacer). --escribir lo saca: solo con datos de prueba. Helpers dentro de --js: esperar(ms), ir(textoDeLaBarraLateral), irA(pantallaPorCtrlK),
// buscar(texto), tocarFila(n) (doble clic: suena), elegirFila(n), boton(texto, ms) (aprieta el botón que empieza así).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rutaApp, rutaElectron } from './app-ruta.mjs'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')

function leerArgs(argv) {
  const o = { pantalla: null, salida: null, cabina: false, tamano: '1600x1000', js: '', espera: 3500, datos: process.env.PAILA_USER_DATA ?? null, napia: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--salida') o.salida = argv[++i]
    else if (a === '--cabina') o.cabina = true
    else if (a === '--escribir') o.escribir = true
    else if (a === '--tamano') o.tamano = argv[++i]
    else if (a === '--js') o.js = argv[++i]
    else if (a === '--espera') o.espera = Number(argv[++i])
    else if (a === '--datos') o.datos = argv[++i]
    else if (a === '--napia') o.napia = true
    else if (a === '--limite') o.limite = Number(argv[++i]) * 1000
    else if (a === '--arg') (o.args ??= []).push(argv[++i])
    else if (a === '--escala') o.escala = Number(argv[++i])
    else if (!a.startsWith('--')) o.pantalla = a
  }
  return o
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pantalla'

/** Una copia de la base de esta PC en una carpeta temporal (se rehace en cada corrida: nunca se toca la real). */
export function copiaDeLaBase(carpeta = 'paila-captura') {
  const real = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'PAILA')
  if (!fs.existsSync(path.join(real, 'paila.db'))) throw new Error('No hay base de PAILA en esta PC: pasá --datos <carpeta>.')
  // una carpeta por corrida (con el número de proceso): dos sesiones capturando a la vez se pisaban la copia (EPERM, 23/10)
  const dst = path.join(os.tmpdir(), `${carpeta}-${process.pid}`)
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })
  process.on('exit', () => { try { fs.rmSync(dst, { recursive: true, force: true }) } catch { /* la app todavía la tiene abierta: queda en temporales */ } })
  for (const f of ['paila.db', 'paila.db-wal', 'paila.db-shm']) if (fs.existsSync(path.join(real, f))) fs.copyFileSync(path.join(real, f), path.join(dst, f))
  return dst
}

/** Lo que corre adentro de la ventana antes de capturar: sin animaciones, helpers y la navegación. */
export function guion({ pantalla, cabina, js }) {
  const comillas = (s) => JSON.stringify(s)
  return `(async () => {
    document.head.insertAdjacentHTML('beforeend', '<style>*{animation:none!important;transition:none!important}</style>')
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
    const ir = (t) => { const b = [...document.querySelectorAll('.side-item')].find((x) => x.textContent.trim().startsWith(t)); if (b) b.click(); return !!b }
    const irA = async (t) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await esperar(400)
      const inp = document.querySelector('.palette input'); if (!inp) return false
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, t); inp.dispatchEvent(new Event('input', { bubbles: true })); await esperar(300)
      const b = [...document.querySelectorAll('.palette .cmd')].find((x) => x.querySelector('.cmd-label')?.textContent.trim() === t) || document.querySelector('.palette .cmd')
      if (b) b.click(); await esperar(600); return !!b
    }
    const buscar = async (t) => { const i = document.querySelector('.searchbox input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, t); i.dispatchEvent(new Event('input', { bubbles: true })); await esperar(1500) }
    const filas = () => document.querySelectorAll('.tbody .tr')
    const tocarFila = async (n = 0) => { filas()[n]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await esperar(2500) }
    const elegirFila = async (n = 0) => { filas()[n]?.click(); await esperar(1500) }
    // espera hasta 8 s a que aparezca el botón (las pantallas cargan sus datos al abrir) y lo aprieta
    const boton = async (t, ms = 1500) => { let b = null; for (let i = 0; i < 40 && !b; i++) { b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t) && !x.disabled); if (!b) await esperar(200) } b?.click(); await esperar(ms); return !!b }
    ${cabina ? "document.documentElement.dataset.cabina = '1'; window.dispatchEvent(new CustomEvent('paila-cabina'))" : ''}
    await esperar(500)
    ${pantalla ? `if (!ir(${comillas(pantalla)})) await irA(${comillas(pantalla)})` : ''}
    ${js}
    if (document.querySelector('.palette')) document.querySelector('.palette input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })()`
}

export function capturar(opciones) {
  const o = { ...leerArgs([]), ...opciones }
  const salida = path.resolve(o.salida ?? `captura-${slug(o.pantalla ?? (o.napia ? 'napia' : 'inicio'))}.png`)
  fs.mkdirSync(path.dirname(salida), { recursive: true }) // la app guarda la foto sin crear la carpeta
  const datos = o.datos ?? copiaDeLaBase()
  // se comprueba antes de abrir nada: con una ruta mala Electron muestra una ventana de error
  const exe = rutaElectron(RAIZ), app = rutaApp(RAIZ)
  const pre = o.napia ? 'NAPIA' : 'PAILA'
  const env = { ...process.env, [`${pre}_USER_DATA`]: datos, [`${pre}_SNAPSHOT`]: salida, PAILA_SNAPSHOT_SIZE: o.tamano, [`${pre}_SNAPSHOT_JS`]: guion(o) + `.then(() => new Promise((r) => setTimeout(r, ${o.espera})))`, NAPIA_SNAPSHOT_WAIT: String(o.espera), ...(o.escribir ? {} : { PAILA_SOLO_LECTURA: '1' }) }
  // `argumentos` es el nombre que usa scripts/capturas.ts (la lista de NAPIA); `args`, el de la línea de comandos
  const extra = [...(o.escala ? [`--force-device-scale-factor=${o.escala}`] : []), ...(o.args ?? []), ...(o.argumentos ?? [])]
  const r = spawnSync(exe, [app, ...(o.napia ? ['--napia'] : []), ...extra], { env, encoding: 'utf8', timeout: o.limite ?? 120000 })
  // CAPTURA_LOG=1: muestra lo que la interfaz escribió en la consola (para depurar el --js)
  if (process.env.CAPTURA_LOG) console.log(String(r.stdout || '').split('\n').filter((l) => l.includes('[interfaz]')).join('\n'))
  if (!fs.existsSync(salida)) throw new Error(`No salió la captura (${r.status}). ${String(r.stderr || '').split('\n').slice(-5).join('\n')}`)
  return salida
}

if (process.argv[1] && path.basename(process.argv[1]) === 'captura.mjs' && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const o = leerArgs(process.argv.slice(2))
  console.log('Listo:', capturar(o))
}
