// Reemplazo básico: cambia un tema de mala calidad por otro archivo mejor SIN perder lo que ya ordenaste.
// El tema conserva su identidad en PAILA (playlists, orden, historial); el archivo viejo va a la papelera y todo se puede deshacer.
import fs from 'node:fs'
import path from 'node:path'
import { type Db } from './db'
import { OpJournal, copyDurable } from './journal'
import { checkOrThrow } from './ops/run'
import { probe, type ProbeResult } from './probe'
import { grade } from './analysis/grade'
import { isLossless } from './queue'
import type { AnalysisRunner } from './analysis/pool'
import { transplantTags } from './tagio'
import { moveNoClobber, trashBatch } from './safefs'
import { fecha, purgedMsg } from './purge'
import type { ReplaceOptions, ReplacementEntry } from '@paila/shared/types'
import { textos, fecha as fechaIdioma } from '@paila/shared/idioma'

/** Lo que se muestra cuando no se puede reemplazar o deshacer (en castellano, las fechas salen como antes: 20/10/2026). */
const T = textos({
  noEnBiblioteca: { es: 'El tema no está en la biblioteca', en: "The track isn't in the library" },
  yaNoEnBiblioteca: { es: 'El tema ya no está en la biblioteca', en: 'The track is no longer in the library' },
  samplePacks: { es: 'Los sample packs no se reemplazan', en: "Sample packs aren't replaced" },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  nuevoNoExiste: { es: 'El archivo nuevo no existe', en: "The new file doesn't exist" },
  actualNoEsta: { es: 'El archivo actual ya no está', en: 'The current file is gone' },
  yaExiste: { es: (n: string) => `Ya existe un archivo llamado ${n} en esa carpeta`, en: (n: string) => `There's already a file called ${n} in that folder` },
  copiaDistinta: { es: 'La copia del archivo nuevo no quedó igual: no se reemplazó', en: "The copy of the new file didn't come out the same: nothing was replaced" },
  noEncontrado: { es: 'No se encontró ese reemplazo', en: "Couldn't find that replacement" },
  yaDeshecho: { es: 'Ese reemplazo ya se deshizo', en: 'That replacement was already undone' },
  sinOriginal: { es: (msg: string) => `${msg}: el archivo original ya no existe`, en: (msg: string) => `${msg}: the original file no longer exists` },
  otraVez: {
    es: (at: string) => `Este tema se volvió a reemplazar después (el ${fecha(at)}). Primero deshacé ese reemplazo, el más nuevo de la lista.`,
    en: (at: string) => `This track was replaced again later (on ${fechaIdioma(at)}). Undo that replacement first, the newest one on the list.`,
  },
  enPapelera: {
    es: 'El tema está en la papelera. Restauralo primero (en esta misma pantalla) y después deshacé el reemplazo.',
    en: 'The track is in the Trash. Restore it first (on this same screen) and then undo the replacement.',
  },
  desaparecido: {
    es: (at: string) => `PAILA no encuentra el archivo del tema (figura como desaparecido desde el ${fecha(at)}). Conectá el disco donde está o volvé a escanear, y probá de nuevo.`,
    en: (at: string) => `PAILA can't find the track's file (it's been listed as missing since ${fechaIdioma(at)}). Connect the drive it's on or scan again, and try again.`,
  },
  noEstaEn: {
    es: (rel: string) => `El archivo del tema ya no está en ${rel}. Volvé a escanear la biblioteca y probá de nuevo.`,
    en: (rel: string) => `The track's file is no longer at ${rel}. Scan the library again and try again.`,
  },
  originalNoEnPapelera: {
    es: 'El archivo original ya no está en la papelera (¿se borró a mano?): no se puede deshacer',
    en: "The original file is no longer in the Trash (was it deleted by hand?): it can't be undone",
  },
  otroArchivo: { es: (t: string) => `Ya hay otro archivo en ${t}: PAILA no lo pisa`, en: (t: string) => `There's already another file at ${t}: PAILA won't overwrite it` },
})

