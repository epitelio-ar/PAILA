// Pasadas que rehacen una parte del análisis cuando mejora el motor, sin volver a analizar todo: la nota de calidad
// (Fase E: corte suave, 32 kHz, escalón de 16 kHz y huecos), el BPM y el tono (los que faltan o los de un motor viejo)
// y el BPM puesto en el rango de cada género.
import path from 'node:path'
import type { AnalysisRunner } from './analysis/pool'
import type { Slots } from './analysis/slots'
import { gradeEnLosDos } from './analysis/grade'
import { guardarOtro } from './textosidioma'
import { cluesFor } from './analysis/clues'
import { energyOf } from './analysis/dj'
import type { RawAnalysis } from './analysis/analyze'
import { PRECISE_FLAGS } from './precise'
import { bpmForStyle, parseStyles, styleOf, type BpmStyle } from './analysis/bpmrange'
import { transaction, visible, type Db } from './db'
import { toAbs } from './files'
import type { Library } from './library'
import { ReadGuard } from './readguard'
import { ANALYSIS_COUNT, ANALYSIS_VERSION, each, isLossless, qualityCols, stillThere, type PendingRow } from './queue'
import { saveSilence } from './silencepass'
import { textos } from '@paila/shared/idioma'

// La fase que se ve mientras corre esta pasada.
const T = textos({ nuevo: { es: 'Revisando con el motor nuevo: calidad (vinilos, 32 kHz, escalones de MP3), y BPM y tono de los que no tenían…', en: 'Checking with the new engine: quality (vinyl, 32 kHz, MP3 steps), and BPM and key for the tracks that had none…' } })

/**
 * Versión del motor de calidad (la nota A+…F). Subirla vuelve a medir la calidad: 2 = Fase E; 3 = decide sola con las pistas
 * (core/analysis/clues.ts, 22/10/2026). La v3 solo cambia los archivos sin pérdida y los MP3 con corte suave: la migración
 * v30 deja al día a los demás sin volver a leerlos. 4 = restos arriba del corte (comparación con Fakin' The Funk, 23/10/2026):
 * la migración v38 deja al día a los con pérdida sin un escalón en el espectro guardado. Trae también los tres casos del corte de
 * golpe en 20 kHz (cut20_trusted, cut20_mp3like, decisión del 23/10/2026). 5 = "Dañado" cuenta tropiezos y no palabras de error,
 * ni las de los tags, y los cortes se miden con dónde están (repaso de criterios del 24/10/2026): la v44 (0.5.4) relee solo
 * los "Dañado" y la v46 (0.5.5) toda la Música, con los que decían "Dañado" primero. Si se corta retoma sola: cada tema queda
 * en 5 recién cuando se guarda lo que se leyó.
 */
export const QUALITY_VERSION = 5
/** Versión del motor de BPM y tono. Subirla los vuelve a calcular en Música (y completa los que faltan). */
export const DJ_VERSION = 2 // 2 = Fase E: BPM con dos métodos combinados (sin segunda pasada) y tono con el perfil edmm

// Temas de Música sin BPM ni tono (no salieron en el primer análisis), o calculados con un motor viejo. Sin dj_v: si
// tiene BPM es de la versión 1; si no, de ninguna. Los sets largos (más de 20 min) no llevan BPM. Parámetro: ?3.
const NEEDS_DJ = `(f.kind = 'musica' AND COALESCE(f.duration, 0) <= 1200 AND COALESCE(a.dj_v, CASE WHEN a.bpm IS NULL THEN 0 ELSE 1 END) < ?3)`

/**
 * Temas con el análisis vigente a los que les falta algo del motor nuevo: la calidad de un motor viejo, o el BPM y el
 * tono. Los samples no se decodifican nunca. Parámetros: ?1 versión del análisis, ?2 de la calidad, ?3 de BPM y tono.
 * Lo usa también core/insights.ts.
 */
