// Completar tags desde MusicBrainz (y tapas desde Cover Art Archive). Solo se envían artista y título (y la duración) del tema.
// Respeta el límite de MusicBrainz (1 pedido por segundo) y solo completa lo que está vacío: nunca pisa un tag.
import { visible, type Db } from './db'
import { normalize } from './duplicates'
import { ERR, fetchSinBrotli } from './online/http'

export type Confidence = 'alta' | 'media'
export interface MbResult {
  mbid: string; score: number; confidence: Confidence
  artist: string; title: string
  album: string | null; year: string | null; releaseId: string | null; track: string | null
  genre: string | null
  /** El release parece un vivo, una recopilación o similar: no se tilda solo. */
  suspicious: boolean
  /** El año en que salió el tema por primera vez ("first-release-date"): el de una recopilación no sirve (docs/pruebas/mp5-internet-dudoso.md). */
  anioOriginal?: string | null
}
export interface MbProposal extends MbResult { fileId: number; rel: string; /** lo que el tema ya tiene hoy */ current: { artist: string; title: string; album: string | null; year: string | null; genre: string | null }; fills: { field: 'album' | 'year' | 'genre' | 'track'; value: string; /** el año original del tema (de un disco sospechoso) */ original?: true }[] }
export type MbStatus = 'ok' | 'sin_resultado' | 'error'

type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>

const GENERIC_TAGS = new Set(['seen live', 'favorites', 'favourite', 'love', 'argentina', 'argentine', 'spanish', 'latin', 'english', 'male vocalists', 'female vocalists', '90s', '80s', '00s', '2000s', '2010s', '70s', 'chill', 'party', 'dance'])
const LIVEISH = /\b(live|en vivo|vivo|concert|concierto|unplugged|ac[uú]stic[oa]?|session(s)?|bootleg|tribute|tributo|karaoke|remix(es)?|best of|greatest hits|grandes [eé]xitos|hits|recopilaci[oó]n|estadio|club|\d{1,2} de [a-z]+,? \d{4}|\d{2}\/\d{2}\/\d{2,4})\b/i
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())

/** Con qué nombre se preguntó (para saber si después cambió). */
const consulta = (t: { artist: string; title: string }) => `${normalize(t.artist)}|${normalize(t.title)}`

export class MusicBrainz {
  private last = 0
  constructor(private db: Db, private ua: string, private fetchFn: FetchFn = (u, i) => fetchSinBrotli(u, i) as unknown as ReturnType<FetchFn>, private gapMs = 1100) {}

