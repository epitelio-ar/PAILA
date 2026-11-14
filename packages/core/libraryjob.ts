// Control del trabajo largo de la biblioteca (escanear o analizar, nunca los dos a la vez): el estado que ve la interfaz y
// pausar, seguir y detener. `Library` lo hereda; core/scan.ts y core/queue.ts lo usan mientras trabajan.
import type { ScanStatus } from '@paila/shared/types'
import { enEsteIdioma, textos, type Idioma } from '@paila/shared/idioma'
import { DISK_POLL_MS } from './readguard'

const T = textos({ deteniendo: { es: 'Deteniendo…', en: 'Stopping…' } })

const idleStatus = (): ScanStatus => ({
  job: null, running: false, paused: false, phase: '', found: 0, toProbe: 0, probed: 0, errors: 0, removed: 0,
  current: '', startedAt: null, finishedAt: null, warnings: [], pauseReason: null, heldBy: null, waitingDisk: null, stopping: false, outcome: null,
})

export class LibraryJob {
  status: ScanStatus = idleStatus()
  /** Pidieron detener: el trabajo en curso corta en el próximo tema. */
  cancel = false
  /** Mientras está en pausa, la promesa que hay que esperar antes del próximo tema. */
  pauseWait: Promise<void> | null = null
  private resumeGate: (() => void) | null = null
  /** Cada cuánto mirar si volvió un disco que se desconectó en medio del análisis (core/readguard.ts; los tests usan menos). */
  diskPollMs = DISK_POLL_MS
  /** Lo pone la app: corta los análisis en curso (workers y ffmpeg). */
  onAbort: (() => void) | null = null
  /** Cuántos temas se están leyendo en este momento (core/queue.ts `each`). Pausar no los corta: terminan solos. */
  reading = 0

  /**
   * Espera a que no quede ningún tema a medio leer, como mucho `maxMs`. Antes de mover o escribir archivos: con 2,5 s fijos,
   * la pasada precisa de un tema largo seguía leyéndolo y Deshacer fallaba con "EBUSY" (corte real con la app, 22/10).
   * Devuelve false si se cumplió el tiempo y todavía hay alguno (la operación sigue: ese archivo puede fallar y se reintenta).
   */
  async idle(maxMs = 60_000, pollMs = 50): Promise<boolean> {
    const t0 = Date.now()
    while (this.reading > 0) {
      if (Date.now() - t0 >= maxMs) return false
      await new Promise((r) => setTimeout(r, pollMs))
    }
    return true
  }

  constructor(private onStatus: (s: ScanStatus) => void = () => {}) {}

  /** Quiénes pausaron el análisis ahora (mover, aplicar, la grilla…): se vuelve a prender cuando sueltan todos. */
  private holds = new Map<number, string>()
  private holdSeq = 0
  /** Lo pausó PAILA (no la persona): entonces lo prende ella misma al soltar el último. */
  private heldPause = false

  /**
   * PAILA pausa el análisis mientras dura algo que mueve archivos o usa mucho el procesador, y lo vuelve a prender sola cuando
   * terminaron TODOS los que lo pausaron (antes la grilla lo prendía al terminar aunque Organizar siguiera moviendo: choques del
   * 27/10, C7). Si la persona lo había pausado, queda pausado. Devuelve la función para soltarlo.
   */
  hold(why: string): () => void {
    const id = ++this.holdSeq
    this.holds.set(id, why)
    if (this.status.running && !this.status.paused) { this.heldPause = true; this.pause(); this.status.heldBy = why; this.emit() }
    return () => {
      if (!this.holds.delete(id) || this.holds.size) return
      if (this.heldPause) { this.heldPause = false; this.resume() }
    }
  }

  /** ¿Hay algo que pidió el análisis en pausa? (no se arranca uno nuevo hasta que suelten) */
  get held(): boolean { return this.holds.size > 0 }

  /** `reason`: por qué se pausó solo (la batería); sin motivo = lo pausó el usuario u otra operación. */
  pause(reason: string | null = null) {
    if (this.status.running && !this.status.paused) { this.status.paused = true; this.status.pauseReason = reason; this.pauseWait = new Promise((r) => (this.resumeGate = r)); this.emit() }
  }
  resume() { if (this.status.paused) { this.status.paused = false; this.status.pauseReason = null; this.status.heldBy = null; this.resumeGate?.(); this.pauseWait = null; this.emit() } }
  /**
   * Cambió el idioma: lo que dice el trabajo en curso ("Analizando calidad, BPM y tono…") se escribió al arrancar y pasa al
   * nuevo (prueba del autor del 28/10: con la app en inglés seguía en castellano).
   */
  pasarIdioma(i: Idioma) { if (this.status.running) { this.status.phase = enEsteIdioma(this.status.phase, i); this.emit() } }
  stop() {
    if (!this.status.running) return
    this.cancel = true
    this.status.phase = T.deteniendo
    this.status.stopping = true
    this.resume()
    this.onAbort?.() // corta lo que está leyendo ahora mismo: no espera a que termine cada archivo
  }

  private lastEmit = 0
  /** Avisa el estado a la interfaz; sin `force`, como mucho cada 150 ms. */
  emit(force = true) {
    const now = Date.now()
    if (!force && now - this.lastEmit < 150) return
    this.lastEmit = now
    this.onStatus({ ...this.status, warnings: [...this.status.warnings] })
  }

  /** Empieza un trabajo: estado limpio y aviso a la interfaz. */
  begin(job: 'scan' | 'analysis', phase: string) {
    this.cancel = false
    this.status = { ...idleStatus(), job, running: true, phase, startedAt: Date.now() }
    // un análisis que arranca mientras algo lo tiene pausado (otra pantalla, el disco que volvió) arranca en pausa y sigue solo después
    if (job === 'analysis' && this.holds.size) { this.heldPause = true; this.pause(); this.status.heldBy = [...this.holds.values()].pop() ?? null }
    this.emit()
  }

  /** Termina el trabajo (bien, detenido o con error): ya no corre ni está en pausa. Si falló, antes se pone `outcome: 'error'`. */
  finish() {
    Object.assign(this.status, {
      running: false, paused: false, pauseReason: null, waitingDisk: null, current: '', finishedAt: Date.now(), stopping: false,
      outcome: this.status.outcome ?? (this.cancel ? 'stopped' : 'ok'),
    })
    this.pauseWait = null
    this.heldPause = false
    this.emit()
  }
}
