// "Buscar géneros": pregunta a Discogs (los estilos de los discos donde está cada tema) y a Last.fm (las etiquetas del
// tema y del artista) por los temas sin género, y guarda las respuestas en `online_cache`. core/genres-find.ts decide
// después, sin internet. Lo de Discogs se comparte con "Buscar nombres oficiales" (misma clave de caché): no se pide dos
// veces. Sin clave de Last.fm anda igual, solo con Discogs. Se puede cancelar y retomar.
import { visible, type Db } from './db'
import { ERR, KeyError, OnlineCache, sinConexion, type CacheArea, type FetchFn } from './online/http'
import { Discogs, type DiscogsKey } from './online/sources'
import { LastFm } from './online/lastfm'
import { mainArtist, recKey, type NameRow } from './official-findings'
import { lastfmArtistKey, lastfmTrackKey } from './genres-find'
import { isJunkGenre } from './genrewords'

export interface GenreKeys { discogs?: DiscogsKey | null; lastfm?: string | null }
export interface GenreSearchOpts { ua: string; keys: () => GenreKeys; fetchFn?: FetchFn; gapMs?: { discogs?: number; lastfm?: number } }
export type GenreLane = 'discogs' | 'lastfm'
export interface GenreSearchProgress { done: number; total: number; current: string; found: number; bySource: Partial<Record<GenreLane, { done: number; total: number; stopped?: string; /** Se cortó porque el servicio no aceptó la clave. */ clave?: boolean }>> }

/** `item`: el tema al que pertenece la búsqueda (para contar temas encontrados, no búsquedas). */
interface Job { area: CacheArea; key: string; label: string; ask: () => Promise<unknown>; item?: string }

export class GenreSearch {
  readonly cache: OnlineCache
  constructor(private db: Db, private opts: GenreSearchOpts) { this.cache = new OnlineCache(db) }

  /** Los temas que hay que buscar: con artista y título, y sin género (o con uno que no dice nada). */
  targets(rows: NameRow[]): NameRow[] {
    const junk = new Set((this.db.prepare(`SELECT id, genre FROM files WHERE ${visible()} AND kind = 'musica'`).all() as { id: number; genre: string | null }[]).filter((f) => isJunkGenre(f.genre)).map((f) => f.id))
    const seen = new Set<string>()
    return rows.filter((r) => {
      if (!junk.has(r.id) || !r.artist?.trim() || !r.title?.trim()) return false
      const k = recKey(r.artist, r.title)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  private jobs(rows: NameRow[]): Record<GenreLane, Job[]> {
    const { ua, fetchFn, gapMs = {} } = this.opts
    const k = this.opts.keys()
    const t = this.targets(rows)
    const out: Record<GenreLane, Job[]> = { discogs: [], lastfm: [] }
    if (k.discogs) {
      const dg = new Discogs(k.discogs, ua, fetchFn, gapMs.discogs)
      out.discogs = t.map((r) => ({ area: 'discogs', key: recKey(r.artist!, r.title!), item: recKey(r.artist!, r.title!), label: `${r.artist} - ${r.title}`, ask: () => dg.recordings(mainArtist(r.artist!), r.title!) }))
    }
    if (k.lastfm) {
      const lf = new LastFm(k.lastfm, ua, fetchFn, gapMs.lastfm)
      const artists = new Map(t.map((r) => [lastfmArtistKey(r.artist!), mainArtist(r.artist!)]))
      out.lastfm = [
        ...t.map((r): Job => ({ area: 'lastfm', key: lastfmTrackKey(r.artist!, r.title!), item: recKey(r.artist!, r.title!), label: `${r.artist} - ${r.title}`, ask: () => lf.trackTags(mainArtist(r.artist!), r.title!) })),
        ...[...artists].map(([key, a]): Job => ({ area: 'lastfm', key, label: a, ask: () => lf.artistTags(a) })),
      ]
    }
    for (const l of ['discogs', 'lastfm'] as const) out[l] = out[l].filter((j) => !this.cache.get(j.area, j.key))
    return out
  }

  /** Qué falta preguntar a cada fuente (para la pantalla, sin internet). */
  todo(rows: NameRow[]): { tracks: number } & Record<GenreLane, number> {
    const j = this.jobs(rows)
    return { tracks: this.targets(rows).length, discogs: j.discogs.length, lastfm: j.lastfm.length }
  }

  /** Pregunta lo que falta; cada fuente aparte, con dos pedidos en camino. Para sola si la clave no anda o falla 5 veces seguidas. */
  async run(rows: NameRow[], onProgress: (p: GenreSearchProgress) => void, isCancelled: () => boolean): Promise<GenreSearchProgress> {
    const lanes = this.jobs(rows)
    const p: GenreSearchProgress = { done: 0, total: 0, current: '', found: 0, bySource: {} }
    // `found` cuenta temas, no búsquedas: un tema con resultados en Discogs y en Last.fm cuenta uno (los artistas no cuentan)
    const foundItems = new Set<string>()
    const report = () => onProgress({ ...p, bySource: { ...p.bySource } })
    for (const l of ['discogs', 'lastfm'] as const) if (lanes[l].length) { p.bySource[l] = { done: 0, total: lanes[l].length }; p.total += lanes[l].length }
    report()
    await Promise.all((['discogs', 'lastfm'] as const).map(async (l) => {
      const jobs = lanes[l], st = p.bySource[l]
      if (!st) return
      let i = 0, fails = 0
      const stop = (msg: string) => { if (st.stopped) return; st.stopped = msg; p.total -= st.total - st.done; report() }
      await Promise.all([0, 1].map(async () => {
        while (i < jobs.length && !st.stopped && !isCancelled()) {
          const j = jobs[i++]
          p.current = j.label
          try {
            const r = await j.ask()
            this.cache.put(j.area, j.key, 'ok', r)
            if (j.item && Array.isArray(r) && r.length && !foundItems.has(j.item)) { foundItems.add(j.item); p.found = foundItems.size }
            fails = 0
          } catch (e) {
            if (e instanceof KeyError) { st.clave = true; stop((e as Error).message); return }
            if (!sinConexion(e)) this.cache.put(j.area, j.key, 'error', { error: (e as Error).message })
            if (++fails >= 5) stop(sinConexion(e) ? ERR.sinInternet : ERR.seCorto((e as Error).message))
          }
          st.done++; p.done++
          report()
        }
      }))
    }))
    p.current = ''
    report()
    return p
  }

  /** Olvida los errores de Discogs y Last.fm de estos temas, para reintentarlos. */
  forgetErrors() { this.db.prepare("DELETE FROM online_cache WHERE status = 'error' AND source IN ('discogs', 'lastfm')").run() }
}
