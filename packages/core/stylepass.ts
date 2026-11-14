// Pasada de estilo por el sonido (MASTERPLAN-3, punto 3): si se bajó el modelo de estilos (core/analysis/effnetrun.ts), a lo
// ya analizado de la Música le escucha 4 pedazos de 20 s y guarda los estilos más probables y lo que oye para la energía
// (tabla `sound_style`), y recalcula su energía (core/energiamarcas.ts). No toca archivos: el género del tag se cambia solo
// si la persona lo pide desde la ficha (pasa por Cambios pendientes).
import type { AnalysisRunner } from './analysis/pool'
import type { Slots } from './analysis/slots'
import { effnetMissing, type StyleResult } from './analysis/effnetrun'
import { transaction, visible, type Db } from './db'
import { toAbs } from './files'
import type { Library } from './library'
import { ReadGuard } from './readguard'
import { ANALYSIS_VERSION, each, stillThere } from './queue'
import { recomputeEnergy } from './energiamarcas'
import { textos } from '@paila/shared/idioma'

// La fase que se ve mientras corre esta pasada.
const T = textos({ estilo: { es: 'Escuchando el estilo de cada tema (y su energía)…', en: 'Listening to the style of each track (and its energy)…' } })

/** Versión de la escucha: si cambia cómo se escucha, se vuelve a escuchar todo. */
export const STYLE_VERSION = 1

/** Temas de la Música con análisis vigente que el modelo de estilos todavía no escuchó (?1 versión del análisis, ?2 de la escucha). */
export const MISSING_STYLE = `f.kind IN ('musica', 'revisar') AND f.error IS NULL AND a.error IS NULL AND a.grade IS NOT NULL AND a.version >= ?1
  AND a.src_size = f.size AND a.src_mtime = f.mtime AND COALESCE(f.duration, 0) BETWEEN 30 AND 1200
  AND NOT EXISTS (SELECT 1 FROM sound_style s WHERE s.file_id = f.id AND s.style_v >= ?2)`

export function pendingStyle(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_STYLE}`)
    .get(ANALYSIS_VERSION, STYLE_VERSION) as { n: number }).n
}

export function heardStyle(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM sound_style WHERE styles IS NOT NULL').get() as { n: number }).n
}

/** Guarda lo que oyó (null: no se pudo escuchar; queda anotada la versión para no reintentar en cada arranque). */
export function saveStyle(db: Db, fileId: number, r: StyleResult | null) {
  db.prepare('INSERT OR REPLACE INTO sound_style (file_id, styles, moods, style_v, made_at) VALUES (?, ?, ?, ?, ?)')
    .run(fileId, r ? JSON.stringify(r.styles) : null, r ? JSON.stringify(r.moods) : null, STYLE_VERSION, new Date().toISOString())
}

/** Dónde está el modelo: `dir` = la carpeta discogs-effnet; `ortDir` = la de modelos de Beat This! (trae onnxruntime-web). */
export interface StyleModels { dir: string; ortDir: string }

export async function stylePass(lib: Library, run: AnalysisRunner, ffmpeg: string, bases: Map<number, string>, slots: Slots, models: StyleModels | null): Promise<number> {
  if (!run.style || !models || effnetMissing(models.dir, models.ortDir)) return 0
  const rows = (lib.db.prepare(
    `SELECT f.id, f.root_id, f.rel_path, f.duration FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_STYLE}
     ORDER BY CASE f.kind WHEN 'musica' THEN 0 ELSE 1 END, f.id`,
  ).all(ANALYSIS_VERSION, STYLE_VERSION) as { id: number; root_id: number; rel_path: string; duration: number | null }[]).filter((r) => bases.has(r.root_id))
  if (!rows.length) return 0
  Object.assign(lib.status, { phase: T.estilo, toProbe: rows.length, probed: 0 })
  lib.emit()
  let pending: { id: number; r: StyleResult | null }[] = []
  const flush = () => {
    const b = pending
    pending = []
    if (b.length) {
      transaction(lib.db, () => { for (const { id, r } of b) saveStyle(lib.db, id, r) })
      recomputeEnergy(lib.db, b.filter((x) => x.r).map((x) => x.id))
    }
  }
  const guard = new ReadGuard(lib, bases, lib.diskPollMs)
  let flushedAt = Date.now()
  // si el modelo no carga (archivo roto), fallan todos: se corta sin marcar nada en vez de dar por escuchada la Música entera
  let streak = 0
  await each(lib, rows, slots, async (r) => {
    if (!stillThere(lib, r)) return
    const file = toAbs(bases.get(r.root_id)!, r.rel_path)
    lib.status.current = file
    try {
      const s = await run.style!({ ffmpeg, file, duration: r.duration, ...models })
      const was = await guard.ok(r.id, r.root_id)
      if (was !== 'ok') return was === 'retry' ? 'retry' : false
      pending.push({ id: r.id, r: s })
      streak = 0
    } catch {
      if (++streak >= 5) return false
      const what = await guard.failed(r.id, r.root_id, file)
      if (what === 'stop') return false
      if (what === 'retry') return 'retry'
      if (what === 'mark') { lib.status.errors++; pending.push({ id: r.id, r: null }) }
    }
    if (pending.length >= 50 || Date.now() - flushedAt > 5000) { flush(); flushedAt = Date.now() }
    lib.status.probed++
    lib.emit(false)
  })
  flush()
  guard.finish()
  return lib.status.probed
}
