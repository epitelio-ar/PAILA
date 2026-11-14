// Cuántos temas se analizan a la vez, cambiable en el momento: al achicarlo, los temas en curso terminan y no arrancan
// otros hasta que haya lugar; al agrandarlo, arrancan los que esperaban. Lo usa la cola de análisis (core/queue.ts).

export class Slots {
  private active = 0
  private waiters: (() => void)[] = []
  private children: { slots: Slots; f: (n: number) => number }[] = []
  private closed = false

  constructor(private max: number) {}

  /** Cuántos temas a la vez se permiten ahora. */
  get size() { return this.max }
  /** Cuántos se están analizando ahora. */
  get busy() { return this.active }

  /** Cambia cuántos a la vez. No corta nada: si baja, los que están en curso terminan su tema. */
  resize(n: number) {
    this.max = Math.max(1, Math.floor(n))
    for (const c of this.children) c.slots.resize(c.f(this.max))
    this.wake()
  }

  /** Otro limitador que sigue a este con una cuenta propia (por ejemplo, la mitad para el BPM preciso). */
  derive(f: (n: number) => number): Slots {
    const slots = new Slots(f(this.max))
    this.children.push({ slots, f })
    return slots
  }

  /** Espera un lugar. Devuelve false si se cerró (se detuvo el análisis): en ese caso no hay que liberar nada. */
  async acquire(): Promise<boolean> {
    while (!this.closed && this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r))
    if (this.closed) return false
    this.active++
    return true
  }

  release() {
    this.active = Math.max(0, this.active - 1)
    this.wake()
  }

  /** Despierta a todos los que esperan para que vean que se detuvo. */
  close() {
    this.closed = true
    for (const c of this.children) c.slots.close()
    this.wake()
  }

  private wake() {
    const w = this.waiters
    this.waiters = []
    for (const r of w) r() // cada uno vuelve a fijarse si hay lugar
  }
}
