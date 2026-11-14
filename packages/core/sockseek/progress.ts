// NAPIA: leer lo que va diciendo sockseek y llevar el estado de cada tema. Puro: recibe líneas, devuelve el estado.
// - Por la salida normal (stdout), con --progress-json, una línea JSON por evento: track_list, search_start, download_start,
//   download_progress (solo trae el tamaño, por eso se busca el tema por el tamaño del archivo) y track_state (cómo terminó).
//   download_start dice de qué usuario se baja (`fuente`): si el archivo resulta trucho, se le pide otra fuente (calidad.ts); y
//   cómo se llama allá (`archivo`): con ese nombre queda el pedazo a medio bajar, que se revisa mientras baja (muestra.ts).
// - Por la de errores (stderr), el registro de siempre: la cuenta, "Kicked from server" (otra sesión con la misma cuenta,
//   por ejemplo SoulseekQt abierto), la pausa de búsquedas de Soulseek y los cortes con otros usuarios, que son normales.
// - El patrón "no se conecta con nadie": encuentra los temas pero ninguna conexión sale ("Failed to establish a direct or
//   indirect transfer/message connection to …") y no baja ninguno. Ahí no sirve "probá más tarde": casi siempre es el router
//   trabado por las miles de conexiones que abre cada búsqueda (ver router.ts y el sockseek con freno).
import type { ProblemKind, RunStatus, TrackProgress, TrackState } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'

// Lo que se ve en la pantalla de NAPIA. Los patrones de abajo (en inglés) son lo que escribe sockseek: no se traducen.
const T = textos({
  nadieLoTiene: { es: 'Nadie lo tiene compartido (o con otro nombre).', en: 'Nobody is sharing it (or it has another name).' },
  otraCalidad: { es: 'Lo tienen, pero no en la calidad pedida o con otra duración.', en: 'Someone has it, but not in the quality you asked for, or with a different length.' },
  nombreMalo: { es: 'El nombre no sirve para buscar: revisalo en la lista.', en: 'The name doesn\'t work for searching: check it in the list.' },
  nadieConecta: { es: 'Lo encontró, pero no se pudo conectar con ninguno de los que lo tienen.', en: 'Found it, but couldn\'t connect to anyone who has it.' },
  seCorto: { es: 'Lo encontró, pero se cortó varias veces. Probá más tarde.', en: 'Found it, but it cut off several times. Try again later.' },
  vezAnterior: { es: 'No se encontró la vez anterior.', en: 'Not found last time.' },
  noSePudo: { es: 'No se pudo bajar.', en: 'Couldn\'t download it.' },
  sockseekDice: { es: (r: string) => `No se pudo bajar (sockseek dice: ${r}).`, en: (r: string) => `Couldn't download it (sockseek says: ${r}).` },
  sinCuenta: { es: 'Falta tu cuenta de Soulseek en la configuración de sockseek.', en: 'Your Soulseek account is missing from sockseek\'s settings.' },
  claveMal: { es: 'Soulseek no aceptó la contraseña: revisala en la configuración de sockseek.', en: 'Soulseek didn\'t accept the password: check it in sockseek\'s settings.' },
  echado: {
    es: 'Soulseek cortó la conexión: puede ser que la misma cuenta esté abierta en otro lado (SoulseekQt, Nicotine+ u otra compu).',
    en: 'Soulseek cut the connection: the same account may be open somewhere else (SoulseekQt, Nicotine+ or another computer).',
  },
  login: {
    es: 'No se pudo entrar a Soulseek. Revisá la conexión a internet y probá de nuevo en un rato.',
    en: 'Couldn\'t sign in to Soulseek. Check your internet connection and try again in a while.',
  },
  pausaBusquedas: {
    es: 'Soulseek pide esperar entre búsquedas: sockseek sigue solo cuando se puede (puede tardar unos minutos).',
    en: 'Soulseek asks you to wait between searches: sockseek carries on by itself when it can (it may take a few minutes).',
  },
})

const STATES: TrackState[] = ['espera', 'buscando', 'bajando', 'bajado', 'yaEstaba', 'noEncontrado', 'fallo', 'cancelado']
const keyOf = (artist: string, title: string) => `${artist}\u0000${title}`.toLowerCase().replace(/\s+/g, ' ').trim()
const LOG_LINES = 300

