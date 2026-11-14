// "Buscar nombres oficiales": pregunta a cada fuente de internet por los artistas y temas de la Música y guarda las
// respuestas en `online_cache` (core/official-findings.ts decide después, sin internet). Las fuentes trabajan a la vez,
// cada una con su ritmo; lo ya preguntado no se vuelve a pedir, así que se puede cancelar y retomar.
// Qué se busca: los nombres como quedan después de "Arreglar nombres y tags" (sin basura, feat. parejo, diccionario).
// AcoustID se pregunta por todos los temas con huella acústica: los sin nombre se reconocen, y los que tienen nombre quedan
// "identificados con seguridad" (de ahí aprende core/junkwords.ts las palabras que sobran). Lo que AcoustID reconoce con el
// mismo artista, título y duración ya trae la grabación de MusicBrainz: ese tema no se le vuelve a preguntar (`coverByPrint`).
import type { Db } from './db'
import { visible } from './db'
import { setReason } from './sets'
import { rulesOf, type TidyRule } from '@paila/shared/tidy-profiles'
import { tidy } from './tidy'
import { ERR, KeyError, OnlineCache, sinConexion, type FetchFn, type Source } from './online/http'
import { AcoustId, Deezer, Discogs, MusicBrainzNames, type DiscogsKey } from './online/sources'
import { artistKey, auddKey, mainArtist, officialFindings, printKey, recKey, type NameRow } from './official-findings'
import { decideByPrint, relate, titleMatch } from './official'
import type { ArtistHit, RecHit } from './online/hits'
import type { AcoustHit } from './online/sources'
import { AudD } from './online/audd'
import { textos } from '@paila/shared/idioma'

// lo que se ve mientras se busca (el tema de ahora) y por qué se cortó una fuente
const T = textos({
  porSonido: { es: (a: string, t: string) => `${a} - ${t} (por el sonido)`, en: (a: string, t: string) => `${a} - ${t} (by its sound)` },
  sinNombre: { es: (id: number) => `tema sin nombre (${id})`, en: (id: number) => `track with no name (${id})` },
  escuchando: { es: (id: number) => `escuchando un tema sin nombre (${id})`, en: (id: number) => `listening to a track with no name (${id})` },
  seCorto: { es: (msg: string) => `Se cortó: ${msg}`, en: (msg: string) => `Stopped: ${msg}` },
})

/** Las claves que hay (las del usuario o las que vienen con PAILA). */
export interface OnlineKeys { discogs?: DiscogsKey | null; acoustid?: string | null; /** solo si el usuario prendió AudD */ audd?: string | null; /** solo para géneros (core/genres-run.ts) */ lastfm?: string | null }
export interface SearchOpts {
  ua: string; keys: () => OnlineKeys; useDeezer?: () => boolean; fetchFn?: FetchFn; gapMs?: Partial<Record<Source, number>>
  /** Los 15 s de audio de un tema, para AudD (core/online/audd.ts, audioClip). */
  clip?: (id: number, duration: number | null) => Promise<Uint8Array | null>
}
/** `found`: temas distintos con algo encontrado en alguna fuente (no búsquedas: un tema se busca en varias). */
export interface SearchProgress { done: number; total: number; current: string; found: number; bySource: Partial<Record<Source, { done: number; total: number; stopped?: string; /** Se cortó porque el servicio no aceptó la clave. */ clave?: boolean }>> }

