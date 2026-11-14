// Vigila con la app abierta qué carpetas de la biblioteca están: si un disco se desconecta o vuelve, avisa enseguida (el
// puntito de la barra lateral pasa a gris o a verde) y dice cuáles volvieron, para retomar lo que esperaba (el análisis,
// lo que quedó a medias). Antes el puntito solo se actualizaba al terminar un trabajo (21/10/2026: siguió verde con el
// SSD desenchufado).
import type { RootInfo } from '@paila/shared/types'

export class RootsWatch {
  private timer: NodeJS.Timeout | null = null
  private last = new Map<number, boolean>()

  /** `onChange`: las carpetas de hoy y las que volvieron (ids) desde la vuelta anterior. */
  constructor(private roots: () => RootInfo[], private onChange: (roots: RootInfo[], back: number[]) => void, private everyMs = 3000) {
    for (const r of this.safeRoots()) this.last.set(r.id, r.available)
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.check(), this.everyMs)
    this.timer.unref?.()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  private safeRoots(): RootInfo[] { try { return this.roots() } catch { return [] } }

  /** Mira ahora. Devuelve true si algo cambió (y ya avisó). */
  check(): boolean {
    const now = this.safeRoots()
    const changed = now.length !== this.last.size || now.some((r) => this.last.get(r.id) !== r.available)
    if (!changed) return false
    const back = now.filter((r) => r.available && this.last.get(r.id) === false).map((r) => r.id)
    this.last = new Map(now.map((r) => [r.id, r.available]))
    this.onChange(now, back)
    return true
  }
}
