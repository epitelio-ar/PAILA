// `npm run verificar`: todo lo que hay que mirar antes de unir una rama, de una vez y en orden: tipos, armado, tests y laboratorio.
// Antes de arrancar mira si otra sesión está haciendo algo pesado (tests, laboratorio, ffmpeg) y espera avisando qué espera.
// Si un test falla, lo repite una vez solo, para separar los que fallan por la carga de la PC de los que fallan de verdad.
//
//   npm run verificar                  laboratorio completo (con nota de calidad)
//   npm run verificar -- --rapido      laboratorio rápido (~1,5 min)
//   npm run verificar -- --sin-esperar no espera a las otras sesiones
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rutaModulo } from './app-ruta.mjs'
import { MEDICION, VERIFICANDO, duracion, leerAvisos, pesados, procesosAhora, quienSoy, tomarAviso, tomarTurnoAjeno } from './turnos.mjs'

export { MEDICION, duracion, pesados }
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')

/** Espera a que nadie más esté haciendo algo pesado (avisos de turno y procesos) y deja el aviso propio: así las otras sesiones ven que se está verificando. */
async function esperarTurno(rapido) {
  const inicio = Date.now()
  let antes = ''
  for (;;) {
    const { esperar, avisar } = pesados(procesosAhora(), new Set([process.pid, process.ppid]))
    const { activos } = leerAvisos()
    // la copia de la Música en uso no frena a verificar (no la toca): solo se muestra
    const frenan = activos.filter((a) => a.tipo !== 'copia').map((a) => a.texto)
    const todo = [...frenan, ...esperar]
    if (!todo.length) {
      const soltar = await tomarAviso(VERIFICANDO, 'verificar', JSON.stringify({ pid: process.pid, quien: quienSoy(), que: `verificación ${rapido ? 'rápida' : 'completa'}`, desde: new Date().toISOString() }), { esperar: 0 })
      if (!soltar) continue // otra sesión la tomó justo antes: se vuelve a mirar
      // y el otro proyecto de la PC espera (se suelta al salir). SOLO: el otro proyecto no suma nada en su segundo lugar mientras tanto
      // (desde el 31/10 puede correr algo en paralelo si la CPU está tranquila; los tests de PAILA son sensibles a la carga)
      tomarTurnoAjeno(`SOLO · verificación ${rapido ? 'rápida' : 'completa'}`)
      const copia = activos.find((a) => a.tipo === 'copia')
      if (copia) console.log(`Aviso: ${copia.texto}. No nos pisamos: verificar no toca la copia.`)
      if (avisar.length) console.log(`Aviso: ${avisar.join(', ')}. Los tests de audio pueden tardar más; si alguno falla, se repite solo.`)
      return Date.now() - inicio
    }
    if (Date.now() - inicio > 60 * 60_000) { console.log('Esperé una hora y sigue habiendo trabajo pesado: arranco igual.'); return Date.now() - inicio }
    const ahora = todo.join(', ')
    if (ahora !== antes) { console.log(`Otra sesión está corriendo algo pesado (${ahora}): espero a que termine para no pisarnos…`); antes = ahora }
    await new Promise((r) => setTimeout(r, 30_000))
  }
}

/** Corre un comando mostrando lo que dice y guardándolo, para leerlo después. vitest y tsc van con node, sin consola de por
 *  medio, así los nombres de los tests llegan tal cual (cmd.exe se come comillas y signos). */
const VITEST = rutaModulo('vitest/vitest.mjs', RAIZ) // una copia de trabajo (git worktree) puede no tener node_modules propio
const TSC = rutaModulo('typescript/bin/tsc', RAIZ)
function correr(cmd, args) {
  return new Promise((ok) => {
    const t0 = Date.now()
    let salida = ''
    const node = cmd === VITEST || cmd === TSC
    const p = node ? spawn(process.execPath, [cmd, ...args], { cwd: RAIZ, env: process.env }) : spawn(cmd, args, { cwd: RAIZ, shell: true, env: process.env })
    const tee = (dest) => (c) => { salida += c; dest.write(c) }
    p.stdout.on('data', tee(process.stdout)); p.stderr.on('data', tee(process.stderr))
    p.on('close', (code) => ok({ code: code ?? 1, salida, ms: Date.now() - t0 }))
  })
}

/** Los tests que fallaron, del informe JSON de vitest: [{ archivo, nombre }] (nombre null = falló el archivo entero). */
export function fallas(informe) {
  const out = []
  for (const f of informe.testResults ?? []) {
    const archivo = path.relative(RAIZ, f.name).split(path.sep).join('/')
    const malos = (f.assertionResults ?? []).filter((a) => a.status === 'failed')
    if (malos.length) for (const a of malos) out.push({ archivo, nombre: a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' ') })
    else if (f.status === 'failed') out.push({ archivo, nombre: null })
  }
  return out
}

/** El nombre de un test como patrón para `vitest -t` (expresión regular contra "archivo describe test": por eso solo el $). */
export const patron = (nombre) => `${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`

/** ¿Pasó ese test (o todos los del archivo) en este informe? */
export function paso(informe, falla) {
  const f = (informe.testResults ?? []).find((t) => path.relative(RAIZ, t.name).split(path.sep).join('/') === falla.archivo)
  if (!f) return false
  const xs = (f.assertionResults ?? []).filter((a) => falla.nombre === null || (a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' ')) === falla.nombre)
  return xs.length > 0 && xs.every((a) => a.status === 'passed' || a.status === 'pending' || a.status === 'skipped') && xs.some((a) => a.status === 'passed')
}

const tmpJson = (n) => path.join(os.tmpdir(), `paila-verificar-${process.pid}-${n}.json`)
function leerInforme(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } finally { fs.rmSync(f, { force: true }) } }

