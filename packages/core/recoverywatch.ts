// Recuperación con la app abierta: si quedó algo a medias en un disco que no estaba (se desconectó en medio de Organizar,
// por ejemplo), cuando ese disco vuelve PAILA lo termina o lo vuelve atrás sin tener que cerrarla. Solo mira mientras haya
// algo pendiente (sin pendientes no hace nada), corre con el candado de operaciones tomado y nunca pisa una operación en
// marcha: si el candado está ocupado, prueba en la vuelta siguiente.
import type { Db } from './db'
import type { OpLock } from './oplock'
import type { RecoveryReport } from '@paila/shared/types'
import { pendingRoots, recover, type RecoveryDeps } from './recovery'
import { textos } from '@paila/shared/idioma'

// Lo que dice PAILA si mientras tanto le piden otra cosa ("Ahora PAILA está terminando…").
const T = textos({ terminando: { es: 'terminando lo que quedó a medias', en: 'finishing what was left half done' } })

export interface WatchDeps extends RecoveryDeps {
  lock: OpLock
  /** Cada cuánto mirar si volvió el disco (solo mientras haya algo pendiente). */
  everyMs?: number
  /** Se resolvió algo: `resolved` = cuántas anotaciones. */
  onResolved?: (report: RecoveryReport, resolved: number) => void
}

export class RecoveryWatch {
  private timer: NodeJS.Timeout | null = null
  private running = false
  constructor(private db: Db, private deps: WatchDeps) {}

  start() {
    if (this.timer) return
    this.timer = setInterval(() => { void this.check() }, this.deps.everyMs ?? 10_000)
    this.timer.unref?.()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  /**
   * ¿Volvió algún disco con algo a medias? Si sí, lo resuelve ahora (con el candado). También se llama antes de escanear.
   * Devuelve cuántas anotaciones resolvió (0 si no había nada, si el disco sigue sin estar o si PAILA está ocupada).
   */
  async check(): Promise<number> {
    if (this.running || this.deps.lock.busy) return 0
    const p = pendingRoots(this.db)
    const back = p.roots.filter((id) => this.deps.rootPath(id) != null)
    if (!back.length && !p.outside) return 0
    this.running = true
    try {
      const before = this.open()
      const report = await this.deps.lock.run(T.terminando, () => recover(this.db, this.deps, { live: { roots: back } }))
      const resolved = before - this.open()
      if (resolved > 0) this.deps.onResolved?.(report, resolved)
      return resolved
    } catch { return 0 } finally { this.running = false }
  }

  private open = () => (this.db.prepare('SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL').get() as { n: number }).n
}
