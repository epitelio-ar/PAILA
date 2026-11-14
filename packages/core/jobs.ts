// Procesos largos en segundo plano (aplicar cambios, buscar en internet, convertir, exportar…).
// El estado vive en el proceso principal: la interfaz puede cambiar de pantalla, cerrarse y volver, y el proceso sigue y se puede ver.
// Hay un solo proceso por tipo a la vez: si ya está corriendo, pedir otro no lo duplica.
// Los que usan el mismo servicio de internet (MusicBrainz, Discogs: cada uno con su límite de pedidos) se ponen en fila
// solos: el segundo queda "en fila" a la vista y arranca cuando termina el primero (prueba con personas, 28/10/2026).
import { textos } from '@paila/shared/idioma'

// Cómo terminó un proceso, como se ve en la lista (el nombre del proceso lo pone quien lo corre).
const TXT = textos({
  yaHay: { es: 'Ya hay un proceso de este tipo en marcha: mirá su avance en pantalla.', en: 'A process of this kind is already running: check its progress on screen.' },
  termino: { es: 'Terminó', en: 'Finished' },
  cancelado: { es: 'Cancelado. ', en: 'Cancelled. ' },
  canceladoEnFila: { es: 'Cancelado antes de empezar.', en: 'Cancelled before it started.' },
})

export interface JobState {
  kind: string
  label: string
  running: boolean
  done: number
  total: number // 0 = no se sabe cuántos son (barra sin porcentaje)
  current: string
  found: number // cosas encontradas o convertidas, según el proceso
  errors: number
  startedAt: number
  finishedAt: number | null
  summary: string | null // cómo terminó
  cancelling: boolean
  failed: boolean
  problems: { name: string; error: string }[] // qué salió mal y con qué archivo
  /** En fila: espera a que termine `job` (su nombre), porque los dos usan `service`. null = ya arrancó. */
  waiting: { job: string; service: string } | null
}

export interface RunOpts {
  /** Los servicios de internet que usa (sus nombres, como se ven: "MusicBrainz"). Con otro proceso que usa alguno, espera en fila. */
  uses?: string[]
}

export interface JobHandle {
  /** Actualiza lo que muestra la interfaz (se envía como mucho unas 8 veces por segundo). */
  update(patch: Partial<Pick<JobState, 'done' | 'total' | 'current' | 'found' | 'errors' | 'problems'>>): void
  /** El usuario apretó Cancelar. */
  cancelled(): boolean
}

export class Jobs {
  private map = new Map<string, JobState>()
  private cancel = new Set<string>()
  private last = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Qué usa cada proceso y en qué orden se pidió (para la fila). */
  private uses = new Map<string, { services: string[]; seq: number }>()
  private seq = 0
  /** Los que esperan en fila: se despiertan cuando termina un proceso o se cancela uno. */
  private wake = new Set<() => void>()

  /** Cada vez que termina uno (bien, cancelado o con error): lo usa el Chequeo para avisar si falló por algo que se arregla. */
  alTerminar: ((j: JobState) => void) | null = null

  constructor(private emit: (list: JobState[]) => void) {}

  list(): JobState[] { return [...this.map.values()] }

  /** Corriendo o en fila. */
  isRunning(kind: string) { return !!this.map.get(kind)?.running }
  /** Corriendo de verdad (no en fila): lo usa el Chequeo para saber si un servicio está ocupado. */
  isWorking(kind: string) { const j = this.map.get(kind); return !!j?.running && !j.waiting }

  /** Pide Cancelar a todo lo que está corriendo (al cerrar PAILA con algo a medias). */
  cancelAll() { for (const j of this.map.values()) if (j.running) this.cancelRequest(j.kind) }

  cancelRequest(kind: string) {
    const j = this.map.get(kind)
    if (j?.running) { this.cancel.add(kind); j.cancelling = true; this.push(true); this.wakeAll() }
  }

