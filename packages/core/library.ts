// Biblioteca: carpetas raíz (por disco y número de serie), reglas de colección y los temas. El escaneo está en
// core/scan.ts, la cola de análisis en core/queue.ts y el resumen de Análisis en core/insights.ts.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type { AnalysisDetail, AnalysisInsights, CollectionKind, RootInfo, ScanStatus } from '@paila/shared/types'
import { analysisWorkers, type AnalysisRunner } from './analysis/pool'
import type { Slots } from './analysis/slots'
import { listed, openDb, transaction, visible, type Db } from './db'
import { findMount, labelOf, mountOf, serialOf } from './volumes'
import { kindFor, type Rule } from './collections'
import { toAbs } from './files'
import { mergeRoot, segments } from './rootmerge'
import { OpLock } from './oplock'
import { LibraryJob } from './libraryjob'
import { scanLibrary } from './scan'
import { analyzeLibrary, pendingAnalysis, pendingPrints } from './queue'
import { pendingQuality } from './reanalysis'
import { pendingPrecise, type SecondOpinion } from './precise'
import { pendingSilence } from './silencepass'
import { pendingStyle, type StyleModels } from './stylepass'
import { getAnalysis, insights } from './insights'
import { textos } from '@paila/shared/idioma'

// Los avisos de agregar carpetas y de escanear (se ven en pantalla). "escaneando la biblioteca" entra en "PAILA está …".
const T = textos({
  yaAdentro: {
    es: (shown: string) => `Esa carpeta ya está adentro de ${shown}, que ya es parte de tu biblioteca: no hace falta agregarla (cada tema aparecería dos veces).`,
    en: (shown: string) => `That folder is already inside ${shown}, which is already part of your library: no need to add it (every track would show up twice).`,
  },
  quieta: {
    es: (una: boolean, busy: string | null) => `Para unir esta carpeta con ${una ? 'la que ya tenías adentro' : 'las que ya tenías adentro'}, PAILA tiene que estar quieta (ahora está ${busy ?? 'escaneando'}). Esperá a que termine o detenelo, y probá de nuevo.`,
    en: (una: boolean, busy: string | null) => `To merge this folder with ${una ? 'the one you already had inside it' : 'the ones you already had inside it'}, PAILA has to be idle (right now it's ${busy ?? 'scanning'}). Wait for it to finish or stop it, and try again.`,
  },
  enCurso: { es: 'Ya hay un escaneo en curso', en: 'A scan is already running' },
  sinFfprobe: { es: 'No se encontró ffprobe', en: "Couldn't find ffprobe" },
  ahoraNo: { es: (busy: string) => `No se puede escanear ahora: PAILA está ${busy}. Esperá a que termine.`, en: (busy: string) => `Can't scan right now: PAILA is ${busy}. Wait for it to finish.` },
  escaneando: { es: 'escaneando la biblioteca', en: 'scanning the library' },
})

interface RootRow { id: number; rel_path: string; serial: string; label: string; last_mount: string }

/**
 * Cuánto se confía en dónde estaba montado un disco antes de volver a buscarlo por número de serie (buscarlo prueba las
 * letras de unidad una por una, y trackPath lo necesita para cada tema).
 */
const MOUNT_TTL_MS = 2000

export class Library extends LibraryJob {
  readonly db: Db
  /** Candado compartido por todo lo que mueve o escribe archivos (y el escaneo, que los recorre). */
  readonly ops = new OpLock()
  /** La segunda opinión de Deezer para la pasada precisa (la pone la app si el usuario lo tiene prendido; en los tests, nada). */
  secondOpinion: (() => SecondOpinion | null) | null = null
  /** Dónde está el modelo de estilos (la app, si se bajó; en los tests, nada: la pasada no corre). */
  styleModels: (() => StyleModels | null) | null = null

  constructor(dbFile: string, private ffprobe: string | null, onStatus?: (s: ScanStatus) => void) {
    super(onStatus)
    this.db = openDb(dbFile)
  }

  // ---------- carpetas raíz ----------

  private mounts = new Map<string, { mount: string | null; at: number }>()
  /** Dónde está montado hoy un disco (o null), guardado un rato corto. Si el disco desaparece, se nota en el momento. */
  private mountFor(serial: string, lastMount: string): string | null {
    const c = this.mounts.get(serial)
    if (c && Date.now() - c.at < MOUNT_TTL_MS && (!c.mount || fs.existsSync(c.mount))) return c.mount
    const mount = findMount(serial, lastMount)
    this.mounts.set(serial, { mount, at: Date.now() })
    return mount
  }

