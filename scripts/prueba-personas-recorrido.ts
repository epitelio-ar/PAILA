// Prueba de punta a punta del kit de prueba con personas (docs/prueba-personas/): "Empezar de nuevo", abre PAILA COMPILADA en modo
// prueba y oculta (scripts/conducir.ts), recorre pantallas y cumple las tareas que se detectan solas (las 9 de la revisión del 02/11:
// repetidos, nombres, tapas, carpetas, deshacer, lista, pendrive y volumen) con los mismos pedidos que la interfaz, comprueba que
// ninguna trampa del kit (trampas.json: dos pistas distintas que se llaman igual) haya ido a la papelera, revisa el registro y vuelve
// a "Empezar de nuevo" comparando la carpeta con el principio. Es la línea de base del MASTERPLAN-5 (etapa 0). Desde la etapa 2 va por
// el camino nuevo (sumar a la lista → un solo Aplicar) y cuenta "rehízo algo": si al salir de una pantalla y volver, lo encontrado ya no
// estaba. Solo toca la carpeta de la prueba.
//
//   node scripts/run-ts.mjs scripts/prueba-personas-recorrido.ts [--carpeta D:/PAILA-trabajo/prueba-personas]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { abrirApp } from './conducir'
import { leerRegistro } from '@paila/core/prueba'
import { informeMarkdown } from '@paila/core/prueba-informe'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const carpeta = path.resolve(arg('--carpeta', 'D:/PAILA-trabajo/prueba-personas'))
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const reiniciar = () => execFileSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/prueba-personas.ts', 'reiniciar', '--carpeta', carpeta, '--persona', 'Recorrido automático'], { stdio: 'inherit' })
/** Cada archivo de la carpeta con su tamaño (para comparar "como al principio"). */
const listado = (dir: string) => {
  const out: string[] = []
  const rec = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) rec(a); else out.push(`${path.relative(dir, a)}|${fs.statSync(a).size}`) } }
  if (fs.existsSync(dir)) rec(dir)
  return out.sort()
}
const ok = (cond: unknown, que: string) => { console.log(`${cond ? 'BIEN' : 'MAL '}  ${que}`); if (!cond) process.exitCode = 1 }

reiniciar()
const principio = listado(path.join(carpeta, 'Música'))
const original = listado(path.join(carpeta, 'original', 'Música'))
ok(principio.join('\n') === original.join('\n'), `la Música de la prueba es igual a original/Música (${principio.length} archivos)`)
const antesRegistros = new Set(fs.existsSync(path.join(carpeta, 'registros')) ? fs.readdirSync(path.join(carpeta, 'registros')) : [])

