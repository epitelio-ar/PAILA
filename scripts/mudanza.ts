// Corrida supervisada de "Pasar a otra compu" (MASTERPLAN-4, 4A.2b) con la biblioteca de verdad, manejando la app armada:
// copia la base real, la exporta con Configuración → Exportar todo (en modo solo mirar), la trae con "Traer de otra compu" a
// una carpeta de datos nueva apuntando a la copia de la Música, deja que PAILA se reabra sola y compara tabla por tabla
// que esté todo (playlists, historial, análisis, huellas, pendientes). Nunca escribe en ninguna carpeta de música.
//
//   node scripts/run-ts.mjs scripts/mudanza.ts <carpeta de pruebas> [base.db] [--musica <copia de la Música>]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { abrirApp } from './conducir'
import { AJUSTES_CON_RUTA, contar } from '@paila/core/mudanza'

const dir = path.resolve(process.argv[2] ?? 'D:/PAILA-trabajo/mudanza')
const real = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.join(process.env.APPDATA ?? '', 'PAILA', 'paila.db')
const musica = path.resolve(process.argv.includes('--musica') ? process.argv[process.argv.indexOf('--musica') + 1] : 'D:/PAILA-trabajo/Música-copia')
if (/^[a-z]:[\\/]+música([\\/]|$)/i.test(dir) || /^[a-z]:[\\/]+música([\\/]|$)/i.test(musica)) throw new Error('Ni la carpeta de pruebas ni la Música de destino pueden estar dentro de D:\\Música')
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const out: string[] = []
const log = (s: string) => { out.push(s); console.log(s) }
const PUERTO = 9341

/** Cada archivo de la carpeta de música con su tamaño y fecha: para comprobar que no se tocó nada. */
function foto(d: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of fs.readdirSync(d, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue
    const p = path.join(e.parentPath, e.name)
    const st = fs.statSync(p)
    m.set(path.relative(d, p), `${st.size}|${st.mtimeMs}`)
  }
  return m
}