async function tests() {
  const f = tmpJson('todo')
  const r = await correr(VITEST, ['run', '--reporter=default', '--reporter=json', `--outputFile.json=${f}`])
  const informe = leerInforme(f)
  if (!informe) return { ...r, bien: r.code === 0, detalle: r.code === 0 ? [] : ['vitest no dejó su informe: mirá la salida de arriba'] }
  const malos = fallas(informe)
  const total = informe.numTotalTests ?? 0
  if (!malos.length) return { ...r, bien: r.code === 0, resumen: `${informe.numPassedTests ?? total} pasan`, detalle: r.code === 0 ? [] : ['vitest terminó mal sin decir qué test: mirá arriba'] }
  const MAX = 15
  const detalle = [], deVerdad = []
  console.log(`\nFallaron ${malos.length}. Los repito de a uno, solos, para ver si era la carga de la PC…`)
  for (const [i, m] of malos.entries()) {
    const quien = `${m.archivo}${m.nombre ? ` › ${m.nombre}` : ''}`
    if (i >= MAX) { deVerdad.push(m); detalle.push(`${quien}: no lo repetí (son muchos)`); continue }
    const g = tmpJson(`solo-${i}`)
    await correr(VITEST, ['run', m.archivo, ...(m.nombre ? ['-t', patron(m.nombre)] : []), '--reporter=json', `--outputFile.json=${g}`])
    const solo = leerInforme(g)
    if (solo && paso(solo, m)) detalle.push(`${quien}: pasó solo (falló por la carga de la PC)`)
    else { deVerdad.push(m); detalle.push(`${quien}: FALLA DE VERDAD (también solo)`) }
  }
  const porCarga = malos.length - deVerdad.length
  const resumen = `${total - malos.length} de ${total} pasan${porCarga ? `; ${porCarga} fallaron por carga y pasaron solos` : ''}${deVerdad.length ? `; ${deVerdad.length} fallan de verdad` : ''}`
  return { ...r, bien: !deVerdad.length, resumen, detalle }
}

/** Lo que importa de la salida del laboratorio: cuántos no cumplen y cuántos cambios hubo. */
export function leerLaboratorio(salida) {
  const no = /NO CUMPLEN lo esperado \((\d+)\)/.exec(salida)
  const cambios = /Cambios respecto de la corrida [^(\n]*\((\d+)\)/.exec(salida)
  const partes = []
  if (/Todo cumple lo esperado/.test(salida)) partes.push('todo cumple lo esperado')
  if (no) partes.push(`${no[1]} no cumplen lo esperado`)
  if (/Faltan \d+ archivos|Cambiaron \d+ archivos/.test(salida)) partes.push('faltan o cambiaron archivos del laboratorio')
  if (cambios) partes.push(`${cambios[1]} cambios respecto de la anterior`)
  else if (/Sin cambios respecto/.test(salida)) partes.push('sin cambios respecto de la anterior')
  return partes.join('; ')
}

/** El resumen de una pantalla. `pasos`: [{ nombre, bien, ms, resumen?, detalle? }]. */
export function resumen(pasos, { espera = 0, rapido = false } = {}) {
  const ancho = Math.max(...pasos.map((p) => p.nombre.length))
  const lineas = ['', `──── Verificación ${rapido ? '(laboratorio rápido)' : '(completa)'} ${'─'.repeat(30)}`]
  if (espera >= 1000) lineas.push(`  ${'Espera'.padEnd(ancho)}  ${duracion(espera)} esperando a otras sesiones`)
  for (const p of pasos) {
    lineas.push(`  ${p.nombre.padEnd(ancho)}  ${p.bien ? 'bien' : 'MAL '}  ${duracion(p.ms).padStart(10)}${p.resumen ? `   ${p.resumen}` : ''}`)
    for (const d of p.detalle ?? []) lineas.push(`  ${''.padEnd(ancho)}    · ${d}`)
  }
  const total = pasos.reduce((s, p) => s + p.ms, 0) + espera
  const malos = pasos.filter((p) => !p.bien).map((p) => p.nombre.toLowerCase())
  lineas.push(`  Total ${duracion(total)}. ${malos.length ? `Falló: ${malos.join(', ')}. El detalle está más arriba.` : 'Todo bien: se puede unir.'}`)
  return lineas.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const rapido = args.includes('--rapido')
  const espera = args.includes('--sin-esperar') ? 0 : await esperarTurno(rapido)
  const pasos = []
  const titulo = (t) => console.log(`\n━━ ${t} ━━`)

  titulo('Tipos')
  const t = await correr(TSC, ['--noEmit', '-p', 'tsconfig.json'])
  const errores = (t.salida.match(/error TS\d+/g) ?? []).length
  pasos.push({ nombre: 'Tipos', bien: t.code === 0, ms: t.ms, resumen: t.code === 0 ? '' : `${errores || 'hay'} errores` })

  titulo('Armado (npm run build)')
  const b = await correr('npm', ['run', 'build'])
  pasos.push({ nombre: 'Armado', bien: b.code === 0, ms: b.ms, resumen: b.code === 0 ? '' : 'no se armó: el test de una sola instancia va a fallar' })

  titulo('Tests (npm test)')
  pasos.push({ nombre: 'Tests', ...(await tests()) })

  titulo(`Laboratorio ${rapido ? 'rápido' : 'completo'}`)
  const l = await correr('npm', ['run', 'corpus', ...(rapido ? ['--', '--rapido'] : [])])
  pasos.push({ nombre: 'Laboratorio', bien: l.code === 0, ms: l.ms, resumen: leerLaboratorio(l.salida) })

  console.log(resumen(pasos, { espera, rapido }))
  process.exitCode = pasos.every((p) => p.bien) ? 0 : 1
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main()
