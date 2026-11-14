// Cola de análisis de la biblioteca: qué falta analizar y el análisis en sí (calidad, BPM y tono, y las dos huellas), con
// la pasada liviana de huellas y la que rehace lo que mejoró del motor (core/reanalysis.ts). Se puede pausar y detener (core/libraryjob.ts).
import os from 'node:os'
import path from 'node:path'
import type { CollectionKind, ScanStatus } from '@paila/shared/types'
import type { AnalysisRunner } from './analysis/pool'
import { Slots } from './analysis/slots'
import type { Prints } from './analysis/analyze'
import { gradeEnLosDos, isLossless, type Verdict } from './analysis/grade'
import { guardarOtro } from './textosidioma'
import { cluesFor } from './analysis/clues'
import { djFromName } from './analysis/dj'
import type { RawAnalysis } from './analysis/analyze'
import { QUALITY_VERSION, bpmStyles, djCols, qualityPass } from './reanalysis'
import { precisePass } from './precise'
import { saveSilence, silencePass } from './silencepass'
import { stylePass } from './stylepass'
import { calibration, recomputeEnergy } from './energiamarcas'
import { silenceFlags } from './analysis/silence'
import { ReadGuard } from './readguard'
import { transaction, visible, type Db } from './db'
import { toAbs } from './files'
import type { Library } from './library'
import { cant, num, textos } from '@paila/shared/idioma'

// Lo que se ve mientras analiza y cómo terminó (solo se muestra: lo que se compara va en `status.outcome`).
const T = textos({
  analizando: { es: 'Analizando calidad, BPM y tono…', en: 'Analyzing quality, BPM and key…' },
  huellas: {
    es: 'Pasada rápida: huella de cada tema (sirve para encontrar repetidos y guardar más rápido)…',
    en: 'Quick pass: a fingerprint for each track (it helps find repeats and save faster)…',
  },
  detenido: {
    es: (n: number, de: number) => `Análisis detenido: ${n} de ${de} (lo hecho quedó guardado)`,
    en: (n: number, de: number) => `Analysis stopped: ${num(n)} of ${num(de)} (what was done is saved)`,
  },
  analizados: { es: (n: number) => `Listo: ${n} temas analizados`, en: (n: number) => `Done: ${cant(n, 'track', 'tracks')} analyzed` },
  conHuella: { es: (n: number) => `Listo: se agregó la huella a ${n} temas`, en: (n: number) => `Done: added the fingerprint to ${cant(n, 'track', 'tracks')}` },
  precisa: { es: (n: number) => `Listo: pasada precisa en ${n} temas`, en: (n: number) => `Done: precise pass on ${cant(n, 'track', 'tracks')}` },
  yaEstaba: { es: 'Listo: la biblioteca ya estaba analizada', en: 'Done: the library was already analyzed' },
  error: { es: (m: string) => `Error: ${m}`, en: (m: string) => `Error: ${m}` },
})

// Subir este número hace que todo se vuelva a analizar (cuando mejora el motor).
export const ANALYSIS_VERSION = 1
// La versión del motor de calidad vive en core/reanalysis.ts (subirla vuelve a medir solo la calidad).
export { QUALITY_VERSION }
// Archivos sin análisis, con uno viejo o que cambiaron desde que se analizaron. Los que no se pudieron leer, no.
export const PENDING = `f.error IS NULL AND ${visible('f')} AND (a.file_id IS NULL OR a.version < ? OR a.src_size != f.size OR a.src_mtime != f.mtime)`

// Temas con análisis vigente pero sin huellas (analizados antes de que existieran). Los samples no se decodifican nunca.
/** La parte de PENDING_PRINTS que mira el análisis (core/insights.ts la cuenta junto con otras cosas). Un parámetro: la versión. */
export const MISSING_PRINTS = 'f.error IS NULL AND a.error IS NULL AND a.prints_at IS NULL AND a.version >= ? AND a.src_size = f.size AND a.src_mtime = f.mtime'
const PENDING_PRINTS = `${visible('f')} AND f.kind != 'produccion' AND ${MISSING_PRINTS}`

/**
 * La tabla del análisis (alias `a`) para los conteos de pendientes: con el índice "resumen" (v41), que tiene solo las columnas
 * que se cuentan. Cada fila del análisis guarda la huella adentro (~3,5 KB): recorrer la tabla lee ~360 MB con 100.000 temas,
 * mire la columna que mire; el índice, ~10 MB. SQLite no lo elige solo (prefiere el número de fila): hay que pedirlo.
 */
export const ANALYSIS_COUNT = 'analysis a INDEXED BY analysis_resumen'

