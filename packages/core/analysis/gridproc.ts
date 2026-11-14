// Lo que hace la app con el proceso de la grilla (apps/paila/electron/gridengine.ts), sin Electron, para poder probarlo: le
// manda cada tema, le contesta los pedazos que pide (Beat This! en la placa de video) y, si el proceso se cierra o pasa mucho
// sin dar señales, el tema en curso falla con su motivo y el próximo arranca otro proceso. Así un tema raro (un mix de 77
// minutos, en el punto 1 real del 24/10) no frena la pasada ni la app. Tests: tests/grilla-proceso.test.ts.
import type { GridAnalysis } from './gridscan'
import type { GridEngineKind, GridWorkerIn, GridWorkerOut } from './gridworker'
import { textos } from '@paila/shared/idioma'

// por qué un tema quedó sin grilla (se ve en la lista de los que fallaron)
const T = textos({
  noSePudo: { es: 'No se pudo calcular la grilla', en: "The grid couldn't be worked out" },
  cerrado: { es: 'El proceso de la grilla se cerró con este tema (puede ser muy largo o estar dañado)', en: 'The grid process closed on this track (it may be very long or damaged)' },
  trabado: { es: (min: number) => `Pasaron ${min} minutos sin avanzar con este tema: se salteó`, en: (min: number) => `${min} minutes went by without progress on this track: it was skipped` },
  salteado: { es: 'Lo salteaste: quedó sin grilla', en: 'You skipped it: it was left without a grid' },
})

/**
 * Si el proceso de la grilla pasa este tiempo sin dar señales (ni un pedazo escuchado), se lo cierra y el tema se saltea.
 * Con degara, un tema de una hora tarda unos minutos sin dar señales.
 */
export const STALL_MS = 15 * 60_000

/** El proceso (o hilo) de la grilla, visto desde la app: `onExit` avisa si se cerró solo. */
export interface GridPort {
  post(m: GridWorkerIn): void
  onMessage(cb: (m: GridWorkerOut) => void): void
  onExit(cb: () => void): void
  kill(): void
}

export type GridModel = (spect: Float32Array) => Promise<{ beat: Float32Array; downbeat: Float32Array }>
export type GridJobIn = Omit<Extract<GridWorkerIn, { type: 'job' }>, 'type' | 'id'> & { engine: GridEngineKind }

export class GridRunner {
  private port: GridPort | null = null
  private jobs = new Map<number, { resolve: (r: GridAnalysis) => void; reject: (e: Error) => void }>()
  private seq = 0
  /** Cuándo dio señales el proceso por última vez (un pedazo escuchado o un tema listo). */
  private news = 0
  private watch: ReturnType<typeof setInterval> | null = null

  /** `spawn`: arranca el proceso; `model`: corre un pedazo en la placa de video (lo que pide el proceso). */
  constructor(private spawn: () => GridPort, private model: GridModel, private opts: { stallMs?: number; checkMs?: number } = {}) {}

  /** Los temas en curso fallan con `e` y el proceso se olvida (el próximo tema arranca otro). */
  private fail(e: Error, kill = false) {
    const p = this.port
    this.port = null
    for (const j of this.jobs.values()) j.reject(e)
    this.jobs.clear()
    if (kill) p?.kill()
  }

  private open(): GridPort {
    if (this.port) return this.port
    const p = this.spawn()
    p.onMessage((m) => {
      this.news = Date.now()
      if (m.type === 'alive') return
      if (m.type === 'model') {
        this.model(m.spect).then(
          (r) => p.post({ type: 'logits', req: m.req, beat: r.beat, downbeat: r.downbeat }),
          (e: Error) => p.post({ type: 'logits', req: m.req, error: e.message }),
        )
        return
      }
      const j = this.jobs.get(m.id)
      this.jobs.delete(m.id)
      if (!j) return
      if (m.result) j.resolve(m.result)
      else j.reject(new Error(m.error ?? T.noSePudo))
    })
    p.onExit(() => { if (this.port === p) this.fail(new Error(T.cerrado)) })
    this.port = p
    return p
  }

  /** La grilla de un archivo. */
  run(job: GridJobIn): Promise<GridAnalysis> {
    const id = ++this.seq, stall = this.opts.stallMs ?? STALL_MS
    this.news = Date.now()
    this.watch ??= setInterval(() => {
      if (!this.jobs.size) { clearInterval(this.watch!); this.watch = null; return }
      if (Date.now() - this.news > stall) this.fail(new Error(T.trabado(Math.round(stall / 60_000))), true)
    }, this.opts.checkMs ?? 30_000)
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject })
      this.open().post({ type: 'job', id, ...job })
    })
  }

  /**
   * El botón «Saltear este»: el tema en curso falla con su motivo y se cierra el proceso (es la única forma de frenar la cuenta
   * en el medio); la pasada sigue con el próximo, en un proceso nuevo. false si no había ninguno en curso.
   */
  skip(): boolean {
    if (!this.jobs.size) return false
    this.fail(new Error(T.salteado), true)
    return true
  }

  close() {
    if (this.watch) clearInterval(this.watch)
    this.watch = null
    this.fail(new Error(T.cerrado), true)
  }
}
