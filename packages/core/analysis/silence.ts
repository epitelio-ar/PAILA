// Silencios largos al principio y al final de un tema (masterplan 3, punto 3). Se miden en la misma lectura del análisis
// (`SilenceMeter`) o, para los temas ya analizados, leyendo solo el principio y el final (`analyzeSilence`). Puro salvo eso.
import { spawn } from 'node:child_process'
import { lowPriority } from '../lowpriority'
import { T } from './errores.textos'

/** Versión de la medición: subirla vuelve a medir los silencios (solo el principio y el final, es liviano). */
export const SILENCE_VERSION = 1

const SR = 44100
/** Bloques de 50 ms: alcanza para medir décimas de segundo y no confundir un golpe con un sonido que sigue. */
const BLOCK = SR / 20
/**
 * Debajo de esto es silencio: −60 dBFS de nivel medio (RMS) en el bloque. Una intro suave de verdad (un piano, el público de
 * un vivo, un pad) queda arriba de −50; el ruido de fondo de un CD en silencio, abajo de −80. El final de un fade-out que
 * baja de −60 ya no se oye a volumen normal, así que contarlo como silencio es justo.
 */
export const SILENCE_DB = -60
/** Un ruido suelto (un clic de vinilo, el "pop" de un MP3 cortado) no corta el silencio: hacen falta 200 ms de sonido en 1 s. */
const SOUND_BLOCKS = 4
const SOUND_SPAN = 20

/** Desde cuántos segundos se avisa. Al principio, 2 s ya se notan (en una playlist, en la cabina); al final, muchos CD
 *  copiados traen 2–3 s de pausa entre temas pegada al final, y eso es normal: se avisa desde 5 s. */
export const LONG_START_S = 2
export const LONG_END_S = 5

export interface SilenceResult {
  /** Segundos de silencio antes del primer sonido. */
  start: number
  /** Segundos de silencio después del último sonido. */
  end: number
  /** El tema entero (o lo que se leyó) está en silencio. */
  silent: boolean
}

/** Mide el nivel de cada bloque de 50 ms del audio estéreo (o mono, con `r` igual a `l`). */
export class SilenceMeter {
  private levels: number[] = []
  private acc = 0
  private n = 0
  push(l: number, r: number) {
    this.acc += (l * l + r * r) * 0.5
    if (++this.n === BLOCK) { this.levels.push(this.acc / BLOCK); this.acc = 0; this.n = 0 }
  }
  /** Niveles (energía media) de cada bloque entero leído. */
  blocks(): number[] { return this.levels }
  result(): SilenceResult { return silenceOf(this.levels) }
}

const THRESHOLD = 10 ** (SILENCE_DB / 10)
/**
 * Un fade-in o un fade-out pasa un rato largo entre −80 y −60 dB: ahí ya está sonando (bajito), no es silencio. En la corrida del
 * 22/10, 19 de 56 avisos del principio y 237 de 370 del final eran eso ("Rubia tarada" de Sumo arranca a −80 y sube). Si entre
 * los dos umbrales hay FADE_S o más, el silencio es solo lo que está debajo de −80 (antes de que empiece el fade o después de que
 * termine). Un arranque o un corte de golpe pasa por ahí en menos de eso.
 */
const DEEP = 10 ** (-80 / 10)
const FADE_S = 1.5

/** Primer bloque desde `from` que empieza un sonido (no un clic suelto), recorriendo hacia adelante o hacia atrás. */
function firstSound(loud: boolean[], dir: 1 | -1): number {
  const n = loud.length
  for (let k = 0; k < n; k++) {
    const i = dir === 1 ? k : n - 1 - k
    if (!loud[i]) continue
    let count = 0
    for (let j = 0; j < SOUND_SPAN && count < SOUND_BLOCKS; j++) {
      const b = i + dir * j
      if (b < 0 || b >= n) break
      if (loud[b]) count++
    }
    // al borde de lo leído (un tema de menos de 1 s, o el último bloque) alcanza con que suene lo que hay
    if (count >= SOUND_BLOCKS || count === (dir === 1 ? n - i : i + 1)) return i
  }
  return -1
}

/** Segundos de silencio al principio y al final, a partir de la energía de cada bloque de 50 ms. */
export function silenceOf(levels: number[]): SilenceResult {
  const loud = levels.map((e) => e > THRESHOLD)
  const first = firstSound(loud, 1)
  if (first < 0) return { start: secs(levels.length), end: secs(levels.length), silent: true }
  const last = firstSound(loud, -1)
  // con un fade, hasta donde empieza a sonar bajito
  const faint = levels.map((e) => e > DEEP)
  const fade = FADE_S / (BLOCK / SR)
  const f0 = firstSound(faint, 1), f1 = firstSound(faint, -1)
  const start = first - f0 >= fade ? f0 : first
  const end = f1 - last >= fade ? f1 : last
  return { start: secs(start), end: secs(levels.length - 1 - end), silent: false }
}

