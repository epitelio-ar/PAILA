// Segunda tanda de la prueba de usabilidad (27/10/2026): PAILA solo con teclado. Aprieta teclas de verdad (no eventos de mentira)
// y mide, para las 5 tareas del kit (docs/prueba-personas/hoja-probador.md):
//   - cuántos Tab hacen falta desde el Inicio hasta el control de cada paso, y si se llega;
//   - en cada parada del Tab: si se ve dónde está el foco (contorno o sombra) y si quedó a la vista;
//   - en cada pantalla: lo que se puede apretar con el mouse pero no con el teclado (cursor de mano y sin foco);
//   - Ctrl+K: que lleve a TODAS las pantallas escribiendo su nombre y Enter; Escape cierra.
// Abre la app COMPILADA oculta con una COPIA de la base y en solo mirar (PAILA_SOLO_LECTURA). Antes: `npm run build`.
//   node scripts/run-ts.mjs scripts/teclado.ts [--salida <carpeta>] [--datos <carpeta>] [--tamano 1366x728]
import fs from 'node:fs'
import path from 'node:path'
import { abrirApp, type App } from './conducir'
import { copiaDeLaBase } from './captura.mjs'

/** Lo que alguien escribiría en Ctrl+K para cada pantalla, y la pantalla a la que tiene que llevar. */
const NAV_PALABRAS: [string, string][] = [
  ['Inicio', 'home'], ['Escuchando', 'escuchando'], ['Centro de problemas', 'problemas'], ['Análisis', 'progress'], ['Estadísticas', 'stats'], ['Espacio', 'space'],
  ['Arreglar nombres', 'tidy'], ['Completar desde internet', 'online'], ['Duplicados', 'dups'], ['Organizar', 'organize'], ['Discos y tapas', 'albums'],
  ['ZIP', 'comprimidos'], ['Tracklist', 'tracklist'], ['Faltan o suenan mal', 'wishlist'], ['Bandeja', 'inbox'], ['Volumen', 'volumen'],
  ['Recortar silencios', 'silencios'], ['Traer una lista', 'requests'], ['Carpetas', 'folderpl'], ['Llevar la música', 'carry'], ['Programas de DJ', 'rekordbox'],
  ['Armar un set', 'setbuilder'], ['Separar voz', 'separar'], ['Playlists', 'playlists'], ['Historial', 'history'], ['Papelera', 'trash'], ['Configuración', 'settings'],
  // lo que alguien nuevo escribiría con sus palabras
  ['repetidos', 'dups'], ['pendrive', 'carry'], ['spotify', 'requests'], ['rekordbox', 'rekordbox'], ['nombres', 'tidy'],
]

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }

/** Dónde está el foco ahora: qué es, si se ve el contorno y si está a la vista. */
const FOCO = `(() => {
  const el = document.activeElement
  if (!el || el === document.body) return { nada: true }
  const s = getComputedStyle(el)
  const contorno = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none')
  // las casillas y radios dibujan el foco en la etiqueta de al lado
  const lab = el.closest('label, .casilla'); const sl = lab ? getComputedStyle(lab) : null
  const enEtiqueta = !!sl && ((sl.outlineStyle !== 'none' && parseFloat(sl.outlineWidth) > 0) || (sl.boxShadow && sl.boxShadow !== 'none'))
  const r = el.getBoundingClientRect()
  const main = document.querySelector('main')
  return { texto: (el.innerText || el.getAttribute('aria-label') || el.title || el.placeholder || el.value || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 50), tag: el.tagName.toLowerCase(), clase: typeof el.className === 'string' ? el.className.split(' ')[0] : '', pagina: el.dataset?.page ?? null, enMain: !!main?.contains(el), enBarra: !!el.closest('.side'), seVe: contorno || enEtiqueta, aLaVista: r.bottom > 0 && r.top < innerHeight && r.width > 0 }
})()`

