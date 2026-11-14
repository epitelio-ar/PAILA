// Energía a tu oído (MASTERPLAN-3, punto 3): la persona marca de 1 a 10 unos temas que conoce y PAILA ajusta la energía de
// toda la Música a ese criterio (core/energia.ts). Qué temas ofrecer para marcar, guardar las marcas, calibrar y recalcular
// la columna `analysis.energy`. Solo datos de PAILA: no toca archivos.
import { transaction, visible, type Db } from './db'
import { energyFeatures, fitEnergy, energyFrom, trackEnergy, type EnergyCalibration, type EnergyMoods, type EnergyRow } from './energia'
import type { EnergyMarkTrack, EnergyMarksState, EnergyCalibrateResult } from '@paila/shared/types'

export const ENERGY_SETTING = 'energy_model'
/** Con cuántas marcas PAILA se anima a ajustar (con menos, un par de temas raros mueven todo). */
export const MIN_MARKS = 12

const COLS = `f.id, COALESCE(NULLIF(f.artist, ''), '') AS artist, COALESCE(NULLIF(f.title, ''), f.rel_path) AS title,
  a.lufs, a.lra, a.danceability, a.bpm, a.spectrum, a.energy, s.moods`
type Row = EnergyRow & { id: number; artist: string; title: string; energy: number | null; moods: string | null }
const moodsOf = (r: { moods: string | null }): EnergyMoods | null => { try { return r.moods ? JSON.parse(r.moods) : null } catch { return null } }

export function calibration(db: Db): EnergyCalibration | null {
  const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(ENERGY_SETTING) as { value: string } | undefined)?.value
  try { return v ? (JSON.parse(v) as EnergyCalibration) : null } catch { return null }
}

/** Vuelve a calcular la energía de todos los temas analizados (con el modelo de estilos donde se escuchó). Devuelve cuántos cambiaron. */
export function recomputeEnergy(db: Db, ids?: number[]): number {
  const cal = calibration(db)
  const rows = db.prepare(`SELECT ${COLS} FROM analysis a JOIN files f ON f.id = a.file_id LEFT JOIN sound_style s ON s.file_id = a.file_id
    WHERE a.lufs IS NOT NULL AND a.dj_v IS NOT NULL${ids ? ` AND a.file_id IN (${ids.map(Number).join(',') || '0'})` : ''}`).all() as unknown as Row[]
  const upd = db.prepare('UPDATE analysis SET energy = ? WHERE file_id = ?')
  let n = 0
  transaction(db, () => {
    for (const r of rows) {
      const e = trackEnergy(r, moodsOf(r), cal)
      if (e !== r.energy) { upd.run(e, r.id); n++ }
    }
  })
  return n
}

const track = (r: Row & { mark?: number | null }): EnergyMarkTrack => ({ id: r.id, artist: r.artist, title: r.title, paila: r.energy, mark: r.mark ?? null })

/**
 * Temas para marcar: de los que la persona seguro conoce (en sus playlists o traídos de Rekordbox primero), repartidos entre
 * toda la escala de energía de hoy y entre carpetas, para que las marcas cubran de lo más tranqui a lo más arriba.
 */
export function markCandidates(db: Db, n = 24): EnergyMarkTrack[] {
  const rows = db.prepare(`SELECT ${COLS}, (SELECT COUNT(*) FROM playlist_items p WHERE p.file_id = f.id) +
      (CASE WHEN EXISTS (SELECT 1 FROM dj_meta m WHERE m.file_id = f.id) THEN 2 ELSE 0 END) AS known,
      substr(f.rel_path, 1, instr(f.rel_path || '/', '/') - 1) AS top
    FROM files f JOIN analysis a ON a.file_id = f.id LEFT JOIN sound_style s ON s.file_id = f.id
    WHERE ${visible('f')} AND f.kind = 'musica' AND a.energy IS NOT NULL AND NOT EXISTS (SELECT 1 FROM energy_marks e WHERE e.file_id = f.id)
    ORDER BY known DESC, f.id`).all() as unknown as (Row & { known: number; top: string })[]
  // por nivel de energía, los más conocidos primero; de a uno por nivel y sin repetir carpeta hasta que no quede otra
  const byLevel = new Map<number, typeof rows>()
  for (const r of rows) byLevel.set(r.energy!, [...(byLevel.get(r.energy!) ?? []), r])
  const levels = [...byLevel.keys()].sort((a, b) => a - b)
  const out: typeof rows = [], tops = new Map<string, number>()
  for (let round = 0; out.length < n && round < 50; round++) {
    let added = false
    for (const l of levels) {
      if (out.length >= n) break
      const pool = byLevel.get(l)!
      const i = pool.findIndex((r) => (tops.get(r.top) ?? 0) <= round)
      if (i < 0) continue
      const [r] = pool.splice(i, 1)
      tops.set(r.top, (tops.get(r.top) ?? 0) + 1)
      out.push(r); added = true
    }
    if (!added) break
  }
  return out.sort((a, b) => a.energy! - b.energy! || a.id - b.id).map((r) => track(r))
}

