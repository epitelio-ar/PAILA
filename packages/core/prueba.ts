// Modo prueba (pruebas con personas, 27/10/2026): el registro local de lo que pasa mientras alguien que nunca vio PAILA la usa.
// Una línea JSON por hecho (hora, segundos desde que abrió, pantalla, botón tocado, aviso, error, tarea cumplida) en un .jsonl de
// la carpeta de la prueba. Nada sale de la PC. `VigiaTareas` mira la base para saber cuándo se cumplió cada tarea.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import { horaLocal } from './notasdeuso'

/**
 * Las tareas de la hoja (docs/prueba-personas/hoja-probador.md), en orden: las 9 de la revisión del 02/11 más el calentamiento.
 * Las de NO_SOLA (contestar en voz alta) no se detectan solas. NAPIA salió del juego principal (dependía de la red de Soulseek).
 */
export const TAREAS = ['cancion', 'contar', 'duplicados', 'nombres', 'tapas', 'carpetas', 'deshacer', 'lista', 'pendrive', 'volumen'] as const
export type TareaPrueba = typeof TAREAS[number]
export const NO_SOLA: ReadonlySet<TareaPrueba> = new Set(['cancion', 'contar'])
export const NOMBRE_TAREA: Record<TareaPrueba, string> = {
  cancion: 'Buscar un tema y decir su calidad', contar: 'Cuántos temas hay y cuántos suenan mal', duplicados: 'Sacar las copias de más (sin tirar ninguno que no sea copia)',
  nombres: 'Dejar bien los nombres', tapas: 'Poner las tapas que faltan', carpetas: 'Acomodar todo en carpetas', deshacer: 'Volver las carpetas a como estaban',
  lista: 'Traer la lista y ver qué falta', pendrive: 'Pasar la lista al pendrive', volumen: 'Que suenen a volumen parejo',
}

export type HechoPrueba =
  | { tipo: 'inicio'; version: string; musica: string; persona?: string }
  | { tipo: 'pantalla'; pantalla: string; antes: string | null; segAntes: number | null }
  | { tipo: 'volver'; pantalla: string }
  | { tipo: 'clic'; texto: string; boton: boolean; pantalla?: string }
  | { tipo: 'escribe'; donde: string; texto: string; pantalla?: string }
  | { tipo: 'ventana'; titulo: string; pantalla?: string }
  | { tipo: 'aviso'; clase: string; texto: string; pantalla?: string }
  /** Lo que muestra un trabajo en marcha (cada 15 s): avance, ritmo y tiempo restante. */
  | { tipo: 'trabajo'; texto: string; pantalla?: string }
  | { tipo: 'error'; donde: string; texto: string; pantalla?: string }
  | { tipo: 'tarea'; tarea: TareaPrueba; detalle: string }
  | { tipo: 'marca'; tarea: number }
  | { tipo: 'fin' }
/** Una línea del registro: el hecho con su hora local y los segundos desde que se abrió PAILA. */
export type LineaPrueba = HechoPrueba & { hora: string; seg: number }

/** Nombre del archivo del registro de una vez que se abre PAILA: 2026-10-27_15-30-12.jsonl (hora local). */
/** En la prueba con personas, ¿esta carpeta queda afuera del kit? Solo se deja usar lo de adentro: si no, quien prueba podía
 *  agregar la música de verdad (o elegirla como Bandeja) y Aplicar la tocaba (prueba de la persona 1, 31/10). Sin prueba, nunca. */
export function fueraDeLaPrueba(carpeta: string | undefined, p: string): boolean {
  if (!carpeta) return false
  const rel = path.relative(path.resolve(carpeta), path.resolve(p))
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
}

export const archivoRegistro = (carpeta: string, d = new Date()) => path.join(carpeta, `${horaLocal(d).replace('T', '_').replace(/:/g, '-')}.jsonl`)

export class RegistroPrueba {
  private inicio: number
  private actual: { pantalla: string; desde: number } | null = null
  private recorrido: string[] = []
  /** `inicio`: la hora de arranque de otro registro del mismo archivo (NAPIA usa la de PAILA, así los segundos coinciden). */
  constructor(readonly archivo: string, private ahora: () => Date = () => new Date(), inicio?: number) {
    this.inicio = inicio ?? ahora().getTime()
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
  }
  get pantalla() { return this.actual?.pantalla ?? null }
  get desde() { return this.inicio }
  /** La ventana volvió a estar adelante (se había ido a NAPIA): se anota la pantalla otra vez, aunque sea la misma. */
  volvio() { const p = this.actual?.pantalla; if (p) { this.actual = null; this.cambio(p) } }

  /** Anota un hecho. Lo de la pantalla lleva la pantalla donde estaba, si el hecho no la trae. */
  anotar(h: HechoPrueba) {
    const d = this.ahora()
    const conPantalla = ['clic', 'escribe', 'ventana', 'aviso', 'error'].includes(h.tipo) && !(h as { pantalla?: string }).pantalla && this.actual ? { ...h, pantalla: this.actual.pantalla } : h
    const linea: LineaPrueba = { hora: horaLocal(d), seg: Math.round((d.getTime() - this.inicio) / 100) / 10, ...conPantalla }
    try { fs.appendFileSync(this.archivo, JSON.stringify(linea) + '\n') } catch { /* sin registro la prueba sigue igual */ }
    return linea
  }

