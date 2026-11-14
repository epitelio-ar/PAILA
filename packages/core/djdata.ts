// Datos de cabina de cada tema (Fase F): grilla, cue points, estrellas, color y "my tags". Se traen sin tocar nada del
// rekordbox.xml que exporta Rekordbox y de los marcadores de Serato de los archivos; PAILA suma su grilla y sus cues
// sugeridos. Lo de Rekordbox y Serato se guarda tal cual vino (en el tiempo de Rekordbox: vuelve idéntico aunque cambie la
// regla del desfase); lo de PAILA, en el tiempo de PAILA (como decodifica ffmpeg), y se corre al exportar (`rbShift`).
import fs from 'node:fs'
import path from 'node:path'
import { transaction, visible, type Db } from './db'
import { parseRbXml, type RbTrack } from './rbxml'
import { readSerato } from './serato'
import { rekordboxMp3Shift } from './analysis/mp3info'
import { tempoRange, type Grid, type GridSegment } from './analysis/grid'
import { CUE_NAMES, type CueSuggestion } from './analysis/cues'
import type { DjCue, DjImportResult, GridMethod } from '@paila/shared/types'

/** De qué grilla fiarse primero al exportar: la que ya tenía Rekordbox (quizás corregida a mano), después Beat This!, después degara. */
export const GRID_PRIORITY: GridMethod[] = ['rekordbox', 'serato', 'beatthis', 'degara']
/** Los TrackID que inventa PAILA arrancan acá (los de Rekordbox son números al azar más chicos). */
const PAILA_ID_BASE = 1_900_000_000

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
/** Entre qué BPM se mueve una grilla de varios tramos (null si todos los tramos van al mismo BPM). */
const rangeOf = (segs: GridSegment[]) => { const r = tempoRange(segs); return r && r.hi > r.lo ? r : null }

/** `rbTime`: la grilla está en el tiempo de Rekordbox (vino de Rekordbox o Serato); si no, en el de PAILA. */
export interface StoredGrid { rbTime: boolean; method: GridMethod; bpm: number; segments: GridSegment[]; errorMs: number | null; variable: boolean; barEnergy: number[] }

export class DjData {
  private shiftCache = new Map<number, number>()

  constructor(private db: Db, private pathOf: (id: number) => string | null) {}

  /**
   * Cuántos segundos hay que sumarle a un momento de PAILA para que sea el mismo en Rekordbox (y en Serato): el "desfase
   * de 0,025 s" de los MP3 que codificó ffmpeg (ver rekordboxMp3Shift en core/analysis/mp3info.ts).
   */
  rbShift(fileId: number): number {
    const hit = this.shiftCache.get(fileId)
    if (hit != null) return hit
    const f = this.db.prepare('SELECT ext, sample_rate AS sr FROM files WHERE id = ?').get(fileId) as { ext: string; sr: number | null } | undefined
    const p = f && f.ext.toLowerCase() === 'mp3' ? this.pathOf(fileId) : null
    const s = p ? rekordboxMp3Shift(p) / (f!.sr || 44100) : 0
    this.shiftCache.set(fileId, s)
    return s
  }

  // ---- grilla ----

  saveGrid(fileId: number, method: GridMethod, g: { grid: Grid | null; barEnergy: number[] }, size: number | null) {
    if (!g.grid) { this.db.prepare('DELETE FROM dj_grid WHERE file_id = ? AND method = ?').run(fileId, method); this.saveTempo(fileId, method, null); return }
    this.db.prepare(`INSERT INTO dj_grid (file_id, method, bpm, segments, error_ms, variable, bar_energy, src_size, made_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (file_id, method) DO UPDATE SET bpm = excluded.bpm, segments = excluded.segments, error_ms = excluded.error_ms, variable = excluded.variable,
      bar_energy = COALESCE(excluded.bar_energy, dj_grid.bar_energy), src_size = excluded.src_size, made_at = excluded.made_at`)
      .run(fileId, method, g.grid.bpm, JSON.stringify(g.grid.segments), g.grid.errorMs, g.grid.variable ? 1 : 0, g.barEnergy.length ? JSON.stringify(g.barEnergy) : null, size, new Date().toISOString())
    this.saveTempo(fileId, method, g.grid.variable ? rangeOf(g.grid.segments) : null)
  }