export interface CandidateInfo {
  path: string; ext: string; codec: string | null; kbps: number | null; sampleRate: number | null; bits: number | null; duration: number | null; size: number
  grade: string; label: string; says: string; why: string[]; lufs: number | null; cutoff: number | null
  /** Marcas del análisis (damaged, fake_lossless…) y recortes de volumen: para la verificación de la Bandeja. */
  flags: string[]; clipEvents: number | null
  /** La calidad real en kbps (1411 = CD): con la misma nota que el tuyo, es mejor solo si suena con más (core/better.ts). */
  effKbps?: number | null
  /** El programa que lo armó ("LAME3.99r", "Lavf"): para elegir entre dos que llegaron para el mismo tema. */
  encoder?: string | null
  /** El espectro (128 puntos en dB, de 0 a 22 kHz): para ver si suma agudos donde el tema de la biblioteca corta. */
  spectrum: number[]
  artist: string | null; title: string | null; album: string | null
}
export interface ReplaceResult { replacementId: number; newRel: string }
/** rel: dónde quedó el original. followed: el tema se había movido o renombrado y el original volvió a ese lugar nuevo. */
export interface UndoResult { rel: string; followed: boolean }

/** Analiza un archivo que todavía no está en la biblioteca, para compararlo con el actual. */
export async function describeCandidate(run: AnalysisRunner, ffprobe: string, ffmpeg: string, file: string): Promise<CandidateInfo> {
  const m: ProbeResult = await probe(ffprobe, file)
  const ext = path.extname(file).slice(1).toLowerCase()
  const lossless = isLossless(m.codec ?? null, ext)
  const info = { codec: m.codec ?? null, ext, lossless, kbps: m.kbps ?? null, sampleRate: m.sampleRate ?? null, bits: m.bits ?? null, channels: m.channels ?? null }
  const raw = await run.full({ ffmpeg, file, ...info, duration: m.duration ?? null, withDj: false })
  const v = grade(info, raw, { names: [{ text: path.basename(file), from: 'archivo' }, ...[m.title, m.artist, m.album].filter((x): x is string => !!x).map((text) => ({ text, from: 'tags' as const }))], year: Number(m.year) || null })
  return {
    path: file, ext, codec: info.codec, kbps: info.kbps, sampleRate: info.sampleRate, bits: info.bits, duration: m.duration ?? null, size: fs.statSync(file).size,
    grade: v.grade, label: v.is, says: v.says, why: v.why, lufs: raw.lufs, cutoff: raw.cutoff.cutoff, flags: v.flags, clipEvents: raw.clipEvents ?? null, effKbps: v.effKbps, encoder: raw.mp3?.encoder ?? null, spectrum: raw.cutoff.spectrum,
    artist: m.artist ?? null, title: m.title ?? null, album: m.album ?? null,
  }
}

const COLS = ['rel_path', 'size', 'mtime', 'ext', 'codec', 'sample_rate', 'bits', 'channels', 'kbps', 'duration', 'artist', 'album_artist', 'title', 'album', 'track', 'year', 'genre', 'error'] as const

/** Lo que se anota al deshacer un reemplazo (en el diario antes de mover, y en la base después). */
export interface ReplaceUndoData { replacementId: number; fileId: number; curRel: string; newTrashRel: string; oldTrashRel: string; target: string; row: Record<string, unknown> }

