// Laboratorio (scripts/corpus.ts): un resultado para el rápido y otro para el completo, y un turno para que no corran dos a la vez.
// Antes los dos guardaban en ultima.json: un rápido después de un completo salía con cientos de "cambios" falsos (22/10: 248).
import fs from 'node:fs'
import path from 'node:path'

export type Resultados = Record<string, Record<string, string | number | boolean | null>>
const tipo = (rapido: boolean) => (rapido ? 'rapido' : 'completo')

/** Dónde queda cada corrida: ultima-rapido.json / anterior-rapido.json, o los mismos con -completo. */
export function archivosDe(out: string, rapido: boolean) {
  return { ultima: path.join(out, `ultima-${tipo(rapido)}.json`), anterior: path.join(out, `anterior-${tipo(rapido)}.json`) }
}

/** La última corrida del mismo tipo, para comparar. Si todavía no hay, sirve el ultima.json de antes si era del mismo tipo. */
export function ultimaDelMismoTipo(out: string, rapido: boolean): Resultados {
  const { ultima } = archivosDe(out, rapido)
  const vieja = path.join(out, 'ultima.json')
  for (const f of [ultima, vieja]) {
    if (!fs.existsSync(f)) continue
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { rapido?: boolean; archivos?: Resultados }
    if (f === ultima || !!j.rapido === rapido) return j.archivos ?? {}
  }
  return {}
}

/** Guarda esta corrida como la última de su tipo (la que había pasa a ser la anterior). Devuelve dónde quedó. */
export function guardarCorrida(out: string, rapido: boolean, archivos: Resultados, fecha = new Date()): string {
  fs.mkdirSync(out, { recursive: true })
  const { ultima, anterior } = archivosDe(out, rapido)
  if (fs.existsSync(ultima)) fs.copyFileSync(ultima, anterior)
  fs.writeFileSync(ultima, JSON.stringify({ fecha: fecha.toISOString(), rapido, archivos }, null, 1))
  return ultima
}

// ── Turno: <laboratorio>/_resultados/corriendo.lock, con quién corre, qué tipo y desde cuándo ──────────────────────────
export interface Turno { pid: number; tipo: string; desde: string; carpeta: string }
export const turnoDe = (out: string) => path.join(out, 'corriendo.lock')
/** Pasadas 4 horas, un aviso se da por olvidado (el completo tarda unos 20 minutos). */
const VENCE = 4 * 3600_000

function vivo(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

/** Quién tiene el turno, si es que alguien lo tiene de verdad (un aviso de un proceso que ya terminó no cuenta). */
export function quienCorre(out: string, ahora = Date.now()): Turno | null {
  const f = turnoDe(out)
  let edad = 0
  try { edad = ahora - fs.statSync(f).mtimeMs } catch { return null }
  let t: Turno
  try { t = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {
    // recién creado y todavía sin escribir (el otro lo está tomando en este instante), o roto
    return edad < 10_000 ? { pid: -1, tipo: '¿?', desde: new Date(ahora).toISOString(), carpeta: '¿?' } : null
  }
  return vivo(t.pid) && edad < VENCE ? t : null
}

/**
 * Toma el turno del laboratorio. Si otro lo tiene, espera (avisando qué espera) hasta `esperaMax`; si no se libera,
 * devuelve null. Devuelve una función para soltarlo, que se llama también si el proceso se corta.
 */
export async function tomarTurno(out: string, rapido: boolean, opts: { esperaMax?: number; pausa?: number; avisar?: (msg: string) => void } = {}): Promise<(() => void) | null> {
  const { esperaMax = 60 * 60_000, pausa = 20_000, avisar = (m: string) => console.log(m) } = opts
  fs.mkdirSync(out, { recursive: true })
  const f = turnoDe(out)
  const mio: Turno = { pid: process.pid, tipo: tipo(rapido), desde: new Date().toISOString(), carpeta: process.cwd() }
  const inicio = Date.now()
  let avisado = ''
  for (;;) {
    try {
      fs.writeFileSync(f, JSON.stringify(mio), { flag: 'wx' })
      const soltar = () => {
        try { if ((JSON.parse(fs.readFileSync(f, 'utf8')) as Turno).pid === mio.pid) fs.rmSync(f, { force: true }) } catch { /* ya no está */ }
        process.off('exit', soltar)
      }
      process.on('exit', soltar)
      return soltar
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    const otro = quienCorre(out)
    if (!otro) { fs.rmSync(f, { force: true }); continue } // aviso viejo: se toma el turno
    if (Date.now() - inicio >= esperaMax) return null
    const que = `el laboratorio ${otro.tipo} que arrancó a las ${new Date(otro.desde).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} en ${otro.carpeta}`
    if (que !== avisado) { avisar(`Ya está corriendo ${que}: espero a que termine para no pisarnos…`); avisado = que }
    await new Promise((r) => setTimeout(r, pausa))
  }
}