  private push(force = false) {
    const now = Date.now()
    if (force || now - this.last >= 125) { this.last = now; if (this.timer) { clearTimeout(this.timer); this.timer = null }; this.emit(this.list()) }
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.last = Date.now(); this.emit(this.list()) }, 125)
  }

  private wakeAll() { const w = [...this.wake]; this.wake.clear(); for (const f of w) f() }

  /** El primero que tiene que terminar antes que `kind`: pedido antes y con algún servicio en común. */
  private blocker(kind: string): { job: string; service: string } | null {
    const me = this.uses.get(kind)
    if (!me?.services.length) return null
    for (const [k, o] of this.uses) {
      if (k === kind || o.seq > me.seq || !this.map.get(k)?.running) continue
      const service = me.services.find((s) => o.services.includes(s))
      if (service) return { job: this.map.get(k)!.label, service }
    }
    return null
  }

  /**
   * Corre `fn` como proceso de tipo `kind`. Si ya hay uno de ese tipo corriendo, falla sin duplicarlo.
   * `summarize` arma el texto final a partir del resultado. Con `uses`, espera en fila a los que usan el mismo servicio;
   * si se cancela en la fila, `fn` no corre y devuelve `undefined`.
   */
  async run<T>(kind: string, label: string, fn: (h: JobHandle) => Promise<T>, summarize: (r: T) => string = () => TXT.termino, opts: RunOpts = {}): Promise<T> {
    if (this.isRunning(kind)) throw new Error(TXT.yaHay)
    const j: JobState = { kind, label, running: true, done: 0, total: 0, current: '', found: 0, errors: 0, startedAt: Date.now(), finishedAt: null, summary: null, cancelling: false, failed: false, problems: [], waiting: null }
    this.map.set(kind, j)
    this.uses.set(kind, { services: opts.uses ?? [], seq: ++this.seq })
    this.cancel.delete(kind)
    j.waiting = this.blocker(kind)
    this.push(true)
    while (j.waiting && !this.cancel.has(kind)) {
      await new Promise<void>((res) => this.wake.add(res))
      j.waiting = this.blocker(kind)
      if (!j.waiting) j.startedAt = Date.now() // el tiempo cuenta desde que arranca de verdad
      this.push(true)
    }
    if (j.waiting) {
      j.waiting = null; j.running = false; j.cancelling = false; j.finishedAt = Date.now(); j.summary = TXT.canceladoEnFila
      this.cancel.delete(kind); this.uses.delete(kind)
      this.push(true)
      return undefined as T
    }
    const h: JobHandle = {
      update: (patch) => { Object.assign(j, patch); this.push() },
      cancelled: () => this.cancel.has(kind),
    }
    try {
      const r = await fn(h)
      j.summary = (this.cancel.has(kind) ? TXT.cancelado : '') + summarize(r)
      return r
    } catch (e) {
      j.failed = true
      j.summary = (e as Error).message
      throw e
    } finally {
      j.running = false; j.finishedAt = Date.now(); j.cancelling = false
      this.cancel.delete(kind); this.uses.delete(kind)
      this.push(true)
      this.wakeAll()
      try { this.alTerminar?.(j) } catch { /* el aviso nunca rompe el proceso */ }
    }
  }

  /**
   * Un proceso que corre en otro programa (NAPIA bajando: core/sockseek/enlace.ts) y se muestra igual que los de PAILA.
   * `null`: ya no corre (desaparece de la barra). No se puede cancelar desde acá: se corta en NAPIA.
   */
  externo(kind: string, label: string, st: { done: number; total: number; current: string; found: number; startedAt: number } | null) {
    const j = this.map.get(kind)
    if (!st) { if (j) { this.map.delete(kind); this.push(true) } return }
    this.map.set(kind, { kind, label, running: true, ...st, errors: 0, finishedAt: null, summary: null, cancelling: false, failed: false, problems: [], waiting: null })
    this.push()
  }

  /** Saca el resultado de un proceso terminado (la interfaz ya lo vio). */
  dismiss(kind: string) {
    const j = this.map.get(kind)
    if (j && !j.running) { this.map.delete(kind); this.push(true) }
  }
}