/** Anota en la base un reemplazo ya deshecho: el original volvió a `target` (también lo usa la recuperación al abrir). */
export function logReplaceUndo(db: Db, d: ReplaceUndoData) {
  const sets = COLS.map((c) => `${c} = ?`).join(', ')
  db.prepare(`UPDATE files SET ${sets} WHERE id = ?`).run(...COLS.map((c) => (c === 'rel_path' ? d.target : (d.row[c] ?? null)) as string | number | null), d.fileId)
  db.prepare('DELETE FROM analysis WHERE file_id = ?').run(d.fileId)
  restoreDj(db, d.fileId, d.replacementId)
  db.prepare('UPDATE replacements SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), d.replacementId)
}

// ---- la grilla y los cues del archivo viejo (uso real del 24/10: al reemplazar quedaba la grilla del tema anterior) ----

type Rows = Record<string, unknown>[]
interface SavedDj { grids: Rows; tempo: Rows; cues: Rows }
const IMPORTED = new Set(['rekordbox', 'serato'])
const insertRows = (db: Db, table: string, rows: Rows) => {
  for (const r of rows) { const k = Object.keys(r); db.prepare(`INSERT OR REPLACE INTO ${table} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).run(...(k.map((c) => r[c]) as (string | number | null)[])) }
}

/**
 * Saca lo que ya no vale para el audio nuevo: la grilla y los cues que calculó PAILA siempre (se vuelven a calcular solos); los de
 * Rekordbox o Serato, si cambió la duración o se pasó de MP3 a otro formato (o al revés: el MP3 empieza unos milisegundos corrido).
 * Lo sacado queda en `replace_dj` para devolverlo si se deshace el reemplazo.
 */
export function dropStaleDj(db: Db, replacementId: number, fileId: number, before: { duration: number | null; ext: string }, after: { duration: number | null; ext: string }) {
  const moved = before.duration == null || after.duration == null || Math.abs(before.duration - after.duration) > 0.5 || (before.ext === 'mp3') !== (after.ext === 'mp3')
  const gone = (m: string) => !IMPORTED.has(m) || moved
  const pick = (sql: string, col: string) => (db.prepare(sql).all(fileId) as Rows).filter((r) => gone(String(r[col])))
  const saved: SavedDj = {
    grids: pick('SELECT * FROM dj_grid WHERE file_id = ?', 'method'),
    tempo: pick('SELECT * FROM dj_tempo WHERE file_id = ?', 'method'),
    cues: pick("SELECT * FROM dj_cues WHERE file_id = ? AND source != 'tracklist'", 'source'),
  }
  for (const g of saved.grids) db.prepare('DELETE FROM dj_grid WHERE file_id = ? AND method = ?').run(fileId, g.method as string)
  for (const t of saved.tempo) db.prepare('DELETE FROM dj_tempo WHERE file_id = ? AND method = ?').run(fileId, t.method as string)
  for (const c of saved.cues) db.prepare('DELETE FROM dj_cues WHERE id = ?').run(c.id as number)
  // aunque no hubiera nada: al deshacer, lo que se calcule para el archivo nuevo tampoco va a valer para el viejo
  db.prepare('INSERT OR REPLACE INTO replace_dj (replacement_id, data) VALUES (?, ?)').run(replacementId, JSON.stringify(saved))
}

/** Al deshacer: lo calculado para el archivo nuevo se saca y vuelve lo que tenía el viejo. Sin fila (una conversión), no se toca. */
function restoreDj(db: Db, fileId: number, replacementId: number) {
  const r = db.prepare('SELECT data FROM replace_dj WHERE replacement_id = ?').get(replacementId) as { data: string } | undefined
  if (!r) return
  const saved = JSON.parse(r.data) as SavedDj
  const back = new Set(saved.grids.map((g) => String(g.method)))
  const drop = (m: string) => !IMPORTED.has(m) || back.has(m)
  for (const g of db.prepare('SELECT method FROM dj_grid WHERE file_id = ?').all(fileId) as { method: string }[]) if (drop(g.method)) db.prepare('DELETE FROM dj_grid WHERE file_id = ? AND method = ?').run(fileId, g.method)
  for (const t of db.prepare('SELECT method FROM dj_tempo WHERE file_id = ?').all(fileId) as { method: string }[]) if (drop(t.method)) db.prepare('DELETE FROM dj_tempo WHERE file_id = ? AND method = ?').run(fileId, t.method)
  const cueBack = new Set(saved.cues.map((c) => String(c.source)))
  db.prepare(`DELETE FROM dj_cues WHERE file_id = ? AND (source = 'paila' OR source IN (${[...cueBack].map(() => '?').join(', ') || "''"}))`).run(fileId, ...cueBack)
  insertRows(db, 'dj_grid', saved.grids)
  insertRows(db, 'dj_tempo', saved.tempo)
  insertRows(db, 'dj_cues', saved.cues)
  db.prepare('DELETE FROM replace_dj WHERE replacement_id = ?').run(replacementId)
}

/**
 * Los temas reemplazados (o convertidos, o recortados) después de `since`: lo que una herramienta calculó antes con su audio
 * viejo (el volumen parejo, un recorte, las marcas de Serato) no se propone sobre el nuevo (choques del 27/10, C6).
 */
export function replacedSince(db: Db, since: string): Set<number> {
  return new Set((db.prepare('SELECT file_id AS id FROM replacements WHERE created_at > ? AND undone_at IS NULL').all(since) as { id: number }[]).map((r) => r.id))
}

export class Replacer {
  private journal: OpJournal
  constructor(private db: Db, private rootPath: (rootId: number) => string | null, private ffprobe: string, private ffmpeg: string) { this.journal = new OpJournal(db) }

  async replace(fileId: number, candidate: string, opts: ReplaceOptions): Promise<ReplaceResult> {
    const old = this.db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as Record<string, unknown> | undefined
    if (!old || old.trashed_at) throw new Error(T.noEnBiblioteca)
    if (old.kind === 'produccion') throw new Error(T.samplePacks)
    const root = this.rootPath(old.root_id as number)
    if (!root) throw new Error(T.sinDisco)
    if (!fs.existsSync(candidate)) throw new Error(T.nuevoNoExiste)
    const oldRel = old.rel_path as string
    const oldAbs = path.join(root, ...oldRel.split('/'))
    if (!fs.existsSync(oldAbs)) throw new Error(T.actualNoEsta)
    const newExt = path.extname(candidate).slice(1).toLowerCase()
    const dirRel = path.posix.dirname(oldRel) === '.' ? '' : path.posix.dirname(oldRel)
    const baseName = opts.sameName ? path.posix.basename(oldRel, path.posix.extname(oldRel)) : path.basename(candidate, path.extname(candidate))
    // con el mismo nombre y la misma extensión salvo mayúsculas ("Tema.Mp3"), queda la del original: con ".mp3" Windows lo
    // veía como otro archivo que "ya existe" (recortar silencios, muestra del 23/10)
    const oldExt = path.posix.extname(oldRel).slice(1)
    const newRel = (dirRel ? dirRel + '/' : '') + `${baseName}.${opts.sameName && oldExt.toLowerCase() === newExt ? oldExt : newExt}`
    const newAbs = path.join(root, ...newRel.split('/'))
    if (newRel !== oldRel && fs.existsSync(newAbs)) throw new Error(T.yaExiste(path.basename(newRel)))

    // chequeos centrales del motor de operaciones: candado, disco, espacio libre para la copia nueva, sample packs
    const candSize = fs.statSync(candidate).size
    checkOrThrow(this.db, { kind: 'reemplazar', op: 'reemplazo', rootId: old.root_id as number, fileId, src: oldRel, dst: newRel, data: null, bytes: candSize }, { rootPath: this.rootPath })
    const id = (this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM replacements').get() as { n: number }).n
    const oldTrashRel = `_PAILA/papelera/${trashBatch(`reemplazo-${id}`)}/${oldRel}`
    const oldTrashAbs = path.join(root, ...oldTrashRel.split('/'))
    // Diario antes de tocar nada: si se corta a mitad, al abrir PAILA vuelve el original a su lugar (core/recovery.ts).
    const jid = this.journal.begin({ op: 'reemplazo', rootId: old.root_id as number, fileId, src: oldRel, dst: newRel, data: { replacementId: id, oldRel, oldTrashRel, newRel } })
    try { moveNoClobber(oldAbs, oldTrashAbs) } catch (e) { this.journal.drop(jid); throw e } // el viejo se guarda, no se borra
    try {
      fs.mkdirSync(path.dirname(newAbs), { recursive: true })
      copyDurable(candidate, newAbs) // el archivo descargado queda donde estaba; la copia, escrita en el disco
      if (fs.statSync(newAbs).size !== candSize) throw new Error(T.copiaDistinta)
      if (opts.keepTags || opts.keepCover) await transplantTags(oldTrashAbs, newAbs, this.ffmpeg, { tags: opts.keepTags, cover: opts.keepCover }, {
        title: old.title as string | null, artist: old.artist as string | null, albumArtist: old.album_artist as string | null, album: old.album as string | null,
        track: old.track as string | null, year: old.year as string | null, genre: old.genre as string | null,
      })
      const m = await probe(this.ffprobe, newAbs)
      const st = fs.statSync(newAbs)
      const keepTags = opts.keepTags
      this.journal.done(jid, () => {
        this.db.prepare(
          `UPDATE files SET rel_path = ?, size = ?, mtime = ?, ext = ?, codec = ?, sample_rate = ?, bits = ?, channels = ?, kbps = ?, duration = ?, error = NULL, probed_at = ?
           ${keepTags ? '' : ', artist = ?, album_artist = ?, title = ?, album = ?, track = ?, year = ?, genre = ?'} WHERE id = ?`,
        ).run(newRel, st.size, Math.round(st.mtimeMs), newExt, m.codec ?? null, m.sampleRate ?? null, m.bits ?? null, m.channels ?? null, m.kbps ?? null, m.duration ?? null, new Date().toISOString(),
          ...(keepTags ? [] : [m.artist ?? null, m.albumArtist ?? null, m.title ?? null, m.album ?? null, m.track ?? null, m.year ?? null, m.genre ?? null]), fileId)
        this.db.prepare('DELETE FROM analysis WHERE file_id = ?').run(fileId) // se vuelve a analizar solo
        // lo pendiente que se calculó con el audio viejo (volumen, recorte, marcas de Serato) ya no vale: se escribía sobre el
        // nuevo (choques del 27/10, C6). La grilla y los cues de PAILA (dj_grid, dj_cues) los rehace otro arreglo (C2).
        const stale = ['replaygain', 'trim', 'serato'].filter((f) => !opts.stillValid?.includes(f as 'replaygain'))
        for (const f of stale) {
          this.db.prepare('DELETE FROM pending_changes WHERE file_id = ? AND field = ?').run(fileId, f)
          this.db.prepare('DELETE FROM pending_meta WHERE file_id = ? AND field = ?').run(fileId, f)
        }
        this.db.prepare('INSERT INTO replacements (id, file_id, old_row, old_trash_rel, new_rel, created_at, batch) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, fileId, JSON.stringify(Object.fromEntries(COLS.map((c) => [c, old[c] ?? null]))), oldTrashRel, newRel, new Date().toISOString(), opts.batch ?? null)
        // la grilla y los cues del archivo viejo no valen para el nuevo
        if (!opts.keepDj) dropStaleDj(this.db, id, fileId, { duration: old.duration as number | null, ext: String(old.ext ?? '').toLowerCase() }, { duration: m.duration ?? null, ext: newExt })
      })
      return { replacementId: id, newRel }
    } catch (e) {
      // algo falló: se deshace todo lo hecho
      fs.rmSync(newAbs, { force: true })
      moveNoClobber(oldTrashAbs, oldAbs)
      this.journal.drop(jid)
      throw e
    }
  }

  list(): ReplacementEntry[] {
    return (this.db.prepare('SELECT id, file_id AS fileId, old_row AS oldRow, new_rel AS newRel, created_at AS createdAt, undone_at AS undoneAt, purged_at AS purgedAt FROM replacements ORDER BY id DESC').all() as
      { id: number; fileId: number; oldRow: string; newRel: string; createdAt: string; undoneAt: string | null; purgedAt: string | null }[])
      .map((r) => ({ id: r.id, fileId: r.fileId, oldRel: (JSON.parse(r.oldRow) as { rel_path: string }).rel_path, newRel: r.newRel, createdAt: r.createdAt, undone: !!r.undoneAt, purgedAt: r.purgedAt }))
  }

  /**
   * Deshace un reemplazo: el archivo de hoy va a la papelera y el original vuelve, con sus datos de antes.
   * Antes mira cómo está el tema AHORA (puede haber cambiado después del reemplazo):
   * - si se movió o se renombró (Organizador, Arreglar nombres…), el original vuelve a ese lugar nuevo con ese nombre: lo de después se respeta;
   * - si está en la papelera, desaparecido, se volvió a reemplazar o se vació la papelera, explica qué pasa y no toca nada.
   */
  undo(id: number): UndoResult {
    const r = this.db.prepare('SELECT file_id AS fileId, old_row AS oldRow, old_trash_rel AS oldTrashRel, new_rel AS newRel, undone_at AS undoneAt, purged_at AS purgedAt FROM replacements WHERE id = ?').get(id) as
      { fileId: number; oldRow: string; oldTrashRel: string; newRel: string; undoneAt: string | null; purgedAt: string | null } | undefined
    if (!r) throw new Error(T.noEncontrado)
    if (r.undoneAt) throw new Error(T.yaDeshecho)
    if (r.purgedAt) throw new Error(T.sinOriginal(purgedMsg(r.purgedAt)))
    const later = this.db.prepare('SELECT created_at AS at FROM replacements WHERE file_id = ? AND id > ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1').get(r.fileId, id) as { at: string } | undefined
    if (later) throw new Error(T.otraVez(later.at))
    const f = this.db.prepare('SELECT root_id, rel_path, trashed_at, missing_at FROM files WHERE id = ?').get(r.fileId) as
      { root_id: number; rel_path: string; trashed_at: string | null; missing_at: string | null } | undefined
    if (!f) throw new Error(T.yaNoEnBiblioteca)
    if (f.trashed_at) throw new Error(T.enPapelera)
    if (f.missing_at) throw new Error(T.desaparecido(f.missing_at))
    const root = this.rootPath(f.root_id)
    if (!root) throw new Error(T.sinDisco)
    checkOrThrow(this.db, { kind: 'reemplazar', op: 'deshacer-reemplazo', rootId: f.root_id, fileId: r.fileId, src: f.rel_path, dst: null, data: null }, { rootPath: this.rootPath })
    const abs = (rel: string) => path.join(root, ...rel.split('/'))
    const curRel = f.rel_path
    if (!fs.existsSync(abs(curRel))) throw new Error(T.noEstaEn(curRel))
    if (!fs.existsSync(abs(r.oldTrashRel))) throw new Error(T.originalNoEnPapelera)
    const row = JSON.parse(r.oldRow) as Record<string, unknown>
    const oldRel = row.rel_path as string
    // ¿Se movió o renombró después? El original vuelve donde está el tema hoy, con el nombre de hoy y su formato de antes.
    const followed = curRel !== r.newRel
    const curDir = path.posix.dirname(curRel) === '.' ? '' : path.posix.dirname(curRel) + '/'
    const target = followed ? curDir + path.posix.basename(curRel, path.posix.extname(curRel)) + path.posix.extname(oldRel) : oldRel
    if (fs.existsSync(abs(target)) && target.toLowerCase() !== curRel.toLowerCase()) throw new Error(T.otroArchivo(target))
    const newTrashRel = `_PAILA/papelera/${trashBatch(`reemplazo-${id}-deshecho`)}/${curRel}`
    const d: ReplaceUndoData = { replacementId: id, fileId: r.fileId, curRel, newTrashRel, oldTrashRel: r.oldTrashRel, target, row }
    const jid = this.journal.begin({ op: 'deshacer-reemplazo', rootId: f.root_id, fileId: r.fileId, src: curRel, dst: target, data: d })
    try { moveNoClobber(abs(curRel), abs(newTrashRel)) } catch (e) { this.journal.drop(jid); throw e }
    try { moveNoClobber(abs(r.oldTrashRel), abs(target)) } catch (e) { moveNoClobber(abs(newTrashRel), abs(curRel)); this.journal.drop(jid); throw e }
    this.journal.done(jid, () => logReplaceUndo(this.db, d))
    return { rel: target, followed }
  }
}
