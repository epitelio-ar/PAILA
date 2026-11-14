// Resumen del análisis para la pantalla Análisis (consultas livianas a la base) y el detalle de un tema.
import type { AnalysisDetail, AnalysisInsights, Grade } from '@paila/shared/types'
import { soundStyle } from './analysis/effnet'
import { visible, type Db } from './db'
import { ANALYSIS_COUNT, ANALYSIS_VERSION, MISSING_PRINTS } from './queue'
import { DJ_VERSION, MISSING_QUALITY, QUALITY_VERSION } from './reanalysis'
import { MISSING_PRECISE, PRECISE_VERSION } from './precise'

/** Numera los "?" de un pedazo de consulta (para combinarlo con otros que ya usan ?1, ?2…). */
const numbered = (sql: string, ...n: number[]) => { let i = 0; return sql.replace(/\?/g, () => `?${n[i++]}`) }

/**
 * Resumen vivo del análisis para la interfaz (se pide cada 4 s). Los conteos salen de una sola pasada por los temas
 * visibles; lo demás usa los índices de la migración v18 (con 100.000 temas: ~0,2 s en vez de ~1,1 s).
 */
export function insights(db: Db): AnalysisInsights {
  const q = <T>(sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as unknown as T[]
  const one = <T>(sql: string, ...p: (string | number)[]) => q<T>(sql, ...p)[0]
  const since = new Date(Date.now() - 5 * 60_000).toISOString()
  // total: lo que se puede analizar · done: con análisis vigente · recentN: analizados en los últimos 5 minutos ·
  // prints: analizados sin huellas (lo mismo que pendingPrints) · quality: con la calidad de un motor viejo (pendingQuality)
  const c = one<{ total: number | null; done: number | null; recentN: number | null; prints: number | null; quality: number | null; precise: number | null }>(
    `SELECT SUM(f.error IS NULL) total, SUM(a.version >= ?1) done, SUM(a.analyzed_at > ?2) recentN, SUM(${numbered(MISSING_PRINTS, 1)}) prints,
       SUM(${MISSING_QUALITY.replace('?2', '?3').replace('?3)', '?4)')}) quality,
       SUM(${MISSING_PRECISE.replace('?3', '?5').replace('?2', '?4')}) precise
     FROM files f LEFT JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id WHERE f.kind != 'produccion' AND ${visible('f')}`, ANALYSIS_VERSION, since, QUALITY_VERSION, DJ_VERSION, PRECISE_VERSION)
  const total = c.total ?? 0, done = c.done ?? 0, recentN = c.recentN ?? 0
  const perMinute = Math.round((recentN / 5) * 10) / 10
  const grades: Record<string, number> = {}
  for (const r of q<{ grade: string; n: number }>("SELECT grade, COUNT(*) n FROM analysis WHERE grade IS NOT NULL GROUP BY grade")) grades[r.grade] = r.n
  const name = (r: { title: string | null; rel: string }) => r.title || r.rel.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  // CROSS JOIN: SQLite recorre primero el análisis por su índice (si no, puede elegir recorrer todos los temas y ordenar)
  const recent = q<{ id: number; title: string | null; artist: string | null; rel: string; ext: string; grade: string | null; label: string | null; bpm: number | null; camelot: string | null; flags: string | null }>(
    `SELECT f.id, f.title, f.artist, f.rel_path AS rel, f.ext, a.grade, a.is_label AS label, a.bpm, a.camelot, a.flags
     FROM analysis a CROSS JOIN files f ON f.id = a.file_id WHERE f.kind != 'produccion' AND ${visible('f')} ORDER BY a.analyzed_at DESC, a.file_id DESC LIMIT 12`)
    .map((r) => ({ id: r.id, title: name(r), artist: r.artist ?? '', ext: r.ext, grade: r.grade, label: r.label, bpm: r.bpm, camelot: r.camelot, flags: r.flags ?? '' }))
  // "flags IS NOT NULL" deja usar el índice parcial analysis_flags (sin marcas no hay nada que contar)
  const flagCount = (...flags: string[]) => one<{ n: number }>(`SELECT COUNT(*) n FROM analysis WHERE flags IS NOT NULL AND (${flags.map(() => "(',' || flags || ',') LIKE ?").join(' OR ')})`, ...flags.map((f) => `%,${f},%`)).n
  // con empate gana el tema más nuevo (el más rápido o más fuerte) o el más viejo (el más lento o más suave): siempre el mismo
  const extreme = (col: string, dir: 'ASC' | 'DESC', where = '') => {
    const r = one<{ title: string | null; rel: string; v: number }>(`SELECT f.title, f.rel_path AS rel, a.${col} AS v FROM analysis a CROSS JOIN files f ON f.id = a.file_id WHERE a.${col} IS NOT NULL AND f.kind = 'musica' ${where} ORDER BY a.${col} ${dir}, a.file_id ${dir} LIMIT 1`)
    return r ? { title: name(r), v: r.v } : null
  }
  const fast = extreme('bpm', 'DESC', "AND a.bpm < 220"), slow = extreme('bpm', 'ASC', "AND a.bpm > 50")
  const loud = extreme('lufs', 'DESC'), quiet = extreme('lufs', 'ASC', "AND a.lufs > -70")
  const missing = Math.max(0, total - done)
  return {
    done, total, perMinute, etaMinutes: perMinute > 0 && missing > 0 ? Math.round(missing / perMinute) : null, grades, recent,
    prints: c.prints ?? 0,
    quality: c.quality ?? 0,
    precise: c.precise ?? 0,
    curiosities: {
      fakeLossless: flagCount('fake_lossless', 'maybe_transcoded'), upscaled: flagCount('upscaled', 'reencoded'),
      fastest: fast && { title: fast.title, bpm: fast.v }, slowest: slow && { title: slow.title, bpm: slow.v },
      topKeys: q<{ camelot: string; n: number }>("SELECT camelot, COUNT(*) n FROM analysis WHERE camelot IS NOT NULL GROUP BY camelot ORDER BY n DESC LIMIT 3"),
      loudest: loud && { title: loud.title, lufs: loud.v }, quietest: quiet && { title: quiet.title, lufs: quiet.v },
    },
  }
}

/** Los silencios medidos de un tema (tabla `silence`, v33; core/silencepass.ts). */
function silenceOf(db: Db, id: number): { silenceStart: number | null; silenceEnd: number | null } {
  const s = db.prepare('SELECT silence_start AS a, silence_end AS b FROM silence WHERE file_id = ?').get(id) as { a: number | null; b: number | null } | undefined
  return { silenceStart: s?.a ?? null, silenceEnd: s?.b ?? null }
}

/** El estilo por el sonido, si el modelo está muy seguro (tabla `sound_style`, v36; core/stylepass.ts). */
function styleOf(db: Db, id: number): AnalysisDetail['soundStyle'] {
  const s = db.prepare('SELECT styles FROM sound_style WHERE file_id = ?').get(id) as { styles: string | null } | undefined
  try { return soundStyle(s?.styles ? JSON.parse(s.styles) : null) } catch { return null }
}

export function getAnalysis(db: Db, id: number): AnalysisDetail | null {
  const a = db.prepare('SELECT * FROM analysis WHERE file_id = ?').get(id) as Record<string, unknown> | undefined
  if (!a) return null
  const json = (v: unknown) => { try { return v ? JSON.parse(String(v)) : [] } catch { return [] } }
  return {
    grade: a.grade as Grade | null, says: a.says as string | null, isLabel: a.is_label as string | null, why: json(a.why),
    confidence: a.confidence as string | null, flags: a.flags ? String(a.flags).split(',') : [], sound: json(a.sound),
    effKbps: a.eff_kbps as number | null, cutoff: a.cutoff as number | null, cutoffDrop: a.cutoff_drop as number | null,
    lufs: a.lufs as number | null, lra: a.lra as number | null, truePeak: a.true_peak as number | null,
    clipEvents: a.clip_events as number | null, stereoCorr: a.stereo_corr as number | null, effBits: a.eff_bits as number | null,
    encoder: a.encoder as string | null, vbrMethod: a.vbr_method as string | null, lameLowpass: a.lame_lowpass as number | null,
    bpm: a.bpm as number | null, bpmSource: a.bpm_source as string | null, bpmFast: a.bpm_fast as number | null,
    musicKey: a.music_key as string | null, camelot: a.camelot as string | null, keyStrength: a.key_strength as number | null,
    energy: a.energy as number | null, danceability: a.danceability as number | null, spectrum: json(a.spectrum),
    ms: a.ms as number | null, error: a.error as string | null, analyzedAt: a.analyzed_at as string,
    ...silenceOf(db, id), soundStyle: styleOf(db, id),
  }
}
