// Candado de operaciones: escanear, aplicar cambios, mover, convertir, mandar a la papelera y deshacer NUNCA corren a la vez.
// Si dos se pisaran, una podría ver la carpeta a medio mover (y, por ejemplo, dar por desaparecido un tema que se estaba
// moviendo). El análisis no entra acá: solo lee, y se pausa aparte mientras se escribe.
import { textos } from '@paila/shared/idioma'

// `what` ("escaneando la biblioteca") lo pasa cada operación ya en el idioma de ahora: completa la frase.
const T = textos({
  ocupada: { es: (what: string) => `Ahora PAILA está ${what}. Esperá a que termine y probá de nuevo.`, en: (what: string) => `PAILA is ${what} right now. Wait for it to finish and try again.` },
  espera: { es: (who: string) => `Espera a que termine: ${who}`, en: (who: string) => `Waiting for this to finish: ${who}` },
  cancelado: { es: 'Cancelado mientras esperaba', en: 'Cancelled while waiting' },
})

/** Para mostrar la espera en un renglón (el `current` de un proceso largo) y poder cancelarla. */
export interface WaitHandle { update(p: { current: string }): void; cancelled(): boolean }

/** Se cortó la espera (la persona apretó Cancelar). */
export class WaitCancelled extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class OpLock {
  private holder: string | null = null
  private cuttable = false
  /**
   * Lo que lee archivos un buen rato sin moverlos (buscar tapas, la grilla, duplicados, buscar silencios): corren a la vez entre
   * ellos, pero nunca con algo que mueve o escribe. Antes corrían igual y perdían lo que se movía en el medio (un disco
   * "propuesto" que ya no estaba, pares de duplicados de menos: choques del 27/10, C7). Ahora lo que mueve espera y lo dice.
   */
  private readers = new Map<number, string>()
  private readerSeq = 0
  pollMs = 200

  /** Lo que está leyendo ahora (para el renglón "espera a que termine…"). */
  get reading(): string[] { return [...this.readers.values()] }

  /** Qué se está haciendo ahora ("escaneando la biblioteca"), o null si está libre. */
  get busy(): string | null { return this.holder }

  /**
   * Lo que se está haciendo y no conviene cortar cerrando PAILA (mover, escribir, copiar, deshacer), o null. Escanear se
   * puede cortar: se retoma solo la próxima vez.
   */
  get unsafeToClose(): string | null { return this.cuttable ? null : this.holder }

  /** Espera a que el candado quede libre, como mucho `maxMs`. false si se cumplió el tiempo y sigue ocupado. */
  async free(maxMs = 30_000, pollMs = 100): Promise<boolean> {
    const t0 = Date.now()
    while (this.holder) {
      if (Date.now() - t0 >= maxMs) return false
      await new Promise((r) => setTimeout(r, pollMs))
    }
    return true
  }

  /**
   * Corre `fn` con el candado tomado. Si ya hay otra operación, no espera: avisa qué se está haciendo, para que la
   * persona lo vea y lo intente de nuevo cuando termine (esperar en silencio parecería que la app se colgó).
   */
  async run<T>(what: string, fn: () => Promise<T> | T, opts: { cuttable?: boolean; wait?: WaitHandle } = {}): Promise<T> {
    if (this.holder) throw new Error(T.ocupada(this.holder))
    // escanear no mueve nada: no espera a los que leen. Lo que mueve sin un renglón donde decir que espera, avisa enseguida.
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
    if (!opts.cuttable && this.readers.size && !opts.wait) throw new Error(T.ocupada(lower(this.reading[0])))
    this.holder = what
    this.cuttable = !!opts.cuttable
    try {
      // con el candado ya tomado (nada nuevo empieza a leer), espera a que termine lo que estaba leyendo
      let waited = false
      while (!this.cuttable && this.readers.size) {
        if (opts.wait?.cancelled()) throw new WaitCancelled(T.cancelado)
        opts.wait?.update({ current: T.espera(this.reading.join(' · ')) })
        waited = true
        await sleep(this.pollMs)
      }
      if (waited) opts.wait?.update({ current: '' })
      return await fn()
    } finally { this.holder = null; this.cuttable = false }
  }

  /**
   * Corre `fn`, que lee archivos un rato largo sin moverlos (ver `readers`). Si algo está moviendo o escribiendo, espera a que
   * termine (y lo dice en `wait`); mientras lee, lo que mueve espera. Varios lectores corren a la vez.
   */
  async read<T>(what: string, fn: () => Promise<T> | T, wait?: WaitHandle): Promise<T> {
    let waited = false
    while (this.holder && !this.cuttable) {
      if (wait?.cancelled()) throw new WaitCancelled(T.cancelado)
      wait?.update({ current: T.espera(this.holder) })
      waited = true
      await sleep(this.pollMs)
    }
    if (waited) wait?.update({ current: '' })
    const id = ++this.readerSeq
    this.readers.set(id, what)
    try { return await fn() } finally { this.readers.delete(id) }
  }
}
