// NAPIA: la lista se baja en tramos de 25 temas (el autor, 1/11: "para evitar que un tema descargado trucho quede pendiente
// hasta el fin de la cola"). Antes, lo trucho se buscaba en otra fuente recién cuando terminaba la lista entera: con una lista de
// 1.000 temas, horas después. Dos sockseek a la vez no se puede (con la misma cuenta, Soulseek echa a uno), así que la lista va
// de a tramos: cada tramo es un sockseek con esos temas y, apenas termina, las vueltas de otra fuente para lo que llegó trucho en
// él (control.ts, buscarOtrasFuentes); después, el tramo siguiente. Lo trucho espera, como mucho, lo que tarda un tramo.
// Todos los tramos usan el mismo CSV (la carpeta de trabajo de sockseek sale de su nombre), el mismo índice y la misma carpeta:
// para sockseek es la misma lista, de a pedazos. Lo que el índice ya da por bajado va en el tramo sin contar (sockseek lo saltea
// en un segundo): al retomar una tanda, los primeros tramos no son puro saltear. Los temas son los mismos objetos de punta a
// punta (Progress los usa tal cual): la pantalla ve una sola lista y la revisión de calidad sigue a cada uno.
// Cortar (o un problema que va a pasar igual con el tramo siguiente, como la cuenta) no deja empezar otro: lo que no llegó a
// arrancar queda cancelado. Tests: tests/napia-tramos.test.ts.
import fs from 'node:fs'
import { parseIndex } from './indexcsv'
import { buscarOtrasFuentes, type ControlCalidad, type CorridaOtraFuente } from './control'
import type { RunEnd, SockseekRun } from './run'
import type { Row } from './progress'
import type { RunStatus, TrackProgress, TrackState } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'

const T = textos({
  tramo: {
    es: (n: number, de: number, temas: number) => `[napia] Tramo ${n} de ${de} (${temas === 1 ? '1 tema' : `${temas} temas`}): lo que llegue trucho se busca en otra fuente apenas termine.`,
    en: (n: number, de: number, temas: number) => `[napia] Part ${n} of ${de} (${temas === 1 ? '1 track' : `${temas} tracks`}): anything that arrives bogus is looked for from another source as soon as it ends.`,
  },
})

/** Cuántos temas por hacer lleva cada tramo. */
export const TRAMO = 25
const LOG = 300

const clave = (t: Row) => `${t.artist}|${t.title}`.toLowerCase()

/** Los temas que el índice de sockseek ya da por bajados (o que ya estaban). */
export function hechosEnIndice(indice: string): Set<string> {
  try { return new Set(parseIndex(fs.readFileSync(indice, 'utf8')).filter((r) => r.state === 'bajado' || r.state === 'yaEstaba').map(clave)) } catch { return new Set() }
}

/** Parte la lista en tramos de `tamano` temas por hacer; lo ya hecho va en el tramo que le toca, sin contar. */
export function partirEnTramos<R extends Row>(rows: R[], hechos: ReadonlySet<string>, tamano = TRAMO): R[][] {
  const out: R[][] = []
  let cur: R[] = [], n = 0
  for (const r of rows) {
    cur.push(r)
    if (!hechos.has(clave(r)) && ++n >= tamano) { out.push(cur); cur = []; n = 0 }
  }
  // lo ya hecho que quedó al final va con el último tramo (solo, sería un sockseek para saltear todo)
  if (cur.length) { if (!n && out.length) out[out.length - 1].push(...cur); else out.push(cur) }
  return out
}

export interface TramosOpciones<R extends Row> {
  /** Los temas de la lista, como van a sockseek (con álbum y duración). */
  rows: R[]
  /** El índice de sockseek de la lista. */
  indice: string
  control: ControlCalidad
  tamano?: number
  /** Corre sockseek con un tramo (escribe el CSV de la lista con esas filas). `tracks`: los temas de la lista de ese tramo. */
  correr: (filas: R[], tracks: TrackProgress[], n: number) => SockseekRun
  /** Lo que se vigila mientras corre cada tramo (fuentes lentas, la muestra). Devuelve cómo dejar de vigilar. */
  vigilar?: (r: SockseekRun) => () => void
  /** Cada vuelta de otra fuente (apps/napia/electron/correr.ts, otraFuente). */
  otra: (filas: TrackProgress[], vetados: string[], ronda: number) => CorridaOtraFuente | null
  /** Hay que frenar: lo cortaste, o un problema que va a pasar igual con el tramo siguiente. */
  frenar: (problema: RunStatus['problem']) => boolean
}

