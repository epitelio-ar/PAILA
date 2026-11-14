// Pedidos a los servicios de música de internet con buenos modales: un ritmo tranquilo por servicio (cada uno tiene su
// límite), reintentos cuando el servicio pide ir más despacio (429/503) y la caché `online_cache` para no repetir pedidos.
import type { Db } from '../db'
import { textos } from '@paila/shared/idioma'

export interface HttpRes { ok: boolean; status: number; json(): Promise<unknown>; headers?: { get(name: string): string | null } }
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData }) => Promise<HttpRes>
/**
 * `fetch` sin Brotli: el Node que trae Electron 43 (24.22.0, con Brotli 1.2.0) tiene la falla CVE-2026-111497 en el
 * decodificador de Brotli (arreglada en Node 24.22.1). Hasta que Electron traiga ese Node, se pide solo gzip/deflate y una
 * respuesta que igual llegue en Brotli se rechaza antes de leerla.
 */
export async function fetchSinBrotli(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('accept-encoding', 'gzip, deflate')
  const r = await fetch(url, { ...init, headers })
  if (/\bbr\b/i.test(r.headers.get('content-encoding') ?? '')) {
    try { await r.body?.cancel() } catch { /* ya cerrado */ }
    throw new Error(`${new URL(String(url)).host}: respuesta en Brotli rechazada`)
  }
  return r
}
export const realFetch: FetchFn = (u, i) => fetchSinBrotli(u, i) as unknown as Promise<HttpRes>

export type Source = 'musicbrainz' | 'deezer' | 'discogs' | 'acoustid' | 'audd'
export const SOURCE_LABEL: Record<Source, string> = { musicbrainz: 'MusicBrainz', deezer: 'Deezer', discogs: 'Discogs', acoustid: 'AcoustID', audd: 'AudD' }
/** Lo que se guarda en la misma caché para la pantalla Discos (listas de temas y tapas) y las etiquetas de Last.fm (géneros): no cuenta como nombres oficiales. */
export type CacheArea = Source | 'discos' | 'tapas' | 'lastfm'

/** Error de clave (401/403 o "invalid API key"): no tiene sentido seguir pidiendo. */
export class KeyError extends Error {}

/**
 * ¿El pedido ni salió (sin wifi, el servidor no se encuentra o cortó)? Eso no dice nada del tema: no se anota en la caché como
 * "ya preguntado" y la próxima búsqueda lo vuelve a pedir sola (prueba de usabilidad del 27/10: se cortaba internet en el medio
 * y esos temas quedaban sin buscar para siempre, salvo con "Reintentar").
 */
