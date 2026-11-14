// Avisos de turno entre sesiones: quién está usando qué (la copia de la Música, una medición de velocidad, el laboratorio, una
// verificación) y los procesos pesados. Lo usan `npm run verificar`, el laboratorio, las pruebas sobre la copia y `npm run turnos`
// (que lo muestra en una pantalla). Los avisos son archivos chicos: se toman solos, se sueltan solos (también si el proceso se corta)
// y uno de un proceso que ya no existe se da por olvidado. Reglas en AGENTS.es.md, "Trabajo pesado y sesiones en paralelo".
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MEDICION = path.join(os.tmpdir(), 'paila-medicion.lock')
export const VERIFICANDO = path.join(os.tmpdir(), 'paila-verificar.lock')
/** La carpeta de trabajo para pruebas (copias, respaldos, laboratorio grande): `PAILA_TRABAJO`, o la de la PC donde se arma PAILA. */
export const carpetaTrabajo = () => process.env.PAILA_TRABAJO || 'D:\\PAILA-trabajo'
export const COPIA_LOCK = () => path.join(carpetaTrabajo(), 'copia-en-uso.lock')
export const carpetaLab = () => process.env.PAILA_CORPUS || 'C:\\PAILA-laboratorio'
export const turnoLab = () => path.join(carpetaLab(), '_resultados', 'corriendo.lock')
/**
 * El turno pesado de otro proyecto que comparte la PC, si lo hay: un archivo con una línea "quién · qué · hora" que vale 30
 * minutos. Mientras esté, PAILA no corre lo pesado, y cuando PAILA verifica lo toma, así el otro espera. Dos cosas pesadas a
 * la vez hacen fallar tests por tiempo. Dónde está ese archivo lo dice `PAILA_TURNO_AJENO` o, si no, el primer renglón de
 * `~/.paila-turno-ajeno` (un archivo de cada PC, fuera del repositorio). Sin ninguno de los dos, no hay otro proyecto: null.
 */
export const turnoAjeno = () => {
  if (process.env.PAILA_TURNO_AJENO) return process.env.PAILA_TURNO_AJENO
  try { return fs.readFileSync(path.join(os.homedir(), '.paila-turno-ajeno'), 'utf8').split(/\r?\n/)[0].trim() || null } catch { return null }
}
/** Cuánto dura un aviso antes de darlo por olvidado, según quién lo puso. */
const VENCE = { medicion: 2 * 3600_000, copia: 12 * 3600_000, laboratorio: 4 * 3600_000, verificar: 3 * 3600_000, ajeno: 30 * 60_000 }

/** "4 min 10 s", "12 s". */
export function duracion(ms) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
}
const hora = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