  roots(): RootInfo[] {
    const rows = this.db.prepare(
      'SELECT r.id, r.rel_path, v.serial, v.label, v.last_mount FROM roots r JOIN volumes v ON v.id = r.volume_id WHERE r.removed_at IS NULL ORDER BY r.id',
    ).all() as unknown as RootRow[]
    return rows.map((r) => {
      const mount = this.mountFor(r.serial, r.last_mount)
      if (mount && mount !== r.last_mount) {
        this.db.prepare('UPDATE volumes SET last_mount = ? WHERE serial = ?').run(mount, r.serial)
      }
      const base = mount ?? r.last_mount
      return {
        id: r.id,
        path: r.rel_path ? path.join(base, r.rel_path) : base,
        volumeLabel: r.label,
        volumeSerial: r.serial,
        available: !!mount && fs.existsSync(r.rel_path ? path.join(mount, r.rel_path) : mount),
        rules: this.rules(r.id),
      }
    })
  }

  rules(rootId: number): Rule[] {
    return this.db.prepare('SELECT rel_prefix AS rel, kind FROM rules WHERE root_id = ? ORDER BY rel_prefix').all(rootId) as unknown as Rule[]
  }

  async addRoot(absPath: string, rules: Rule[]): Promise<RootInfo> {
    const full = path.resolve(absPath)
    const mount = mountOf(full)
    const serial = serialOf(full)
    const label = await labelOf(full)
    const rel = path.relative(mount, full)
    // Carpetas una adentro de otra: cada tema aparecería dos veces (y "duplicados" podría proponer tirar el único archivo).
    const norm = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/').toLowerCase()
    const mine = norm(rel)
    const inner: { id: number; prefix: string }[] = []
    for (const r of this.db.prepare('SELECT r.id, r.rel_path AS rel, v.serial FROM roots r JOIN volumes v ON v.id = r.volume_id WHERE r.removed_at IS NULL').all() as { id: number; rel: string; serial: string }[]) {
      if (r.serial !== serial) continue
      const other = norm(r.rel)
      if (other === mine) continue // es la misma carpeta: se actualizan sus reglas
      const shown = this.roots().find((x) => x.id === r.id)?.path ?? r.rel
      if (other === '' || mine.startsWith(other + '/')) {
        throw new Error(T.yaAdentro(shown))
      }
      // contiene a otra que ya estaba: se unen (core/rootmerge.ts), sin perder playlists, análisis ni historial
      if (mine === '' || other.startsWith(mine + '/')) inner.push({ id: r.id, prefix: segments(r.rel).slice(segments(rel).length).join('/') })
    }
    if (inner.length && ((this.status.running && this.status.job === 'scan') || this.ops.busy)) throw new Error(T.quieta(inner.length === 1, this.ops.busy))
    const id = transaction(this.db, () => {
      this.db.prepare(
        'INSERT INTO volumes (serial, label, last_mount) VALUES (?, ?, ?) ON CONFLICT(serial) DO UPDATE SET label = excluded.label, last_mount = excluded.last_mount',
      ).run(serial, label, mount)
      const vol = this.db.prepare('SELECT id FROM volumes WHERE serial = ?').get(serial) as { id: number }
      const existing = this.db.prepare('SELECT id FROM roots WHERE volume_id = ? AND rel_path = ?').get(vol.id, rel) as { id: number } | undefined
      // si esa carpeta se había sacado antes, vuelve con todo (sus temas, playlists e historial)
      if (existing) this.db.prepare('UPDATE roots SET removed_at = NULL WHERE id = ?').run(existing.id)
      if (existing) this.db.prepare('UPDATE files SET excluded_at = NULL WHERE root_id = ?').run(existing.id)
      const rootId = existing?.id ?? Number(
        this.db.prepare('INSERT INTO roots (volume_id, rel_path, added_at) VALUES (?, ?, ?)').run(vol.id, rel, new Date().toISOString()).lastInsertRowid,
      )
      this.db.prepare('DELETE FROM rules WHERE root_id = ?').run(rootId)
      const ins = this.db.prepare('INSERT INTO rules (root_id, rel_prefix, kind) VALUES (?, ?, ?)')
      // Solo se guardan las reglas que cambian algo respecto de la carpeta de arriba.
      for (const r of [...rules].sort((a, b) => a.rel.length - b.rel.length)) {
        const parent = kindFor(r.rel.includes('/') ? r.rel.slice(0, r.rel.lastIndexOf('/')) : '', this.rules(rootId))
        if (r.kind !== parent || r.rel === '') ins.run(rootId, r.rel, r.kind)
      }
      for (const x of inner) mergeRoot(this.db, rootId, x.id, x.prefix)
      if (inner.length) this.reclassify(rootId)
      return rootId
    })
    this.bases = null
    return this.roots().find((r) => r.id === id)!
  }