/** Columnas de la tabla `analysis` para las huellas de un tema. */
function printCols(p: Prints) {
  return { audio_md5: p.audioMd5, audio_size: p.size, audio_mtime: p.mtime, chromaprint: p.chromaprint, prints_at: new Date().toISOString() }
}

export interface PendingRow {
  id: number; root_id: number; rel_path: string; kind: CollectionKind; ext: string; codec: string | null; genre: string | null
  sample_rate: number | null; bits: number | null; channels: number | null; kbps: number | null; duration: number | null
  size: number; mtime: number
}

export { isLossless } // vive con la nota (analysis/grade.ts): NAPIA la usa sin cargar la cola

/** Cuántos temas faltan analizar (nuevos, modificados o de una versión vieja del análisis). */
export function pendingAnalysis(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${PENDING}`)
    .get(ANALYSIS_VERSION) as { n: number }).n
}

/**
 * Dónde está el tema ahora, justo antes de leerlo: la lista de cada pasada se arma al empezar, y si mientras tanto PAILA
 * lo movió (Organizar, papelera, Duplicados) hay que leerlo en su lugar nuevo, o saltearlo sin decir nada si ya no está a la
 * vista. Antes se leía la ruta vieja y el análisis avisaba "se movió por fuera de PAILA" (corrida con la app, 22/10).
 */
export function currentRel(db: Db, fileId: number): string | null {
  return (db.prepare(`SELECT rel_path AS rel FROM files WHERE id = ? AND ${visible()}`).get(fileId) as { rel: string } | undefined)?.rel ?? null
}
/** Para cada pasada: pone la ruta de hoy en la fila, o la da por vista (cuenta en el avance) si ya no está. */
export function stillThere(lib: Library, r: { id: number; rel_path: string }): boolean {
  const rel = currentRel(lib.db, r.id)
  if (rel == null) { lib.status.probed++; return false }
  r.rel_path = rel
  return true
}

/** Cuántos temas ya analizados no tienen todavía las huellas (se analizaron antes de que existieran). */
export function pendingPrints(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN ${ANALYSIS_COUNT} ON a.file_id = f.id WHERE ${PENDING_PRINTS}`)
    .get(ANALYSIS_VERSION) as { n: number }).n
}

/**
 * Recorre `items` con hasta `slots.size` temas a la vez (se puede cambiar en el momento, ver core/analysis/slots.ts).
 * Respeta pausar y detener entre tema y tema. Si `fn` devuelve false, ese recorrido corta (lo detuvo el usuario); si
 * devuelve 'retry', el tema vuelve a la cola (al final): volvió el disco, o un error del archivo con intentos de sobra.
 */
export async function each<T>(lib: Library, items: T[], slots: Slots, fn: (item: T) => Promise<boolean | void | 'retry'>) {
  let next = 0
  const loop = async () => {
    while (next < items.length && !lib.cancel) {
      if (lib.pauseWait) await lib.pauseWait
      if (lib.cancel || next >= items.length || !(await slots.acquire())) break
      // mientras esperaba lugar pudieron pausar, detener o terminarse la lista
      if (lib.cancel || next >= items.length) { slots.release(); break }
      if (lib.pauseWait) { slots.release(); continue }
      const item = items[next++]
      let go: boolean | void | 'retry'
      lib.reading++
      try { go = await fn(item) } finally { lib.reading--; slots.release() }
      if (go === 'retry') items.push(item)
      if (go === false) break
    }
  }
  // tantos recorridos como lo máximo que se pueda pedir; `slots` decide cuántos trabajan a la vez
  const loops = Math.min(items.length, Math.max(slots.size, os.availableParallelism()))
  await Promise.all(Array.from({ length: loops }, loop))
}

/**
 * Analiza lo pendiente: primero Música, después proyectos, sets y lo que hay para revisar. Los samples solo
 * se miran por el nombre. Cada tema se lee una sola vez: de esa lectura salen la calidad, el BPM y el tono, y las dos
 * huellas (la del sonido y la acústica). Después, una pasada liviana agrega las huellas a lo que se había analizado
 * antes de que existieran, y otra rehace lo que mejoró del motor (core/reanalysis.ts). Se puede pausar y detener.
 * `limit`: cuántos temas a la vez (un número fijo, o un `Slots` que se puede cambiar mientras corre).
 */
