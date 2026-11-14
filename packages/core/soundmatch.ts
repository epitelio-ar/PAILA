// Comparar dos huellas acústicas bit a bit, ya alineadas: cuánto se parecen, cuánto suena realmente igual y si son el mismo
// audio, una versión (comparten un pedazo) o nada. Lo usan Duplicados y la Bandeja, con los pares que encuentra soundindex.ts.

/** Cuadros por segundo de la huella (Chromaprint: 11.025 Hz, un cuadro cada 1.365 muestras). */
export const FRAMES_PER_SECOND = 11025 / 1365

/** Cómo se parecen dos huellas alineadas con un corrimiento. */
export interface Alignment {
  /** Cuadros de B corridos respecto de A (B[i + offset] ~ A[i]). */
  offset: number
  /** Bits iguales en la parte que se superpone, de 0 a 1 (dos temas distintos dan ~0,5–0,6; el mismo audio, más de 0,85). */
  sim: number
  /** Cuadros que se superponen. */
  overlap: number
  /** Cuadros dentro de tramos de ~5 s que suenan igual (≥ 80 % de bits iguales): el pedazo realmente compartido. */
  matched: number
  /**
   * Cuánto se parecen "de fondo", en corrimientos que no tienen nada que ver (la mediana): ~0,5 en música con armonía,
   * hasta ~0,85 en techno muy percusivo, donde la huella casi no tiene notas y todo se parece a todo.
   */
  background: number
  /** sim − background: cuánto más se parecen en este corrimiento que en cualquiera. Dos temas distintos: ≤ 0,05. */
  contrast: number
  /** Cuadros compartidos "que dicen algo" (ver `sharedFrames` y `withShared`). Sin el dato, `soundRelation` decide como antes. */
  shared?: number
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

const WINDOW = 40 // ~5 s

/** Compara A y B con un corrimiento dado: parecido general y cuánto suena realmente igual. */
export function alignAt(a: ArrayLike<number>, b: ArrayLike<number>, offset: number, background = TYPICAL_BACKGROUND): Alignment {
  const from = Math.max(0, -offset), to = Math.min(a.length, b.length - offset)
  const n = Math.max(0, to - from)
  if (n === 0) return { offset, sim: 0, overlap: 0, matched: 0, background, contrast: -background }
  // un tramo "suena igual" con 80 % de bits iguales; si de fondo ya se parecen mucho (techno), hace falta más
  const goodRun = Math.min(0.97, Math.max(0.8, background + 0.12)) * 32 * WINDOW
  const same = new Uint8Array(n)
  let total = 0
  for (let i = 0; i < n; i++) { const s = 32 - popcount((a[from + i] ^ b[from + i + offset]) >>> 0); same[i] = s; total += s }
  // tramos de WINDOW cuadros con ≥ 80 % de bits iguales: cada cuadro que cae en alguno cuenta como compartido
  const good = new Uint8Array(n)
  let run = 0
  for (let i = 0; i < n; i++) {
    run += same[i]
    if (i >= WINDOW) run -= same[i - WINDOW]
    if (i >= WINDOW - 1 && run >= goodRun) good.fill(1, i - WINDOW + 1, i + 1)
  }
  let matched = 0
  for (let i = 0; i < n; i++) matched += good[i]
  // con menos de un tramo de superposición no se puede afirmar nada
  if (n < WINDOW) matched = 0
  const sim = total / (32 * n)
  return { offset, sim, overlap: n, matched, background, contrast: sim - background }
}

/** Parecido de fondo de dos temas desconocidos (cuando no hay corrimientos lejanos para medirlo: temas muy cortos). */
const TYPICAL_BACKGROUND = 0.55

/** Bits iguales en un corrimiento, mirando un cuadro de cada dos (alcanza para el fondo y es el doble de rápido). */
function quickSim(a: ArrayLike<number>, b: ArrayLike<number>, offset: number): number {
  let same = 0, n = 0
  for (let i = Math.max(0, -offset); i < a.length && i + offset < b.length; i += 2) { same += 32 - popcount((a[i] ^ b[i + offset]) >>> 0); n++ }
  return n >= WINDOW ? same / (32 * n) : NaN
}

/** El parecido "de fondo": la mediana en corrimientos de 5 a 50 s lejos del bueno, para los dos lados. */
export function background(a: ArrayLike<number>, b: ArrayLike<number>, offset: number): number {
  const xs: number[] = []
  for (let d = 40; d <= 400; d += 20) for (const o of [offset + d, offset - d]) { const v = quickSim(a, b, o); if (!Number.isNaN(v)) xs.push(v) }
  if (xs.length < 4) return TYPICAL_BACKGROUND
  xs.sort((x, y) => x - y)
  return xs[xs.length >> 1]
}

/** El mejor corrimiento cerca de `offset` (±`spread` cuadros): por si los votos cayeron un cuadro al lado. */
export function bestAlignment(a: ArrayLike<number>, b: ArrayLike<number>, offset: number, spread = 2): Alignment {
  const bg = background(a, b, offset)
  const all: Alignment[] = []
  for (let d = -spread; d <= spread; d++) all.push(alignAt(a, b, offset + d, bg))
  // Los cuadros vecinos se parecen entre sí: corrido un cuadro, casi todo sigue "sonando igual". Entre los que comparten
  // (casi) lo mismo, el bueno es el de más bits iguales.
  const most = Math.max(...all.map((x) => x.matched))
  return all.filter((x) => x.matched >= most - WINDOW / 2).reduce((x, y) => (y.sim > x.sim ? y : x))
}

/** La misma alineación con `shared` calculado (ver `sharedFrames`). Lo usa Duplicados para ver los pedazos compartidos. */
export const withShared = (a: ArrayLike<number>, b: ArrayLike<number>, al: Alignment): Alignment => ({ ...al, shared: sharedFrames(a, b, al.offset) })

/** Tramo de ~5 s que suena igual: 80 % de bits iguales. */
const SAME_RUN = 0.8
/** Cuánto más tiene que parecerse un tramo en su corrimiento que contra el resto del otro tema. */
const LOCAL_CONTRAST = 0.1
/**
 * Valores distintos mínimos en un tramo de ~5 s (40 cuadros) para que diga algo. Con notas, casi cada cuadro es distinto;
 * una intro de solo bombo repite los mismos pocos valores. Biblioteca real (23/10): el 3 % de todos los tramos tiene menos
 * de 20, y el 48 % de los de techno muy percusivo.
 */
const MIN_VARIETY = 20
/** Valores distintos de cada tramo de WINDOW cuadros (el que empieza en i), en una sola pasada. */
function varieties(fp: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.max(0, fp.length - WINDOW + 1))
  const count = new Map<number, number>()
  for (let i = 0; i < fp.length; i++) {
    count.set(fp[i], (count.get(fp[i]) ?? 0) + 1)
    if (i >= WINDOW) { const old = fp[i - WINDOW], c = count.get(old)! - 1; if (c) count.set(old, c); else count.delete(old) }
    if (i >= WINDOW - 1) out[i - WINDOW + 1] = count.size
  }
  return out
}

