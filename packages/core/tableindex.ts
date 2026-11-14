// Tabla de temas para bibliotecas grandes (desde BIG_LIBRARY temas): los temas viven acá y no en la interfaz, que pide solo
// el orden de los ids y las filas que se ven. Filtra y ordena con las mismas funciones que la interfaz (shared/tableview.ts).
// Corre en un hilo aparte (core/tableworker.ts) para no trabar el proceso principal mientras lee 100.000 filas.
import type { DatabaseSync } from 'node:sqlite'
import { TRACK_FIELDS, type Track } from '@paila/shared/types'
import { libraryStats, queryTracks, sortTracks, type LibraryStats, type TableQuery } from '@paila/shared/tableview'
import { SORT_VALUES } from '@paila/shared/trackinfo'
import { listed } from './db'

// Las mismas filas que Library.tracks(), ya con los nombres de Track (leer objetos así es ~2 veces más rápido que
// leer y convertir).
const SQL = `SELECT f.id AS id, f.root_id AS rootId, f.rel_path AS rel, f.kind AS kind, f.ext AS ext, f.codec AS codec,
  f.sample_rate AS sampleRate, f.bits AS bits, f.channels AS channels, f.kbps AS kbps, f.duration AS duration,
  f.artist AS artist, f.album_artist AS albumArtist, f.title AS title, f.album AS album, f.track AS track, f.year AS year,
  f.genre AS genre, f.size AS size, f.mtime AS mtime, f.error AS error, a.grade AS grade, a.is_label AS isLabel, a.flags AS flags,
  a.eff_kbps AS effKbps, a.cutoff AS cutoff, a.lufs AS lufs, a.bpm AS bpm, a.music_key AS musicKey, a.camelot AS camelot,
  a.energy AS energy, f.missing_at AS missing,
  (SELECT t.lo || ',' || t.hi || ',' || g.bpm FROM dj_tempo t JOIN dj_grid g ON g.file_id = t.file_id AND g.method = t.method WHERE t.file_id = f.id ORDER BY t.method = 'beatthis' DESC LIMIT 1) AS tempo
  FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${listed('f')}`

/** Cuántas filas van junto con el orden: más de las que entran en una pantalla grande. */
const VIEW_ROWS = 120

export interface TableLoad { total: number; stats: LibraryStats }

export class TrackIndex {
  private tracks: Track[] = []
  private byId = new Map<number, Track>()
  private last: { key: string; ids: number[] } | null = null
  /** Todos los temas ya ordenados por cada columna pedida (hasta la próxima carga): filtrar después da el mismo orden. */
  private sorted = new Map<string, Track[]>()

  /** Vuelve a leer todos los temas (cuando algo cambió: escaneo, análisis, tags…). */
  load(db: DatabaseSync): TableLoad {
    this.tracks = db.prepare(SQL).all() as unknown as Track[]
    this.byId = new Map(this.tracks.map((t) => [t.id, t]))
    this.last = null
    this.sorted.clear()
    return { total: this.tracks.length, stats: libraryStats(this.tracks) }
  }

  /**
   * Los ids a la vista, en orden. La misma consulta dos veces seguidas (sin recargar) no se recalcula. Para buscar o cambiar
   * de colección no se vuelve a ordenar: se filtra la lista ya ordenada por esa columna (el orden es estable, así que da
   * exactamente lo mismo que filtrar y después ordenar).
   */
  query(q: TableQuery): number[] {
    const key = JSON.stringify(q)
    if (this.last?.key === key) return this.last.ids
    let list: Track[]
    if (q.plIds && q.sort.key === 'order') list = queryTracks(this.tracks, q)
    else {
      const col = q.sort.key === 'order' ? 'artist' : q.sort.key
      const sk = `${col}:${q.sort.dir}`
      let all = this.sorted.get(sk)
      if (!all) { all = sortTracks([...this.tracks], SORT_VALUES[col], q.sort.dir); this.sorted.set(sk, all) }
      list = queryTracks(all, { ...q, sort: { key: 'order', dir: 1 }, plIds: q.plIds }, false)
    }
    this.last = { key, ids: list.map((t) => t.id) }
    return this.last.ids
  }

  /** Los ids a la vista y las filas de una pantalla y media desde `from` (lo que se está viendo). */
  view(q: TableQuery, from = 0): { ids: number[]; rows: unknown[][] } {
    const ids = this.query(q)
    const start = Math.max(0, Math.min(from, ids.length - 1) - 20)
    return { ids, rows: this.rows(ids.slice(start, start + VIEW_ROWS)) }
  }

  /** Las filas de estos temas, como arreglos en el orden de TRACK_FIELDS (las que no existen se saltean). */
  rows(ids: number[]): unknown[][] {
    const out: unknown[][] = []
    for (const id of ids) {
      const t = this.byId.get(id)
      if (t) out.push(TRACK_FIELDS.map((f) => t[f]))
    }
    return out
  }
}