/** Por qué no se pudo, como lo dice sockseek (failureReason) → en el idioma de la pantalla y si cuenta como "no se encontró". */
const FAILURES: Record<string, [TrackState, () => string]> = {
  NoSearchResults: ['noEncontrado', () => T.nadieLoTiene],
  NoSuitableFileFound: ['noEncontrado', () => T.otraCalidad],
  InvalidSearchString: ['noEncontrado', () => T.nombreMalo],
  AllDownloadsFailed: ['fallo', () => T.nadieConecta],
  OutOfDownloadRetries: ['fallo', () => T.seCorto],
}

/** No se pudo hacer ni la conexión directa ni la indirecta con otro usuario (con el router trabado, pasa con todos). */
export const isEstablishError = (line: string) => /failed to establish a direct or indirect (transfer|message) connection/i.test(line)
/** Cuántas conexiones fallidas sin ninguna bajada hacen el patrón (mientras baja; al terminar alcanza con 3). */
const NADIE_DURANTE = 8, NADIE_AL_FINAL = 3

export interface Row { artist: string; title: string }

export class Progress {
  private rows: TrackProgress[]
  private byKey = new Map<string, TrackProgress>()
  private bySize = new Map<number, TrackProgress>()
  peerErrors = 0
  /** Conexiones con otros usuarios que no se pudieron hacer ni directa ni indirectamente. */
  establishErrors = 0
  /** Algún tema llegó a bajar algo (más de 0 %): entonces la conexión no es el problema. */
  private anyBytes = false
  problem: RunStatus['problem'] = null
  log: string[] = []
  summary: { ok: number; failed: number } | null = null

  /** `rows`: las filas de la lista; si ya son temas con su estado (los tramos de core/sockseek/tramos.ts), se usan esos mismos. */
  constructor(rows: (Row | TrackProgress)[]) {
    this.rows = rows.map((r) => ('state' in r ? r : { artist: r.artist, title: r.title, state: 'espera', percent: null, detail: null, path: null, format: null }))
    for (const r of this.rows) if (!this.byKey.has(keyOf(r.artist, r.title))) this.byKey.set(keyOf(r.artist, r.title), r)
  }

  /** El tema del evento; si sockseek nombra uno que no estaba en la lista (otra forma de escribirlo), se suma al final. */
  private track(d: { artist?: string; title?: string }): TrackProgress | null {
    if (!d.title) return null
    const k = keyOf(d.artist ?? '', d.title)
    let t = this.byKey.get(k)
    if (!t) { t = { artist: d.artist ?? '', title: d.title, state: 'espera', percent: null, detail: null, path: null, format: null }; this.rows.push(t); this.byKey.set(k, t) }
    return t
  }

  /** Una línea de la salida normal. Devuelve true si cambió algo que se ve. */
  stdout(line: string): boolean {
    const s = line.trim()
    if (!s.startsWith('{')) {
      if (s) this.addLog(s)
      if (isEstablishError(s)) { this.establishErrors++; return true }
      return false
    }
    let ev: { type?: string; data?: Record<string, unknown> }
    try { ev = JSON.parse(s) } catch { this.addLog(s); return false }
    const d = (ev.data ?? {}) as Record<string, never>
    switch (ev.type) {
      case 'track_list': {
        // lo que ya estaba (o no se encontró la vez anterior) sockseek lo dice solo acá, ya terminado: no manda track_state
        for (const x of (d.tracks ?? []) as { artist?: string; title?: string; terminalOutcome?: string }[]) {
          if (x.terminalOutcome && x.terminalOutcome !== 'None') this.trackState(x)
          else this.track(x)
        }
        return true
      }
      case 'search_start': { const t = this.track(d); if (t && t.state === 'espera') t.state = 'buscando'; return !!t }
      case 'download_start': {
        const t = this.track(d)
        if (!t) return false
        t.state = 'bajando'; t.percent = 0; t.format = d.extension ?? null; t.fuente = d.username ?? null; t.archivo = d.filename ?? null
        t.bytes = 0; t.total = typeof d.size === 'number' ? d.size : null
        if (typeof d.size === 'number') this.bySize.set(d.size, t)
        return true
      }
      case 'download_progress': {
        const t = typeof d.totalBytes === 'number' ? this.bySize.get(d.totalBytes) : undefined
        if (!t || t.state !== 'bajando' || typeof d.percent !== 'number') return false
        t.percent = Math.max(0, Math.min(100, d.percent))
        if (typeof d.bytesTransferred === 'number') t.bytes = d.bytesTransferred
        if (t.percent > 0) this.anyBytes = true
        return true
      }
      case 'track_state': return this.trackState(d)
      default: return false
    }
  }