/**
 * Cuadros que suenan igual en este corrimiento *y dicen algo*: tramos de ~5 s con 80 % de bits iguales, con variedad (ver
 * MIN_VARIETY) y que se parecen al menos 0,1 más que el mismo tramo contra otras partes del otro tema (la mediana de
 * corrimientos de 5 a 50 s). Un tramo de solo bombo, sin notas, se parece a todo y no cuenta: así dos temas de techno distintos no "comparten" nada
 * (medido el 23/10 con la biblioteca real: "LSD" y "Move Your Body" daban 40 s de tramos iguales y ahora 0), y una intro,
 * un sample o el estribillo de un remix sí (Bad Blood y su REBASSED: 12 s; Intro y Outro de un disco: 12 s).
 */
export function sharedFrames(a: ArrayLike<number>, b: ArrayLike<number>, offset: number): number {
  const n = a.length
  // sumas acumuladas de bits iguales para un corrimiento: la ventana que empieza en i sale en O(1) (NaN si no entra)
  const sums = (o: number) => {
    const from = Math.max(0, -o), to = Math.min(n, b.length - o)
    if (to - from < WINDOW) return null
    const s = new Int32Array(to - from + 1)
    for (let i = from; i < to; i++) s[i - from + 1] = s[i - from] + 32 - popcount((a[i] ^ b[i + o]) >>> 0)
    return (i: number) => (i >= from && i + WINDOW <= to ? (s[i + WINDOW - from] - s[i - from]) / (32 * WINDOW) : NaN)
  }
  const at = sums(offset)
  if (!at) return 0
  // primero los tramos que suenan igual y tienen variedad; si no hay ninguno, no hace falta mirar el resto
  const candidates: number[] = []
  const variety = varieties(a)
  for (let i = 0; i + WINDOW <= n; i++) if (at(i) >= SAME_RUN && variety[i] >= MIN_VARIETY) candidates.push(i)
  if (!candidates.length) return 0
  const others: ((i: number) => number)[] = []
  for (let d = 40; d <= 400; d += 20) for (const o of [offset + d, offset - d]) { const s = sums(o); if (s) others.push(s) }
  const good = new Uint8Array(n)
  for (const i of candidates) {
    const here = at(i)
    // "la mediana de los otros corrimientos está al menos 0,1 abajo" = más de la mitad de ellos lo está (sin ordenar)
    let valid = 0, below = 0
    for (const s of others) { const v = s(i); if (v === v) { valid++; if (v <= here - LOCAL_CONTRAST) below++ } }
    if (valid >= 4 ? below > valid >> 1 : here - TYPICAL_BACKGROUND >= LOCAL_CONTRAST) good.fill(1, i, i + WINDOW)
  }
  let shared = 0
  for (let i = 0; i < n; i++) shared += good[i]
  return shared
}

// ---------- cuándo dos huellas son "el mismo audio" o "comparten un pedazo" ----------

