// Lee la cabecera Xing/Info + LAME de un MP3: con qué se codificó y a qué frecuencia cortaba el encoder.
import fs from 'node:fs'

export interface Mp3Info {
  encoder: string | null // ej. "LAME3.100"
  vbrMethod: 'CBR' | 'ABR' | 'VBR' | null
  lowpassHz: number | null // corte que usó el encoder (si lo guardó)
}

const SAMPLE_RATES = [[11025, 12000, 8000], [0, 0, 0], [22050, 24000, 16000], [44100, 48000, 32000]] // por versión MPEG

export function readMp3Info(file: string): Mp3Info {
  const none: Mp3Info = { encoder: null, vbrMethod: null, lowpassHz: null }
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(10)
    fs.readSync(fd, head, 0, 10, 0)
    let start = 0
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
      start = 10 + size + (head[5] & 0x10 ? 10 : 0)
    }
    const buf = Buffer.alloc(64 * 1024)
    const len = fs.readSync(fd, buf, 0, buf.length, start)
    for (let i = 0; i + 4 < len; i++) {
      if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue
      const version = (buf[i + 1] >> 3) & 3 // 3 = MPEG1
      const layer = (buf[i + 1] >> 1) & 3 // 1 = Layer III
      const srIdx = (buf[i + 2] >> 2) & 3
      if (version === 1 || layer !== 1 || srIdx === 3 || !SAMPLE_RATES[version][srIdx]) continue
      const mono = ((buf[i + 3] >> 6) & 3) === 3
      const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17
      const x = i + 4 + side
      const tag = buf.toString('latin1', x, x + 4)
      if (tag !== 'Xing' && tag !== 'Info') return { ...none, vbrMethod: 'CBR' } // primer cuadro sin cabecera: CBR clásico
      const flags = buf.readUInt32BE(x + 4)
      let p = x + 8
      if (flags & 1) p += 4
      if (flags & 2) p += 4
      if (flags & 4) p += 100
      if (flags & 8) p += 4
      const encoder = buf.toString('latin1', p, p + 9).replace(/[^\x20-\x7e]/g, '').trim() || null
      const isLame = !!encoder && /^(LAME|Lavc|Lavf|GOGO|L3\.)/i.test(encoder)
      const method = isLame ? buf[p + 9] & 0x0f : 0
      const vbrMethod = [1, 8].includes(method) ? 'CBR' : [2, 9].includes(method) ? 'ABR' : method >= 3 && method <= 6 ? 'VBR' : tag === 'Info' ? 'CBR' : 'VBR'
      const lowpass = isLame && /^LAME/i.test(encoder) ? buf[p + 10] * 100 : 0
      return { encoder, vbrMethod, lowpassHz: lowpass > 0 ? lowpass : null }
    }
    return none
  } catch {
    return none
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** El primer cuadro de un MP3: si tiene cabecera Xing/Info, si es de LAME y el retardo del encoder (muestras). */
export interface Mp3Start { xing: boolean; lame: boolean; encoderDelay: number | null; sampleRate: number | null; /** "LAME3.100", "Lavc58.35"… */ encoder: string | null
  /** Cabecera de LAME de verdad (no de ffmpeg), con su suma de control bien: Traktor la saltea como Rekordbox (`traktorMp3Shift`). */
  lameValid?: boolean }

export function readMp3Start(file: string): Mp3Start {
  const none: Mp3Start = { xing: false, lame: false, encoderDelay: null, sampleRate: null, encoder: null }
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(10)
    fs.readSync(fd, head, 0, 10, 0)
    let start = 0
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
      start = 10 + size + (head[5] & 0x10 ? 10 : 0)
    }
    const buf = Buffer.alloc(64 * 1024)
    const len = fs.readSync(fd, buf, 0, buf.length, start)
    for (let i = 0; i + 4 < len; i++) {
      if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue
      const version = (buf[i + 1] >> 3) & 3
      const layer = (buf[i + 1] >> 1) & 3
      const srIdx = (buf[i + 2] >> 2) & 3
      if (version === 1 || layer !== 1 || srIdx === 3 || !SAMPLE_RATES[version][srIdx]) continue
      const sampleRate = SAMPLE_RATES[version][srIdx]
      const mono = ((buf[i + 3] >> 6) & 3) === 3
      const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17
      const x = i + 4 + side
      const tag = buf.toString('latin1', x, x + 4)
      if (tag !== 'Xing' && tag !== 'Info') return { ...none, sampleRate }
      const flags = buf.readUInt32BE(x + 4)
      let p = x + 8
      if (flags & 1) p += 4
      if (flags & 2) p += 4
      if (flags & 4) p += 100
      if (flags & 8) p += 4
      const enc = buf.toString('latin1', p, p + 4)
      const lame = /^(LAME|Lavc|Lavf|L3\.9|GOGO)/i.test(enc) && p + 24 <= len
      // retardo del encoder: 12 bits a partir del byte 21 de la cabecera LAME
      const encoderDelay = lame ? (buf[p + 21] << 4) | (buf[p + 22] >> 4) : null
      return { xing: true, lame, encoderDelay, sampleRate, encoder: lame ? buf.toString('latin1', p, p + 9).replace(/[^ -~]/g, '').trim() : null, lameValid: lameValid(buf, i, x, len) }
    }
    return none
  } catch {
    return none
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** CRC-16 de LAME (polinomio 0x8005 reflejado, desde 0). */
function crc16(b: Buffer, from: number, to: number): number {
  let c = 0
  for (let i = from; i < to; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1 }
  return c
}
/**
 * Como lo mira dj-data-converter (mp3-parser, lame.cljc): la cabecera de LAME va 120 bytes después de "Xing"/"Info", dice
 * "LAME…" con revisión 0, 1 o 15, y su suma de control (los bytes del cuadro hasta ella) coincide.
 */
function lameValid(b: Buffer, frame: number, xing: number, len: number): boolean {
  const t = xing + 120, crcAt = t + 34
  if (crcAt + 2 > len || !/^LAME/.test(b.toString('latin1', t, t + 4))) return false
  const rev = b[t + 9] >> 4
  return (rev === 0 || rev === 1 || rev === 15) && crc16(b, frame, crcAt) === b.readUInt16BE(crcAt)
}

/**
 * Cuántos segundos corre Traktor un MP3 respecto de Rekordbox (regla de dj-data-converter, offset.clj): Traktor toca el
 * cuadro de la cabecera Xing/Info como 26 ms de sonido salvo que sea una cabecera de LAME válida; Rekordbox no. Los MP3
 * sin cabecera, igual en los dos.
 */
export function traktorMp3Shift(file: string): number {
  const s = readMp3Start(file)
  return s.xing && !s.lameValid ? 0.026 : 0
}

/** Cuántas muestras del principio se saltea ffmpeg al decodificar (el retardo de LAME + 529 del decodificador; 0 si no hay cabecera LAME). */
export function mp3StartPadding(file: string): number {
  const s = readMp3Start(file)
  return s.lame && s.encoderDelay != null ? s.encoderDelay + 529 : 0
}

/**
 * Cuántas muestras corre Rekordbox un MP3 respecto de PAILA (ffmpeg, que se saltea el relleno del principio de cualquier
 * MP3 con cabecera LAME). Medido con la grilla de una colección real de Rekordbox (docs/archivo/pruebas/2026-10-21-rekordbox-pro.md):
 * - cabecera escrita por ffmpeg ("Lavc", "Lavf"; por ejemplo los de slider.kz): Rekordbox no se saltea el relleno
 *   (retardo + 529 muestras, ~25 ms: el "desfase de 0,025 s" conocido);
 * - cabecera escrita por LAME: además cuenta la cabecera misma como un cuadro de silencio (1152 muestras), ~51 ms;
 * - sin cabecera: nada.
 */
export function rekordboxMp3Shift(file: string): number {
  const s = readMp3Start(file)
  if (!s.lame || s.encoderDelay == null) return 0
  const pad = s.encoderDelay + 529
  return /^LAME/i.test(s.encoder ?? '') ? pad + ((s.sampleRate ?? 44100) >= 32000 ? 1152 : 576) : pad
}