  /** Entre qué BPM se mueve el tema según una grilla (`dj_tempo`: el rango que muestra la tabla); null = parejo. */
  private saveTempo(fileId: number, method: GridMethod, r: { lo: number; hi: number } | null) {
    if (!r) { this.db.prepare('DELETE FROM dj_tempo WHERE file_id = ? AND method = ?').run(fileId, method); return }
    this.db.prepare('INSERT INTO dj_tempo (file_id, method, lo, hi) VALUES (?, ?, ?, ?) ON CONFLICT (file_id, method) DO UPDATE SET lo = excluded.lo, hi = excluded.hi').run(fileId, method, r.lo, r.hi)
  }

  /** Las grillas de un tema, de la más confiable a la menos. */
  grids(fileId: number): StoredGrid[] {
    const rows = this.db.prepare('SELECT method, bpm, segments, error_ms AS errorMs, variable, bar_energy AS barEnergy FROM dj_grid WHERE file_id = ?').all(fileId) as
      { method: GridMethod; bpm: number; segments: string; errorMs: number | null; variable: number; barEnergy: string | null }[]
    return rows.map((r) => ({ rbTime: r.method === 'rekordbox' || r.method === 'serato', method: r.method, bpm: r.bpm, segments: JSON.parse(r.segments), errorMs: r.errorMs, variable: !!r.variable, barEnergy: r.barEnergy ? JSON.parse(r.barEnergy) : [] }))
      .sort((a, b) => GRID_PRIORITY.indexOf(a.method) - GRID_PRIORITY.indexOf(b.method))
  }

/**
   * La grilla que va al rekordbox.xml: la de Rekordbox o Serato si la trajiste, si no la de PAILA. Con `pailaWhenMoving`
   * (lo pide cada uno: "rehacer"), en los temas donde PAILA encontró que el tempo se mueve y la de Rekordbox o Serato es
   * fija (un solo BPM), va la variable de PAILA: una grilla fija se corre en un tema tocado sin metrónomo.
   */
  grid(fileId: number, pailaWhenMoving = false): StoredGrid | null {
    const gs = this.grids(fileId)
    if (pailaWhenMoving && gs[0]?.rbTime && new Set(gs[0].segments.map((s) => s.bpm)).size === 1) {
      const moving = gs.find((g) => !g.rbTime && g.variable)
      if (moving) return moving
    }
    return gs[0] ?? null
  }

  /** Qué temas ya tienen grilla de un método (o de cualquiera). */
  withGrid(ids: number[], method?: GridMethod): Set<number> {
    const q = this.db.prepare(`SELECT 1 FROM dj_grid WHERE file_id = ?${method ? ' AND method = ?' : ''}`)
    return new Set(ids.filter((id) => (method ? q.get(id, method) : q.get(id))))
  }

  // ---- cue points ----

  /**
   * Los cues de un tema: los de Rekordbox si hay, si no los de Serato, si no los sugeridos por PAILA. Los del tracklist de
   * un set (dónde entra cada tema: core/setlists.ts) van siempre, sumados a esos.
   */
  cues(fileId: number): DjCue[] {
    const rows = this.db.prepare('SELECT source, kind, num, start, end_at AS endAt, name, color FROM dj_cues WHERE file_id = ? ORDER BY start').all(fileId) as unknown as DjCue[]
    const tracklist = rows.filter((r) => r.source === 'tracklist')
    for (const src of ['rekordbox', 'serato', 'paila'] as const) {
      const got = rows.filter((r) => r.source === src)
      if (got.length) return [...got, ...tracklist].sort((a, b) => a.start - b.start)
    }
    return tracklist
  }