/** Por encima de esto, los bits de la parte superpuesta dicen "mismo audio" (dos temas distintos dan ~0,5–0,65). */
export const SAME_SIM = 0.78
/** Pedazo compartido mínimo para mostrar dos temas como versiones (radio edit / extended del mismo master). */
export const VERSION_SECONDS = 15
/**
 * Cuánto más tienen que parecerse en su corrimiento que "de fondo" (ver Alignment.contrast). Medido con la biblioteca
 * real (3.448 temas, comparando todos los de duración parecida): dos temas distintos dan hasta 0,05 (techno percusivo
 * que se parece "a todo" en un 80 %), y el mismo tema, desde 0,11.
 */
export const MIN_CONTRAST = 0.08
/**
 * En techno muy percusivo la huella casi no tiene notas y todo se parece a todo (fondo de 0,87 a 0,93): ahí el contraste no
 * llega a 0,08 aunque sea el mismo audio. Se mira entonces qué parte del margen que queda hasta 1 usan. Biblioteca real
 * (23/10): el mismo tema pasado a MP3 de 96 o 128k, desde 0,84 ("Vortex": 0,987 con fondo 0,912); dos temas distintos, hasta
 * 0,32 (7.218 pares de los 121 temas más percusivos). Con un fondo de más de 0,93 (un loop sin una sola nota; el tema más
 * percusivo de esa biblioteca da 0,926) la huella no dice nada y no se decide por sonido.
 */
const MIN_RELATIVE = 0.6, MAX_BACKGROUND = 0.93
/** ¿Se parecen en su corrimiento claramente más que "de fondo"? */
export const standsOut = (al: Alignment) =>
  al.contrast >= MIN_CONTRAST || (al.background <= MAX_BACKGROUND && al.contrast >= MIN_RELATIVE * (1 - al.background))
/** Si en ningún corrimiento pasan de esto, suenan distinto (dos temas cualquiera dan ~0,5–0,65; el mismo, más de 0,8). */
export const DIFFERENT_SIM = 0.68

/** ¿Duran lo mismo? ±3 s o 2 % (el FLAC y el MP3 de "Madonna - Music" difieren 3,4 s en 3:49). */
export const sameLength = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(3, 0.02 * Math.max(a, b))
/**
 * Margen más ancho, solo cuando la huella confirma que suenan igual y los tags dicen el mismo tema: ±10 s o 4 %. Son los
 * bajados de YouTube o slider.kz con la intro del video, aplausos o silencio de más (corrida del 22/10 sobre la biblioteca
 * real: Katy Perry 3,8 s, Robbie Williams 6,5 s, Los Nota Lokos 9 s). Un radio edit o un extended difieren mucho más.
 */
export const closeLength = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(10, 0.04 * Math.max(a, b))

/** Suenan igual en todo lo que se superpone, sin mirar cuánto dura cada uno. */
export function soundsAlike(al: Alignment, lenA: number, lenB: number): boolean {
  const shorter = Math.min(lenA, lenB)
  if (al.overlap < 10 * FRAMES_PER_SECOND || al.matched / FRAMES_PER_SECOND < VERSION_SECONDS * 0.66 || !standsOut(al)) return false
  return al.matched >= 0.85 * al.overlap && al.overlap >= 0.85 * shorter && al.sim >= SAME_SIM
}

/**
 * Pedazo mínimo "que dice algo" (`Alignment.shared`) para mostrar dos temas juntos como versiones: una intro, un sample, el
 * estribillo de un remix. Corrida del 23/10 con la biblioteca real: los pedazos de verdad dieron de 9,8 a 13,6 s (Bad Blood
 * y su REBASSED, Intro y Outro de un disco, dos Supernature de Cerrone) y los pares de temas distintos, 0 s.
 */
export const PIECE_SECONDS = 8

export type SoundRelation = 'same' | 'version' | 'none'

/**
 * Qué relación tienen dos temas según su huella alineada y sus duraciones:
 * - `same`: suenan igual en todo lo que se superpone y duran lo mismo (±3 s o 2 %): el mismo audio, otra calidad.
 * - `version`: comparten un pedazo (≥ 15 s; con `shared` calculado, ≥ 8 s que digan algo) pero no son iguales (otra
 *   duración, otra mezcla, un corte, una intro o un sample).
 * - `none`: no se parecen, comparten muy poco o se parecen solo "de fondo" (techno percusivo).
 */
export function soundRelation(al: Alignment, durA: number | null, durB: number | null, lenA: number, lenB: number): SoundRelation {
  const matchedSec = al.matched / FRAMES_PER_SECOND
  const enough = al.overlap >= 10 * FRAMES_PER_SECOND && matchedSec >= VERSION_SECONDS * 0.66 && standsOut(al)
  if (enough && sameLength(durA, durB) && soundsAlike(al, lenA, lenB)) return 'same'
  if (al.shared != null) return al.shared / FRAMES_PER_SECOND >= PIECE_SECONDS ? 'version' : 'none'
  return enough && matchedSec >= VERSION_SECONDS ? 'version' : 'none'
}