process.env.PAILA_PRUEBA = carpeta
const app = await abrirApp(path.join(carpeta, 'datos'), { log: path.join(carpeta, 'recorrido-consola.log') })
/** El registro de esta vez (el más nuevo) y si ya anotó la tarea. */
const registroNuevo = () => fs.readdirSync(path.join(carpeta, 'registros')).filter((f) => !antesRegistros.has(f)).sort().pop()
const anotada = (t: string) => { const r = registroNuevo(); return !!r && leerRegistro(path.join(carpeta, 'registros', r)).some((l) => l.tipo === 'tarea' && l.tarea === t) }
/** Como una persona: no sigue hasta que la tarea quedó cumplida (con el análisis andando, aplicar espera a que suelte los archivos). */
/** Lo largo (buscar tapas, medir el volumen) se arranca y se espera mirando los trabajos, como una persona: una sola llamada pasaba el minuto. */
const enMarcha = () => app.js<boolean>('window.paila.jobs().then((js) => js.some((j) => j.running))')
const esperarTrabajos = async (max = 20 * 60) => { await espera(1500); for (let i = 0; i < max && await enMarcha(); i++) await espera(1000) }
const esperarTarea = async (t: string) => { const desde = Date.now(); while (!anotada(t) && Date.now() - desde < 10 * 60_000) await espera(2000); ok(anotada(t), `tarea "${t}" anotada en ${Math.round((Date.now() - desde) / 1000)} s`) }
try {
  await app.esperarTexto(/Inicio/, 60_000)
  // el escaneo de la carpeta de prueba: hasta que estén los temas
  let temas = 0
  for (let i = 0; i < 300 && temas < 290; i++) { temas = await app.js<number>('window.paila.getTracks().then((t) => t.rows.length)'); await espera(1000) }
  ok(temas > 250, `PAILA abrió con la música de prueba ya puesta (${temas} temas)`)
  // pantallas y clics (con un ir y volver: Traer una lista → Llevar la música → Traer una lista)
  // desde las pestañas (01/11): primero la pestaña, después la parte de la barra lateral (como una persona)
  const ir = async (seccion: string, page: string) => {
    await app.js(`document.querySelector('.pestana[data-seccion=${seccion}]').click()`); await espera(500)
    await app.js(`document.querySelector('[data-page=${page}]').click()`); await espera(700)
  }
  for (const [s, p] of [['limpiar', 'dups'], ['datos', 'tidy'], ['conocer', 'home'], ['usar', 'requests'], ['usar', 'carry'], ['usar', 'requests'], ['conocer', 'home']]) await ir(s, p)

  // MASTERPLAN-5, etapa 2: lo encontrado queda en la base y todo se aplica con un solo Aplicar (papelera → nombres → mover → tapas).
  // "Rehízo algo" (la hoja del observador) = volver a buscar o a analizar algo que PAILA ya había encontrado: acá se cuenta cada vez
  // que, al salir de una pantalla y volver, lo encontrado ya no estaba.
  let rehizo = 0
  const busquedas = { repetidos: 0, tapas: 0 }
  const aplicar = async () => { await app.js('void window.paila.applyChanges().then((r) => { window.__aplicado = r })'); await esperarTrabajos(); return app.js<{ partes: Record<string, number>; failed: unknown[] }>('window.__aplicado') }
  const enLista = (campo: string) => app.js<number>(`window.paila.pendingChanges().then((l) => l.filter((c) => c.field === '${campo}' && !c.error).length)`)

  // 2. repetidos: lo que la pantalla deja tildado de fábrica (sin las Versiones ni lo "para decidir vos"), sumado a la lista
  await ir('limpiar', 'dups')
  type Ult = { grupos: { keep: number | null; decidir?: boolean; items: { id: number }[] }[] } | null
  let ultimo = await app.js<Ult>('window.paila.repetidosUltimo()')
  if (!ultimo?.grupos.length) { await app.js('window.paila.findDuplicates()'); busquedas.repetidos++; ultimo = await app.js<Ult>('window.paila.repetidosUltimo()') }
  const grupos = ultimo?.grupos ?? []
  const plan = grupos.filter((g) => g.keep != null && !g.decidir).flatMap((g) => g.items.filter((i) => i.id !== g.keep).map((i) => [i.id, g.keep]))
  await app.js(`window.paila.sumarRepetidos(${JSON.stringify(plan)}, ${JSON.stringify(grupos.flatMap((g) => g.items.map((i) => i.id)))})`)
  // salís y volvés: la lista de repetidos y lo sumado siguen ahí, sin buscar de nuevo
  await ir('conocer', 'home'); await ir('limpiar', 'dups'); await espera(1500)
  const vuelven = await app.js<number>('window.paila.repetidosUltimo().then((u) => (u ? u.grupos.length : 0))')
  const enPantalla = await app.js<number>("document.querySelectorAll('.dup-grupo').length")
  if (vuelven !== grupos.length || !enPantalla) rehizo++
  ok(vuelven === grupos.length && enPantalla > 0, `salís de Duplicados y volvés: siguen los ${vuelven} grupos (${enPantalla} en pantalla) sin buscar de nuevo`)
  ok(await enLista('papelera') === plan.length, `y los ${plan.length} repetidos siguen en lo que vas a aplicar`)
  const r2 = await aplicar()
  ok(r2.partes.papelera > 0, `repetidos a la papelera con el Aplicar único: ${r2.partes.papelera}`)
  await esperarTarea('duplicados')
  const trampas = (() => { try { return JSON.parse(fs.readFileSync(path.join(carpeta, 'trampas.json'), 'utf8')) as string[] } catch { return [] } })()
  ok(trampas.length >= 4, `el kit trae ${trampas.length} trampas`)
  ok(trampas.every((t) => fs.existsSync(path.join(carpeta, 'Música', ...t.split('/')))), 'ninguna trampa fue a la papelera (siguen en su lugar)')
  // 3. nombres: Arreglar nombres mira solo al entrar (lo de internet ya está ahí, sin apretar "Analizar"); un tema con nombre roto → Aplicar
  await ir('datos', 'tidy')
  let mira = false
  for (let i = 0; i < 60 && !mira; i++) { mira = await app.js<boolean>("!!document.querySelector('.tidy-siguiente')"); if (!mira) await espera(1000) }
  if (!mira) rehizo++
  ok(mira, 'Arreglar nombres muestra lo que encontró al entrar, sin apretar "Analizar"')
  await app.js(`(async () => {
    const rows = (await window.paila.getTracks()).rows.map((r) => ({ id: r[0], rel: r[2] }))
    const f = rows.find((r) => /AudioTrack/.test(r.rel)) ?? rows[0]
    await window.paila.stageChange([f.id], 'artist', 'Artista arreglado')
  })()`)
  await aplicar()
  await esperarTarea('nombres')
  // 4. tapas: buscar una vez; salís y volvés y lo encontrado sigue (está en la base); se suma y se aplica
  await ir('datos', 'albums')
  await app.js('void window.paila.coversScan().catch(() => {})'); busquedas.tapas++
  await esperarTrabajos()
  const cuantas = () => app.js<number>('window.paila.coversLast().then((ps) => (ps ?? []).filter((p) => p.proposed && !p.staged && !p.puesta).length)')
  const antesDeSalir = await cuantas()
  await ir('conocer', 'home'); await ir('datos', 'albums')
  const alVolver = await cuantas()
  if (alVolver !== antesDeSalir) rehizo++
  ok(alVolver === antesDeSalir, `salís de Tapas y volvés: siguen las ${alVolver} tapas encontradas, sin buscar de nuevo`)
  const tapas = await app.js<number>(`(async () => {
    const ps = (await window.paila.coversLast()) ?? []
    const keys = ps.filter((p) => p.proposed && !p.staged && !p.puesta).map((p) => p.key)
    return keys.length ? (await window.paila.coversStage(keys)).tracks : 0
  })()`)
  if (tapas > 0) await aplicar()
  ok(tapas > 0, `tapas puestas en ${tapas} temas (necesita internet)`)
  if (tapas > 0) await esperarTarea('tapas')
  // 5 y 6. carpetas y deshacerlas, con el estado de la colección (MASTERPLAN-5, etapa 1): cuenta de la música, no de marcas
  const fuera = () => app.js<number | null>('window.paila.estado().then((e) => e.grupos.carpetas.n)')
  const fueraAntes = await fuera()
  ok((fueraAntes ?? 0) > 200, `el estado cuenta ${fueraAntes} temas fuera de su carpeta antes de ordenar`)
  await ir('ordenar', 'organize')
  // los que chocan con otro (quedarían con "(2)") no se suman sin aceptarlo (riesgo 3): quedan fuera hasta resolverlos en Duplicados
  const chocan = await app.js<number>(`window.paila.organizePlan({ rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' }).then((p) => p.conflicts)`)
  await app.js(`window.paila.sumarMover({ rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' }, false)`)
  const sumados = await enLista('mover')
  const r5 = await aplicar()
  ok(r5.partes.mover > 200 && r5.partes.mover === sumados, `temas en sus carpetas con el Aplicar único: ${r5.partes.mover} de ${sumados} sumados`)
  const fueraDespues = await fuera()
  ok(fueraDespues === chocan, `después de ordenar, el estado dice ${fueraDespues} fuera de su carpeta: los ${chocan} que chocan con otro, sin "(2)" silencioso`)
  await esperarTarea('carpetas')
  ok(rehizo === 0, `tareas 2 a 5 sin "rehízo algo": ${rehizo} veces volvió a faltar lo encontrado (búsquedas: repetidos ${busquedas.repetidos}, tapas ${busquedas.tapas}; la línea de base buscaba de nuevo al volver)`)
  await app.js(`(async () => { const b = (await window.paila.organizeBatches())[0]; void window.paila.organizeUndo(b.batchId).then((r) => { window.__deshechos = r.moved }) })()`)
  for (let i = 0; i < 600 && !(await app.js<number>('window.__deshechos ?? 0')); i++) await espera(1000)
  const deshechos = await app.js<number>('window.__deshechos ?? 0')
  ok(deshechos > 200, `carpetas deshechas: ${deshechos}`)
  // la tarea 6, automática: deshacer Organizar hace que el estado (y el Inicio) vuelvan a decir cuántos están fuera
  const vuelta = await fuera()
  ok(vuelta === fueraAntes, `deshacer Organizar: el estado vuelve a decir ${vuelta} temas fuera de su carpeta (antes de ordenar: ${fueraAntes})`)
  await ir('conocer', 'home'); await espera(1500)
  const inicio = await app.js<string>(`document.querySelector('.estado')?.innerText ?? ''`)
  const renglon = inicio.split(/\r?\n/).find((l) => l.includes('fuera de su carpeta')) ?? inicio.slice(0, 80)
  ok(inicio.includes('fuera de su carpeta'), `el Inicio lo dice: «${renglon}»`)
  await esperarTarea('deshacer')
  // 4. la lista de Spotify
  const lista = JSON.stringify(path.join(carpeta, 'Para la prueba', 'Para el viaje.csv'))
  const faltan = await app.js<number>(`(async () => {
    const p = await window.paila.previewRequestFile(${lista})
    await window.paila.createRequest({ name: 'Para el viaje', source: p.source ?? 'csv', items: p.items })
    return p.items.filter((i) => !i.file).length
  })()`)
  ok(faltan >= 10, `lista traída: ${faltan} temas que faltan (se esperan unos 12)`)
  await esperarTarea('lista')
  // 5. una playlist al PENDRIVE
  const pendrive = JSON.stringify(path.join(carpeta, 'PENDRIVE'))
  await app.js(`(async () => {
    const rows = (await window.paila.getTracks()).rows.map((r) => ({ id: r[0], rel: r[2] }))
    const id = (await window.paila.createPlaylist('Para el auto', 'list', null)).find((p) => p.name === 'Para el auto').id
    await window.paila.addToPlaylist(id, rows.slice(0, 3).map((r) => r.id))
    await window.paila.runExport(id, { dest: ${pendrive}, keepFlac: true, convert: false, numbered: false, subfolder: true, fat32: false })
  })()`)
  await esperarTarea('pendrive')
  // 9. volumen parejo (necesita el análisis terminado: el volumen de cada tema)
  await esperarTrabajos()
  await app.js('void window.paila.gainPlan().catch(() => {})')
  await esperarTrabajos()
  const parejo = await app.js<number>(`(async () => { const k = await window.paila.gainStage(false); if (k) void window.paila.applyChanges(); return k })()`)
  ok(parejo > 0, `volumen parejo en ${parejo} temas`)
  if (parejo > 0) await esperarTarea('volumen')
  // nada a medias antes de cerrar (si no, PAILA pregunta "¿Frenar y cerrar?")
  for (let i = 0; i < 300 && await app.js<boolean>('window.paila.jobs().then((js) => js.some((j) => j.running))'); i++) await espera(1000)
  // cómo quedó la colección al final, contado de la música (los repetidos, cuando el análisis terminó y se calcularon)
  let fin = await app.js<Record<string, { n: number | null; aparte?: number; espera?: string }>>('window.paila.estado().then((e) => e.grupos)')
  for (let i = 0; i < 120 && fin.repetidos.espera === 'calculando'; i++) { await espera(1000); fin = await app.js('window.paila.estado().then((e) => e.grupos)') }
  ok(fin.repetidos.n != null || fin.repetidos.espera === 'escuchando', `estado al final: ${Object.entries(fin).map(([k, g]) => `${k} ${g.n ?? g.espera}${g.aparte ? ` (+${g.aparte})` : ''}`).join(' · ')}`)
} catch (e) { ok(false, `el recorrido se cortó: ${(e as Error).message}`); console.log(app.consola.slice(-10).join('\n')) }
try { await app.cerrar() } catch (e) { ok(false, `${(e as Error).message}: se corta`); app.matar() }