export async function analyzeLibrary(lib: Library, run: AnalysisRunner, ffmpeg: string, limit: number | Slots): Promise<ScanStatus> {
  lib.begin('analysis', T.analizando)
  const slots = typeof limit === 'number' ? new Slots(limit) : limit

  try {
    const bases = new Map(lib.roots().filter((r) => r.available).map((r) => [r.id, r.path]))
    const rows = (lib.db.prepare(
      `SELECT f.id, f.root_id, f.rel_path, f.kind, f.ext, f.codec, f.genre, f.sample_rate, f.bits, f.channels, f.kbps, f.duration, f.size, f.mtime
       FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${PENDING}
       ORDER BY CASE f.kind WHEN 'musica' THEN 0 WHEN 'proyectos' THEN 1 WHEN 'sets' THEN 2 WHEN 'revisar' THEN 3 ELSE 4 END, f.id`,
    ).all(ANALYSIS_VERSION) as unknown as PendingRow[]).filter((r) => bases.has(r.root_id))

    // Los samples no se decodifican: el BPM y el tono suelen venir en el nombre.
    const samples = rows.filter((r) => r.kind === 'produccion')
    const todo = rows.filter((r) => r.kind !== 'produccion')
    lib.status.toProbe = rows.length
    transaction(lib.db, () => {
      for (const r of samples) {
        const d = djFromName(path.basename(r.rel_path))
        saveAnalysis(lib.db, r, { bpm: d.bpm, bpm_source: d.bpm ? 'nombre' : null, music_key: d.key, camelot: d.camelot })
        lib.status.probed++
      }
    })
    lib.emit()

    const styles = bpmStyles(lib.db)
    let pending: (() => void)[] = []
    const flush = () => {
      const batch = pending
      pending = []
      if (batch.length) transaction(lib.db, () => { for (const save of batch) save() })
    }

    const guard = new ReadGuard(lib, bases, lib.diskPollMs)
    let flushedAt = Date.now()
    await each(lib, todo, slots, async (r) => {
      if (!stillThere(lib, r)) return
      const file = toAbs(bases.get(r.root_id)!, r.rel_path)
      lib.status.current = file
      const lossless = isLossless(r.codec, r.ext)
      const info = { codec: r.codec, ext: r.ext, lossless, kbps: r.kbps, sampleRate: r.sample_rate, bits: r.bits, channels: r.channels }
      try {
        const raw = await run.full({ ffmpeg, file, ...info, duration: r.duration, withDj: r.kind !== 'sets' && (r.duration ?? 0) <= 20 * 60 })
        const was = await guard.ok(r.id, r.root_id)
        if (was !== 'ok') return was === 'retry' ? 'retry' : false
        const v = gradeEnLosDos(info, raw, cluesFor(lib.db, r.id))
        pending.push(() => {
          saveAnalysis(lib.db, r, { ...qualityCols(v, raw), ...djCols(raw, r, styles), ms: raw.ms, ...printCols(raw.prints) })
          guardarOtro(lib.db, r.id, v.otro) // la nota en el otro idioma (core/textosidioma.ts)
          if (raw.silence) saveSilence(lib.db, r.id, raw.silence)
        })
      } catch (e) {
        // lo cortó el usuario: el tema queda pendiente, no con error; si se fue el disco, se espera y se repite (core/readguard.ts)
        const what = await guard.failed(r.id, r.root_id, file)
        if (what === 'stop') return false
        if (what === 'retry') return 'retry'
        if (what === 'mark') { lib.status.errors++; pending.push(() => saveAnalysis(lib.db, r, { error: (e as Error).message })) }
      }
      if (pending.length >= 50 || Date.now() - flushedAt > 5000) { flush(); flushedAt = Date.now() }
      lib.status.probed++
      lib.emit(false)
    })
    flush()
    guard.finish()
    const analyzed = lib.status.probed

    const printed = lib.cancel ? 0 : await printsPass(lib, run, ffmpeg, bases, slots)
    if (!lib.cancel) await qualityPass(lib, run, ffmpeg, bases, slots)
    if (!lib.cancel) await silencePass(lib, run, ffmpeg, bases, slots)
    if (!lib.cancel) await stylePass(lib, run, ffmpeg, bases, slots, lib.styleModels?.() ?? null)
    // la energía de lo recién analizado, con lo calibrado a oído (si se calibró; si no, ya quedó la de siempre)
    if (analyzed && calibration(lib.db)) recomputeEnergy(lib.db)
    // la pasada precisa va última: es la que menos apuro tiene (confirma, no cambia)
    const confirmed = lib.cancel ? 0 : await precisePass(lib, run, ffmpeg, bases, slots, lib.secondOpinion?.() ?? null)

    lib.status.phase = lib.cancel
      ? T.detenido(lib.status.probed, lib.status.toProbe)
      : analyzed ? T.analizados(analyzed) : printed ? T.conHuella(printed) : confirmed ? T.precisa(confirmed) : T.yaEstaba
  } catch (e) {
    lib.status.phase = T.error((e as Error).message)
    lib.status.outcome = 'error'
  } finally {
    lib.finish()
  }
  return lib.status
}

/**
 * Pasada liviana: solo las huellas, para los temas que ya tenían análisis (no se repite la calidad ni el BPM). Es una
 * lectura del archivo sin medidor de volumen ni FFT de calidad: unas 3 veces más rápida que analizar de cero.
 */