/** Lo que tiene cursor de mano en la pantalla pero no se puede alcanzar con Tab (ni está adentro de algo que sí). */
const SOLO_MOUSE = `(() => {
  const main = document.querySelector('main')
  const foco = (el) => el.matches('button:not([disabled]), a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')
  const out = []
  for (const el of main.querySelectorAll('*')) {
    const s = getComputedStyle(el)
    if (s.cursor !== 'pointer' || foco(el)) continue
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
    let p = el.parentElement, cubierto = false
    for (; p && p !== main; p = p.parentElement) if (foco(p)) { cubierto = true; break }
    if (cubierto || el.querySelector('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) continue
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer' && !foco(el.parentElement)) continue
    out.push(((el.innerText || el.title || el.getAttribute('aria-label') || el.className) + '').trim().replace(/\\s+/g, ' ').slice(0, 50))
  }
  return [...new Set(out)]
})()`

interface Parada { texto: string; tag: string; clase: string; pagina: string | null; enMain: boolean; enBarra?: boolean; seVe: boolean; aLaVista: boolean; nada?: boolean }

/** Aprieta una flecha (u otra tecla) hasta que el foco cumpla `llegó` (o `max` veces). */
async function teclaHasta(app: App, tecla: string, llego: (p: Parada) => boolean, max = 120) {
  for (let i = 0; i < max; i++) {
    await app.tecla(tecla)
    await espera(30)
    if (llego(await app.js<Parada>(FOCO))) return { veces: i + 1, llego: true }
  }
  return { veces: max, llego: false }
}

/** Aprieta Tab hasta que el foco cumpla `llegó` (o `max` veces). Devuelve las paradas. */
async function tabHasta(app: App, llego: (p: Parada) => boolean, max = 120) {
  const paradas: Parada[] = []
  for (let i = 0; i < max; i++) {
    await app.tecla('Tab')
    await espera(30)
    const p = await app.js<Parada>(FOCO)
    paradas.push(p)
    if (llego(p)) return { tabs: i + 1, llego: true, paradas }
  }
  return { tabs: max, llego: false, paradas }
}

const resumen = (ps: Parada[]) => ({ sinContorno: [...new Set(ps.filter((p) => !p.nada && !p.seVe).map((p) => `${p.tag}.${p.clase} «${p.texto}»`))], fueraDeVista: [...new Set(ps.filter((p) => !p.nada && !p.aLaVista).map((p) => p.texto))].slice(0, 10) })