  /** Guarda los cues sugeridos (reemplaza los sugeridos de antes; los traídos de Rekordbox o Serato no se tocan). */
  saveSuggested(fileId: number, cues: CueSuggestion[]) {
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM dj_cues WHERE file_id = ? AND source = 'paila'").run(fileId)
      const ins = this.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'paila', ?, ?, ?, NULL, ?, ?)")
      // solo memory cues (marcas en la forma de onda): son aproximados (corrida supervisada 21/10: el inicio acierta casi
      // siempre, el resto 1 de cada 3 contra Mixed In Key), así que no ocupan los pads de hot cue
      for (const c of cues) ins.run(fileId, 'memory', -1, c.time, CUE_NAMES[c.role], CUE_COLORS[c.role])
    })
  }

  // ---- identificadores ----

  /** El TrackID fijo de un tema (se inventa la primera vez). */
  trackId(fileId: number): string {
    const r = this.db.prepare('SELECT track_id AS id FROM rb_ids WHERE file_id = ?').get(fileId) as { id: string } | undefined
    if (r) return r.id
    let id = PAILA_ID_BASE + fileId
    while (this.db.prepare('SELECT 1 FROM rb_ids WHERE track_id = ?').get(String(id))) id += 10_000_000
    this.db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (?, ?, 'paila')").run(fileId, String(id))
    return String(id)
  }

  meta(fileId: number): { stars: number; colour: string | null; myTags: string[]; comments: string | null; playCount: number | null } | null {
    const r = this.db.prepare('SELECT stars, colour, my_tags AS myTags, comments, play_count AS playCount FROM dj_meta WHERE file_id = ?').get(fileId) as
      { stars: number; colour: string | null; myTags: string | null; comments: string | null; playCount: number | null } | undefined
    return r ? { ...r, myTags: r.myTags ? JSON.parse(r.myTags) : [] } : null
  }

  // ---- importar ----

  /** Mapa ruta → tema, y nombre de archivo + tamaño → tema (para los que se movieron desde que se exportó el XML). */
  private fileIndex() {
    const byPath = new Map<string, number>(), byName = new Map<string, number[]>()
    for (const r of this.db.prepare(`SELECT f.id, f.size FROM files f WHERE ${visible('f')}`).all() as { id: number; size: number }[]) {
      const p = this.pathOf(r.id)
      if (!p) continue
      byPath.set(norm(p), r.id)
      const k = `${norm(path.basename(p))}|${r.size}`
      byName.set(k, [...(byName.get(k) ?? []), r.id])
    }
    return { byPath, byName }
  }

  /**
   * Trae lo de un rekordbox.xml (solo lo lee): TrackID, estrellas, color, comentario, "my tags", veces tocado, grilla y
   * cues de cada tema que está en PAILA. Lo de Rekordbox reemplaza lo que se había traído antes de Rekordbox; los cues
   * sugeridos y la grilla de PAILA quedan, pero al exportar gana lo de Rekordbox.
   */
  importRekordbox(xmlFile: string): DjImportResult {
    const tracks = parseRbXml(fs.readFileSync(xmlFile, 'utf8'))
    const { byPath, byName } = this.fileIndex()
    const res: DjImportResult = { source: 'rekordbox', tracks: tracks.length, matched: 0, byName: 0, grids: 0, cues: 0, stars: 0, colours: 0, myTags: 0, unmatched: [] }
    const now = new Date().toISOString()
    transaction(this.db, () => {
      for (const t of tracks) {
        let id = byPath.get(norm(t.path))
        if (id == null) {
          const cand = byName.get(`${norm(path.basename(t.path))}|${t.size}`)
          if (cand?.length === 1) { id = cand[0]; res.byName++ }
        }
        if (id == null) { if (res.unmatched.length < 200 && /m[uú]sica/i.test(t.path)) res.unmatched.push(t.path); continue }
        res.matched++
        this.storeRekordbox(id, t, now, res)
      }
    })
    return res
  }

  private storeRekordbox(id: number, t: RbTrack, now: string, res: DjImportResult) {
    const db = this.db
    // el TrackID de Rekordbox pasa a ser el de este tema (si otro tema no lo tiene ya)
    const owner = db.prepare('SELECT file_id AS f FROM rb_ids WHERE track_id = ?').get(t.trackId) as { f: number } | undefined
    if (!owner || owner.f === id) {
      db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (?, ?, 'rekordbox') ON CONFLICT (file_id) DO UPDATE SET track_id = excluded.track_id, source = 'rekordbox'").run(id, t.trackId)
    }
    db.prepare(`INSERT INTO dj_meta (file_id, stars, colour, my_tags, comments, play_count, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (file_id) DO UPDATE SET stars = excluded.stars, colour = excluded.colour, my_tags = excluded.my_tags, comments = excluded.comments,
      play_count = excluded.play_count, imported_at = excluded.imported_at`)
      .run(id, t.stars, t.colour, t.myTags.length ? JSON.stringify(t.myTags) : null, t.comments || null, t.playCount, now)
    if (t.stars) res.stars++
    if (t.colour) res.colours++
    if (t.myTags.length) res.myTags++
    if (t.grid.length) {
      const segs = t.grid
      // variable solo si cambia el BPM (la del análisis dinámico): Rekordbox también pone varios puntos al mismo BPM
      const r = rangeOf(segs)
      db.prepare(`INSERT INTO dj_grid (file_id, method, bpm, segments, error_ms, variable, bar_energy, src_size, made_at) VALUES (?, 'rekordbox', ?, ?, NULL, ?, NULL, ?, ?)
        ON CONFLICT (file_id, method) DO UPDATE SET bpm = excluded.bpm, segments = excluded.segments, variable = excluded.variable, src_size = excluded.src_size, made_at = excluded.made_at`)
        .run(id, t.grid[0].bpm, JSON.stringify(segs), r ? 1 : 0, t.size, now)
      this.saveTempo(id, 'rekordbox', r)
      res.grids++
    }
    db.prepare("DELETE FROM dj_cues WHERE file_id = ? AND source = 'rekordbox'").run(id)
    const ins = db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'rekordbox', ?, ?, ?, ?, ?, ?)")
    for (const c of t.cues) {
      const kind = c.type === 4 || (c.end != null && c.end > c.start) ? 'loop' : c.num >= 0 ? 'hot' : 'memory'
      ins.run(id, kind, c.num, c.start, c.end, c.name, c.color)
    }
    if (t.cues.length) res.cues++
  }

  /**
   * Lo de un pendrive de CDJ (core/listimport.ts), en el tiempo de Rekordbox como su XML: se guarda como de Rekordbox, pero
   * solo lo que el tema no tenía (si ya trajiste tu rekordbox.xml, gana lo tuyo). `stamp` marca la tanda para deshacerla.
   */
  recoverRekordbox(id: number, d: { grid: GridSegment[]; cues: RbTrack['cues']; stars: number; colour: string | null }, stamp: string, size: number | null): { grid: boolean; cues: boolean; meta: boolean } {
    const db = this.db
    const out = { grid: false, cues: false, meta: false }
    transaction(db, () => {
      if (d.grid.length && !db.prepare("SELECT 1 FROM dj_grid WHERE file_id = ? AND method = 'rekordbox'").get(id)) {
        const r = rangeOf(d.grid)
        db.prepare("INSERT INTO dj_grid (file_id, method, bpm, segments, error_ms, variable, bar_energy, src_size, made_at) VALUES (?, 'rekordbox', ?, ?, NULL, ?, NULL, ?, ?)")
          .run(id, d.grid[0].bpm, JSON.stringify(d.grid), r ? 1 : 0, size, stamp)
        this.saveTempo(id, 'rekordbox', r)
        out.grid = true
      }
      if (d.cues.length && !db.prepare("SELECT 1 FROM dj_cues WHERE file_id = ? AND source = 'rekordbox'").get(id)) {
        const ins = db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'rekordbox', ?, ?, ?, ?, ?, ?)")
        for (const c of d.cues) ins.run(id, c.type === 4 || (c.end != null && c.end > c.start) ? 'loop' : c.num >= 0 ? 'hot' : 'memory', c.num, c.start, c.end, c.name, c.color)
        out.cues = true
      }
      if ((d.stars || d.colour) && !db.prepare('SELECT 1 FROM dj_meta WHERE file_id = ?').get(id)) {
        db.prepare('INSERT INTO dj_meta (file_id, stars, colour, imported_at) VALUES (?, ?, ?, ?)').run(id, d.stars, d.colour, stamp)
        out.meta = true
      }
    })
    return out
  }

  /** Deshace lo recuperado de un pendrive, salvo lo que se reemplazó después al traer un rekordbox.xml. */
  undoRecovered(done: { grids: number[]; cues: number[]; meta: number[]; stamp: string }) {
    const db = this.db
    transaction(db, () => {
      for (const id of done.grids) {
        if (Number(db.prepare("DELETE FROM dj_grid WHERE file_id = ? AND method = 'rekordbox' AND made_at = ?").run(id, done.stamp).changes)) this.saveTempo(id, 'rekordbox', null)
      }
      for (const id of done.cues) {
        const m = db.prepare('SELECT imported_at AS at FROM dj_meta WHERE file_id = ?').get(id) as { at: string } | undefined
        if (!m || m.at <= done.stamp) db.prepare("DELETE FROM dj_cues WHERE file_id = ? AND source = 'rekordbox'").run(id)
      }
      for (const id of done.meta) db.prepare('DELETE FROM dj_meta WHERE file_id = ? AND imported_at = ?').run(id, done.stamp)
    })
  }

  /**
   * Trae los marcadores de Serato que están dentro de los archivos (solo los lee): cues, loops, color y la grilla. Se
   * toman en el mismo tiempo que Rekordbox (por confirmar en los MP3 con cabecera: ver la bitácora de la Fase F).
   */
  importSerato(ids?: number[]): DjImportResult {
    const rows = this.db.prepare(`SELECT f.id, f.ext, f.size FROM files f WHERE ${visible('f')} AND f.error IS NULL AND lower(f.ext) IN ('mp3', 'flac', 'aif', 'aiff', 'wav')`).all() as { id: number; ext: string; size: number }[]
    const want = ids ? new Set(ids) : null
    const res: DjImportResult = { source: 'serato', tracks: 0, matched: 0, byName: 0, grids: 0, cues: 0, stars: 0, colours: 0, myTags: 0, unmatched: [] }
    const now = new Date().toISOString()
    for (const r of rows) {
      if (want && !want.has(r.id)) continue
      const p = this.pathOf(r.id)
      if (!p) continue
      res.tracks++
      const m = readSerato(p, r.ext)
      if (!m) continue
      res.matched++
      transaction(this.db, () => {
        this.db.prepare("DELETE FROM dj_cues WHERE file_id = ? AND source = 'serato'").run(r.id)
        const ins = this.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'serato', ?, ?, ?, ?, ?, ?)")
        for (const c of m.cues) ins.run(r.id, c.kind, c.index, round3(c.startMs / 1000), c.endMs != null ? round3(c.endMs / 1000) : null, c.name, c.color)
        if (m.cues.length) res.cues++
        if (m.grid) {
          this.db.prepare(`INSERT INTO dj_grid (file_id, method, bpm, segments, error_ms, variable, bar_energy, src_size, made_at) VALUES (?, 'serato', ?, ?, NULL, 0, NULL, ?, ?)
            ON CONFLICT (file_id, method) DO UPDATE SET bpm = excluded.bpm, segments = excluded.segments, src_size = excluded.src_size, made_at = excluded.made_at`)
            .run(r.id, m.grid.bpm, JSON.stringify([{ start: round3(m.grid.position), bpm: m.grid.bpm, beat: 1 }]), r.size, now)
          res.grids++
        }
        // el color de Serato solo si Rekordbox no le puso uno (el blanco de Serato es "sin color")
        if (m.colour && m.colour !== '#FFFFFF') {
          this.db.prepare(`INSERT INTO dj_meta (file_id, stars, colour, imported_at) VALUES (?, 0, ?, ?) ON CONFLICT (file_id) DO UPDATE SET colour = COALESCE(dj_meta.colour, excluded.colour)`).run(r.id, m.colour, now)
          res.colours++
        }
      })
    }
    return res
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000

/** Colores de los cues sugeridos (los de los pads de Rekordbox): verde inicio, rojo drop, azul break, naranja salida. */
export const CUE_COLORS: Record<CueSuggestion['role'], string> = { inicio: '#28E214', drop: '#E81414', break: '#305AFF', salida: '#E0641B' }
