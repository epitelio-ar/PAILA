// Tracklist automático de un set (MASTERPLAN-3, punto 5; idea del 20/10/2026): PAILA escucha un set, un
// enganchado o un recital y dice qué temas de la biblioteca suenan y en qué minuto.
//
// Cómo: la huella del set entero (analysis/setprint.ts) se recorre en ventanas de ~30 s cada ~10 s y cada ventana se busca
// en el índice de huellas de Duplicados (soundindex.ts), que tiene los primeros 120 s de cada tema. Las ventanas que
// encuentran el mismo tema seguido forman un tramo; el minuto en que entra sale de dónde cae la ventana dentro del tema.
// Los tramos que nadie reconoce quedan "sin reconocer" (para AcoustID o el reconocedor opcional).
// Puro (sin ffmpeg ni archivos): lo de leer el set está en analysis/setprint.ts y lo de la base, en setlists.ts.
import { encodeFingerprint } from './analysis/chromaprint'
import { SoundIndex, indexParams, type LibraryPrints } from './soundindex'
import { FRAMES_PER_SECOND, MIN_CONTRAST, bestAlignment } from './soundmatch'

/** Largo de cada ventana del set (~30 s) y cada cuánto empieza una (~10 s), en cuadros de la huella. */
export const WINDOW = 240
export const HOP = 80
/** Para que una ventana diga "acá suena este tema": segundos que suenan igual (de 30) y contraste contra el fondo. */
const MIN_MATCHED_S = 8
/** Contraste que se pide en la pasada "como un disco". */
const DISC_CONTRAST = 0.1
/** Dos ventanas del mismo tema con más de esto entre una y otra son dos pasadas distintas (lo tocó dos veces). */
export const SAME_PLAY_GAP_S = 90
/** Un tramo de más de esto sin ningún tema reconocido es "sin reconocer". */
export const GAP_S = 60
/** Dos temas de la biblioteca que entran en el mismo momento (±8 s) y se superponen son el mismo audio (un duplicado). */
export const SAME_START_S = 8

/** Una ventana del set que suena como un tema de la biblioteca. */
export interface SetHit {
  /** Segundo del set donde empieza la ventana. */
  at: number
  fileId: number
  /** Segundo del tema que suena al principio de la ventana (puede ser negativo: la ventana empieza antes que el tema). */
  pos: number
  /** Velocidad a la que sonaba (1 = la original; 1,03 = un 3 % más rápido). */
  rate: number
  /** Segundos de la ventana que suenan realmente igual. */
  matched: number
  /** Cuánto más se parecen que "de fondo" (ver soundmatch.ts). */
  contrast: number
  /** Salió de la segunda pasada (el set leído a otra velocidad, como un disco): más fácil que sea una casualidad. */
  disc?: boolean
}

export type Confidence = 'alta' | 'media' | 'baja'

/** Un tema del tracklist (o un tramo sin reconocer, con `fileId` null). */
export interface TracklistEntry {
  /** Segundo del set en que entra (aproximado: ±10 s). */
  start: number
  /** Hasta dónde se lo escuchó (la última ventana que lo reconoce). */
  heardUntil: number
  fileId: number | null
  /** Otros archivos de la biblioteca con el mismo audio (duplicados): entran en el mismo momento. */
  alsoIds: number[]
  /** Velocidad a la que sonaba (1 = original). */
  rate: number
  /** Ventanas que lo reconocen y la más clara (contraste). */
  windows: number
  contrast: number
  confidence: Confidence
}

export interface FindOptions {
  /** Temas que no se buscan (el propio set, otros sets). */
  exclude?: (fileId: number) => boolean
  /**
   * Velocidades a probar además de la original. Un set de DJ suele tener los temas acelerados o frenados unos puntos con
   * "master tempo" (la nota queda igual): se estira la huella del set a cada velocidad.
   */
  rates?: number[]
  /**
   * Para la segunda pasada sobre un tramo: la huella empieza en el segundo `offset` del set y se leyó a `speed` (más
   * rápido o más lento, como un disco: ver analysis/setprint.ts). Así las ventanas dicen el segundo y la velocidad del set.
   */
  offset?: number
  speed?: number
  onProgress?: (fraction: number) => void
  isCancelled?: () => boolean
}

/**
 * La huella del set leída a otra velocidad: el cuadro i del resultado es el del set en el tiempo i / rate. Sirve para
 * "master tempo" (cambia el tiempo y no la nota): si el DJ aceleró un tema un 3 %, el set estirado a 1,03 se alinea con él.
 */
export function stretchPrint(fp: Uint32Array, rate: number): Uint32Array {
  if (rate === 1) return fp
  const n = Math.floor(fp.length * rate), out = new Uint32Array(n)
  for (let i = 0; i < n; i++) out[i] = fp[Math.min(fp.length - 1, Math.round(i / rate))]
  return out
}

/** Las velocidades entre 1 − `span` y 1 + `span`, de a `step` (sin la 1, que se prueba siempre). */
export function rateGrid(span = 0.08, step = 0.01): number[] {
  const out: number[] = []
  for (let r = -span; r <= span + 1e-9; r += step) if (Math.abs(r) > 1e-9) out.push(Math.round((1 + r) * 1000) / 1000)
  return out
}

