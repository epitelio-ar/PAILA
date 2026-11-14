// Pasada precisa en segundo plano (MASTERPLAN-2 6.2, "Dos pasadas"): después de la rápida, vuelve a escuchar el BPM y el
// tono de cada tema de Música con otros métodos y, si hay internet, le pregunta a Deezer. No cambia valores: marca cuánto
// se confía en ellos (confirmado / dudoso). Prioridad baja, respeta la intensidad y se puede pausar. Nunca escribe tags.
import { parseKey, keyMatch } from './analysis/bench'
import type { AnalysisRunner } from './analysis/pool'
import type { Slots } from './analysis/slots'
import { transaction, visible, type Db } from './db'
import { toAbs } from './files'
import type { Library } from './library'
import { deezerBpm, deezerVerdict } from './online/deezerbpm'
import type { Deezer } from './online/sources'
import type { OnlineCache } from './online/http'
import { ANALYSIS_COUNT, ANALYSIS_VERSION, each, stillThere } from './queue'
import { ReadGuard } from './readguard'
import { DJ_VERSION } from './reanalysis'
import { textos } from '@paila/shared/idioma'

// La fase que se ve mientras corre esta pasada.
const T = textos({ precisa: { es: 'Segunda pasada: confirmando el ritmo y el tono de cada tema…', en: 'Second pass: confirming the tempo and key of each track…' } })

/** Versión de la pasada precisa. Subirla la vuelve a correr en toda la Música. */
export const PRECISE_VERSION = 1

/** Las marcas que pone la pasada precisa (se borran cuando se vuelve a calcular el BPM o el tono). */
export const PRECISE_FLAGS = ['dj_precise', 'bpm_ok', 'key_ok', 'key_doubtful']

/** Lo que hace falta para la segunda opinión de Deezer (solo si el usuario lo tiene prendido). */
export interface SecondOpinion { dz: Deezer; cache: OnlineCache }

/**
 * Temas de Música con BPM y tono de la rápida vigente que todavía no tienen la pasada precisa. Parámetros: ?1 versión del
 * análisis, ?2 de BPM y tono, ?3 de la pasada precisa. Lo usa también core/insights.ts.
 */
export const MISSING_PRECISE = `f.kind = 'musica' AND f.error IS NULL AND a.error IS NULL AND a.version >= ?1 AND a.bpm IS NOT NULL
  AND COALESCE(a.dj_v, 1) >= ?2 AND COALESCE(a.precise_v, 0) < ?3 AND a.src_size = f.size AND a.src_mtime = f.mtime`

export function pendingPrecise(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_PRECISE}`)
    .get(ANALYSIS_VERSION, DJ_VERSION, PRECISE_VERSION) as { n: number }).n
}

interface Row { id: number; root_id: number; rel_path: string; duration: number | null; artist: string | null; title: string | null; bpm: number; base: number; camelot: string | null; flags: string | null }

/**
 * Cuenta votos. BPM: los dos métodos de la rápida (si coincidieron), el tempo de los golpes y Deezer; con 3 o más queda
 * "confirmado". Tono: con 3 de los 4 perfiles de acuerdo, "confirmado"; si ninguno de los otros 3 coincide, "dudoso".
 */
export function preciseFlags(r: Pick<Row, 'base' | 'camelot' | 'flags'>, beatsBpm: number | null, keys: (string | null)[], deezer: number | null): string[] {
  const old = (r.flags ?? '').split(',').filter((f) => f && !PRECISE_FLAGS.includes(f))
  let bpmVotes = old.includes('bpm_doubtful') ? 1 : 2
  if (beatsBpm && Math.abs(Math.log(beatsBpm / r.base)) < Math.log(1.02)) bpmVotes++
  if (deezerVerdict(r.base, deezer) === 'confirma') bpmVotes++
  const mine = parseKey(r.camelot)
  const agree = mine ? keys.filter((k) => { const c = parseKey(k); return c && keyMatch(c, mine) === 'exacto' }).length : 0
  return [...old, 'dj_precise', ...(bpmVotes >= 3 ? ['bpm_ok'] : []), ...(mine && agree >= 2 ? ['key_ok'] : []), ...(mine && keys.length && agree === 0 ? ['key_doubtful'] : [])]
}

export async function precisePass(lib: Library, run: AnalysisRunner, ffmpeg: string, bases: Map<number, string>, slots: Slots, opinion: SecondOpinion | null): Promise<number> {
  if (!run.precise) return 0
  const rows = (lib.db.prepare(
    `SELECT f.id, f.root_id, f.rel_path, f.duration, f.artist, f.title, a.bpm, COALESCE(a.bpm_base, a.bpm) AS base, a.camelot, a.flags
     FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND ${MISSING_PRECISE} ORDER BY f.id`,
  ).all(ANALYSIS_VERSION, DJ_VERSION, PRECISE_VERSION) as unknown as Row[]).filter((r) => bases.has(r.root_id))
  if (!rows.length) return 0
  Object.assign(lib.status, { phase: T.precisa, toProbe: rows.length, probed: 0 })
  lib.emit()
  const upd = lib.db.prepare('UPDATE analysis SET flags = ?, precise_v = ? WHERE file_id = ?')
  let pending: unknown[][] = []
  const flush = () => { const b = pending; pending = []; if (b.length) transaction(lib.db, () => { for (const p of b) upd.run(...(p as never[])) }) }
  let online = opinion
  const guard = new ReadGuard(lib, bases, lib.diskPollMs)
  let flushedAt = Date.now()
  await each(lib, rows, slots, async (r) => {
    if (!stillThere(lib, r)) return
    const file = toAbs(bases.get(r.root_id)!, r.rel_path)
    lib.status.current = file
    try {
      const v = await run.precise!({ ffmpeg, file, duration: r.duration })
      const was = await guard.ok(r.id, r.root_id)
      if (was !== 'ok') return was === 'retry' ? 'retry' : false
      let dz: number | null = null
      if (online && r.artist && r.title) {
        // sin internet (o Deezer caído): se sigue sin segunda opinión, sin reintentar en cada tema
        try { dz = (await deezerBpm(online.dz, r.artist, r.title, r.duration, online.cache))?.bpm ?? null } catch { online = null }
      }
      pending.push([preciseFlags(r, v.beatsBpm, v.keys, dz).join(','), PRECISE_VERSION, r.id])
    } catch {
      // Disco o archivo que no está: no se marca nada (antes se marcaba "para no reintentar" y un SSD desenchufado dejó
      // 946 temas como hechos sin leerlos, 21/10/2026). Solo un error del archivo, después de varios intentos.
      const what = await guard.failed(r.id, r.root_id, file)
      if (what === 'stop') return false
      if (what === 'retry') return 'retry'
      if (what === 'mark') { lib.status.errors++; pending.push([r.flags, PRECISE_VERSION, r.id]) } // se intentó: no reintentar en cada arranque
    }
    // de a 50, o cada 5 s: al cerrar PAILA se pierde muy poco
    if (pending.length >= 50 || Date.now() - flushedAt > 5000) { flush(); flushedAt = Date.now() }
    lib.status.probed++
    lib.emit(false)
  })
  flush()
  guard.finish()
  return lib.status.probed
}