  /** Cambió la pantalla: anota cuánto estuvo en la anterior y, si vuelve a la de antes (A → B → A), también "volver". */
  cambio(pantalla: string) {
    if (!pantalla || pantalla === this.actual?.pantalla) return
    const t = this.ahora().getTime()
    const antes = this.actual
    this.anotar({ tipo: 'pantalla', pantalla, antes: antes?.pantalla ?? null, segAntes: antes ? Math.round((t - antes.desde) / 100) / 10 : null })
    if (this.recorrido.length >= 2 && this.recorrido[this.recorrido.length - 2] === pantalla) this.anotar({ tipo: 'volver', pantalla })
    this.recorrido = [...this.recorrido, pantalla].slice(-10)
    this.actual = { pantalla, desde: t }
  }
}

/** Leer un registro: las líneas que no se entienden (un corte a mitad de una línea) se saltean. */
export function leerRegistro(archivo: string): LineaPrueba[] {
  return fs.readFileSync(archivo, 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l) as LineaPrueba] : [] } catch { return [] } })
}

const cant = (n: number, palabra: string) => `${n} ${palabra}${n > 1 ? 's' : ''}`
const cuenta = (db: Db, sql: string) => { try { return (db.prepare(sql).get() as { n: number }).n } catch { return 0 } }

/** Qué tareas ya se ven cumplidas en la base, con un detalle corto (cuántos temas). Solo lee. */
/**
 * Qué tareas ya se ven cumplidas en la base. `trampas`: los falsos repetidos del kit (trampas.json, lugares en Música/): si alguno
 * fue a la papelera, se anota en la tarea de repetidos (es lo que más importa medir: que PAILA no tire lo que no es copia).
 */
export function tareasHechas(db: Db, trampas: readonly string[] = []): Partial<Record<TareaPrueba, string>> {
  const r: Partial<Record<TareaPrueba, string>> = {}
  const temas = (sql: string) => cuenta(db, `SELECT COUNT(DISTINCT file_id) AS n FROM journal WHERE undone_at IS NULL AND ${sql}`)
  const dups = cuenta(db, "SELECT COUNT(*) AS n FROM trash_log WHERE reason LIKE '%uplicad%' AND restored_at IS NULL")
  const tiradas = trampas.length ? (db.prepare('SELECT orig_rel AS rel FROM trash_log WHERE restored_at IS NULL').all() as { rel: string }[]).filter((x) => trampas.includes(x.rel)).length : 0
  if (dups) r.duplicados = `${cant(dups, 'repetido')} a la papelera${tiradas ? ` · TIRÓ ${tiradas} QUE NO ${tiradas > 1 ? 'ERAN' : 'ERA'} COPIA` : ''}`
  const nombres = temas("field IN ('title', 'artist', 'albumArtist', 'filename')")
  if (nombres) r.nombres = `${cant(nombres, 'tema')} con el nombre arreglado`
  const tapas = temas("field IN ('cover', 'folderCover')")
  if (tapas) r.tapas = `${cant(tapas, 'tema')} con tapa`
  const movidos = cuenta(db, 'SELECT COUNT(*) AS n FROM moves_log WHERE undone_at IS NULL AND file_id IS NOT NULL')
  if (movidos) r.carpetas = `${cant(movidos, 'tema')} en su carpeta`
  const deshechos = cuenta(db, 'SELECT COUNT(*) AS n FROM moves_log WHERE undone_at IS NOT NULL AND file_id IS NOT NULL')
  if (deshechos) r.deshacer = `${cant(deshechos, 'tema')} de vuelta donde estaba`
  const listas = cuenta(db, 'SELECT COUNT(*) AS n FROM requests WHERE undone_at IS NULL')
  if (listas) r.lista = `${listas} lista${listas > 1 ? 's' : ''} traída${listas > 1 ? 's' : ''}`
  const copiados = cuenta(db, "SELECT COUNT(*) AS n FROM copies_log WHERE kind IN ('pendrive', 'celular')")
  if (copiados) r.pendrive = `${cant(copiados, 'archivo')} copiado${copiados > 1 ? 's' : ''}`
  const volumen = temas("field = 'replaygain'")
  if (volumen) r.volumen = `${cant(volumen, 'tema')} con el volumen parejo`
  return r
}

/**
 * Mira la base cada tanto y anota cada tarea una sola vez, cuando aparece cumplida y su número ya no cambia entre dos vueltas
 * (si no, una tanda a medio mover quedaba anotada con "3 repetidos" de 10). `terminar` anota lo que quedó sin anotar.
 */
export class VigiaTareas {
  private vistas = new Set<TareaPrueba>()
  private antes: Partial<Record<TareaPrueba, string>> = {}
  constructor(private db: Db, private registro: RegistroPrueba, private trampas: readonly string[] = []) {}
  revisar(terminar = false) {
    const ahora = tareasHechas(this.db, this.trampas)
    for (const [t, detalle] of Object.entries(ahora) as [TareaPrueba, string][]) {
      if (this.vistas.has(t) || (detalle !== this.antes[t] && !terminar)) continue
      this.vistas.add(t)
      this.registro.anotar({ tipo: 'tarea', tarea: t, detalle })
    }
    this.antes = ahora
  }
}