/** Los temas de la Música con artista y título como los deja el asistente con estas reglas (sin "oficial", que es lo que se busca). */
export function cleanedRows(db: Db, rules: Iterable<TidyRule> = rulesOf('oficial')): NameRow[] {
  const base = [...rules].filter((r) => r !== 'oficial')
  const rows = db.prepare(
    // la huella acústica (2–3 KB) solo de los temas sin artista o sin título: son los únicos que se reconocen por el sonido
    `SELECT f.id, f.rel_path AS rel, f.duration, f.artist, f.title,
       CASE WHEN coalesce(trim(f.artist), '') = '' OR coalesce(trim(f.title), '') = '' THEN a.chromaprint END AS chromaprint, a.chromaprint IS NOT NULL AS hasPrint
     FROM files f LEFT JOIN analysis a ON a.file_id = f.id
     WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' ORDER BY f.rel_path`,
  ).all() as unknown as (NameRow & { rel: string })[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const c of tidy(db, ['mojibake', 'filename', 'junk', 'style'], undefined, base).changes) {
    const r = byId.get(c.id)
    if (r && (c.field === 'artist' || c.field === 'title')) r[c.field] = c.to
  }
  return rows.filter((r) => !setReason(r.rel, r.duration, r)).map(({ id, rel, artist, title, duration, chromaprint, hasPrint }) => ({ id, artist, title, duration, chromaprint, hasPrint: !!hasPrint, file: rel.split('/').pop() }))
}

export class OfficialSearch {
  readonly cache: OnlineCache
  constructor(private db: Db, private opts: SearchOpts) { this.cache = new OnlineCache(db) }

  /** Qué falta preguntar a cada fuente (para la pantalla, sin internet). */
  todo(rows: NameRow[]): Record<Source, number> & { tracks: number; artists: number; unnamed: number } {
    const k0 = this.opts.keys()
    const w = this.work(rows)
    const left = (s: Source, keys: string[]) => keys.filter((k) => !this.cache.get(s, k)).length
    const recs = w.tracks.map((t) => recKey(t.artist!, t.title!))
    const k = this.opts.keys()
    return {
      tracks: w.tracks.length, artists: w.artists.length, unnamed: w.prints.length,
      musicbrainz: left('musicbrainz', w.artists.map(artistKey)) + left('musicbrainz', recs),
      deezer: this.opts.useDeezer?.() === false ? 0 : left('deezer', recs),
      discogs: k.discogs ? left('discogs', recs) : 0,
      acoustid: k.acoustid ? left('acoustid', [...w.prints.map((p) => printKey(p.chromaprint!)), ...this.namedPrints(w.prints).map((p) => p.key)]) : 0,
      audd: k0.audd ? left('audd', w.unnamed.filter((r) => this.unknown(r)).map(auddKey)) : 0,
    }
  }

  private work(rows: NameRow[]) {
    this.rowsMemo = rows
    const named = rows.filter((r) => r.artist?.trim() && r.title?.trim())
    const seen = new Set<string>()
    const tracks = named.filter((r) => { const k = recKey(r.artist!, r.title!); if (seen.has(k)) return false; seen.add(k); return true })
    const artists = [...new Map(named.map((r) => [artistKey(mainArtist(r.artist!)), mainArtist(r.artist!)])).values()]
    const pk = new Set<string>()
    const prints = rows.filter((r) => (!r.artist?.trim() || !r.title?.trim()) && r.chromaprint && r.duration && !pk.has(r.chromaprint) && pk.add(r.chromaprint))
    const unnamed = rows.filter((r) => (!r.artist?.trim() || !r.title?.trim()) && r.duration)
    return { tracks, artists, prints, unnamed }
  }