/** ¿Sigue vivo ese proceso? (null si no se sabe: sin número.) */
export function vivo(pid) {
  if (!pid || pid < 0) return null
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** Quién soy: la sesión (`PAILA_SESION`), o la rama y la carpeta de trabajo. */
export function quienSoy() {
  if (process.env.PAILA_SESION) return process.env.PAILA_SESION
  let rama = ''
  try { rama = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* sin git */ }
  const carpeta = path.basename(process.cwd())
  return rama && rama !== carpeta ? `${rama} (${carpeta})` : carpeta
}

const leer = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const edad = (f, ahora) => { try { return ahora - fs.statSync(f).mtimeMs } catch { return null } }

/**
 * Los avisos que hay ahora: [{ tipo, quien, que, desde, pid, vivo, edad, texto }]. `tipo`: 'copia' | 'medicion' | 'laboratorio' | 'verificar'.
 * Un aviso de un proceso que ya terminó, o más viejo que lo que dura ese tipo, no cuenta (sale en `olvidados`, para mostrarlo).
 */
export function leerAvisos({ ahora = Date.now(), copia = COPIA_LOCK(), medicion = MEDICION, laboratorio = turnoLab(), verificando = VERIFICANDO, ajeno = turnoAjeno() } = {}) {
  const activos = [], olvidados = []
  const poner = (a) => {
    const e = a.edad ?? 0
    const muerto = a.vivo === false || e > VENCE[a.tipo]
    ;(muerto ? olvidados : activos).push({ ...a, texto: textoAviso(a) })
  }
  // Música-copia: una línea "quién · qué · hasta HH:MM · pid N" (o lo que haya escrito alguien a mano)
  const c = leer(copia)
  if (c != null) {
    const linea = c.trim().split(/\r?\n/)[0] ?? ''
    const pid = Number(/·\s*pid\s+(\d+)\s*$/.exec(linea)?.[1]) || null
    const partes = linea.replace(/·\s*pid\s+\d+\s*$/, '').split('·').map((x) => x.trim()).filter(Boolean)
    poner({ tipo: 'copia', quien: partes[0] ?? '¿?', que: partes.slice(1).join(' · ') || 'sin detalle', desde: null, pid, vivo: vivo(pid), edad: edad(copia, ahora), aMano: !pid })
  }
  const m = leer(medicion)
  if (m != null) {
    const linea = m.trim().split(/\r?\n/)[0] ?? ''
    const pid = Number(/·\s*pid\s+(\d+)\s*$/.exec(linea)?.[1]) || null
    poner({ tipo: 'medicion', quien: linea.split('·')[0].replace(/·\s*pid.*$/, '').trim() || '¿?', que: linea.split('·').slice(1).join('·').replace(/·\s*pid\s+\d+\s*$/, '').trim() || 'sin detalle', desde: null, pid, vivo: vivo(pid), edad: edad(medicion, ahora), aMano: !pid })
  }
  for (const [tipo, f] of [['laboratorio', laboratorio], ['verificar', verificando]]) {
    const txt = leer(f)
    if (txt == null) continue
    let j = null
    try { j = JSON.parse(txt) } catch { /* recién creado o roto */ }
    const e = edad(f, ahora)
    if (!j) { if (e != null && e < 10_000) poner({ tipo, quien: '¿?', que: 'recién empezando', desde: null, pid: null, vivo: null, edad: e }); continue }
    poner(tipo === 'laboratorio'
      ? { tipo, quien: j.carpeta ?? '¿?', que: `laboratorio ${j.tipo ?? ''}`.trim(), desde: j.desde ?? null, pid: j.pid ?? null, vivo: vivo(j.pid), edad: e }
      : { tipo, quien: j.quien ?? '¿?', que: j.que ?? 'verificación', desde: j.desde ?? null, pid: j.pid ?? null, vivo: vivo(j.pid), edad: e })
  }
  // el turno pesado del otro proyecto (si es de PAILA misma, lo tomó esta verificación: no frena)
  const a = ajeno ? leer(ajeno) : null
  if (a != null && !a.startsWith('PAILA')) {
    const partes = (a.trim().split(/\r?\n/)[0] ?? '').split('·').map((x) => x.trim()).filter(Boolean)
    poner({ tipo: 'ajeno', quien: partes[0] ?? path.basename(path.dirname(ajeno)), que: partes.slice(1).join(' · ') || 'algo pesado', desde: null, pid: null, vivo: null, edad: edad(ajeno, ahora) })
  }
  return { activos, olvidados }
}

/** Toma el turno pesado del otro proyecto mientras PAILA hace algo pesado (solo si su carpeta existe y nadie lo tiene). Devuelve con qué soltarlo. */
export function tomarTurnoAjeno(que, archivo = turnoAjeno()) {
  if (!archivo || !fs.existsSync(path.dirname(archivo))) return () => {}
  const texto = `PAILA · ${quienSoy()} · ${que} · ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}\n`
  try { fs.writeFileSync(archivo, texto, { flag: 'wx' }) } catch { return () => {} }
  return soltarAlSalir(archivo, (t) => t === texto)
}

const NOMBRE = { copia: 'Música-copia', medicion: 'Medición', laboratorio: 'Laboratorio', verificar: 'Verificación', ajeno: 'Otro proyecto' }
/** Una línea: quién usa qué. */
export function textoAviso(a) {
  const desde = a.desde ? `, desde las ${hora(a.desde)}` : a.edad != null ? `, hace ${duracion(a.edad)}` : ''
  const pid = a.pid ? `, proceso ${a.pid}` : a.aMano ? ', aviso hecho a mano' : ''
  return `${NOMBRE[a.tipo]}: ${a.quien} — ${a.que}${desde}${pid}`
}

// ── Qué está pesado en la PC ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Qué procesos pesados hay andando y si hay que esperarlos. `procesos`: [{ pid, nombre, ruta, cmd }] (como Win32_Process).
 * Se espera a lo de otras sesiones (tests, laboratorio, escala, instalador, ffmpeg); el ffmpeg de PAILA instalada (alguien
 * analizando su música) solo se avisa: puede durar toda la noche.
 */
export function pesados(procesos, propios = new Set()) {
  const esperar = [], avisar = []
  for (const p of procesos) {
    if (propios.has(p.pid)) continue
    const cmd = (p.cmd ?? '').replace(/\\/g, '/'), ruta = (p.ruta ?? '').replace(/\\/g, '/')
    const nombre = (p.nombre ?? '').toLowerCase()
    if (nombre === 'ffmpeg.exe' || nombre === 'ffprobe.exe') {
      if (/\/Programs\/PAILA\/|PAILA[^/]*portable/i.test(ruta)) avisar.push(`PAILA instalada está analizando (${nombre})`)
      else esperar.push(`audio de otra sesión (${nombre})`)
    } else if (nombre === 'node.exe' || nombre === 'electron.exe') {
      if (/vitest/.test(cmd)) esperar.push('tests (vitest)')
      else if (/scripts\/corpus\.ts|corpus-\d+\.mjs/.test(cmd)) esperar.push('el laboratorio')
      else if (/scripts\/escala\.ts|escala-\d+\.mjs/.test(cmd)) esperar.push('la prueba de escala')
      else if (/electron-builder/.test(cmd)) esperar.push('el armado del instalador')
    }
  }
  const unicos = (xs) => [...new Map(xs.map((x) => [x, xs.filter((y) => y === x).length])).entries()].map(([x, n]) => (n > 1 ? `${x} ×${n}` : x))
  return { esperar: unicos(esperar), avisar: unicos(avisar) }
}

/** Los procesos de esta PC que pueden ser pesados (Windows; en otro sistema no se mira). */
export function procesosAhora() {
  if (process.platform !== 'win32') return []
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='ffmpeg.exe' or Name='ffprobe.exe' or Name='electron.exe'\" | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).trim()
    if (!out) return []
    const j = JSON.parse(out)
    return (Array.isArray(j) ? j : [j]).map((p) => ({ pid: p.ProcessId, nombre: p.Name, ruta: p.ExecutablePath, cmd: p.CommandLine }))
  } catch { return [] }
}