export function sinConexion(e: unknown): boolean {
  const err = e as { message?: string; code?: string; cause?: { code?: string; message?: string } } | null
  const t = `${err?.code ?? ''} ${err?.cause?.code ?? ''} ${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_|network|socket hang up/i.test(t)
}

/** Los errores de los servicios que se ven en la pantalla (por qué se cortó una fuente), en castellano y en inglés. */
export const ERR = textos({
  respondio: { es: (name: string, status: number) => `${name} respondió ${status}`, en: (name: string, status: number) => `${name} answered ${status}` },
  /** Sin el nombre adelante ("AcoustID: respondió 500"). */
  soloRespondio: { es: (status: number) => `respondió ${status}`, en: (status: number) => `answered ${status}` },
  despacio: { es: (name: string) => `${name} pide ir más despacio: reintentá en un rato`, en: (name: string) => `${name} is asking to slow down: try again in a while` },
  clave: { es: (name: string) => `${name} no aceptó la clave`, en: (name: string) => `${name} did not accept the key` },
  claveRespondio: { es: (name: string, status: number) => `${name} no aceptó la clave (respondió ${status})`, en: (name: string, status: number) => `${name} did not accept the key (it answered ${status})` },
  claveApp: { es: (name: string) => `${name} no aceptó la clave de aplicación`, en: (name: string) => `${name} did not accept the application key` },
  seCorto: { es: (msg: string) => `Se cortó: ${msg}`, en: (msg: string) => `Stopped: ${msg}` },
  sinInternet: { es: 'Se cortó internet: lo que falta se busca solo la próxima vez', en: 'The internet connection dropped: what is left is looked up again next time' },
})

/**
 * Un servicio con su ritmo: `gapMs` entre pedidos (MusicBrainz 1 por segundo; Deezer, Discogs con clave y AcoustID, más
 * rápido pero sin apurarse). Si responde 429 o 503 espera y reintenta (hasta 3 veces).
 */
export class Polite {
  /** Cuándo puede salir el próximo pedido (se reserva el turno antes de esperar). */
  private next = 0
  constructor(readonly name: string, private gapMs: number, private fetchFn: FetchFn = realFetch, private ua = 'PAILA') {}

  /** Espera su turno: los pedidos salen separados por `gapMs` (aunque la respuesta anterior todavía no haya llegado). */
  private async turn(extra = 0) {
    const at = Math.max(Date.now(), this.next) + extra
    this.next = at + this.gapMs
    const wait = at - Date.now()
    if (wait > 0) await sleep(wait)
  }

  /** Pide respetando el ritmo del servicio; si pide ir más despacio (429/503), espera y reintenta. */
  async get(url: string, headers: Record<string, string> = {}, init: { method?: string; body?: string | FormData } = {}): Promise<HttpRes> {
    for (let attempt = 0; ; attempt++) {
      await this.turn(attempt && this.gapMs ? 4000 * attempt : 0)
      const res = await this.fetchFn(url, { ...init, headers: { 'User-Agent': this.ua, Accept: 'application/json', ...headers } })
      if ((res.status !== 429 && res.status !== 503) || attempt >= 3) return res
    }
  }

  /** Pide y devuelve el JSON; los errores salen en el idioma de la persona. */
  async json<T>(url: string, headers?: Record<string, string>, init?: { method?: string; body?: string }): Promise<T> {
    const res = await this.get(url, headers, init)
    if (res.status === 401 || res.status === 403) throw new KeyError(ERR.claveRespondio(this.name, res.status))
    if (!res.ok) throw new Error(res.status === 429 || res.status === 503 ? ERR.despacio(this.name) : ERR.respondio(this.name, res.status))
    return (await res.json()) as T
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type CacheStatus = 'ok' | 'error'
/** La caché de lo que respondió cada fuente: clave = fuente + búsqueda (ya normalizada). */
export class OnlineCache {
  constructor(private db: Db) {}
  /** Las claves guardadas de las fuentes pedidas con `known` (para no preguntar a la base por las que no están). */
  private only = new Map<CacheArea, Set<string>>()
  /**
   * Las búsquedas guardadas de una fuente (solo las claves). Desde ahí, `get` de esa fuente contesta "no hay" sin ir a la
   * base cuando la clave no está: para recorridos de solo lectura sobre toda la biblioteca (con 100.000 temas eran cientos
   * de miles de consultas que casi nunca encontraban nada).
   */
  known(source: CacheArea): Set<string> {
    let s = this.only.get(source)
    if (!s) { s = new Set((this.db.prepare('SELECT query FROM online_cache WHERE source = ?').all(source) as { query: string }[]).map((r) => r.query)); this.only.set(source, s) }
    return s
  }
  get<T>(source: CacheArea, query: string): { status: CacheStatus; data: T | null } | null {
    if (this.only.get(source)?.has(query) === false) return null
    const r = this.db.prepare('SELECT status, data FROM online_cache WHERE source = ? AND query = ?').get(source, query) as { status: CacheStatus; data: string | null } | undefined
    return r ? { status: r.status, data: r.data ? JSON.parse(r.data) as T : null } : null
  }
  /** La lista guardada, solo si la búsqueda salió bien: una con error (un 503 de MusicBrainz) guarda {error}, no una lista (punto 1 real, 24/10). */
  lista<T>(source: CacheArea, query: string): T[] {
    const r = this.get<T[]>(source, query)
    return r?.status === 'ok' && Array.isArray(r.data) ? r.data : []
  }
  put(source: CacheArea, query: string, status: CacheStatus, data: unknown) {
    this.db.prepare(
      'INSERT INTO online_cache (source, query, status, data, looked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (source, query) DO UPDATE SET status = excluded.status, data = excluded.data, looked_at = excluded.looked_at',
    ).run(source, query, status, data == null ? null : JSON.stringify(data), new Date().toISOString())
    this.only.get(source)?.add(query)
  }
  /** Cuántas búsquedas hay guardadas por fuente (para la pantalla). */
  counts(): Partial<Record<Source, { ok: number; error: number }>> {
    const out: Partial<Record<Source, { ok: number; error: number }>> = {}
    for (const r of this.db.prepare("SELECT source, status, COUNT(*) AS n FROM online_cache WHERE source NOT IN ('discos', 'tapas', 'lastfm') GROUP BY source, status").all() as { source: Source; status: CacheStatus; n: number }[]) {
      const e = out[r.source] ?? (out[r.source] = { ok: 0, error: 0 })
      e[r.status] = r.n
    }
    return out
  }
  /** Olvida los errores (para reintentarlos). */
  forgetErrors() { this.db.prepare("DELETE FROM online_cache WHERE status = 'error' AND source NOT IN ('discos', 'tapas', 'lastfm')").run() }
}