async function main() {
  const salida = path.resolve(arg('--salida') ?? 'teclado')
  const datos = arg('--datos') ?? copiaDeLaBase('paila-teclado')
  fs.mkdirSync(salida, { recursive: true })
  const app = await abrirApp(datos, { puerto: 9485, soloLectura: true, tamano: arg('--tamano') ?? '1366x728' })
  const out: Record<string, unknown> = {}
  const inicio = async () => { await app.tecla('Escape'); await app.js(`document.querySelector('[data-page=home]').click(); 0`); await espera(600); await app.js(`document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); 0`) }
  // después de abrir el Inicio (que se lleva el foco a la pantalla): el body con tabindex se puede enfocar, así el próximo Tab
  // arranca desde arriba y no desde lo último que tuvo el foco
  try {
    await espera(3000)

    // 1. Mirá cómo está tu música: desde el Inicio, ¿cuántos Tab hasta lo primero de la pantalla (y no de la barra)?
    await inicio()
    const t1 = await tabHasta(app, (p) => p.enMain)
    out.mirar = { tabsHastaLaPantalla: t1.tabs, llego: t1.llego, primeras: t1.paradas.slice(0, 6).map((p) => p.texto), ...resumen(t1.paradas) }
    out.mirarSoloMouse = await app.js(SOLO_MOUSE)
    // el mismo camino con «Saltar al contenido»: Tab, Enter y Tab
    await inicio()
    await app.tecla('Tab')
    const primero = await app.js<Parada>(FOCO)
    let conSaltar: Record<string, unknown> = { primerTab: primero.texto }
    if (/Saltar al contenido|Skip to content/.test(primero.texto)) {
      await app.tecla('Enter'); await espera(200)
      const s = await tabHasta(app, (p) => p.enMain, 20)
      conSaltar = { ...conSaltar, tabsHastaLaPantalla: 1 + s.tabs, llego: s.llego, primeraDeLaPantalla: s.paradas.at(-1)?.texto }
    }
    out.mirarConSaltar = conSaltar
    await app.captura(path.join(salida, '1-inicio-foco.png'))

    // las tareas que van a una herramienta: Tab hasta la barra, flechas ↓ hasta su renglón (P2, 27/10: la barra es una sola
    // parada del Tab), Enter, y Tab hasta el botón del paso. También: cuántos Tab para salir de la barra.
    const tarea = async (clave: string, pagina: string, boton: RegExp) => {
      await inicio()
      const entrar = await tabHasta(app, (p) => !!p.enBarra, 40)
      const flechas = entrar.llego ? await teclaHasta(app, 'ArrowDown', (p) => p.pagina === pagina) : { veces: 0, llego: false }
      let salir: number | null = null
      if (flechas.llego) {
        const s = await tabHasta(app, (p) => !p.enBarra, 40)
        salir = s.llego ? s.tabs : null
        await app.tecla('Tab', { shift: true }); await espera(60) // de vuelta al renglón
      }
      const a = { tabs: entrar.tabs + flechas.veces, llego: flechas.llego, paradas: entrar.paradas, entrar: entrar.tabs, flechas: flechas.veces, salir }
      if (a.llego) { await app.tecla('Enter'); await espera(1200) }
      const b = a.llego ? await tabHasta(app, (p) => p.enMain && boton.test(p.texto)) : { tabs: 0, llego: false, paradas: [] as Parada[] }
      await app.captura(path.join(salida, `${clave}-foco.png`))
      out[clave] = { teclasHastaLaHerramienta: a.tabs, tabsParaEntrarALaBarra: a.entrar, flechasHastaLaHerramienta: a.flechas, tabsParaSalirDeLaBarra: a.salir, llegoALaHerramienta: a.llego, tabsHastaElBoton: b.tabs, llegoAlBoton: b.llego, ...resumen([...a.paradas, ...b.paradas]), soloMouse: await app.js(SOLO_MOUSE) }
      console.log(clave, JSON.stringify(out[clave]))
    }
    await tarea('duplicados', 'dups', /^Buscar duplicados/)
    await tarea('nombres', 'tidy', /^Analizar mi Música/)
    await tarea('traerLista', 'requests', /^Elegir archivo|Pegar|textarea/i)
    await tarea('pendrive', 'carry', /Elegí una playlist|^Elegí/)

    // 4 bis: Traer una lista pegando texto, todo con teclado: pestaña o campo de texto, escribir, "Ver qué tengo"
    await inicio()
    await app.js(`document.querySelector('[data-page=requests]').click(); 0`); await espera(1000); await app.js(`document.activeElement?.blur(); 0`)
    const ta = await tabHasta(app, (p) => p.tag === 'textarea', 60)
    let traer: Record<string, unknown> = { tabsHastaElCampo: ta.tabs, llegoAlCampo: ta.llego }
    if (ta.llego) {
      for (const c of 'Daft Punk - One More Time') await app.tecla(c)
      const v = await tabHasta(app, (p) => /^Ver qué tengo/.test(p.texto), 20)
      traer = { ...traer, tabsHastaVerQueTengo: v.tabs, llegoAVerQueTengo: v.llego }
      if (v.llego) { await app.tecla('Enter'); await espera(4000); const c = await tabHasta(app, (p) => /^Crear la playlist/.test(p.texto), 80); traer = { ...traer, tabsHastaCrear: c.tabs, llegoACrear: c.llego, ...resumen([...v.paradas, ...c.paradas]) } }
    }
    out.traerListaPegando = traer
    await app.captura(path.join(salida, 'traer-lista-teclado.png'))

    // 5 bis: Llevar la música: elegir la playlist con el teclado (flechas en el desplegable)
    await inicio()
    await app.js(`document.querySelector('[data-page=carry]').click(); 0`); await espera(1000); await app.js(`document.activeElement?.blur(); 0`)
    const sel = await tabHasta(app, (p) => p.tag === 'select', 40)
    if (sel.llego) { await app.tecla('ArrowDown'); await espera(300) }
    const elegida = await app.js<string>(`document.activeElement?.tagName === 'SELECT' ? document.activeElement.selectedOptions[0]?.textContent : ''`)
    const dest = await tabHasta(app, (p) => /^Elegir la carpeta/.test(p.texto), 40)
    out.pendriveTeclado = { tabsHastaLaLista: sel.tabs, playlistElegida: elegida, tabsHastaCarpeta: dest.tabs, llegoACarpeta: dest.llego, ...resumen([...sel.paradas, ...dest.paradas]) }

    // Ctrl+K: cada pantalla por su nombre
    const ctrlK: { nombre: string; esperada: string; llego: string | null; ok: boolean }[] = []
    for (const [nombre, esperada] of NAV_PALABRAS) {
      await inicio()
      await app.tecla('k', { ctrl: true }); await espera(250)
      for (const c of nombre) await app.tecla(c)
      await espera(200); await app.tecla('Enter'); await espera(700)
      const llego = await app.js<string | null>(`document.querySelector('.side-item.on[data-page], .side-ico-btn.on[data-page]')?.dataset.page ?? (document.querySelector('.side-item.on') ? 'biblioteca' : null)`)
      const abierta = await app.js<boolean>(`!!document.querySelector('.palette')`)
      if (abierta) await app.tecla('Escape')
      ctrlK.push({ nombre, esperada, llego, ok: llego === esperada })
    }
    out.ctrlK = { total: ctrlK.length, bien: ctrlK.filter((x) => x.ok).length, mal: ctrlK.filter((x) => !x.ok) }
    console.log('Ctrl+K', JSON.stringify(out.ctrlK))

    // Escape: la paleta, la ayuda de atajos (?) y una ventana compartida (Ventana): la de Anotar del reproductor no siempre está; la de atajos sí
    await inicio()
    await app.tecla('k', { ctrl: true }); await espera(250); await app.tecla('Escape'); await espera(250)
    const paleta = !(await app.js<boolean>(`!!document.querySelector('.palette')`))
    await app.tecla('?'); await espera(300)
    const atajosAbierta = await app.js<boolean>(`!!document.querySelector('.modal')`)
    const focoAdentro = await app.js<boolean>(`!!document.querySelector('.modal')?.contains(document.activeElement)`)
    await app.tecla('Escape'); await espera(300)
    out.escape = { paleta, atajosAbierta, focoAdentroDeLaVentana: focoAdentro, atajosCerro: !(await app.js<boolean>(`!!document.querySelector('.modal')`)) }

    // todas las pantallas: lo que solo se aprieta con el mouse
    const soloMouse: Record<string, string[]> = {}
    for (const [, pagina] of NAV_PALABRAS) {
      if (soloMouse[pagina]) continue
      await app.js(`document.querySelector('[data-page=${JSON.stringify(pagina)}]')?.click(); 0`); await espera(900)
      const s = await app.js<string[]>(SOLO_MOUSE)
      if (s.length) soloMouse[pagina] = s
    }
    out.soloMouse = soloMouse
  } finally {
    fs.writeFileSync(path.join(salida, 'teclado.json'), JSON.stringify(out, null, 1))
    await app.cerrar().catch(() => app.matar())
  }
}

if (process.argv[1] && /teclado(-[0-9a-f]+|-\d+)?\.m?[jt]s$/.test(process.argv[1])) await main()