  private trackState(d: Record<string, unknown>): boolean {
    const t = this.track(d as { artist?: string; title?: string })
    if (!t) return false
    const outcome = String(d.terminalOutcome ?? 'None'), phase = String(d.activityPhase ?? 'None')
    const kbps = typeof d.bitRate === 'number' && d.bitRate > 0 ? ` ${d.bitRate} kbps` : ''
    if (outcome === 'Succeeded') { t.state = 'bajado'; t.percent = 100; t.path = (d.downloadPath as string) ?? null; t.format = d.extension ? `${d.extension}${kbps}` : t.format; t.detail = null }
    else if (outcome === 'Skipped') {
      const reason = String(d.skipReason ?? '')
      if (/NotFound/i.test(reason)) { t.state = 'noEncontrado'; t.detail = T.vezAnterior }
      else { t.state = 'yaEstaba'; t.path = (d.downloadPath as string) ?? null; t.detail = null }
      t.percent = null
    } else if (outcome === 'Failed') {
      const reason = String(d.failureReason ?? '')
      const known = FAILURES[reason]
      t.state = known?.[0] ?? 'fallo'; t.percent = null
      t.detail = known ? known[1]() : reason && reason !== 'None' ? T.sockseekDice(reason) : T.noSePudo
    } else if (outcome === 'Cancelled') { t.state = 'cancelado'; t.percent = null }
    else if (/download/i.test(phase)) { t.state = 'bajando'; t.percent ??= 0 }
    else if (/search|queue|wait/i.test(phase) && t.state === 'espera') t.state = 'buscando'
    else return false
    return true
  }

  /** Una línea del registro (stderr). Devuelve true si cambió algo que se ve. */
  stderr(line: string): boolean {
    const s = line.trimEnd()
    if (!s.trim()) return false
    this.addLog(s)
    const done = s.match(/\[cli\] Completed: (\d+) succeeded, (\d+) failed/)
    if (done) { this.summary = { ok: Number(done[1]), failed: Number(done[2]) }; return true }
    const p = problemOf(s)
    if (p) { if (!this.problem || p.kind !== 'pausaBusquedas') this.problem = p; return true }
    if (isEstablishError(s)) this.establishErrors++
    if (isPeerError(s)) { this.peerErrors++; return true }
    return false
  }

  private addLog(s: string) { this.log.push(s); if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES) }

  /**
   * El patrón "no se conecta con nadie": muchas conexiones imposibles y ningún tema bajado. Mientras baja hacen falta varias;
   * al terminar (`terminado`), alcanza con unas pocas si todo lo que se encontró falló por no poder conectarse.
   */
  nadieConecta(terminado = false): boolean {
    if (this.anyBytes || this.rows.some((t) => t.state === 'bajado')) return false
    if (!terminado) return this.establishErrors >= NADIE_DURANTE
    return this.establishErrors >= NADIE_AL_FINAL && this.rows.some((t) => t.state === 'fallo')
  }

  /** Al cancelar: lo que no terminó queda "cancelado" (lo bajado a medias queda como .incomplete y se retoma la próxima). */
  cancelPending(salvo?: Set<TrackProgress>) { for (const t of this.rows) if (!salvo?.has(t) && (t.state === 'espera' || t.state === 'buscando' || t.state === 'bajando')) { t.state = 'cancelado'; t.percent = null } }

  get tracks(): TrackProgress[] { return this.rows }

  counts(): Record<TrackState, number> {
    const c = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<TrackState, number>
    for (const t of this.rows) c[t.state]++
    return c
  }
}

/** Qué línea de sockseek es qué problema (los patrones son su salida, en inglés). El texto sale de T con la misma clave. */
const PROBLEMS: [RegExp, ProblemKind & keyof typeof T][] = [
  [/login failed.*missing .*(username|password)/i, 'sinCuenta'],
  [/(invalid ?pass|wrong password|incorrect password|INVALIDPASS)/i, 'claveMal'],
  [/kicked from server/i, 'echado'],
  [/login failed|could not log ?in|failed to log ?in/i, 'login'],
  [/(too many searches|search(es)? (limit|banned)|banned for 30|waiting for search)/i, 'pausaBusquedas'],
]

export function problemOf(line: string): { kind: ProblemKind; text: string } | null {
  for (const [re, kind] of PROBLEMS) if (re.test(line)) return { kind, text: T[kind] }
  return null
}

/** Un corte con otro usuario (no responde, rechaza, se cae): es normal en Soulseek y sockseek prueba con otro. */
export const isPeerError = (line: string) => !/login|server/i.test(line) && /(timed? ?out|connection (refused|reset|failed|closed)|unable to connect|failed to (connect|establish)|remote host|peer|transfer (rejected|failed)|user (is )?offline)/i.test(line)