/** Todas las ventanas del set que suenan como algún tema de la biblioteca (varias por ventana en las mezclas). */
export async function findHits(lib: LibraryPrints, setFp: Uint32Array, opts: FindOptions = {}): Promise<SetHit[]> {
  const rates = [1, ...(opts.rates ?? []).filter((r) => r !== 1)]
  const versions = rates.map((rate) => ({ rate, fp: stretchPrint(setFp, rate) }))
  const prints = new Map<number, Uint32Array | null>()
  const printOf = (id: number) => { if (!prints.has(id)) prints.set(id, lib.fingerprint(id)); return prints.get(id)! }
  const out: SetHit[] = []
  const offset = opts.offset ?? 0, speed = opts.speed ?? 1
  const total = Math.max(1, setFp.length - WINDOW)
  for (let s = 0; s === 0 || s + WINDOW <= setFp.length; s += HOP) {
    if (s % (HOP * 30) === 0) {
      if (opts.isCancelled?.()) break
      opts.onProgress?.(s / total)
      await new Promise((r) => setImmediate(r)) // la app sigue respondiendo
    }
    const best = new Map<number, SetHit>()
    for (const v of versions) {
      const a = Math.round(s * v.rate)
      const win = v.fp.subarray(a, a + WINDOW)
      if (win.length < WINDOW / 2) continue
      for (const h of lib.index.query(win, 3).slice(0, 6)) {
        const id = lib.index.ids[h.b]
        if (opts.exclude?.(id)) continue
        const other = printOf(id)
        if (!other) continue
        const al = bestAlignment(win, other, h.offset)
        const matched = al.matched / FRAMES_PER_SECOND
        // a otra velocidad (la pasada "como un disco") hay muchas más chances de una casualidad: se pide más
        if (al.contrast < (speed !== 1 ? DISC_CONTRAST : MIN_CONTRAST) || matched < MIN_MATCHED_S) continue
        const hit: SetHit = { at: offset + (s / FRAMES_PER_SECOND) * speed, fileId: id, pos: al.offset / FRAMES_PER_SECOND, rate: Math.round((v.rate / speed) * 1000) / 1000, matched, contrast: al.contrast, ...(speed !== 1 ? { disc: true } : {}) }
        const prev = best.get(id)
        if (!prev || score(hit) > score(prev)) best.set(id, hit)
      }
    }
    out.push(...best.values())
    if (s + WINDOW >= setFp.length) break
  }
  opts.onProgress?.(1)
  return out
}

/** Cuánto pesa una ventana: segundos iguales y contraste. */
export const score = (h: SetHit) => h.matched + h.contrast * 40

/** Segundo del set en que sonaría el principio del tema, según una ventana. */

/**
 * Los tramos del set donde ninguna ventana reconoce nada (de al menos `min` segundos): ahí se vuelve a buscar con el set
 * leído a otras velocidades (un tema acelerado como un disco cambia de nota y la huella normal no lo encuentra).
 */
export function silentSpans(hits: SetHit[], setSeconds: number, min = 45): { from: number; to: number }[] {
  const ats = [...new Set(hits.map((h) => h.at))].sort((a, b) => a - b)
  const win = WINDOW / FRAMES_PER_SECOND
  const out: { from: number; to: number }[] = []
  let covered = 0
  for (const at of ats) { if (at - covered >= min) out.push({ from: covered, to: at }); covered = Math.max(covered, at + win) }
  if (setSeconds - covered >= min) out.push({ from: covered, to: setSeconds })
  return out
}

/**
 * Huellas enteras de algunos temas (los de la carpeta del set: core/setlists.ts) armadas como el índice de la biblioteca,
 * que solo acepta pedazos de hasta ~127 s: cada tema va en pedazos de 1024 cuadros que se superponen 256. Las ventanas
 * que encuentra se pasan al tema y al segundo de verdad con `toTrack`.
 */
export function chunkedPrints(entries: { fileId: number; fp: Uint32Array; duration: number | null }[]): { lib: LibraryPrints; toTrack(hit: SetHit): SetHit } {
  const CH = 1024, STEP = 768
  const chunks: { fileId: number; start: number; fp: Uint32Array; duration: number | null }[] = []
  for (const e of entries) {
    for (let s = 0; s < e.fp.length; s += STEP) {
      const sub = e.fp.subarray(s, Math.min(e.fp.length, s + CH))
      if (sub.length < WINDOW && s > 0) break
      chunks.push({ fileId: e.fileId, start: s, fp: sub, duration: e.duration })
      if (s + CH >= e.fp.length) break
    }
  }
  const b = SoundIndex.builder(indexParams(Math.max(chunks.length, 1)))
  chunks.forEach((c, i) => b.add({ id: i, chromaprint: encodeFingerprint(c.fp) }))
  return {
    lib: { index: b.finish(), fingerprint: (i) => chunks[i]?.fp ?? null, duration: (i) => chunks[i]?.duration ?? null },
    toTrack: (h) => { const c = chunks[h.fileId]; return { ...h, fileId: c.fileId, pos: h.pos + c.start / FRAMES_PER_SECOND } },
  }
}

/** "1:02:03" o "4:05". */
export function clock(s: number): string {
  const t = Math.max(0, Math.round(s)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}
