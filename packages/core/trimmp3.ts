// Recortar un MP3 sin recodificar (recortar silencios, core/trim.ts): se sacan cuadros enteros del principio o del final y se
// copian los bytes de todo lo demás tal cual (el ID3 de adelante, el ID3v1, el APE y el Lyrics3 de atrás quedan idénticos).
// La cabecera Xing/Info + LAME del primer cuadro se corrige: cantidad de cuadros, bytes, índice, retardo y relleno, y sus
// sumas de control. Puro: recibe y devuelve bytes.
import { T } from './trim.textos'

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

interface Frame { at: number; len: number }
interface Header { version: number; sampleRate: number; spf: number; len: number; mono: boolean }

/** La cabecera de un cuadro de MPEG Layer III en `b[i]`, o null. */
function header(b: Uint8Array, i: number): Header | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null
  const version = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3
  const br = b[i + 2] >> 4, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1
  if (version === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return null
  const sampleRate = RATES[version][sr], kbps = (version === 3 ? BITRATES_V1 : BITRATES_V2)[br]
  const len = Math.floor(((version === 3 ? 144000 : 72000) * kbps) / sampleRate) + pad
  return { version, sampleRate, spf: version === 3 ? 1152 : 576, len, mono: ((b[i + 3] >> 6) & 3) === 3 }
}

/** CRC-16 de LAME (polinomio 0x8005 reflejado, desde 0). */
function crc16(b: Uint8Array, from: number, to: number, c = 0): number {
  for (let i = from; i < to; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1 }
  return c
}
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const put32 = (b: Uint8Array, i: number, v: number) => { b[i] = v >>> 24; b[i + 1] = (v >>> 16) & 255; b[i + 2] = (v >>> 8) & 255; b[i + 3] = v & 255 }

/** Dónde termina el audio: antes del ID3v1, el APE y el Lyrics3 del final (que se copian tal cual). */
function audioEnd(b: Uint8Array): number {
  let end = b.length
  const txt = (i: number, n: number) => (i >= 0 ? String.fromCharCode(...b.subarray(i, i + n)) : '')
  for (let changed = true; changed;) {
    changed = false
    if (txt(end - 128, 3) === 'TAG') { end -= 128; changed = true }
    if (txt(end - 32, 8) === 'APETAGEX') { const size = b[end - 20] | (b[end - 19] << 8) | (b[end - 18] << 16) | (b[end - 17] << 24); end -= size + (b[end - 9] & 0x80 ? 32 : 0); changed = true }
    if (txt(end - 9, 9) === 'LYRICS200') { end -= Number(txt(end - 15, 6)) + 15; changed = true }
  }
  return Math.max(0, end)
}

export interface Mp3Layout {
  /** Fin del ID3 de adelante (donde empieza el audio) y fin del audio. */
  start: number; end: number
  sampleRate: number; spf: number
  /** El cuadro de la cabecera Xing/Info, si hay (no es audio). */
  info: Frame | null
  /** Los cuadros de audio. */
  frames: Frame[]
  /** Muestras que ffmpeg se saltea al principio (el retardo de LAME + 529; 0 sin cabecera LAME): el tiempo de PAILA. */
  skip: number
}

/** Los cuadros de un MP3. Tira un error en castellano si no se puede recortar sin recodificar. */
export function mp3Layout(b: Uint8Array): Mp3Layout {
  let start = 0
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) start = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) + (b[5] & 0x10 ? 10 : 0)
  const end = audioEnd(b)
  const frames: Frame[] = []
  let first: Header | null = null, junk = 0
  for (let i = start; i + 4 <= end;) {
    const h = header(b, i)
    // un cuadro vale si el siguiente también empieza bien (o es el último): así no se toma un 0xFF suelto por un cuadro
    if (h && (!first || (h.sampleRate === first.sampleRate && h.version === first.version)) && (i + h.len >= end || header(b, i + h.len))) {
      first ??= h
      frames.push({ at: i, len: Math.min(h.len, end - i) })
      i += h.len
    } else { i++; junk++ }
  }
  if (!first || frames.length < 10) throw new Error(T.sinCuadros)
  if (junk > 64 * 1024) throw new Error(T.roto)
  if (String.fromCharCode(...b.subarray(frames[0].at + 36, frames[0].at + 40)) === 'VBRI') throw new Error(T.vbri)
  const tag = xingAt(b, frames[0].at, first)
  const info = tag != null ? frames.shift()! : null
  const lame = tag != null ? lameAt(b, tag) : null
  const skip = lame ? ((b[lame + 21] << 4) | (b[lame + 22] >> 4)) + 529 : 0
  return { start, end, sampleRate: first.sampleRate, spf: first.spf, info, frames, skip }
}

/** Dónde dice "Xing"/"Info" en el primer cuadro, o null. */
function xingAt(b: Uint8Array, at: number, h: Header): number | null {
  const x = at + 4 + (h.version === 3 ? (h.mono ? 17 : 32) : h.mono ? 9 : 17)
  const t = String.fromCharCode(...b.subarray(x, x + 4))
  return t === 'Xing' || t === 'Info' ? x : null
}
/** Dónde empieza la cabecera de LAME (o de ffmpeg, con el mismo formato) después de los campos de Xing, o null. */
function lameAt(b: Uint8Array, x: number): number | null {
  const flags = u32(b, x + 4)
  const p = x + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0)
  return /^(LAME|Lavc|Lavf|L3\.9|GOGO)/i.test(String.fromCharCode(...b.subarray(p, p + 4))) ? p : null
}