  /**
   * Los temas con nombre que tienen huella acústica (sin repetir huellas): la huella se lee de a una, así con 100.000 temas
   * no se cargan todas en memoria. `skip`: las de los temas sin nombre, que ya se preguntan.
   */
  private namedPrints(skip: NameRow[]): { key: string; id: number; label: string; duration: number; rec: string }[] {
    const seen = new Set(skip.map((r) => printKey(r.chromaprint!)))
    const q = this.db.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?')
    const out: { key: string; id: number; label: string; duration: number; rec: string }[] = []
    for (const r of this.rowsMemo ?? []) {
      if (!r.hasPrint || !r.duration || !r.artist?.trim() || !r.title?.trim()) continue
      const cp = (q.get(r.id) as { chromaprint: string | null } | undefined)?.chromaprint
      if (!cp) continue
      const key = printKey(cp)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, id: r.id, label: T.porSonido(r.artist!, r.title!), duration: r.duration, rec: recKey(r.artist!, r.title!) })
    }
    return out
  }
  private rowsMemo: NameRow[] | null = null

  /**
   * Los temas que AcoustID ya reconoció por el sonido con el mismo artista, título y duración: las grabaciones que trae
   * AcoustID son las de MusicBrainz, así que se guardan como su respuesta y a MusicBrainz no se le pregunta ese tema. Es
   * el servicio más lento (un pedido por segundo y, cuando está cargado, mucho menos): en la prueba con personas del 28/10
   * se llevó 30 de los 37 minutos con 300 temas. Con la base de esa prueba: 164 de 271 temas sin preguntar, y las mismas
   * propuestas salvo 7 (4 nuevas y 3 porque MusicBrainz escribe el mismo tema de dos maneras en discos distintos).
   */
  private coverByPrint(tracks: NameRow[]): void {
    const want = new Set(tracks.map((t) => recKey(t.artist!, t.title!)).filter((k) => !this.cache.get('musicbrainz', k)))
    if (!want.size) return
    const q = this.db.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?')
    for (const r of this.rowsMemo ?? []) {
      if (!r.hasPrint || !r.duration || !r.artist?.trim() || !r.title?.trim()) continue
      const key = recKey(r.artist, r.title)
      if (!want.has(key)) continue
      const cp = (q.get(r.id) as { chromaprint: string | null } | undefined)?.chromaprint
      const c = cp ? this.cache.get<AcoustHit[]>('acoustid', printKey(cp)) : null
      if (c?.status !== 'ok' || !c.data) continue
      const lead = mainArtist(r.artist)
      const same = c.data.filter((h) => h.score >= 0.9).flatMap((h) => h.recordings).filter((x) => titleMatch(r.title!, x.title) === 'same'
        && x.length != null && Math.abs(x.length - r.duration!) <= 7 && x.credit.some((p) => relate(lead, p.name) === 'same'))
      if (!same.length) continue
      this.cache.put('musicbrainz', key, 'ok', same.map((x): RecHit => ({ ...x, source: 'musicbrainz' })))
      want.delete(key)
    }
  }

  /** ¿Nada identificó este tema sin nombre? (AcoustID no lo reconoció o no se pudo preguntar). Solo esos van a AudD. */
  private unknown(r: NameRow): boolean {
    if (!r.chromaprint) return true
    const c = this.cache.get<AcoustHit[]>('acoustid', printKey(r.chromaprint))
    return !(c?.status === 'ok' && c.data && decideByPrint(r, c.data).length)
  }

  /**
   * Pregunta lo que falta. Cada fuente trabaja aparte, con hasta 2 pedidos en camino (el ritmo de salida lo cuida `Polite`).
   * Una fuente para sola si la clave no anda o si falla 5 veces seguidas (sin internet).
   */
  async run(rows: NameRow[], onProgress: (p: SearchProgress) => void, isCancelled: () => boolean): Promise<SearchProgress> {
    const { ua, fetchFn, gapMs = {} } = this.opts
    const keys = this.opts.keys()
    const w = this.work(rows)
    const p: SearchProgress = { done: 0, total: 0, current: '', found: 0, bySource: {} }
    const report = () => onProgress({ ...p, bySource: { ...p.bySource } })
    // `item`: el tema que se busca (los artistas no cuentan como encontrados); un tema encontrado en tres fuentes cuenta uno
    type Job = { key: string; label: string; ask: () => Promise<unknown>; item?: string }
    const foundItems = new Set<string>()
    // cada fuente, en etapas: los temas de MusicBrainz se buscan entre los artistas ya encontrados (necesitan sus ids)
    // `waits`: antes de esa etapa espera a que termine otra fuente (los temas de MusicBrainz, a AcoustID: lo que reconoce no se pregunta)
    const lanes: { source: Source; stages: (() => Job[])[]; after?: Source; waits?: { stage: number; source: Source } }[] = []
    const recJobs = (ask: (t: NameRow) => Promise<unknown>) => () => w.tracks.map((t) => { const key = recKey(t.artist!, t.title!); return { key, item: key, label: `${t.artist} - ${t.title}`, ask: () => ask(t) } })
    const mb = new MusicBrainzNames(ua, fetchFn, gapMs.musicbrainz)
    lanes.push({ source: 'musicbrainz', stages: [
      () => w.artists.map((a) => ({ key: artistKey(a), label: a, ask: () => mb.artists(a) })),
      recJobs((t) => mb.recordings(mainArtist(t.artist!), t.title!, this.arids(mainArtist(t.artist!)))),
    ], waits: { stage: 1, source: 'acoustid' } })
    if (this.opts.useDeezer?.() !== false) { const dz = new Deezer(fetchFn, gapMs.deezer); lanes.push({ source: 'deezer', stages: [recJobs((t) => dz.recordings(mainArtist(t.artist!), t.title!))] }) }
    if (keys.discogs) { const dg = new Discogs(keys.discogs, ua, fetchFn, gapMs.discogs); lanes.push({ source: 'discogs', stages: [recJobs((t) => dg.recordings(mainArtist(t.artist!), t.title!))] }) }
    if (keys.acoustid) {
      const ac = new AcoustId(keys.acoustid, ua, fetchFn, gapMs.acoustid)
      const printOf = (id: number) => (this.db.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?').get(id) as { chromaprint: string }).chromaprint
      lanes.push({ source: 'acoustid', stages: [
        () => w.prints.map((r) => ({ key: printKey(r.chromaprint!), item: `#${r.id}`, label: T.sinNombre(r.id), ask: () => ac.lookup(r.chromaprint!, r.duration!) })),
        // después, los que tienen nombre: no cambian el nombre, enseñan qué palabras sobran
        () => this.namedPrints(w.prints).map((p) => ({ key: p.key, item: p.rec, label: p.label, ask: () => ac.lookup(printOf(p.id), p.duration) })),
      ] })
    }
    if (keys.audd && this.opts.clip) {
      const au = new AudD(keys.audd, ua, fetchFn, gapMs.audd)
      const clip = this.opts.clip
      // después de AcoustID: solo lo que AcoustID no reconoció
      lanes.push({ source: 'audd', after: 'acoustid', stages: [() => w.unnamed.filter((r) => this.unknown(r)).map((r) => ({ key: auddKey(r), item: `#${r.id}`, label: T.escuchando(r.id), ask: async () => { const c = await clip(r.id, r.duration); return c ? au.recognize(c) : null } }))] })
    }
    const pending = (source: Source, jobs: Job[]) => jobs.filter((j) => !this.cache.get(source, j.key))
    const counted = new Map<string, number>() // cuántos se contaron al empezar en cada etapa (para descontar lo que ya no hace falta)
    for (const l of lanes) {
      const n = l.stages.reduce((s, st, i) => { const k = pending(l.source, st()).length; counted.set(`${l.source}:${i}`, k); return s + k }, 0)
      p.bySource[l.source] = { done: 0, total: n }; p.total += n
    }
    report()
    const running = new Map<Source, Promise<void>>()
    for (const l of lanes) running.set(l.source, (async () => {
      if (l.after) await running.get(l.after)
      const st = p.bySource[l.source]!
      let fails = 0
      const stop = (msg: string) => { if (st.stopped) return; st.stopped = msg; p.total -= st.total - st.done; report() }
      for (const [si, stage] of l.stages.entries()) {
        if (l.waits?.stage === si) {
          await running.get(l.waits.source)
          if (isCancelled()) return
          this.coverByPrint(w.tracks)
        }
        const jobs = pending(l.source, stage())
        if (l.waits?.stage === si) { const less = counted.get(`${l.source}:${si}`)! - jobs.length; st.total -= less; p.total -= less; report() }
        // AudD se cuenta de nuevo después de AcoustID (lo que ya se reconoció no se manda)
        if (l.after && l.stages.length === 1) { p.total += jobs.length - (st.total - st.done); st.total = st.done + jobs.length }
        let i = 0
        await Promise.all([0, 1].map(async () => {
          while (i < jobs.length && !st.stopped && !isCancelled()) {
            const j = jobs[i++]
            p.current = j.label
            try {
              const r = await j.ask()
              this.cache.put(l.source, j.key, 'ok', r)
              if (j.item && (Array.isArray(r) ? r.length : r != null) && !foundItems.has(j.item)) { foundItems.add(j.item); p.found = foundItems.size }
              fails = 0
            } catch (e) {
              if (e instanceof KeyError) { st.clave = true; stop((e as Error).message); return }
              if (!sinConexion(e)) this.cache.put(l.source, j.key, 'error', { error: (e as Error).message })
              if (++fails >= 5) stop(sinConexion(e) ? ERR.sinInternet : T.seCorto((e as Error).message))
            }
            st.done++; p.done++
            report()
          }
        }))
        if (st.stopped || isCancelled()) return
      }
    })())
    await Promise.all(running.values())
    p.current = ''
    report()
    return p
  }

  /** Los artistas de MusicBrainz que pueden ser este nombre (por nombre, alias o parecido), para buscar sus temas. */
  private arids(name: string): string[] {
    const hits = this.cache.lista<ArtistHit>('musicbrainz', artistKey(name))
    return hits.filter((h) => h.score >= 80 && relate(name, h.name, h.aliases)).slice(0, 3).map((h) => h.id)
  }
}