  private async get(url: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }> {
    const wait = this.last + this.gapMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.last = Date.now()
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, { headers: { 'User-Agent': this.ua, Accept: 'application/json' } })
      if (res.status !== 503 || attempt >= 3) return res
      await new Promise((r) => setTimeout(r, this.gapMs === 0 ? 0 : 5000 * (attempt + 1))) // MusicBrainz pide ir más despacio
      this.last = Date.now()
    }
  }

  /** Busca un tema por artista y título. null = no encontró nada convincente. */
  async lookup(artist: string, title: string, durationSec: number | null): Promise<MbResult | null> {
    const esc = (s: string) => s.replace(/["\\]/g, ' ')
    const q = `recording:"${esc(title)}" AND artist:"${esc(artist)}"`
    const res = await this.get(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=8`)
    if (!res.ok) throw new Error(res.status === 503 ? ERR.despacio('MusicBrainz') : ERR.respondio('MusicBrainz', res.status))
    const data = (await res.json()) as { recordings?: MbRecording[] }
    const wantA = normalize(artist), wantT = normalize(title)
    const good = (data.recordings ?? []).filter((r) => {
      const a = (r['artist-credit'] ?? []).map((c) => c.name ?? c.artist?.name ?? '').join(' ')
      const sameT = normalize(r.title) === wantT
      const sameA = normalize(a) === wantA || normalize((r['artist-credit'] ?? [])[0]?.artist?.name ?? '') === wantA || wantA.includes(normalize((r['artist-credit'] ?? [])[0]?.artist?.name ?? '~~'))
      const lenOk = durationSec == null || r.length == null || Math.abs(r.length / 1000 - durationSec) <= 6
      return sameT && sameA && lenOk && (r.score ?? 0) >= 80
    })
    if (!good.length) return null
    const best = good.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
    const rel = pickRelease(best.releases ?? [])
    const year = (rel?.date ?? best['first-release-date'] ?? '').slice(0, 4)
    // el más viejo entre todas las grabaciones que coinciden: cada remasterización es otra grabación con su fecha ("Personal Jesus"
    // salía 2023 con la de la mejor puntuada; medición del 13/11)
    const primero = good.map((r) => (r['first-release-date'] ?? '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)).sort()[0] ?? ''
    const tags = (best.tags ?? []).filter((t) => !GENERIC_TAGS.has(t.name.toLowerCase())).sort((a, b) => b.count - a.count)
    return {
      mbid: best.id, score: best.score ?? 0, confidence: (best.score ?? 0) >= 95 && good.length >= 1 ? 'alta' : 'media',
      artist: (best['artist-credit'] ?? []).map((c) => c.name ?? c.artist?.name).join(''), title: best.title,
      album: rel?.title ?? null, year: /^\d{4}$/.test(year) ? year : null, releaseId: rel?.id ?? null, track: null,
      genre: tags[0] && tags[0].count >= 1 ? titleCase(tags[0].name) : null,
      anioOriginal: /^\d{4}$/.test(primero) ? primero : null,
      suspicious: !rel || LIVEISH.test(rel.title) || (rel['release-group']?.['secondary-types'] ?? []).some((x) => ['Live', 'Compilation', 'Remix', 'DJ-mix', 'Bootleg'].includes(x)),
    }
  }

  /** Tapa frontal de un release (500 px). null si no hay. */
  async cover(releaseId: string): Promise<Uint8Array | null> {
    const res = await this.get(`https://coverartarchive.org/release/${releaseId}/front-500`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(ERR.respondio('Cover Art Archive', res.status))
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length > 1000 ? buf : null
  }

  // ---------- por lotes, con caché ----------

  /** Temas con artista y título pero sin álbum, año o género. */
  candidates(): { id: number; rel: string; artist: string; title: string; duration: number | null; album: string | null; year: string | null; genre: string | null }[] {
    return this.db.prepare(
      `SELECT id, rel_path AS rel, artist, title, duration, album, year, genre FROM files
       WHERE ${visible()} AND error IS NULL AND kind = 'musica' AND artist IS NOT NULL AND artist != '' AND title IS NOT NULL AND title != ''
         AND (album IS NULL OR album = '' OR year IS NULL OR year = '' OR genre IS NULL OR genre = '')`,
    ).all() as unknown as { id: number; rel: string; artist: string; title: string; duration: number | null; album: string | null; year: string | null; genre: string | null }[]
  }

  /**
   * Lo que ya se le preguntó por ese tema. Con `tema` (su artista y título de hoy): si se preguntó con otro nombre (lo cambiaste
   * después, en Arreglar nombres), es como si no se hubiera preguntado, y se vuelve a buscar (la vuelta 1 de
   * docs/diseno/repensar-usabilidad.md: lo que se buscó con un nombre mal escrito quedaba "sin resultado" para siempre). Lo
   * guardado antes de que se anotara el nombre (sin `q`) sigue valiendo.
   */
  cached(fileId: number, tema?: { artist: string; title: string }): { status: MbStatus; result: MbResult | null } | null {
    const r = this.db.prepare('SELECT status, result FROM mb_lookup WHERE file_id = ?').get(fileId) as { status: MbStatus; result: string | null } | undefined
    if (!r) return null
    const data = r.result ? JSON.parse(r.result) as Partial<MbResult> & { q?: string } : null
    if (tema && data?.q && data.q !== consulta(tema)) return null
    return { status: r.status, result: r.status === 'ok' ? data as MbResult : null }
  }

  async run(onProgress: (p: { done: number; total: number; current: string; found: number }) => void, isCancelled: () => boolean, opts: { retryFailed?: boolean } = {}): Promise<{ looked: number; found: number; errors: number }> {
    // un tema sin año cuya respuesta guardada es de un disco sospechoso y no trae el año original (se guardaba desde el 13/11): se
    // vuelve a preguntar una vez, para tener el año en que salió el tema y no el de la recopilación
    const sinOriginal = (c: { year: string | null }, k: { result: MbResult | null }) => !c.year && !!k.result?.suspicious && k.result.anioOriginal === undefined
    const todo = this.candidates().filter((c) => { const k = this.cached(c.id, c); return !k || (opts.retryFailed && k.status === 'error') || sinOriginal(c, k) })
    let done = 0, found = 0, errors = 0, consecutiveErrors = 0
    const put = this.db.prepare('INSERT INTO mb_lookup (file_id, status, result, looked_at) VALUES (?, ?, ?, ?) ON CONFLICT (file_id) DO UPDATE SET status = excluded.status, result = excluded.result, looked_at = excluded.looked_at')
    for (const c of todo) {
      if (isCancelled()) break
      onProgress({ done, total: todo.length, current: `${c.artist} - ${c.title}`, found })
      try {
        const r = await this.lookup(c.artist, c.title, c.duration)
        // con el nombre con que se preguntó (`q`): si después cambia, se vuelve a preguntar (cached)
        put.run(c.id, r ? 'ok' : 'sin_resultado', JSON.stringify({ ...r, q: consulta(c) }), new Date().toISOString())
        if (r) found++
        consecutiveErrors = 0
      } catch (e) {
        errors++; consecutiveErrors++
        put.run(c.id, 'error', JSON.stringify({ error: (e as Error).message, q: consulta(c) }), new Date().toISOString())
        if (consecutiveErrors >= 5) throw new Error(ERR.seCorto((e as Error).message)) // probablemente sin internet o bloqueados
      }
      done++
    }
    onProgress({ done, total: todo.length, current: '', found })
    return { looked: done, found, errors }
  }

  /** Propuestas a partir de la caché: solo completa lo vacío. */
  proposals(): MbProposal[] {
    const out: MbProposal[] = []
    // lo que ya está propuesto (en Cambios pendientes) no se vuelve a ofrecer: después de proponer seguía el mismo "Proponer 2
    // cambios" (el autor, 01/11)
    const yaPropuesto = new Set((this.db.prepare("SELECT file_id AS id, field FROM pending_changes WHERE field IN ('album', 'year', 'genre')").all() as { id: number; field: string }[]).map((r) => `${r.id}:${r.field}`))
    for (const c of this.candidates()) {
      const k = this.cached(c.id, c)
      if (!k || k.status !== 'ok' || !k.result) continue
      const r = k.result
      const fills: MbProposal['fills'] = []
      if (!c.album && r.album && !yaPropuesto.has(`${c.id}:album`)) fills.push({ field: 'album', value: r.album })
      // de un disco sospechoso, el año del disco es el de la recopilación: se ofrece el original, si lo hay
      if (!c.year && !yaPropuesto.has(`${c.id}:year`)) {
        if (r.suspicious && r.anioOriginal) fills.push({ field: 'year', value: r.anioOriginal, original: true })
        else if (r.year) fills.push({ field: 'year', value: r.year })
      }
      if (!c.genre && r.genre && !yaPropuesto.has(`${c.id}:genre`)) fills.push({ field: 'genre', value: r.genre })
      if (fills.length) out.push({ ...r, fileId: c.id, rel: c.rel, current: { artist: c.artist, title: c.title, album: c.album, year: c.year, genre: c.genre }, fills })
    }
    return out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'alta' ? -1 : 1) || a.rel.localeCompare(b.rel))
  }
}