/** Una lista que baja en tramos. Para la pantalla es como un solo sockseek: los temas, las cuentas, el problema y el registro. */
export class ListaEnTramos<R extends Row = Row> {
  /** Los temas de la lista (los mismos objetos en todos los tramos). */
  private readonly base: TrackProgress[]
  private readonly enBase: Set<TrackProgress>
  private readonly corridas: SockseekRun[] = []
  /** La corrida del tramo que está bajando (null entre tramos). */
  actual: SockseekRun | null = null
  private ultima: SockseekRun | null = null
  private readonly propio: string[] = []
  tramos = 0

  constructor(private readonly o: TramosOpciones<R>) {
    this.base = o.rows.map((r) => ({ artist: r.artist, title: r.title, state: 'espera', percent: null, detail: null, path: null, format: null }))
    this.enBase = new Set(this.base)
  }

  /** Los temas: los de la lista y, al final, los que sockseek nombró de otra forma (los suma Progress). */
  get tracks(): TrackProgress[] {
    const extra = this.corridas.flatMap((c) => c.progress.tracks.filter((t) => !this.enBase.has(t)))
    return extra.length ? [...this.base, ...extra] : this.base
  }

  counts(): Record<TrackState, number> {
    const c: Record<TrackState, number> = { espera: 0, buscando: 0, bajando: 0, bajado: 0, yaEstaba: 0, noEncontrado: 0, fallo: 0, cancelado: 0 }
    for (const t of this.tracks) c[t.state]++
    return c
  }

  get problem(): RunStatus['problem'] { return (this.actual ?? this.ultima)?.progress.problem ?? null }
  get peerErrors() { return this.corridas.reduce((n, c) => n + c.progress.peerErrors, 0) }
  /** El registro de toda la lista: los tramos que terminaron, lo que dijo NAPIA y lo del que baja. */
  get log(): string[] { return this.actual ? [...this.propio, ...this.actual.progress.log] : this.propio }
  /** Es la corrida de uno de los tramos (su registro ya está en `log`). */
  esTramo = (r: SockseekRun) => this.corridas.includes(r)
  /** Para lo que NAPIA anota en el registro (otra fuente, fuentes lentas). */
  anotar = (linea: string) => { this.propio.push(linea); if (this.propio.length > LOG) this.propio.splice(0, this.propio.length - LOG) }
  /** "No se conecta con nadie": en el tramo de ahora, y no bajó nada en toda la lista. */
  nadieConecta(terminado = false) {
    const c = this.actual ?? this.ultima
    return !!c && !this.base.some((t) => t.state === 'bajado') && c.progress.nadieConecta(terminado)
  }

  /** Baja la lista entera, tramo por tramo, con la otra fuente al terminar cada uno. */
  async bajar(): Promise<RunEnd> {
    const porClave = new Map(this.base.map((t) => [clave(t), t]))
    // NAPIA_TRAMO: tramos más chicos, para la prueba de punta a punta (scripts/napia-calidad.ts --tramos)
    const tramos = partirEnTramos(this.o.rows, hechosEnIndice(this.o.indice), this.o.tamano ?? (Number(process.env.NAPIA_TRAMO) || TRAMO))
    this.tramos = tramos.length
    let end: RunEnd = { exitCode: 0, cancelled: false }
    let frenada = false
    for (const [i, filas] of tramos.entries()) {
      if (this.o.frenar(this.problem)) { frenada = true; break }
      if (tramos.length > 1) this.anotar(T.tramo(i + 1, tramos.length, filas.length))
      const r = this.o.correr(filas, filas.map((f) => porClave.get(clave(f))!), i)
      this.actual = r; this.corridas.push(r)
      const dejar = this.o.vigilar?.(r) ?? (() => {})
      end = await r.done
      dejar()
      for (const l of r.progress.log) this.anotar(l)
      this.actual = null; this.ultima = r
      this.o.control.ver(this.tracks)
      if (end.cancelled) { frenada = true; break }
      // lo que llegó trucho en este tramo, a otra fuente ya (no si lo cortaste o hubo un problema que frena)
      await buscarOtrasFuentes(this.o.control, this.o.otra, () => this.o.frenar(this.problem)).catch(() => this.o.control.terminar())
    }
    // lo que no llegó a arrancar (se cortó la lista, o un problema la frenó): cancelado, como lo que sockseek no terminó
    if (frenada) for (const t of this.base) if (t.state === 'espera' || t.state === 'buscando') { t.state = 'cancelado'; t.percent = null }
    return { exitCode: end.exitCode, cancelled: end.cancelled }
  }
}
