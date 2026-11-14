// Grupo de workers: cada uno analiza un archivo por vez sin trabar la app. Se agranda o achica en el momento (intensidad
// del análisis, core/analysis/intensity.ts). En la app cada worker es un proceso aparte con prioridad baja.
import { Worker } from 'node:worker_threads'
import { fork } from 'node:child_process'
import os from 'node:os'
import { lowPriority } from '../lowpriority'
import type { AnalyzeJob, PreciseJob, Prints, PrintsJob, RawAnalysis } from './analyze'
import type { PreciseVotes } from './dj'
import type { SilenceJob, SilenceResult } from './silence'
import type { StyleJob, StyleResult } from './effnetrun'
import { threadsFor } from './intensity'

export type WorkerMsg = { type: 'full'; job: AnalyzeJob } | { type: 'prints'; job: PrintsJob } | { type: 'precise'; job: PreciseJob }
  | { type: 'silence'; job: SilenceJob } | { type: 'style'; job: StyleJob }
/** `mb`: memoria del worker al terminar (si pasa de RECYCLE_MB, se reemplaza por uno nuevo). */
type Reply = { ok: boolean; result?: unknown; error?: string; mb?: number }

/**
 * Tope de memoria de un worker: si al terminar un tema usa más, se cierra y arranca otro limpio. Red de seguridad por si
 * algo vuelve a quedar ocupado tema tras tema (pasó con Essentia, ver core/analysis/dj.ts).
 */
export const RECYCLE_MB = 1200

/** Lo que necesita la cola de análisis. En la app usa los workers; en los tests, las funciones directas. */
export interface AnalysisRunner {
  full(job: AnalyzeJob): Promise<RawAnalysis>
  /** Solo las huellas, para los temas analizados antes de que existieran. */
  prints(job: PrintsJob): Promise<Prints>
  /** Votos de la pasada precisa (core/precise.ts). Sin esto, la pasada precisa no corre. */
  precise?(job: PreciseJob): Promise<PreciseVotes>
  /** Silencio al principio y al final de un tema ya analizado (core/silencepass.ts). Sin esto, esa pasada no corre. */
  silence?(job: SilenceJob): Promise<SilenceResult>
  /** Estilo por el sonido y lo que oye para la energía (core/stylepass.ts), si se bajó el modelo. */
  style?(job: StyleJob): Promise<StyleResult>
}

/** Un worker, sea un hilo o un proceso: mandarle un trabajo, oír la respuesta, enterarse si se cerró, cerrarlo. */
export interface WorkerPort {
  post(msg: WorkerMsg): void
  onMessage(cb: (m: Reply) => void): void
  /** Se cerró (porque se lo cerró o porque se cayó). */
  onExit(cb: (why: Error) => void): void
  kill(): Promise<void>
  /** Número de proceso (para medir memoria y bajarle la prioridad), si es un proceso aparte. */
  pid?: number
}
export type Spawner = () => WorkerPort

export { lowPriority } // prioridad baja (core/lowpriority.ts)

/** Workers como hilos del mismo proceso (los tests). Windows no deja bajarle la prioridad a un hilo desde Node. */
export const threadSpawner = (script: string): Spawner => () => {
  const w = new Worker(script)
  let exited = false
  const exits: ((e: Error) => void)[] = []
  const done = (e: Error) => { if (!exited) { exited = true; for (const cb of exits) cb(e) } }
  w.on('error', done)
  w.on('exit', () => done(new Error('El worker de análisis se cerró')))
  return { post: (m) => w.postMessage(m), onMessage: (cb) => w.on('message', cb), onExit: (cb) => exits.push(cb), kill: async () => { await w.terminate() } }
}

/** Workers como procesos de Node aparte, con prioridad baja (las mediciones; la app usa el equivalente de Electron). */
export const forkSpawner = (script: string): Spawner => () => {
  const p = fork(script, [], { serialization: 'advanced', stdio: 'ignore', windowsHide: true })
  lowPriority(p.pid)
  return {
    pid: p.pid,
    post: (m) => p.send(m),
    onMessage: (cb) => p.on('message', (m) => cb(m as Reply)),
    onExit: (cb) => p.once('exit', () => cb(new Error('El proceso de análisis se cerró'))),
    kill: () => new Promise((r) => { if (p.exitCode != null || p.signalCode) return r(); p.once('exit', () => r()); p.kill() }),
  }
}