async function printsPass(lib: Library, run: AnalysisRunner, ffmpeg: string, bases: Map<number, string>, slots: Slots): Promise<number> {
  const rows = (lib.db.prepare(
    `SELECT f.id, f.root_id, f.rel_path, f.channels FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${PENDING_PRINTS}
     ORDER BY CASE f.kind WHEN 'musica' THEN 0 WHEN 'revisar' THEN 1 WHEN 'proyectos' THEN 2 ELSE 3 END, f.id`,
  ).all(ANALYSIS_VERSION) as { id: number; root_id: number; rel_path: string; channels: number | null }[]).filter((r) => bases.has(r.root_id))
  if (!rows.length) return 0
  Object.assign(lib.status, { phase: T.huellas, toProbe: rows.length, probed: 0 })
  lib.emit()
  const upd = lib.db.prepare('UPDATE analysis SET audio_md5 = ?, audio_size = ?, audio_mtime = ?, chromaprint = ?, prints_at = ? WHERE file_id = ?')
  let pending: unknown[][] = []
  let flushedAt = Date.now()
  const flush = () => {
    const batch = pending
    pending = []
    flushedAt = Date.now()
    if (batch.length) transaction(lib.db, () => { for (const p of batch) upd.run(...(p as never[])) })
  }
  const guard = new ReadGuard(lib, bases, lib.diskPollMs)
  await each(lib, rows, slots, async (r) => {
    if (!stillThere(lib, r)) return
    const file = toAbs(bases.get(r.root_id)!, r.rel_path)
    lib.status.current = file
    let c = printCols({ audioMd5: null, chromaprint: null, size: null, mtime: null })
    try {
      c = printCols(await run.prints({ ffmpeg, file, channels: r.channels }))
      const was = await guard.ok(r.id, r.root_id)
      if (was !== 'ok') return was === 'retry' ? 'retry' : false
    } catch {
      // disco que no está: se espera y se repite; archivo que no está: no se anota (core/readguard.ts)
      const what = await guard.failed(r.id, r.root_id, file)
      if (what === 'stop') return false
      if (what === 'retry') return 'retry'
      if (what === 'skip') { lib.status.probed++; lib.emit(false); return }
      lib.status.errors++
    }
    // Un error del archivo, después de MAX_TRIES intentos, queda anotado (sin huellas) para no reintentar en cada arranque.
    pending.push([c.audio_md5, c.audio_size, c.audio_mtime, c.chromaprint, c.prints_at, r.id])
    // de a 50, o cada 5 s: es una pasada rápida y, si se cierra PAILA, se pierde muy poco
    if (pending.length >= 50 || Date.now() - flushedAt > 5000) flush()
    lib.status.probed++
    lib.emit(false)
  })
  flush()
  guard.finish()
  return lib.status.probed
}

/** Las columnas de la nota de calidad (las que rehace la pasada de calidad cuando mejora el motor), con las marcas de silencio de la misma lectura. */
export function qualityCols(v: Verdict, raw: RawAnalysis): Record<string, string | number | null> {
  return {
    grade: v.grade, says: v.says, is_label: v.is, why: JSON.stringify(v.why), confidence: v.confidence,
    // "BPM dudoso" sale de la misma lectura (los dos métodos de BPM no coinciden, core/analysis/dj.ts)
    flags: [...v.flags, ...(raw.dj?.bpmDoubtful ? ['bpm_doubtful'] : []), ...silenceFlags(raw.silence ?? null)].join(',') || null, eff_kbps: v.effKbps, sound: JSON.stringify(v.sound),
    cutoff: raw.cutoff.cutoff, cutoff_drop: raw.cutoff.drop, lufs: raw.lufs, lra: raw.lra, true_peak: raw.truePeak,
    sample_peak: raw.samplePeak, clip_events: raw.clipEvents, stereo_corr: raw.stereoCorr, eff_bits: raw.effBits,
    encoder: raw.mp3?.encoder ?? null, vbr_method: raw.mp3?.vbrMethod ?? null, lame_lowpass: raw.mp3?.lowpassHz ?? null,
    spectrum: JSON.stringify(raw.cutoff.spectrum), quality_v: QUALITY_VERSION,
  }
}

function saveAnalysis(db: Db, r: PendingRow, values: Record<string, string | number | null>) {
  const cols = ['file_id', 'version', 'src_size', 'src_mtime', 'analyzed_at', ...Object.keys(values)]
  db.prepare(`INSERT OR REPLACE INTO analysis (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(r.id, ANALYSIS_VERSION, r.size, r.mtime, new Date().toISOString(), ...Object.values(values))
}