// ── Tomar y soltar un aviso ──────────────────────────────────────────────────────────────────────────────────────────────
/** Suelta un aviso al terminar el proceso, también con Ctrl+C o cerrando la consola. Solo borra el que es suyo (`dueño(texto)`). */
function soltarAlSalir(archivo, esMio) {
  const soltar = () => {
    try { if (esMio(fs.readFileSync(archivo, 'utf8'))) fs.rmSync(archivo, { force: true }) } catch { /* ya no está */ }
    process.off('exit', soltar)
  }
  process.on('exit', soltar)
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(s, () => { soltar(); process.exit(130) })
  return soltar
}

/**
 * Toma un aviso de turno de forma que dos no lo tomen a la vez (crea el archivo solo si no está). Si lo tiene otro, avisa quién y
 * espera (`esperar`: milisegundos, 0 = no espera y devuelve null). Devuelve la función que lo suelta.
 */
export async function tomarAviso(archivo, tipo, texto, { esperar = 0, pausa = 15_000, avisar = (m) => console.log(m), ignorar = () => false } = {}) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  const inicio = Date.now()
  let dicho = ''
  for (;;) {
    try {
      fs.writeFileSync(archivo, texto, { flag: 'wx' })
      return soltarAlSalir(archivo, (t) => t === texto)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    const opts = tipo === 'copia' ? { copia: archivo } : tipo === 'medicion' ? { medicion: archivo } : tipo === 'verificar' ? { verificando: archivo } : { laboratorio: archivo }
    const { activos } = leerAvisos(opts)
    const otro = activos.find((a) => a.tipo === tipo)
    if (!otro) { fs.rmSync(archivo, { force: true }); continue } // olvidado: se toma
    if (ignorar(otro)) return () => {}
    if (Date.now() - inicio >= esperar) return null
    if (otro.texto !== dicho) { avisar(`${otro.texto}: espero a que termine…`); dicho = otro.texto }
    await new Promise((r) => setTimeout(r, pausa))
  }
}