/** La PAILA que se abrió sola después de traer: espera su ventana, saca una captura y la cierra (si no cierra, por su número). */
async function laReabierta(captura: string): Promise<string> {
  let ws: WebSocket | null = null
  for (let i = 0; i < 150 && !ws; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[]
      const p = pages.find((x) => x.type === 'page' && /index\.html/.test(x.url))
      if (p) { const s = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { s.onopen = res; s.onerror = rej }); ws = s }
    } catch { /* todavía no */ }
    if (!ws) await espera(400)
  }
  if (!ws) throw new Error('PAILA no se volvió a abrir sola después de traer')
  let id = 0
  const pend = new Map<number, (m: { result?: any }) => void>()
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); pend.delete(m.id) }
  // cada pedido con tiempo máximo: una ventana oculta que no dibuja no contesta la captura (se trabó el 23/10)
  const cdp = (method: string, params: object = {}, ms = 5000) => new Promise<any>((res) => { const n = ++id; const t = setTimeout(() => { pend.delete(n); res(null) }, ms); pend.set(n, (m) => { clearTimeout(t); res(m.result) }); ws!.send(JSON.stringify({ id: n, method, params })) })
  const leer = async () => (await cdp('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }))?.result?.value ?? ''
  let texto = ''
  for (let i = 0; i < 100 && !/temas/i.test(texto); i++) { await espera(300); texto = await leer() }
  await espera(2500) // lo que recordaba la ventana se pone y recarga una vez
  texto = ''
  for (let i = 0; i < 100 && !/temas/i.test(texto); i++) { texto = await leer(); if (!/temas/i.test(texto)) await espera(300) } // después de la recarga
  await cdp('Runtime.evaluate', { expression: "document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>')" })
  for (let intento = 0; intento < 8; intento++) {
    await cdp('Runtime.evaluate', { expression: `document.documentElement.style.outlineOffset = '${intento % 2}px'; document.documentElement.getBoundingClientRect(); 0` })
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, 4000)
    if (shot?.data) { fs.writeFileSync(captura, Buffer.from(shot.data, 'base64')); break }
  }
  await cdp('Runtime.evaluate', { expression: 'window.close()' }, 2000)
  ws.close()
  // que termine de cerrarse; si no, se corta ESA (la que escucha en nuestro puerto), nunca otra
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PUERTO}/json/version`); await espera(500) } catch { return texto } }
  const pid = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => l.includes(`127.0.0.1:${PUERTO}`) && /LISTENING/.test(l))?.trim().split(/\s+/).pop()
  if (pid) { execFileSync('taskkill', ['/PID', pid, '/T', '/F']); log(`(la reabierta no cerró sola: se cortó el proceso ${pid})`) }
  return texto
}

/** Compara dos bases tabla por tabla (filas iguales, sin importar el orden). Devuelve las tablas con diferencias. */
function comparar(a: DatabaseSync, b: DatabaseSync): string[] {
  const aparte = new Set(['settings', 'volumes', 'roots', 'files', 'op_journal', 'inbox_items', 'sqlite_sequence'])
  const tablas = (a.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
  const filas = (db: DatabaseSync, t: string) => (db.prepare(`SELECT * FROM "${t}"`).all() as object[]).map((r) => JSON.stringify(r, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : typeof v === 'bigint' ? Number(v) : v))).sort()
  const mal: string[] = []
  for (const t of tablas) {
    if (aparte.has(t)) continue
    const x = filas(a, t), y = filas(b, t)
    const iguales = x.length === y.length && x.every((r, i) => r === y[i])
    if (!iguales) mal.push(`${t}: ${x.length} filas antes, ${y.length} después`)
    else if (x.length) log(`  ${t}: ${x.length} filas, iguales`)
  }
  // ajustes: todos menos las claves (no viajan) y las rutas de esta compu que en la otra no existen
  const ajustes = (db: DatabaseSync) => filas(db, 'settings').filter((r) => { const k = (JSON.parse(r) as { key: string }).key; return !k.startsWith('claves.') && !AJUSTES_CON_RUTA.includes(k) })
  const sa = ajustes(a), sb = ajustes(b)
  if (sa.join() !== sb.join()) mal.push(`settings: ${sa.length} antes, ${sb.length} después`)
  else log(`  settings (sin claves ni rutas de la compu): ${sa.length}, iguales`)
  // temas: lo mismo salvo dónde está la carpeta (y la fecha, si se copió sin conservarla)
  const temas = (db: DatabaseSync) => (db.prepare('SELECT id, root_id, rel_path, size, mtime, missing_at IS NOT NULL AS falta, trashed_at, excluded_at, artist, title, album, genre, kind FROM files ORDER BY id').all() as object[]).map((r) => JSON.stringify(r))
  const fa = temas(a), fb = temas(b)
  const distintos = fa.filter((r, i) => r !== fb[i])
  if (fa.length !== fb.length || distintos.length) mal.push(`files: ${distintos.length} temas distintos (p. ej. ${distintos.slice(0, 3).join(' / ')})`)
  else log(`  files: ${fa.length} temas, iguales (misma ruta, tamaño, fecha y tags)`)
  return mal
}

async function main() {
  process.env.PAILA_IDIOMA ??= 'es' // los botones se aprietan por su texto en castellano
  const lock = 'D:/PAILA-trabajo/copia-en-uso.lock'
  if (fs.existsSync(lock)) throw new Error(`La copia de la Música está en uso: ${fs.readFileSync(lock, 'utf8').trim()}`)
  fs.writeFileSync(lock, `mudanza (4A.2b, rama practical-herschel): solo LEE la copia para comparar, no aplica nada; hasta las ${new Date(Date.now() + 40 * 60_000).toLocaleTimeString('es-AR')}\n`)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    const A = path.join(dir, 'origen'), B = path.join(dir, 'destino'), archivo = path.join(dir, 'todo.paila')
    fs.mkdirSync(A, { recursive: true }); fs.mkdirSync(B, { recursive: true })
    for (const f of ['', '-wal', '-shm']) if (fs.existsSync(real + f)) fs.copyFileSync(real + f, path.join(A, `paila.db${f}`))
    const datosReales = path.dirname(real)
    if (fs.existsSync(path.join(datosReales, 'tapas'))) fs.cpSync(path.join(datosReales, 'tapas'), path.join(A, 'tapas'), { recursive: true })
    const antes = foto(musica)
    log(`Música de destino: ${musica} (${antes.size} archivos)`)

    // 1. la compu de origen: Configuración → Exportar todo
    process.env.PAILA_ELEGIR = archivo
    let t0 = Date.now()
    const app1 = await abrirApp(A, { soloLectura: true, puerto: PUERTO, log: path.join(dir, 'app1.log') })
    try {
      await app1.clic('Configuración')
      await app1.esperarTexto('Pasar a otra compu')
      await app1.js("[...document.querySelectorAll('h4')].find((h) => h.textContent.startsWith('Pasar a otra compu'))?.scrollIntoView()")
      await app1.clic('Exportar todo…')
      await app1.esperarTexto('Listo:', 120_000)
      await app1.captura(path.join(dir, '1-exportar.png'))
    } finally { await app1.cerrar() }
    log(`Exportar todo: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(fs.statSync(archivo).size / 1e6).toFixed(1)} MB`)

    // 2. la compu nueva (PAILA vacía): Traer de otra compu, eligiendo la copia de la Música
    process.env.PAILA_ELEGIR = `${archivo};${musica}`
    t0 = Date.now()
    const app2 = await abrirApp(B, { soloLectura: true, puerto: PUERTO, log: path.join(dir, 'app2.log') })
    let reabierta = ''
    try {
      await app2.clic('¿Venís de otra compu? Traer todo…')
      await app2.esperarTexto('Armado el')
      await espera(1500)
      const sugerida = /Encontré|Buscando/.test(await app2.texto())
      if (sugerida) await app2.esperarTexto('Encontré', 300_000) // la misma ruta existe en esta compu: la busca sola (solo lee)
      await app2.clic(sugerida ? 'Elegir otra carpeta…' : 'Elegir dónde está ahora…')
      await espera(500)
      await app2.esperarTexto(new RegExp(`Encontré [\\d.]+ de [\\d.]+ temas en ${musica.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`), 300_000)
      await app2.captura(path.join(dir, '2-traer.png'))
      log('Lo que mostró antes de confirmar:')
      for (const l of (await app2.js<string>("document.querySelector('.mudanza-ventana')?.innerText ?? ''")).split('\n').filter(Boolean)) log(`  | ${l}`)
      await app2.clic('Traer y volver a abrir PAILA')
      await app2.terminado
      log(`Traer: ${((Date.now() - t0) / 1000).toFixed(1)} s hasta que se cerró para reabrirse`)
      reabierta = await laReabierta(path.join(dir, '3-reabierta.png'))
    } catch (e) { app2.matar(); throw e }
    log(`Se volvió a abrir sola: ${reabierta.includes('temas') ? 'sí, con la biblioteca' : 'NO se vio la biblioteca'}`)
    await espera(3000)

    // 3. comparar
    const a = new DatabaseSync(path.join(A, 'paila.db'), { readOnly: true }), b = new DatabaseSync(path.join(B, 'paila.db'), { readOnly: true })
    log(`Conteos antes:   ${JSON.stringify(contar(a))}`)
    log(`Conteos después: ${JSON.stringify(contar(b))}`)
    log(`Carpeta en la base nueva: ${JSON.stringify(b.prepare('SELECT v.last_mount, r.rel_path FROM roots r JOIN volumes v ON v.id = r.volume_id').all())}`)
    log(`Claves en la base nueva: ${(b.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'claves.%'").get() as { n: number }).n}`)
    log('Tabla por tabla:')
    const mal = comparar(a, b)
    for (const m of mal) log(`  DISTINTO ${m}`)
    a.close(); b.close()
    const respaldos = fs.existsSync(path.join(B, 'respaldos')) ? fs.readdirSync(path.join(B, 'respaldos')) : []
    log(`Respaldos en la carpeta nueva: ${respaldos.join(', ') || 'ninguno (estaba vacía)'}`)

    // 4. traer otra vez sobre una PAILA que ya tiene datos: tiene que avisar, pedir que se confirme y dejar una copia antes
    process.env.PAILA_ELEGIR = `${archivo};${musica}`
    const app3 = await abrirApp(B, { soloLectura: true, puerto: PUERTO, log: path.join(dir, 'app3.log') })
    let pidio = false
    try {
      await app3.clic('Configuración')
      await app3.esperarTexto('Pasar a otra compu')
      await app3.clic('Traer de otra compu…')
      await app3.esperarTexto('Armado el')
      await app3.esperarTexto('Encontré', 300_000) // la ruta de origen (D:\Música) existe acá: la busca sola
      await app3.clic('Elegir otra carpeta…')
      await app3.esperarTexto(/Encontré [\d.]+ de [\d.]+ temas en D:\\PAILA-trabajo/, 300_000)
      const traerBoton = "[...document.querySelectorAll('.mudanza-ventana button')].find((b) => b.textContent.startsWith('Traer y volver'))"
      const frenado = await app3.js<boolean>(`${traerBoton}.disabled`)
      await app3.captura(path.join(dir, '4-ya-tiene-datos.png'))
      await app3.js("[...document.querySelectorAll('.mudanza-ventana label')].find((l) => l.textContent.includes('Sí, reemplazar')).click()")
      await espera(300)
      pidio = frenado && /Esta PAILA ya tiene [\d.]+ temas/.test(await app3.texto()) && !(await app3.js<boolean>(`${traerBoton}.disabled`))
      log(`Con datos: avisa y frena el botón hasta confirmar: ${pidio ? 'sí' : 'NO'}`)
      await app3.clic('Traer y volver a abrir PAILA')
      await app3.terminado
      await laReabierta(path.join(dir, '5-reabierta-de-nuevo.png'))
    } catch (e) { app3.matar(); throw e }
    const respaldos2 = fs.readdirSync(path.join(B, 'respaldos'))
    const copia = respaldos2.find((f) => f.endsWith('_antes-de-traer.db'))
    log(`Copia antes de reemplazar: ${copia ?? 'NO HAY'}`)
    const c2 = new DatabaseSync(path.join(B, 'paila.db'), { readOnly: true })
    const x = new DatabaseSync(archivo, { readOnly: true })
    const igual2 = JSON.stringify(contar(c2)) === JSON.stringify(contar(x))
    c2.close(); x.close()
    log(`Después de traer de nuevo, los conteos siguen iguales: ${igual2 ? 'sí' : 'NO'}`)

    const despues = foto(musica)
    const tocados = [...antes].filter(([k, v]) => despues.get(k) !== v).length + [...despues.keys()].filter((k) => !antes.has(k)).length
    log(`Archivos de música tocados: ${tocados}`)
    log(mal.length || tocados || !pidio || !copia || !igual2 || !reabierta.includes('temas') ? 'RESULTADO: hay diferencias, revisar' : 'RESULTADO: está todo, igual que en la base de origen')
  } finally {
    fs.rmSync(lock, { force: true })
    fs.writeFileSync(path.join(dir, 'resumen.txt'), out.join('\n') + '\n')
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
