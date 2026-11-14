// "Grilla y cues" (Fase F): calcula la grilla y los cues sugeridos de los temas elegidos (una playlist, o la Música entera
// después de avisar cuánto tarda), de a uno, con pausa y cancelar. Solo escribe en la base: los archivos no se tocan.
import fs from 'node:fs'
import path from 'node:path'
import { styleOf } from './analysis/bpmrange'
import { visible, type Db } from './db'
import type { DjData } from './djdata'
import type { GridAnalysis } from './analysis/gridscan'
import type { GridMethod, GridPlan } from '@paila/shared/types'

/**
 * Cuánto tarda, medido en una notebook de uso diario (docs/archivo/pruebas/2026-10-21-rekordbox-pro.md y 2026-10-22-silencios-y-grillas.md):
 * un fijo por tema (el modelo en 3 pedazos) más lo que lleva leer el audio y el resto, por minuto de música. `wholePerMinute`:
 * lo que suma, por minuto, un tema que se escucha entero (con la placa de video: el tempo se mueve o el 1 se corre).
 */
export const COST: Record<GridPlan['engine'], { perTrack: number; perMinute: number; wholePerMinute: number }> = {
  gpu: { perTrack: 3.2, perMinute: 1.1, wholePerMinute: 3.5 }, cpu: { perTrack: 27, perMinute: 1.2, wholePerMinute: 0 }, degara: { perTrack: 1, perMinute: 2, wholePerMinute: 0 },
}
/**
 * Qué parte de los temas se escucha entera: lo electrónico y lo urbano se produce con click y casi nunca; el rock, lo tocado
 * en vivo y lo demás, muchas veces. Medido con los 40 temas de "Prueba grillas" (22/10): 26 de 35 y 1 de 5. Con la PC libre,
 * esos 40 tardaron 718 s: la cuenta de antes daba 393 s y esta, 716 s. Con el procesador nunca se escucha entero.
 */
export const WHOLE_SHARE = { pista: 0.2, resto: 0.7 }
const PISTA = new Set(['House, techno y electrónica de pista', 'Drum & bass y jungle', 'Dubstep', 'Reggaetón, dembow y RKT'])
/** Si es de pista (producido con click) según su género o sus carpetas. */
export const isPista = (genre: string | null, relPath: string) => {
  const dir = path.posix.dirname(relPath.replaceAll('\\', '/'))
  return PISTA.has(styleOf(genre, dir === '.' ? null : dir)?.name ?? '')
}
/** Segundos de un tema de `minutes` minutos, contando lo que suma si se escucha entero (con la probabilidad de su estilo). */
export const trackSeconds = (engine: GridPlan['engine'], minutes: number, pista: boolean) =>
  COST[engine].perTrack + minutes * (COST[engine].perMinute + (pista ? WHOLE_SHARE.pista : WHOLE_SHARE.resto) * COST[engine].wholePerMinute)
/** Para un tema típico de 5 minutos que no es de pista (lo que se muestra antes de elegir). */
export const SECONDS_PER_TRACK: Record<GridPlan['engine'], number> = { gpu: Math.round(trackSeconds('gpu', 5, false)), cpu: Math.round(trackSeconds('cpu', 5, false)), degara: Math.round(trackSeconds('degara', 5, false)) }

export const methodOf = (engine: GridPlan['engine']): GridMethod => (engine === 'degara' ? 'degara' : 'beatthis')

/**
 * Desde cuántos minutos un tema va al final de la pasada, de más corto a más largo: un mix de 77 minutos tarda lo que cien
 * temas (y como era el primero de la cola, en el punto 1 real del 24/10 parecía que la grilla no avanzaba).
 */
export const LONG_MINUTES = 20

const PASABLES = `${visible('f')} AND f.error IS NULL AND COALESCE(f.duration, 0) >= 20`

/**
 * Los temas que se pueden pasar (Música, Revisar y Proyectos; sin desaparecidos, en la papelera ni con error). Los Sets (mixes
 * enteros) quedan afuera de la pasada de toda la Música (pedido del autor del 24/10: un mix de una hora tarda lo que cien temas
 * y no se pincha encima de otro); en una playlist elegida a mano, sí entran.
 */
export function gridCandidates(db: Db, ids: number[] | null): number[] {
  const kinds = ids ? "'musica', 'revisar', 'proyectos', 'sets'" : "'musica', 'revisar', 'proyectos'"
  const rows = db.prepare(`SELECT f.id FROM files f WHERE ${PASABLES} AND f.kind IN (${kinds})`).all() as { id: number }[]
  const ok = new Set(rows.map((r) => r.id))
  return ids ? ids.filter((id) => ok.has(id)) : [...ok]
}

/** Cuántos Sets deja afuera la pasada de toda la Música (para decirlo en pantalla). */
export const setsLeftOut = (db: Db, ids: number[] | null): number =>
  ids ? 0 : (db.prepare(`SELECT COUNT(*) AS n FROM files f WHERE ${PASABLES} AND f.kind = 'sets'`).get() as { n: number }).n

