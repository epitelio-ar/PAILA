// Emparejar un archivo nuevo con la biblioteca por su huella acústica (nivel 1 de la Bandeja, antes que tags y nombre).
// Devuelve los temas candidatos ordenados y clasificados: el mismo audio (sirve para reemplazar), una versión o dudoso.
import { decodeFingerprint } from './analysis/chromaprint'
import type { Db } from './db'
import { libraryPrints } from './soundindex'
import { DIFFERENT_SIM, FRAMES_PER_SECOND, bestAlignment, soundRelation, type Alignment } from './soundmatch'

/**
 * - `mismo`: el mismo audio (otra calidad, otro formato, otro nombre): suenan igual en todo lo que se superpone y duran lo
 *   mismo (±3 s o 2 %). Es el único que sirve para reemplazar.
 * - `version`: comparten un pedazo largo (≥ 15 s) pero no son el mismo audio: radio edit / extended, remix, otro master,
 *   en vivo. Nunca reemplazar solo.
 * - `dudoso`: algo se parece (la huella lo encontró, o es un tema pedido) pero no alcanza para decir que es el mismo ni una
 *   versión: mirarlo a oído.
 */
export type PrintKind = 'mismo' | 'version' | 'dudoso'

export interface PrintCandidate {
  fileId: number
  kind: PrintKind
  /** Bits iguales en la parte que se superpone (0–1). Dos temas cualquiera: ~0,5–0,65; el mismo audio: más de 0,8. */
  similarity: number
  /** Cuánto más se parecen en su corrimiento que "de fondo" (0–1). Temas distintos: ≤ 0,05; el mismo: ≥ 0,11. */
  contrast: number
  /** Segundos que suenan realmente igual (de los primeros 120 s). */
  sharedSeconds: number
  /** Cuánto más adelante empieza el audio en el tema de la biblioteca (segundos; negativo = antes). */
  offsetSeconds: number
  /** Duración del tema de la biblioteca menos la del archivo nuevo (segundos), si se saben las dos. */
  durationDiff: number | null
  /** Está entre los `prefer` (por ejemplo, un tema "pedido" de la lista «Faltan o suenan mal»). */
  preferred: boolean
}

export interface MatchOptions {
  /** Duración del archivo nuevo (para distinguir "mismo" de "versión"). */
  duration?: number | null
  /** Temas que se prefieren (pedidos): se comparan siempre, aunque el índice no los haya encontrado, y van primero. */
  prefer?: number[]
  /** Cuántos candidatos devolver como mucho (los mejores). */
  limit?: number
}

const ORDER: Record<PrintKind, number> = { mismo: 0, version: 1, dudoso: 2 }
/** Para ser "dudoso" tiene que haber algo: un poco de contraste o algunos segundos iguales. */
const DOUBT_CONTRAST = 0.04
const DOUBT_SECONDS = 5

/**
 * Los temas de la biblioteca que suenan como `print` (la huella comprimida de AcoustID, o ya decodificada). Usa el índice de
 * toda la biblioteca (se arma una vez y queda guardado mientras la biblioteca no cambie: anda con 100.000 temas) y compara
 * bit a bit solo los candidatos. Orden: mismo → versión → dudoso; dentro de cada uno, los preferidos primero y después
 * los más parecidos.
 */
export async function matchByPrint(db: Db, print: string | Uint32Array, opts: MatchOptions = {}): Promise<PrintCandidate[]> {
  const fp = typeof print === 'string' ? decodeFingerprint(print) : print
  if (fp.length < 10 * FRAMES_PER_SECOND) return [] // menos de 10 s de huella: no se puede afirmar nada
  const lib = await libraryPrints(db)
  const prefer = new Set(opts.prefer ?? [])
  const tried = new Map<number, number | null>() // tema → corrimiento que sugirió el índice (null = probar varios)
  for (const hit of lib.index.query(fp).slice(0, 50)) tried.set(lib.index.ids[hit.b], hit.offset)
  for (const id of prefer) if (!tried.has(id)) tried.set(id, null)
  const out: PrintCandidate[] = []
  for (const [id, offset] of tried) {
    const other = lib.fingerprint(id)
    if (!other) continue
    let al: Alignment
    if (offset != null) al = bestAlignment(fp, other, offset)
    else { // un pedido que el índice no encontró: se buscan corrimientos de ±10 s
      al = bestAlignment(fp, other, 0)
      for (let o = -80; o <= 80; o += 4) { const x = bestAlignment(fp, other, o); if (x.matched > al.matched || (x.matched === al.matched && x.sim > al.sim)) al = x }
    }
    const dur = lib.duration(id)
    const rel = soundRelation(al, opts.duration ?? null, dur, fp.length, other.length)
    const shared = al.matched / FRAMES_PER_SECOND
    const kind: PrintKind | null = rel === 'same' ? 'mismo' : rel === 'version' ? 'version'
      : al.sim >= DIFFERENT_SIM && (al.contrast >= DOUBT_CONTRAST || shared >= DOUBT_SECONDS) ? 'dudoso' : null
    if (!kind) continue
    out.push({
      fileId: id, kind, similarity: al.sim, contrast: al.contrast, sharedSeconds: Math.round(shared), offsetSeconds: Math.round((al.offset / FRAMES_PER_SECOND) * 10) / 10,
      durationDiff: dur != null && opts.duration != null ? Math.round((dur - opts.duration) * 10) / 10 : null, preferred: prefer.has(id),
    })
  }
  out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || Number(b.preferred) - Number(a.preferred) || b.similarity - a.similarity)
  return out.slice(0, opts.limit ?? 20)
}