/**
 * El nombre oficial de cada tema según lo ya buscado en internet (solo la caché y solo lo de confianza alta). Lo usa la
 * Faltan o suenan mal: así "Bien Alto - La Renga" (título "Título - Artista") no sale al revés en el .csv. Se vuelve a
 * calcular solo si cambió la biblioteca, sus tags o la caché. Eso se mira como mucho una vez por segundo: la Lista lo pide
 * tema por tema, y cada mirada recorre toda la biblioteca (74 ms con 100.000 temas: con 40.000 temas para conseguir, la app
 * quedaba trabada casi una hora; prueba de usabilidad con 100.000 temas, 27/10/2026).
 */
export function officialNames(db: Db, cadaMs = 1000): (fileId: number) => { artist: string; title: string } | null {
  let stamp = ''
  let names = new Map<number, { artist: string; title: string }>()
  let vacia = true
  let mirado = -Infinity
  const state = db.prepare('SELECT (SELECT COUNT(*) FROM files) AS n, (SELECT MAX(probed_at) FROM files) AS p, (SELECT MAX(id) FROM journal) AS j, (SELECT COUNT(*) FROM online_cache) AS c, (SELECT MAX(looked_at) FROM online_cache) AS l')
  return (fileId) => {
    const ahora = Date.now()
    if (ahora - mirado < cadaMs) return vacia ? null : names.get(fileId) ?? null
    mirado = ahora
    const st = state.get() as { c: number }
    vacia = !st.c
    if (vacia) return null // nunca se buscó nada en internet
    const now = JSON.stringify(st)
    if (now !== stamp) {
      stamp = now
      names = new Map()
      const rows = cleanedRows(db)
      const found = officialFindings(db, rows)
      for (const r of rows) {
        const sure = (found.get(r.id) ?? []).filter((f) => f.conf === 'alta')
        if (!sure.length) continue
        const artist = sure.find((f) => f.field === 'artist')?.to ?? r.artist, title = sure.find((f) => f.field === 'title')?.to ?? r.title
        if (artist?.trim() && title?.trim()) names.set(r.id, { artist, title })
      }
    }
    return names.get(fileId) ?? null
  }
}