const nuevo = registroNuevo()
ok(nuevo, `hay un registro nuevo (${nuevo})`)
const lineas = leerRegistro(path.join(carpeta, 'registros', nuevo!))
const tipos = (t: string) => lineas.filter((l) => l.tipo === t)
ok(tipos('inicio')[0]?.tipo === 'inicio' && (tipos('inicio')[0] as { persona?: string }).persona === 'Recorrido automático', 'el registro empieza con "inicio" y el nombre de la persona')
ok(tipos('pantalla').length >= 5, `pantallas anotadas: ${tipos('pantalla').map((l) => (l as { pantalla: string }).pantalla).join(' → ')}`)
ok(tipos('volver').length >= 1, `volver atrás anotado (${tipos('volver').length})`)
ok(tipos('clic').some((l) => (l as { texto: string }).texto.includes('Duplicados')), `clics con su texto (${tipos('clic').length})`)
ok(tipos('fin').length === 1, 'el registro termina con "fin"')
fs.writeFileSync(path.join(carpeta, 'recorrido-informe.md'), informeMarkdown('Recorrido automático', 'hoy', lineas))

reiniciar()
const despues = listado(path.join(carpeta, 'Música'))
ok(despues.join('\n') === original.join('\n'), `"Empezar de nuevo" deja la Música igual al principio (${despues.length} archivos)`)
ok(!fs.existsSync(path.join(carpeta, 'datos')) && !fs.readdirSync(path.join(carpeta, 'PENDRIVE')).length, 'sin base de datos y con el PENDRIVE vacío')
process.exit(process.exitCode ?? 0) // sin esperar a que se cierre el puerto de depuración (salía con 1 aunque todo diera bien)