/**
 * Cuánto va a tardar. No se cuentan los que ya tienen grilla de ese método (salvo `force`) ni los que tienen una de
 * Rekordbox o Serato, que ganan al exportar (salvo `theirs`: para encontrar los que se mueven y rehacerles la grilla).
 */
export function gridPlan(db: Db, dj: DjData, ids: number[] | null, engine: GridPlan['engine'], force = false, theirs = false): GridPlan & { todo: number[] } {
  const all = gridCandidates(db, ids)
  const has = new Set([...(force ? [] : dj.withGrid(all, methodOf(engine))), ...(theirs ? [] : [...dj.withGrid(all, 'rekordbox'), ...dj.withGrid(all, 'serato')])])
  const info = db.prepare('SELECT duration, genre, rel_path AS rel FROM files WHERE id = ?')
  let seconds = 0
  const short: number[] = [], long: { id: number; dur: number }[] = []
  for (const id of all.filter((x) => !has.has(x))) {
    const f = info.get(id) as { duration: number | null; genre: string | null; rel: string } | undefined
    seconds += trackSeconds(engine, (f?.duration ?? 300) / 60, !!f && isPista(f.genre, f.rel))
    if ((f?.duration ?? 0) > LONG_MINUTES * 60) long.push({ id, dur: f!.duration! }); else short.push(id)
  }
  const todo = [...short, ...long.sort((a, b) => a.dur - b.dur).map((x) => x.id)]
  return { tracks: all.length, already: all.length - todo.length, seconds: Math.round(seconds), engine, setsOut: setsLeftOut(db, ids), todo }
}

export interface GridPassResult { done: number; failed: { rel: string; error: string }[]; ms: number; /** Suma de lo que tardó cada parte (ms). */ stages: { decode: number; model: number; rest: number } }

/**
 * Si se desconecta el disco en medio de la grilla: `ok` dice si la carpeta del tema está; `wait` espera a que vuelva
 * (false = se canceló). Sin esto, un disco que no está cuenta como tema fallado (core/readguard.ts).
 */
export interface GridDisk { ok(id: number): boolean; wait(id: number): Promise<boolean> }

/** Pasa los temas de a uno: `runOne` calcula (en un proceso aparte en la app) y acá se guarda la grilla y los cues sugeridos. */
export async function gridPass(db: Db, dj: DjData, todo: number[], pathOf: (id: number) => string | null, runOne: (file: string) => Promise<GridAnalysis>,
  onProgress: (p: { done: number; total: number; current: string }) => void, cancelled: () => boolean, disk?: GridDisk): Promise<GridPassResult> {
  const t0 = Date.now()
  const res: GridPassResult = { done: 0, failed: [], ms: 0, stages: { decode: 0, model: 0, rest: 0 } }
  const info = db.prepare('SELECT rel_path AS rel, size, duration FROM files WHERE id = ?')
  // para medir (scripts/grilla-tiempos.ts): PAILA_GRID_TIEMPOS=<archivo> anota cuánto tardó cada tema y cuántos pedazos escuchó
  const log = process.env.PAILA_GRID_TIEMPOS
  for (let i = 0; i < todo.length && !cancelled(); i++) {
    const id = todo[i]
    const f = info.get(id) as { rel: string; size: number; duration: number | null } | undefined
    const p = pathOf(id)
    onProgress({ done: i, total: todo.length, current: f?.rel ?? '' })
    // el disco no está: se espera a que vuelva y se repite el mismo tema (nada queda marcado)
    const away = async () => { if (!disk || disk.ok(id)) return 'no' as const; return (await disk.wait(id)) ? 'back' as const : 'stop' as const }
    if (f && !p) { const a = await away(); if (a === 'back') { i--; continue } if (a === 'stop') break }
    if (!f || !p) { res.failed.push({ rel: f?.rel ?? String(id), error: 'El disco no está conectado' }); continue }
    try {
      const g = await runOne(p)
      // si el disco se fue mientras leía, el resultado puede estar cortado: se repite cuando vuelva
      const a = await away()
      if (a === 'back') { i--; continue }
      if (a === 'stop') break
      if (g.stages) { res.stages.decode += g.stages.decode; res.stages.model += g.stages.model; res.stages.rest += g.stages.rest }
      dj.saveGrid(id, g.method, g, f.size)
      if (log) fs.appendFileSync(log, JSON.stringify({ id, rel: f.rel, dur: f.duration, ms: g.ms, stages: g.stages, windows: g.windows, variable: g.grid?.variable ?? null, segments: g.grid?.segments.length ?? 0 }) + '\n')
      if (g.cues.length) dj.saveSuggested(id, g.cues)
      if (!g.grid) res.failed.push({ rel: f.rel, error: 'No tiene un pulso parejo (o es muy corto) para armarle grilla' })
      else res.done++
    } catch (e) {
      const a = await away()
      if (a === 'back') { i--; continue }
      if (a === 'stop') break
      res.failed.push({ rel: f.rel, error: (e as Error).message })
    }
  }
  onProgress({ done: todo.length, total: todo.length, current: '' })
  res.ms = Date.now() - t0
  return res
}
