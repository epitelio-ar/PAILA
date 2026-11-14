// Intensidad del análisis en la app: lee el modo guardado, mira la batería (powerMonitor) y la memoria libre, y agranda o
// achica el análisis en el momento, sin cortarlo. La regla de cada modo está en core/analysis/intensity.ts.
import os from 'node:os'
import { execFile } from 'node:child_process'
import { powerMonitor, utilityProcess } from 'electron'
import type { Intensity, IntensityInfo } from '@paila/shared/types'
import { plan, threadsFor } from '@paila/core/analysis/intensity'
import { lowPriority, type Spawner, type WorkerMsg, type WorkerPool } from '@paila/core/analysis/pool'
import type { Slots } from '@paila/core/analysis/slots'
import type { Library } from '@paila/core/library'
import { idioma, textos } from '@paila/shared/idioma'

const MODES: Intensity[] = ['tranqui', 'normal', 'fondo']
const SETTING = 'analysis_intensity'
// Los avisos de la batería (se ven en la pantalla Análisis y como aviso suelto). La pausa por batería se reconoce por el
// texto que se puso al pausar (`batteryReason`), no por compararlo con el de ahora: el idioma puede cambiar en el medio.
const T = textos({
  pausa: { es: 'La notebook está a batería y el análisis está en modo Tranqui: sigue solo al enchufarla.', en: "The laptop is on battery and the analysis is in Easy mode: it continues on its own when you plug it in." },
  bajoANormal: {
    es: 'La notebook pasó a batería: el análisis bajó solo de "A fondo" a "Normal". Vuelve a "A fondo" al enchufarla.',
    en: 'The laptop switched to battery: the analysis dropped from "Full power" to "Normal" by itself. It goes back to "Full power" when you plug it in.',
  },
  sigueAFondo: { es: 'Volvió la corriente: el análisis sigue "A fondo".', en: 'Power is back: the analysis continues at "Full power".' },
  enPausa: {
    es: 'La notebook pasó a batería: el análisis (modo Tranqui) quedó en pausa hasta que la enchufes.',
    en: 'The laptop switched to battery: the analysis (Easy mode) is paused until you plug it in.',
  },
  sigueTranqui: { es: 'Volvió la corriente: el análisis (modo Tranqui) sigue solo.', en: 'Power is back: the analysis (Easy mode) continues on its own.' },
})

/** Workers como procesos de Electron aparte, con prioridad baja (Windows no deja bajarle la prioridad a un hilo). */
export const utilitySpawner = (script: string): Spawner => () => {
  // el idioma de ahora, para los errores que se ven (core/analysis/worker.ts)
  const p = utilityProcess.fork(script, [], { serviceName: 'PAILA - análisis', stdio: 'ignore', env: { ...process.env, PAILA_IDIOMA_PROCESO: idioma() } })
  const queue: WorkerMsg[] = []
  let ready = false, exited = false
  p.once('spawn', () => { lowPriority(p.pid); ready = true; for (const m of queue.splice(0)) p.postMessage(m) })
  p.once('exit', () => { exited = true })
  return {
    get pid() { return p.pid },
    post: (m) => { if (ready) p.postMessage(m); else queue.push(m) },
    onMessage: (cb) => p.on('message', cb),
    onExit: (cb) => p.once('exit', () => cb(new Error('El proceso de análisis se cerró'))),
    kill: () => new Promise((r) => { if (exited) return r(); p.once('exit', () => r()); p.kill() }),
  }
}

/** Núcleos físicos del procesador (los hilos de Node son lógicos). En Windows y en Mac se le pregunta al sistema una vez. */
function physicalCores(): Promise<number | null> {
  if (process.platform === 'darwin') {
    return new Promise((resolve) => execFile('sysctl', ['-n', 'hw.physicalcpu'], { timeout: 15_000 }, (err, out) => { const n = Number(String(out).trim()); resolve(!err && n > 0 ? n : null) }))
  }
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum'],
      { windowsHide: true, timeout: 15_000 }, (err, out) => { const n = Number(String(out).trim()); resolve(!err && n > 0 ? n : null) })
  })
}