/**
 * Cuántos workers de análisis usar en modo Normal: la mitad de los hilos del procesador (ver threadsFor). Cada worker
 * tiene además su ffmpeg decodificando en paralelo, así que ocupa entre 1 y 2 hilos.
 */
export function analysisWorkers(cores = os.availableParallelism()) {
  return threadsFor('normal', cores)
}

interface Pending { resolve: (r: unknown) => void; reject: (e: Error) => void }
type Waiter = ((w: WorkerPort) => void) & { reject?: (e: Error) => void }

export class WorkerPool implements AnalysisRunner {
  private idle: WorkerPort[] = []
  private waiting: Waiter[] = []
  private pending = new Map<WorkerPort, Pending>()
  private all = new Set<WorkerPort>()
  private closing = false
  private spawner: Spawner

  /** `spawner`: cómo arrancar cada worker (un script = hilos). Los workers arrancan recién cuando hacen falta. */
  constructor(spawner: Spawner | string, private max: number) {
    this.spawner = typeof spawner === 'string' ? threadSpawner(spawner) : spawner
  }

  /** Cuántos workers hay vivos ahora. */
  get size() { return this.all.size }
  /** Los procesos de los workers (para medir cuánta memoria usan). */
  get pids() { return [...this.all].map((w) => w.pid).filter((p): p is number => p != null) }

  /** Cambia cuántos workers puede haber. Los que sobran se cierran al terminar su tema; los que faltan arrancan solos. */
  resize(n: number) {
    this.max = Math.max(1, Math.floor(n))
    while (this.all.size > this.max && this.idle.length) this.retire(this.idle.pop()!)
    this.serve()
  }

  private spawn(): WorkerPort {
    const w = this.spawner()
    w.onMessage((m) => {
      const p = this.pending.get(w)
      this.pending.delete(w)
      if (p) m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))
      if ((m.mb ?? 0) > RECYCLE_MB && this.all.has(w)) { this.retire(w); this.serve() } else this.release(w)
    })
    // Si un worker se cae (o se cerró), lo que estaba haciendo falla y la cola sigue con otro.
    w.onExit((e) => {
      const p = this.pending.get(w)
      this.pending.delete(w)
      this.all.delete(w)
      this.idle = this.idle.filter((x) => x !== w)
      p?.reject(e)
      this.serve()
    })
    this.all.add(w)
    return w
  }

  private retire(w: WorkerPort) {
    this.all.delete(w)
    this.idle = this.idle.filter((x) => x !== w)
    void w.kill()
  }

  private release(w: WorkerPort) {
    if (!this.all.has(w)) return
    if (this.all.size > this.max) { this.retire(w); return }
    const next = this.waiting.shift()
    if (next) next(w)
    else this.idle.push(w)
  }

  /** Arranca workers para los pedidos que esperan, mientras haya lugar. */
  private serve() {
    while (!this.closing && this.waiting.length && this.all.size < this.max) this.waiting.shift()!(this.spawn())
  }

  private call<T>(msg: WorkerMsg): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closing) return reject(new Error('Detenido'))
      const go = (w: WorkerPort) => { this.pending.set(w, { resolve: resolve as (r: unknown) => void, reject }); w.post(msg) }
      const w = this.idle.pop() ?? (this.all.size < this.max ? this.spawn() : undefined)
      if (w) go(w)
      else this.waiting.push(Object.assign(go, { reject }))
    })
  }

  full(job: AnalyzeJob) { return this.call<RawAnalysis>({ type: 'full', job }) }
  prints(job: PrintsJob) { return this.call<Prints>({ type: 'prints', job }) }
  precise(job: PreciseJob) { return this.call<PreciseVotes>({ type: 'precise', job }) }
  silence(job: SilenceJob) { return this.call<SilenceResult>({ type: 'silence', job }) }
  style(job: StyleJob) { return this.call<StyleResult>({ type: 'style', job }) }

  /** Corta todo lo que está en curso: los pedidos pendientes fallan y los workers ocupados se cierran. */
  abort() {
    const busy = [...this.pending]
    this.pending.clear()
    for (const [w, p] of busy) { p.reject(new Error('Detenido')); this.retire(w) }
    for (const g of this.waiting) g.reject?.(new Error('Detenido'))
    this.waiting = []
  }

  async close() {
    this.closing = true
    this.abort()
    const all = [...this.all]
    this.all.clear()
    this.idle = []
    await Promise.all(all.map((w) => w.kill()))
  }
}