/** Marca (1–10) o desmarca (null) la energía de un tema. */
export function setMark(db: Db, fileId: number, value: number | null) {
  if (value == null) db.prepare('DELETE FROM energy_marks WHERE file_id = ?').run(fileId)
  else db.prepare('INSERT OR REPLACE INTO energy_marks (file_id, value, marked_at) VALUES (?, ?, ?)').run(fileId, Math.max(1, Math.min(10, Math.round(value))), new Date().toISOString())
}

function marked(db: Db): (Row & { mark: number })[] {
  return db.prepare(`SELECT ${COLS}, e.value AS mark FROM energy_marks e JOIN files f ON f.id = e.file_id JOIN analysis a ON a.file_id = f.id
    LEFT JOIN sound_style s ON s.file_id = f.id WHERE a.lufs IS NOT NULL ORDER BY e.marked_at DESC`).all() as unknown as (Row & { mark: number })[]
}

export function marksState(db: Db): EnergyMarksState {
  const cal = calibration(db)
  return { marks: marked(db).map(track), min: MIN_MARKS, calibratedWith: cal?.marks ?? 0, calibratedAt: cal?.at ?? null }
}

const within1 = (pred: number[], truth: number[]) => (truth.length ? Math.round((100 * pred.filter((p, i) => Math.abs(p - truth[i]) <= 1).length) / truth.length) : 0)

/**
 * Ajusta la energía a las marcas: un modelo con lo que oyó el de estilos (si la mayoría de los marcados lo tiene) y otro con
 * lo de la base, y recalcula todos. Cuánto acierta se mide dejando cada marca afuera del ajuste, para no engañarse.
 */
export function calibrate(db: Db): EnergyCalibrateResult {
  const ms = marked(db)
  if (ms.length < MIN_MARKS) return { ok: false, marks: ms.length, before: 0, after: 0, changed: 0 }
  const truth = ms.map((m) => m.mark)
  const before = within1(ms.map((m) => m.energy ?? 5), truth)
  const loo = (feats: number[][], t: number[]) => feats.map((_, i) => energyFrom(feats[i], fitEnergy(feats.filter((__, j) => j !== i), t.filter((__, j) => j !== i))))
  const cal: EnergyCalibration = { marks: ms.length, at: new Date().toISOString() }
  const base = ms.map((m) => energyFeatures(m))
  cal.base = fitEnergy(base, truth)
  const withSound = ms.filter((m) => moodsOf(m))
  let pred = loo(base, truth)
  if (withSound.length >= MIN_MARKS) {
    const sf = withSound.map((m) => energyFeatures(m, moodsOf(m)!)), st = withSound.map((m) => m.mark)
    cal.sound = fitEnergy(sf, st)
    const ls = loo(sf, st), byId = new Map(withSound.map((m, i) => [m.id, ls[i]]))
    pred = ms.map((m, i) => byId.get(m.id) ?? pred[i])
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(ENERGY_SETTING, JSON.stringify(cal))
  return { ok: true, marks: ms.length, before, after: within1(pred, truth), changed: recomputeEnergy(db) }
}

/** Vuelve a la energía de fábrica (borra lo calibrado; las marcas quedan). */
export function resetCalibration(db: Db): number {
  db.prepare('DELETE FROM settings WHERE key = ?').run(ENERGY_SETTING)
  return recomputeEnergy(db)
}