export class IntensityControl {
  private run: { slots: Slots; pool: WorkerPool } | null = null
  private timer: NodeJS.Timeout | null = null
  private cores: number | null = null
  private readonly threads = os.availableParallelism()
  /** El aviso con el que se pausó por la batería (para seguir solo si sigue siendo esa pausa). */
  private batteryReason: string | null = null

  constructor(private lib: Library, private get: (k: string) => string | null, private put: (k: string, v: string) => void, private notify: (i: IntensityInfo) => void) {
    void physicalCores().then((c) => { this.cores = c })
    powerMonitor.on('on-battery', () => this.power(true))
    powerMonitor.on('on-ac', () => this.power(false))
  }

  mode(): Intensity {
    const m = this.get(SETTING) as Intensity | null
    return m && MODES.includes(m) ? m : 'normal'
  }

  private onBattery() { try { return powerMonitor.isOnBatteryPower() } catch { return false } }

  private current() {
    return plan({ mode: this.mode(), threads: this.threads, onBattery: this.onBattery(), freeMb: os.freemem() / 1e6, running: this.run?.pool.size ?? 0 })
  }

  /** Cuántos temas a la vez al arrancar un análisis. */
  workers() { return this.current().workers }

  info(notice: string | null = null): IntensityInfo {
    const p = this.current()
    return {
      mode: this.mode(), effective: p.effective, workers: p.workers,
      byMode: { tranqui: threadsFor('tranqui', this.threads), normal: threadsFor('normal', this.threads), fondo: threadsFor('fondo', this.threads) },
      threads: this.threads, cores: this.cores, cpu: os.cpus()[0]?.model.replace(/\s+/g, ' ').trim() ?? '',
      onBattery: this.onBattery(), paused: p.paused, limitedByMemory: p.limitedByMemory, freeMb: Math.round(os.freemem() / 1e6), notice,
    }
  }

  /** Empieza un análisis: desde ahora los cambios de modo, batería o memoria se le aplican en el momento. */
  attach(slots: Slots, pool: WorkerPool) {
    this.run = { slots, pool }
    this.apply(true)
    // la memoria libre cambia sola (otros programas): se revisa cada medio minuto
    this.timer = setInterval(() => this.apply(false), 30_000)
  }

  detach() {
    this.run = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  set(mode: Intensity): IntensityInfo {
    if (!MODES.includes(mode)) throw new Error('Intensidad desconocida')
    this.put(SETTING, mode)
    this.apply(true)
    const i = this.info()
    this.notify(i)
    return i
  }

  /** Aplica el plan. `transition`: cambió algo (modo, batería, arranque): recién ahí se pausa o se sigue solo. */
  private apply(transition: boolean) {
    const p = this.current()
    if (this.run) { this.run.slots.resize(p.workers); this.run.pool.resize(p.workers) }
    if (!transition) return
    const s = this.lib.status
    if (p.paused && s.running && s.job === 'analysis' && !s.paused) { this.batteryReason = T.pausa; this.lib.pause(this.batteryReason) }
    // solo se sigue solo si fue la batería la que lo pausó (si lo pausó el usuario, queda en pausa)
    if (!p.paused && s.paused && this.batteryReason && s.pauseReason === this.batteryReason) { this.batteryReason = null; this.lib.resume() }
  }

  private power(battery: boolean) {
    this.apply(true)
    const m = this.mode()
    const notice = m === 'fondo'
      ? battery ? T.bajoANormal : T.sigueAFondo
      : m === 'tranqui' && this.lib.status.running && this.lib.status.job === 'analysis'
        ? battery ? T.enPausa : T.sigueTranqui
        : null
    this.notify(this.info(notice))
  }
}