export const MISSING_QUALITY = `f.error IS NULL AND a.error IS NULL AND a.grade IS NOT NULL AND a.version >= ?1
  AND a.src_size = f.size AND a.src_mtime = f.mtime AND f.kind != 'produccion' AND (COALESCE(a.quality_v, 1) < ?2 OR ${NEEDS_DJ})`

/** Cuántos temas esperan que se les vuelva a medir la calidad, o el BPM y el tono, con el motor nuevo. */
export function pendingQuality(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_QUALITY}`)
    .get(ANALYSIS_VERSION, QUALITY_VERSION, DJ_VERSION) as { n: number }).n
}

/**
 * Vuelve a medir lo que cambió del motor: la calidad (una lectura sin huellas, más liviana que analizar de cero) y, en
 * Música, el BPM y el tono si faltan o son de un motor viejo. Conserva las huellas, el BPM
 * de los que no lo necesitan y la marca de BPM dudoso.
 */
export async function qualityPass(lib: Library, run: AnalysisRunner, ffmpeg: string, bases: Map<number, string>, slots: Slots): Promise<number> {
  const rows = (lib.db.prepare(
    `SELECT f.id, f.root_id, f.rel_path, f.kind, f.ext, f.codec, f.genre, f.sample_rate, f.bits, f.channels, f.kbps, f.duration, f.size, f.mtime, a.flags,
       ${NEEDS_DJ} AS dj
     FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_QUALITY}
     ORDER BY dj DESC, CASE WHEN (',' || COALESCE(a.flags, '') || ',') LIKE '%,damaged,%' THEN 0 ELSE 1 END,
       CASE WHEN f.codec IN ('flac', 'alac') OR f.codec LIKE 'pcm_%' THEN 0 ELSE 1 END, f.id`,
  ).all(ANALYSIS_VERSION, QUALITY_VERSION, DJ_VERSION) as unknown as (PendingRow & { flags: string | null; dj: number })[]).filter((r) => bases.has(r.root_id))
  if (!rows.length) return 0
  Object.assign(lib.status, { phase: T.nuevo, toProbe: rows.length, probed: 0 })
  const styles = bpmStyles(lib.db)
  lib.emit()
  let pending: (() => void)[] = []
  const flush = () => { const b = pending; pending = []; if (b.length) transaction(lib.db, () => { for (const save of b) save() }) }
  const mark = lib.db.prepare('UPDATE analysis SET quality_v = ?, dj_v = ? WHERE file_id = ?')
  const guard = new ReadGuard(lib, bases, lib.diskPollMs)
  let flushedAt = Date.now()
  await each(lib, rows, slots, async (r) => {
    if (!stillThere(lib, r)) return
    const file = toAbs(bases.get(r.root_id)!, r.rel_path)
    lib.status.current = file
    const info = { codec: r.codec, ext: r.ext, lossless: isLossless(r.codec, r.ext), kbps: r.kbps, sampleRate: r.sample_rate, bits: r.bits, channels: r.channels }
    try {
      const raw = await run.full({ ffmpeg, file, ...info, duration: r.duration, withDj: !!r.dj, withPrints: false })
      const was = await guard.ok(r.id, r.root_id)
      if (was !== 'ok') return was === 'retry' ? 'retry' : false
      const v = gradeEnLosDos(info, raw, cluesFor(lib.db, r.id)), cols = qualityCols(v, raw)
      if (r.dj) Object.assign(cols, djCols(raw, r, styles))
      // las marcas de BPM y tono no son de calidad: se conservan (salvo que el BPM y el tono se vuelvan a calcular)
      const keep = r.dj ? [] : (r.flags ?? '').split(',').filter((f) => f === 'bpm_doubtful' || PRECISE_FLAGS.includes(f))
      if (keep.length) cols.flags = [cols.flags, ...keep].filter(Boolean).join(',')
      const keys = Object.keys(cols)
      pending.push(() => {
        lib.db.prepare(`UPDATE analysis SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE file_id = ?`).run(...keys.map((k) => cols[k]), r.id)
        guardarOtro(lib.db, r.id, v.otro) // la nota en el otro idioma (core/textosidioma.ts)
        if (raw.silence) saveSilence(lib.db, r.id, raw.silence)
      })
    } catch {
      // disco o archivo que no está: no se marca (core/readguard.ts); un error del archivo, después de varios intentos
      const what = await guard.failed(r.id, r.root_id, file)
      if (what === 'stop') return false
      if (what === 'retry') return 'retry'
      if (what === 'mark') { lib.status.errors++; pending.push(() => mark.run(QUALITY_VERSION, DJ_VERSION, r.id)) } // se intentó: no reintentar en cada arranque
    }
    if (pending.length >= 50 || Date.now() - flushedAt > 5000) { flush(); flushedAt = Date.now() }
    lib.status.probed++
    lib.emit(false)
  })
  flush()
  guard.finish()
  return lib.status.probed
}

/** Las columnas de BPM y tono de un análisis (el BPM en el rango del género). `bpm_fast`: lo que dio el otro método si no coinciden. */
export function djCols(raw: RawAnalysis, r: { genre: string | null; rel_path: string }, styles: BpmStyle[]): Record<string, string | number | null> {
  const bpm = raw.dj?.bpm ?? null
  return {
    bpm: bpm ? styledBpm(bpm, r.genre, r.rel_path, styles) : null, bpm_base: bpm, bpm_source: bpm ? 'mixto' : null, bpm_fast: raw.dj?.bpmOther ?? null,
    music_key: raw.dj?.key ?? null, camelot: raw.dj?.camelot ?? null, key_strength: raw.dj?.keyStrength ?? null,
    energy: energyOf(raw.lufs, raw.dj?.danceability ?? null, bpm), danceability: raw.dj?.danceability ?? null, dj_v: DJ_VERSION,
    precise_v: null, // BPM y tono nuevos: la pasada precisa los vuelve a mirar
  }
}

/** Rangos de BPM por género que eligió el usuario (o los de fábrica). */
export const BPM_STYLES_SETTING = 'bpm_styles'
export function bpmStyles(db: Db): BpmStyle[] {
  return parseStyles((db.prepare('SELECT value FROM settings WHERE key = ?').get(BPM_STYLES_SETTING) as { value: string } | undefined)?.value)
}

/** El BPM de un tema en el rango de su género (tag, o si no hay, las carpetas donde está). */
export function styledBpm(base: number, genre: string | null, relPath: string, styles: BpmStyle[]): number {
  const dir = path.posix.dirname(relPath.replaceAll('\\', '/'))
  return bpmForStyle(base, styleOf(genre, dir === '.' ? null : dir, styles))
}

/**
 * Vuelve a poner el BPM de todos los temas en el rango de su género (después de cambiar los rangos). No decodifica nada:
 * parte del BPM en el rango general (`bpm_base`). Devuelve cuántos temas cambiaron.
 */
export function applyBpmStyles(db: Db, styles: BpmStyle[] = bpmStyles(db)): number {
  const rows = db.prepare(`SELECT a.file_id AS id, f.rel_path AS rel, f.genre, a.bpm, COALESCE(a.bpm_base, a.bpm) AS base FROM analysis a JOIN files f ON f.id = a.file_id
    WHERE a.bpm IS NOT NULL AND COALESCE(a.bpm_source, '') != 'nombre'`).all() as { id: number; rel: string; genre: string | null; bpm: number; base: number }[]
  const upd = db.prepare('UPDATE analysis SET bpm = ?, bpm_base = ? WHERE file_id = ?')
  let changed = 0
  transaction(db, () => {
    for (const r of rows) {
      const bpm = styledBpm(r.base, r.genre, r.rel, styles)
      if (bpm !== r.bpm) changed++
      upd.run(bpm, r.base, r.id)
    }
  })
  return changed
}