/** Hora de hoy (o de mañana) a la que vence un aviso de `horas` horas, como "17:40". */
const hasta = (horas) => new Date(Date.now() + horas * 3600_000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * Antes de aplicar cambios sobre Música-copia: toma `copia-en-uso.lock` (al lado de la carpeta de la copia). Si otra sesión la
 * tiene, no sigue (la copia es de a una sesión por vez): tira un error que dice quién. `propio`: el aviso lo escribiste a mano
 * vos mismo (como pide AGENTS.es.md): se usa tal cual y no se borra al terminar. Devuelve la función que lo suelta (también se
 * suelta sola al salir).
 */
export async function tomarCopia(copia, { que, horas = 2, propio = false, esperar = 0, quien = quienSoy(), avisar } = {}) {
  const archivo = path.join(path.dirname(path.resolve(copia)), 'copia-en-uso.lock')
  const texto = `${quien} · ${que} · hasta ${hasta(horas)} · pid ${process.pid}\n`
  const r = await tomarAviso(archivo, 'copia', texto, { esperar, avisar, ignorar: (a) => propio && a.aMano })
  if (!r) {
    const otro = leerAvisos({ copia: archivo }).activos.find((a) => a.tipo === 'copia')
    throw new Error(`La copia de la Música está en uso (${otro?.texto ?? archivo}). Solo se lee hasta que termine${otro?.aMano ? '; si es tuyo, volvé a correr con --aviso-propio' : ''}.`)
  }
  return r
}

/** Antes de medir velocidades: toma `%TEMP%\paila-medicion.lock` solo y corre con PAILA_MEDICION=1. Si es tuyo y lo hiciste a mano (PAILA_MEDICION ya está), se usa. */
export async function tomarMedicion(que, { esperar = 0, quien = quienSoy(), avisar } = {}) {
  const propio = !!process.env.PAILA_MEDICION
  const r = await tomarAviso(MEDICION, 'medicion', `${quien} · ${que} · hasta ${hasta(2)} · pid ${process.pid}\n`, { esperar, avisar, ignorar: (a) => propio && a.aMano })
  if (!r) throw new Error(`Otra sesión está midiendo velocidades (${leerAvisos().activos.find((a) => a.tipo === 'medicion')?.texto}). Esperá a que termine.`)
  process.env.PAILA_MEDICION = '1'
  return r
}

/** Espera a que no haya una medición de otra sesión (para lo pesado que no mide: laboratorio, tests). */
export async function esperarSinMedicion({ avisar = (m) => console.log(m), tope = 45 * 60_000 } = {}) {
  if (process.env.PAILA_MEDICION) return 0
  const inicio = Date.now()
  let dicho = ''
  for (;;) {
    const m = leerAvisos().activos.find((a) => a.tipo === 'medicion')
    if (!m || Date.now() - inicio > tope) return Date.now() - inicio
    if (m.texto !== dicho) { avisar(`${m.texto}: espero para no contaminar la medición…`); dicho = m.texto }
    await new Promise((r) => setTimeout(r, 20_000))
  }
}

/** La pantalla de `npm run turnos`: quién está usando qué. */
export function pantallaTurnos(avisos, { esperar = [], avisar = [] } = {}) {
  const lineas = ['', '── Quién está usando qué ' + '─'.repeat(40)]
  for (const tipo of ['copia', 'laboratorio', 'verificar', 'medicion', 'ajeno']) {
    const a = avisos.activos.filter((x) => x.tipo === tipo)
    if (!a.length) lineas.push(`  ${NOMBRE[tipo].padEnd(13)} libre`)
    for (const x of a) lineas.push(`  ${NOMBRE[tipo].padEnd(13)} ${x.quien} — ${x.que}${x.desde ? `, desde las ${hora(x.desde)}` : x.edad != null ? `, hace ${duracion(x.edad)}` : ''}${x.pid ? ` (proceso ${x.pid})` : x.aMano ? ' (aviso hecho a mano)' : ''}`)
  }
  for (const x of avisos.olvidados) lineas.push(`  · Olvidado (se ignora): ${x.texto}${x.vivo === false ? ' — su proceso ya no existe' : ' — es muy viejo'}`)
  if (esperar.length) lineas.push(`  Procesos pesados: ${esperar.join(', ')}`)
  if (avisar.length) lineas.push(`  Ojo: ${avisar.join(', ')}`)
  if (!esperar.length && !avisar.length && !avisos.activos.length) lineas.push('  Todo libre: se puede correr lo pesado.')
  lineas.push('')
  return lineas.join('\n')
}

if (process.argv[1] && path.basename(process.argv[1]) === 'turnos.mjs' && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const { esperar, avisar } = pesados(procesosAhora(), new Set([process.pid, process.ppid]))
  console.log(pantallaTurnos(leerAvisos(), { esperar, avisar }))
}
