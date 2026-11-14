// Pasada liviana de silencios (masterplan 3, punto 3): a los temas que se analizaron antes de que PAILA midiera los silencios
// les lee solo el principio y el final (core/analysis/silence.ts). Los temas nuevos ya los traen del análisis completo
// (`saveSilence`, desde core/queue.ts). No toca archivos: solo anota cuántos segundos (tabla `silence`) y las marcas `silence_start`/`silence_end`.
import type { AnalysisRunner } from './analysis/pool'
import type { Slots } from './analysis/slots'
import { SILENCE_FLAGS, SILENCE_VERSION, silenceFlags, type SilenceResult } from './analysis/silence'
import { transaction, visible, type Db } from './db'
import { toAbs } from './files'
import type { Library } from './library'
import { ReadGuard } from './readguard'
import { ANALYSIS_COUNT, ANALYSIS_VERSION, each, stillThere } from './queue'
import { textos } from '@paila/shared/idioma'

// La fase que se ve mientras corre esta pasada.
const T = textos({ silencios: { es: 'Pasada rápida: silencios largos al principio o al final de cada tema…', en: 'Quick pass: long silences at the start or end of each track…' } })

/**
 * Temas con análisis vigente que todavía no tienen los silencios medidos (o con una medición vieja). Los samples no se
 * decodifican nunca. Parámetros: ?1 versión del análisis, ?2 de los silencios. Lo usa también core/insights.ts.
 */
export const MISSING_SILENCE = `f.kind != 'produccion' AND f.error IS NULL AND a.error IS NULL AND a.grade IS NOT NULL AND a.version >= ?1
  AND a.src_size = f.size AND a.src_mtime = f.mtime AND NOT EXISTS (SELECT 1 FROM silence s WHERE s.file_id = f.id AND s.silence_v >= ?2)`

export function pendingSilence(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_SILENCE}`)
    .get(ANALYSIS_VERSION, SILENCE_VERSION) as { n: number }).n
}

/**
 * Guarda los silencios de un tema en la tabla `silence` (v33; null: no se pudo medir, queda anotada la versión para no reintentar).
 * Lo usan esta pasada y el análisis completo (core/queue.ts, core/reanalysis.ts), que los mide en la misma lectura.
 */
export function saveSilence(db: Db, fileId: number, s: SilenceResult | null | undefined) {
  db.prepare('INSERT OR REPLACE INTO silence (file_id, silence_start, silence_end, silence_v) VALUES (?, ?, ?, ?)')
    .run(fileId, s ? s.start : null, s && !s.silent ? s.end : null, SILENCE_VERSION)
}

/** Las marcas del tema con las de silencio de ahora (las demás quedan como estaban). */
export function withSilenceFlags(flags: string | null, s: SilenceResult | null | undefined): string | null {
  const keep = (flags ?? '').split(',').filter((f) => f && !SILENCE_FLAGS.includes(f))
  return [...keep, ...silenceFlags(s ?? null)].join(',') || null
}

export async function silencePass(lib: Library, run: AnalysisRunner, ffmpeg: string, bases: Map<number, string>, slots: Slots): Promise<number> {
  if (!run.silence) return 0
  const rows = (lib.db.prepare(
    `SELECT f.id, f.root_id, f.rel_path, f.duration FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_SILENCE}
     ORDER BY CASE f.kind WHEN 'musica' THEN 0 ELSE 1 END, f.id`,
  ).all(ANALYSIS_VERSION, SILENCE_VERSION) as { id: number; root_id: number; rel_path: string; duration: number | null }[]).filter((r) => bases.has(r.root_id))
  if (!rows.length) return 0
  Object.assign(lib.status, { phase: T.silencios, toProbe: rows.length, probed: 0 })
  lib.emit()
  // las marcas se leen al guardar (no al armar la lista): otra cosa pudo cambiarlas mientras tanto
  const flagsOf = lib.db.prepare('SELECT flags FROM analysis WHERE file_id = ?')
  const upd = lib.db.prepare('UPDATE analysis SET flags = ? WHERE file_id = ?')
  let pending: { id: number; s: SilenceResult | null }[] = []
  const flush = () => {
    const b = pending
    pending = []
    if (b.length) transaction(lib.db, () => {
      for (const { id, s } of b) {
        saveSilence(lib.db, id, s)
        const old = (flagsOf.get(id) as { flags: string | null } | undefined)?.flags ?? null
        if (s) upd.run(withSilenceFlags(old, s), id)
      }
    })
  }
  const guard = new ReadGuard(lib, bases, lib.diskPollMs)
  let flushedAt = Date.now()
  await each(lib, rows, slots, async (r) => {
    if (!stillThere(lib, r)) return
    const file = toAbs(bases.get(r.root_id)!, r.rel_path)
    lib.status.current = file
    try {
      const s = await run.silence!({ ffmpeg, file, duration: r.duration })
      const was = await guard.ok(r.id, r.root_id)
      if (was !== 'ok') return was === 'retry' ? 'retry' : false
      pending.push({ id: r.id, s })
    } catch {
      // disco o archivo que no está: no se marca (core/readguard.ts); un error del archivo, después de varios intentos
      const what = await guard.failed(r.id, r.root_id, file)
      if (what === 'stop') return false
      if (what === 'retry') return 'retry'
      if (what === 'mark') { lib.status.errors++; pending.push({ id: r.id, s: null }) } // se intentó: no reintentar en cada arranque
    }
    if (pending.length >= 50 || Date.now() - flushedAt > 5000) { flush(); flushedAt = Date.now() }
    lib.status.probed++
    lib.emit(false)
  })
  flush()
  guard.finish()
  return lib.status.probed
}