  removeRoot(id: number) {
    this.bases = null
    // No se borra nada: la carpeta y sus temas quedan ocultos (con playlists, análisis e historial) por si vuelve.
    transaction(this.db, () => {
      const now = new Date().toISOString()
      this.db.prepare('UPDATE roots SET removed_at = ? WHERE id = ?').run(now, id)
      this.db.prepare('UPDATE files SET excluded_at = COALESCE(excluded_at, ?) WHERE root_id = ?').run(now, id)
    })
  }

  setRule(rootId: number, rel: string, kind: CollectionKind) {
    transaction(this.db, () => {
      // Elegir el tipo de una carpeta vale para todo lo que tiene adentro.
      if (rel === '') this.db.prepare('DELETE FROM rules WHERE root_id = ?').run(rootId)
      else this.db.prepare("DELETE FROM rules WHERE root_id = ? AND substr(rel_prefix, 1, length(?) + 1) = ? || '/'").run(rootId, rel, rel)
      this.db.prepare('INSERT INTO rules (root_id, rel_prefix, kind) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET kind = excluded.kind').run(rootId, rel, kind)
      this.reclassify(rootId)
    })
  }

  /** Recalcula la colección de los archivos ya escaneados cuando cambian las reglas (también al escanear). */
  reclassify(rootId: number) {
    const rules = this.rules(rootId)
    const rows = this.db.prepare('SELECT id, rel_path, kind, excluded_at FROM files WHERE root_id = ?').all(rootId) as { id: number; rel_path: string; kind: string; excluded_at: string | null }[]
    const upd = this.db.prepare('UPDATE files SET kind = ? WHERE id = ?')
    // Excluir no borra: el tema queda oculto con sus playlists y su historial, y vuelve si la carpeta se vuelve a incluir.
    const hide = this.db.prepare('UPDATE files SET excluded_at = ? WHERE id = ?')
    const now = new Date().toISOString()
    for (const f of rows) {
      const k = kindFor(f.rel_path, rules)
      if (k === 'excluir') { if (!f.excluded_at) hide.run(now, f.id) }
      else {
        if (f.excluded_at) hide.run(null, f.id)
        if (k !== f.kind) upd.run(k, f.id)
      }
    }
  }

  // ---------- temas ----------

  trackCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM files WHERE ${visible()}`).get() as { n: number }).n
  }

  /** Cuántas filas tiene la tabla (los visibles más los desaparecidos): decide si es una biblioteca grande (BIG_LIBRARY). */
  tableCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM files WHERE ${listed()}`).get() as { n: number }).n
  }

  /**
   * Todas las filas como arreglos, en el orden de TRACK_FIELDS (o solo la de un tema). Con los desaparecidos: la tabla los
   * muestra marcados. Con bibliotecas grandes la tabla no usa esto: ver core/tableindex.ts.
   */
  tracks(id?: number): unknown[][] {
    const st = this.db.prepare(
      `SELECT f.id, f.root_id, f.rel_path, f.kind, f.ext, f.codec, f.sample_rate, f.bits, f.channels, f.kbps, f.duration,
              f.artist, f.album_artist, f.title, f.album, f.track, f.year, f.genre, f.size, f.mtime, f.error,
              a.grade, a.is_label, a.flags, a.eff_kbps, a.cutoff, a.lufs, a.bpm, a.music_key, a.camelot, a.energy, f.missing_at,
              (SELECT t.lo || ',' || t.hi || ',' || g.bpm FROM dj_tempo t JOIN dj_grid g ON g.file_id = t.file_id AND g.method = t.method WHERE t.file_id = f.id ORDER BY t.method = 'beatthis' DESC LIMIT 1) AS tempo
       FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${listed('f')}${id == null ? '' : ' AND f.id = ?'}`,
    )
    st.setReturnArrays(true) // directo como arreglos: sin armar un objeto por fila (abre más rápido)
    return st.all(...(id == null ? [] : [id])) as unknown as unknown[][]
  }

  trackPath(id: number): string | null {
    const f = this.db.prepare('SELECT root_id, rel_path FROM files WHERE id = ?').get(id) as { root_id: number; rel_path: string } | undefined
    if (!f) return null
    const base = this.rootBase(f.root_id)
    return base ? toAbs(base, f.rel_path) : null
  }

  private bases: { at: number; byId: Map<number, string> } | null = null
  /**
   * La carpeta de una raíz con la letra de unidad de hoy (la misma que `roots()[i].path`), guardada un rato corto: trackPath
   * se llama una vez por tema. Agregar o sacar carpetas la vuelve a calcular.
   */
  private rootBase(rootId: number): string | undefined {
    if (!this.bases || Date.now() - this.bases.at >= MOUNT_TTL_MS) this.bases = { at: Date.now(), byId: new Map(this.roots().map((r) => [r.id, r.path])) }
    return this.bases.byId.get(rootId)
  }

  // ---------- escaneo y análisis (pausables; nunca los dos a la vez) ----------

  async scan(concurrency = Math.max(2, Math.min(8, os.cpus().length - 1))): Promise<ScanStatus> {
    if (this.status.running) throw new Error(T.enCurso)
    if (!this.ffprobe) throw new Error(T.sinFfprobe)
    if (this.ops.busy) throw new Error(T.ahoraNo(this.ops.busy))
    const ffprobe = this.ffprobe
    return this.ops.run(T.escaneando, () => scanLibrary(this, ffprobe, concurrency), { cuttable: true })
  }

  /** Analiza lo pendiente (ver core/queue.ts). `limit`: cuántos temas a la vez (un `Slots` se puede cambiar mientras corre). */
  async analyze(run: AnalysisRunner, ffmpeg: string, limit: number | Slots = analysisWorkers()): Promise<ScanStatus> {
    // Mientras PAILA mueve o escribe archivos, el análisis no arranca: leería temas en medio de moverlos (EBUSY). Desde que
    // Organizar no congela la app, el análisis podía arrancar en el medio (corte con la app, 22/10). Espera a que termine.
    await this.ops.free(Number.POSITIVE_INFINITY)
    if (this.status.running) throw new Error(T.enCurso)
    return analyzeLibrary(this, run, ffmpeg, limit)
  }

  /** Cuántos temas faltan analizar (nuevos, modificados o de una versión vieja del análisis). */
  pendingAnalysis(): number { return pendingAnalysis(this.db) }
  /** Cuántos temas ya analizados no tienen todavía las huellas. */
  pendingPrints(): number { return pendingPrints(this.db) }
  /** Cuántos temas esperan que se les vuelva a medir la calidad con el motor nuevo (core/reanalysis.ts). */
  pendingQuality(): number { return pendingQuality(this.db) }
  /** Cuántos temas de Música esperan la pasada precisa (core/precise.ts). */
  pendingPrecise(): number { return pendingPrecise(this.db) }
  /** Cuántos temas esperan que se les midan los silencios del principio y el final (core/silencepass.ts). */
  pendingSilence(): number { return pendingSilence(this.db) }
  /** Cuántos temas espera escuchar el modelo de estilos (0 si no se bajó; core/stylepass.ts). */
  pendingStyle(): number { return this.styleModels?.() ? pendingStyle(this.db) : 0 }
  insights(): AnalysisInsights { return insights(this.db) }
  getAnalysis(id: number): AnalysisDetail | null { return getAnalysis(this.db, id) }

  /** Datos de un tema para el reproductor y el espectrograma. */
  trackFile(id: number): { path: string; ext: string; codec: string | null; size: number; mtime: number } | null {
    const f = this.db.prepare('SELECT ext, codec, size, mtime FROM files WHERE id = ?').get(id) as { ext: string; codec: string | null; size: number; mtime: number } | undefined
    const p = f && this.trackPath(id)
    return f && p ? { path: p, ...f } : null
  }

  close() { this.db.close() }
}