const secs = (blocks: number) => Math.round(blocks * 10 * (BLOCK / SR)) / 10

/** Segundos que dura cada bloque de `blocks()` (50 ms). */
export const BLOCK_SECONDS = BLOCK / SR

/**
 * Dónde suena algo de verdad, para recortar (core/trim.ts): el primer y el último bloque arriba de −80 dB (con la misma regla
 * del clic suelto), o null si todo está debajo. Más prudente que el aviso (−60 dB): un ruido de fondo de cinta, el público
 * de un vivo o el final de una reverberación quedan adentro; solo afuera queda lo que no se oye.
 */
export function soundBounds(levels: number[]): { first: number; last: number } | null {
  const faint = levels.map((e) => e > DEEP)
  const first = firstSound(faint, 1)
  return first < 0 ? null : { first, last: firstSound(faint, -1) }
}

/** El primer y el último bloque que se oye (arriba de −60 dB), aunque sea uno solo: un clic o un golpe suelto. Null si no hay. */
export function audibleBounds(levels: number[]): { first: number; last: number } | null {
  const first = levels.findIndex((e) => e > THRESHOLD)
  if (first < 0) return null
  let last = levels.length - 1
  while (levels[last] <= THRESHOLD) last--
  return { first, last }
}

/** Las marcas del análisis que salen de los silencios (problema informativo, ui/src/problems.ts). */
export function silenceFlags(s: SilenceResult | null): string[] {
  if (!s || s.silent) return []
  return [...(s.start >= LONG_START_S ? ['silence_start'] : []), ...(s.end >= LONG_END_S ? ['silence_end'] : [])]
}
export const SILENCE_FLAGS = ['silence_start', 'silence_end']

/** Cuánto se lee del principio y del final en la pasada liviana: un silencio más largo que esto se anota como "al menos". */
export const EDGE_SECONDS = 90

export interface SilenceJob { ffmpeg: string; file: string; duration: number | null }

/** Lee el principio del tema (`len` segundos; Infinity: entero), o los últimos `len` con `fromEnd`, y devuelve los niveles. */
export function readLevels(job: SilenceJob, len: number, fromEnd: boolean): Promise<number[]> {
  const seek = fromEnd ? ['-sseof', String(-len)] : []
  const args = ['-threads', '1', '-v', 'error', '-nostdin', ...seek, '-i', job.file, '-map', '0:a:0', '-vn', ...(Number.isFinite(len) ? ['-t', String(len)] : []),
    '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1']
  return new Promise((resolve, reject) => {
    const p = spawn(job.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    lowPriority(p.pid)
    const meter = new SilenceMeter()
    let leftover: Buffer = Buffer.alloc(0)
    let stderr = ''
    p.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      const usable = buf.length - (buf.length % 8)
      const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable))
      for (let o = 0; o < f.length; o += 2) meter.push(f[o], f[o + 1])
      leftover = buf.subarray(usable)
    })
    p.stderr.on('data', (d) => { if (stderr.length < 20_000) stderr += d })
    p.on('error', reject)
    p.on('close', () => {
      const b = meter.blocks()
      if (!b.length) reject(new Error(stderr.trim().split('\n').pop() || T.noSeLeyo))
      else resolve(b)
    })
  })
}

/**
 * Para los temas ya analizados: lee solo el principio y el final (90 s de cada lado; un tema corto, entero una vez) en vez
 * de todo el tema. Un silencio que ocupa todo lo leído se anota con lo leído (es "al menos eso").
 */
export async function analyzeSilence(job: SilenceJob): Promise<SilenceResult> {
  const dur = job.duration ?? 0
  if (dur > 0 && dur <= EDGE_SECONDS * 2) return silenceOf(await readLevels(job, Math.ceil(dur) + 1, false))
  const head = await readLevels(job, EDGE_SECONDS, false)
  // un MP3 con la duración mal anotada (dice 19 min y dura 4) no tiene "los últimos 90 s" donde ffmpeg los busca: entero
  const tail = await readLevels(job, EDGE_SECONDS, true).catch(() => readLevels(job, Infinity, false))
  const a = silenceOf(head), b = silenceOf(tail)
  if (a.silent && b.silent) return { start: a.start, end: b.end, silent: true }
  return { start: a.start, end: b.end, silent: false }
}