interface MbRelease { id: string; title: string; date?: string; status?: string; 'track-count'?: number; 'release-group'?: { 'primary-type'?: string; 'secondary-types'?: string[] } }
interface MbRecording {
  id: string; title: string; score?: number; length?: number; 'first-release-date'?: string
  'artist-credit'?: { name?: string; artist?: { name?: string } }[]; releases?: MbRelease[]; tags?: { name: string; count: number }[]
}

/** El release más "normal": oficial, álbum o sencillo (no recopilación ni bootleg), el más antiguo. */
/**
 * ¿Todas las letras del título son latinas? ("WHEN WE ALL FALL ASLEEP…" sí, "Björk" sí, la edición japonesa "ホエン・ウィー…" no). Se
 * prefiere la edición en letras latinas, y un dato en otro alfabeto no entra tildado (revision-internet.ts, criterioMb; 13/11).
 */
export const enLetrasLatinas = (s: string | null | undefined) => !s || ![...s].some((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch))

export function pickRelease(rs: MbRelease[]): MbRelease | null {
  if (!rs.length) return null
  const score = (r: MbRelease) => {
    let s = 0
    if (r.status === 'Official') s += 10
    if (r.status === 'Bootleg') s -= 10
    const t = r['release-group']?.['primary-type']
    if (t === 'Album') s += 6; else if (t === 'EP' || t === 'Single') s += 4
    if ((r['release-group']?.['secondary-types'] ?? []).some((x) => ['Compilation', 'Live', 'Remix', 'DJ-mix', 'Soundtrack'].includes(x))) s -= 6
    if (LIVEISH.test(r.title)) s -= 7
    if (enLetrasLatinas(r.title)) s += 8 // antes que la misma edición en otro alfabeto ("bury a friend", Billie Eilish)
    return s
  }
  return [...rs].sort((a, b) => score(b) - score(a) || (a.date ?? '9999').localeCompare(b.date ?? '9999'))[0]
}
