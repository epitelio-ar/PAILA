// Ritmo y tiempo estimado de un escaneo o análisis: sale del promedio de lo que viene haciendo, suavizado (no de la
// velocidad del último instante), y no promete nada cuando la velocidad no es creíble. El 21/10/2026 la pasada precisa
// fallaba en cadena (disco desenchufado) y la pantalla decía "2.855 por minuto · falta menos de 1 min".

export interface Eta {
  /** Temas por minuto (suavizado), o null si todavía no hay con qué calcular. */
  perMinute: number | null
  /** Minutos que faltan, o null ("calculando…"). */
  minutes: number | null
  /** La velocidad no es creíble (casi todo da error): no se estima. */
  doubtful: boolean
}

/** Cuánto pesa lo último contra lo de antes: el promedio se va corriendo con una constante de unos 2 minutos. */
const TAU_MS = 120_000
/** Lo mínimo para estimar: 20 s mirando y 3 temas hechos. */
const MIN_MS = 20_000
const MIN_DONE = 3
/** Ventana para mirar los errores recientes. */
const RECENT_MS = 60_000

/**
 * Mide de a pasos: `add` con cada estado que llega (hora, cuántos van, cuántos errores); `gap` cuando se pausa (lo que
 * dura la pausa no cuenta); `estimate` con cuántos faltan.
 */
export class EtaMeter {
  private start: { t: number; n: number } | null = null
  private last: { t: number; n: number } | null = null
  private span = 0
  private done = 0
  private ema: number | null = null
  private recent: { t: number; n: number; errors: number }[] = []

  /** Reinicia (cambió la fase o la tarea). */
  reset() { this.start = this.last = null; this.span = 0; this.done = 0; this.ema = null; this.recent = [] }

  /** Una pausa: el próximo paso arranca de cero (el tiempo en pausa no baja el ritmo). */
  gap() { this.last = null }

  add(t: number, n: number, errors = 0) {
    this.recent.push({ t, n, errors })
    while (this.recent.length > 2 && t - this.recent[0].t > RECENT_MS) this.recent.shift()
    if (!this.last) { this.last = { t, n }; this.start ??= { t, n }; return }
    const dt = t - this.last.t, dn = n - this.last.n
    // mismo instante (lo que avanzó llega entre dos tics del reloj): se espera al próximo tic para contarlo. Antes se
    // pisaba el último y ese avance se perdía: Completar desde internet decía "4,7 por minuto · falta 2 h 24 min" y
    // terminó en 9 min (prueba de la persona 2, 1/11)
    if (dt <= 0 && dn >= 0) return
    if (dt <= 0 || dn < 0) { this.last = { t, n }; return }
    this.span += dt
    this.done += dn
    this.last = { t, n }
    // hasta juntar lo mínimo, el promedio simple; después, un promedio que se corre (pesa más lo reciente, sin saltos)
    if (this.span < MIN_MS || this.ema == null) { this.ema = this.done / this.span; return }
    const alpha = 1 - Math.exp(-dt / TAU_MS)
    this.ema += alpha * (dn / dt - this.ema)
  }

  estimate(remaining: number): Eta {
    if (this.span < MIN_MS || this.done < MIN_DONE || this.ema == null || this.ema <= 0) return { perMinute: null, minutes: null, doubtful: false }
    const perMinute = Math.round(this.ema * 60_000 * 10) / 10
    // errores en cadena: si la mitad o más de lo último dio error, el ritmo no dice nada
    const a = this.recent[0], b = this.recent[this.recent.length - 1]
    const recentDone = b.n - a.n, recentErr = b.errors - a.errors
    if (recentDone >= 5 && recentErr * 2 >= recentDone) return { perMinute, minutes: null, doubtful: true }
    const minutes = Math.max(0, remaining) / (this.ema * 60_000)
    // "menos de 1 min" solo si ya se vio hacer esa cantidad de verdad (al menos un minuto mirando, o faltan menos de los
    // que se hicieron en el último minuto)
    if (minutes < 1 && remaining > 0 && this.span < 60_000 && remaining > recentDone) return { perMinute, minutes: null, doubtful: false }
    return { perMinute, minutes, doubtful: false }
  }
}