export interface Mp3Cut {
  bytes: Uint8Array
  sampleRate: number; spf: number
  /** Desde qué muestra y hasta cuál (en el tiempo de PAILA del original) quedó el audio; el nuevo empieza en `keptFrom`. */
  keptFrom: number; keptTo: number
  cutStart: boolean; cutEnd: boolean
}

/**
 * Deja el audio entre los segundos `fromSec` y `toSec` (en el tiempo de PAILA: como decodifica ffmpeg), redondeado a cuadros
 * enteros hacia afuera, con un cuadro de más de cada lado que se corta: el primero que queda puede necesitar datos del
 * anterior (la "reserva de bits" del MP3) y sonar mal unos milisegundos; por eso se corta siempre dentro del silencio.
 */
export function cutMp3(b: Uint8Array, fromSec: number, toSec: number): Mp3Cut {
  const L = mp3Layout(b)
  const n = L.frames.length
  const from = Math.round(fromSec * L.sampleRate), to = Math.round(toSec * L.sampleRate)
  const k0 = from > 0 ? Math.max(0, Math.floor((from + L.skip) / L.spf) - 1) : 0
  const k1 = Math.min(n, Math.ceil((to + L.skip) / L.spf) + 1)
  if (k1 - k0 < 10) throw new Error(T.casiNada)
  const kept = L.frames.slice(k0, k1)
  // lo que no se corta se copia entero, con lo que haya entre cuadros (así, sin cortes, el archivo queda idéntico)
  const audio = { from: k0 > 0 ? kept[0].at : L.info ? L.info.at + L.info.len : L.start, to: k1 < n ? kept[kept.length - 1].at + kept[kept.length - 1].len : L.end }
  const dropped = b.subarray(L.info ? L.info.at + L.info.len : L.start, L.frames[0].at)
  // entre el ID3 y el primer cuadro a veces hay basura ("Simple", Callejeros: 408 bytes de ceros y FF); si adentro hay otro tag, no
  if (k0 > 0 && /ID3|TAG|APETAGEX|LYRICS/.test(Buffer.from(dropped).toString('latin1'))) throw new Error(T.algoEntre)
  const info = L.info ? b.slice(L.info.at, L.info.at + L.info.len) : new Uint8Array(0)
  let skip = L.skip
  if (L.info && (k0 > 0 || k1 < n)) skip = fixInfo(b, L, info, kept, audio.to - audio.from, k0 > 0, k1 < n)
  const head = b.subarray(0, L.start), tail = b.subarray(L.end)
  const out = new Uint8Array(head.length + info.length + (audio.to - audio.from) + tail.length)
  out.set(head, 0); out.set(info, head.length); out.set(b.subarray(audio.from, audio.to), head.length + info.length)
  out.set(tail, out.length - tail.length)
  return { bytes: out, sampleRate: L.sampleRate, spf: L.spf, keptFrom: k0 * L.spf + skip - L.skip, keptTo: k1 * L.spf - L.skip, cutStart: k0 > 0, cutEnd: k1 < n }
}

/**
 * Corrige la cabecera Xing/Info (y la de LAME) del cuadro `info` (una copia) para los cuadros que quedan. Los campos de
 * cuadros y bytes siguen la misma cuenta que el original (algunos encoders cuentan el cuadro de la cabecera, otros no).
 * Devuelve las muestras que ffmpeg se va a saltear al principio del nuevo.
 */
function fixInfo(b: Uint8Array, L: Mp3Layout, info: Uint8Array, kept: Frame[], audioBytes: number, cutStart: boolean, cutEnd: boolean): number {
  const h = header(b, L.info!.at)!
  const x = xingAt(info, 0, h)!
  const flags = u32(info, x + 4)
  const origBytes = L.end - L.info!.at, newBytes = info.length + audioBytes
  // ¿la suma de control de la cabecera de LAME estaba bien? (se mira antes de tocar nada: si lo estaba, se rehace)
  const lame = lameAt(info, x)
  const wasValid = lame != null && crc16(info, 0, lame + 34) === ((info[lame + 34] << 8) | info[lame + 35])
  let p = x + 8
  if (flags & 1) { put32(info, p, u32(info, p) - L.frames.length + kept.length); p += 4 }
  if (flags & 2) { put32(info, p, u32(info, p) - origBytes + newBytes); p += 4 }
  if (flags & 4) {
    // índice: en qué byte (de 256) del archivo está cada 1 % del tema
    for (let i = 0, acc = 0, k = 0; i < 100; i++) {
      const target = (i / 100) * kept.length
      while (k < target && k < kept.length) acc += kept[k++].len
      info[p + i] = Math.min(255, Math.floor(((info.length + acc) / newBytes) * 256))
    }
    p += 100
  }
  if (lame == null) return 0
  // retardo y relleno (12 bits cada uno): sin el principio no hay retardo; sin el final, no hay relleno
  let delay = (info[lame + 21] << 4) | (info[lame + 22] >> 4), pad = ((info[lame + 22] & 15) << 8) | info[lame + 23]
  if (cutStart) delay = 0
  if (cutEnd) pad = 0
  info[lame + 21] = delay >> 4; info[lame + 22] = ((delay & 15) << 4) | (pad >> 8); info[lame + 23] = pad & 255
  put32(info, lame + 28, u32(info, lame + 28) - origBytes + newBytes)
  let music = 0
  for (const f of kept) music = crc16(b, f.at, f.at + f.len, music)
  info[lame + 32] = music >> 8; info[lame + 33] = music & 255
  if (wasValid) { const c = crc16(info, 0, lame + 34); info[lame + 34] = c >> 8; info[lame + 35] = c & 255 }
  return delay + 529
}
