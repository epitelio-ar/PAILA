// Recortar el principio y/o el final de un archivo de audio sin perder nada (recortar silencios, core/trim.ts), con los tags
// intactos, y verificar el resultado antes de usarlo:
// - WAV y AIFF: se cortan las muestras del bloque de audio; los demás bloques (tags, bext…) se copian tal cual. Verificado bit a bit.
// - FLAC: el audio se vuelve a armar sin pérdida y se le pegan los bloques del original (tags, tapas). Verificado bit a bit.
// - MP3: cuadros enteros, sin recodificar (core/trimmp3.ts). Verificado muestra por muestra contra el original.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { Readable } from 'node:stream'
import { lowPriority } from './lowpriority'
import { cutMp3 } from './trimmp3'
import { T } from './trim.textos'

export const TRIM_FORMATS = ['mp3', 'flac', 'wav', 'aiff', 'aif']

export interface TrimDone {
  /** Desde qué segundo y hasta cuál del original quedó el audio (en MP3, redondeado a cuadros). */
  keptFrom: number; keptTo: number
}

const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const setLe32 = (b: Uint8Array, i: number, v: number) => { b[i] = v & 255; b[i + 1] = (v >>> 8) & 255; b[i + 2] = (v >>> 16) & 255; b[i + 3] = v >>> 24 }
const id = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])

/** Un WAV con solo el audio entre los segundos `fromSec` y `toSec`, y qué muestras quedaron. Puro. */
export function cutWav(b: Uint8Array, fromSec: number, toSec: number): { bytes: Uint8Array; sampleRate: number; s0: number; s1: number } {
  if (id(b, 0) !== 'RIFF' || id(b, 8) !== 'WAVE') throw new Error(id(b, 0) === 'RF64' ? T.rf64 : T.noWav)
  const chunks: { id: string; at: number; size: number }[] = []
  for (let i = 12; i + 8 <= b.length;) {
    let size = le32(b, i + 4)
    if (id(b, i) === 'data' && (size === 0 || size === 0xffffffff || i + 8 + size > b.length)) size = b.length - i - 8 // WAV grabado "en vivo", sin el tamaño
    chunks.push({ id: id(b, i), at: i, size })
    i += 8 + size + (size & 1)
  }
  const fmt = chunks.find((c) => c.id === 'fmt '), data = chunks.find((c) => c.id === 'data')
  if (!fmt || !data) throw new Error(T.faltaAudio('WAV'))
  const format = b[fmt.at + 8] | (b[fmt.at + 9] << 8)
  if (![1, 3, 0xfffe].includes(format)) throw new Error(T.comprimido('WAV'))
  const sampleRate = le32(b, fmt.at + 12), align = b[fmt.at + 20] | (b[fmt.at + 21] << 8)
  const total = Math.floor(data.size / align)
  const s0 = Math.max(0, Math.min(total, Math.round(fromSec * sampleRate))), s1 = Math.max(s0, Math.min(total, Math.round(toSec * sampleRate)))
  const audio = b.subarray(data.at + 8 + s0 * align, data.at + 8 + s1 * align)
  const parts: Uint8Array[] = []
  for (const c of chunks) {
    if (c === data) {
      const h = new Uint8Array(8); h.set(b.subarray(c.at, c.at + 4)); setLe32(h, 4, audio.length)
      parts.push(h, audio, new Uint8Array(audio.length & 1))
    } else {
      const copy = b.slice(c.at, Math.min(b.length, c.at + 8 + c.size + (c.size & 1)))
      if (c.id === 'fact' && c.size >= 4) setLe32(copy, 8, s1 - s0)
      parts.push(copy)
    }
  }
  const out = new Uint8Array(12 + parts.reduce((n, p) => n + p.length, 0))
  out.set(b.subarray(0, 12)); setLe32(out, 4, out.length - 8)
  let at = 12
  for (const p of parts) { out.set(p, at); at += p.length }
  return { bytes: out, sampleRate, s0, s1 }
}

/**
 * Un AIFF (o AIFC sin comprimir) con solo el audio entre los segundos `fromSec` y `toSec`. Igual que el WAV, pero en orden
 * "big endian": las muestras del bloque SSND, la cantidad en COMM; lo demás (el ID3 con los tags) tal cual. Puro.
 */
export function cutAiff(b: Uint8Array, fromSec: number, toSec: number): { bytes: Uint8Array; sampleRate: number; s0: number; s1: number } {
  const v = Buffer.from(b.buffer, b.byteOffset, b.length)
  if (id(b, 0) !== 'FORM' || !['AIFF', 'AIFC'].includes(id(b, 8))) throw new Error(T.noAiff)
  const chunks: { id: string; at: number; size: number }[] = []
  for (let i = 12; i + 8 <= b.length;) { const size = Math.min(v.readUInt32BE(i + 4), b.length - i - 8); chunks.push({ id: id(b, i), at: i, size }); i += 8 + size + (size & 1) }
  const comm = chunks.find((c) => c.id === 'COMM'), ssnd = chunks.find((c) => c.id === 'SSND')
  if (!comm || !ssnd) throw new Error(T.faltaAudio('AIFF'))
  if (id(b, 8) === 'AIFC' && !['NONE', 'sowt', 'twos'].includes(id(b, comm.at + 26))) throw new Error(T.comprimido('AIFF'))
  const channels = v.readUInt16BE(comm.at + 8), bits = v.readUInt16BE(comm.at + 14)
  // la frecuencia viene en "extended" de 80 bits
  const exp = v.readUInt16BE(comm.at + 16) & 0x7fff, mant = v.readUInt32BE(comm.at + 18)
  const sampleRate = Math.round(mant * 2 ** (exp - 16383 - 31))
  const align = channels * Math.ceil(bits / 8), offset = v.readUInt32BE(ssnd.at + 8)
  const total = Math.floor((ssnd.size - 8 - offset) / align)
  const s0 = Math.max(0, Math.min(total, Math.round(fromSec * sampleRate))), s1 = Math.max(s0, Math.min(total, Math.round(toSec * sampleRate)))
  const start = ssnd.at + 16 + offset
  const parts: Uint8Array[] = []
  for (const c of chunks) {
    if (c === ssnd) {
      const audio = b.subarray(start + s0 * align, start + s1 * align)
      const h = Buffer.alloc(16); b.subarray(c.at, c.at + 4).forEach((x, k) => { h[k] = x }); h.writeUInt32BE(8 + audio.length, 4); h.writeUInt32BE(0, 8); h.writeUInt32BE(0, 12)
      parts.push(h, audio, new Uint8Array(audio.length & 1))
    } else {
      const copy = Buffer.from(b.slice(c.at, Math.min(b.length, c.at + 8 + c.size + (c.size & 1))))
      if (c === comm) copy.writeUInt32BE(s1 - s0, 10)
      parts.push(copy)
    }
  }
  const out = new Uint8Array(12 + parts.reduce((n, x) => n + x.length, 0))
  out.set(b.subarray(0, 12)); Buffer.from(out.buffer).writeUInt32BE(out.length - 8, 4)
  let at = 12
  for (const x of parts) { out.set(x, at); at += x.length }
  return { bytes: out, sampleRate, s0, s1 }
}

interface FlacBlock { type: number; body: Uint8Array }
/** Los bloques de metadatos de un FLAC (con lo que haya antes de "fLaC", por ejemplo un ID3 pegado) y dónde empieza el audio. */
function flacBlocks(b: Uint8Array): { prefix: Uint8Array; blocks: FlacBlock[]; audio: number } {
  const at = Buffer.from(b.buffer, b.byteOffset, Math.min(b.length, 1 << 20)).indexOf('fLaC')
  if (at < 0) throw new Error(T.noFlac)
  const blocks: FlacBlock[] = []
  let i = at + 4
  for (let last = false; !last && i + 4 <= b.length;) {
    last = (b[i] & 0x80) !== 0
    const len = (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]
    blocks.push({ type: b[i] & 0x7f, body: b.subarray(i + 4, i + 4 + len) })
    i += 4 + len
  }
  return { prefix: b.subarray(0, at), blocks, audio: i }
}
/** Muestras por segundo, bits y cuántas muestras tiene un FLAC (de su STREAMINFO). */
export function flacInfo(b: Uint8Array): { sampleRate: number; bits: number; samples: number } {
  const si = flacBlocks(b).blocks[0].body
  const samples = (si[13] & 15) * 2 ** 32 + (((si[14] << 24) | (si[15] << 16) | (si[16] << 8) | si[17]) >>> 0)
  return { sampleRate: (si[10] << 12) | (si[11] << 4) | (si[12] >> 4), bits: (((si[12] & 1) << 4) | (si[13] >> 4)) + 1, samples }
}

/**
 * Un FLAC nuevo con el audio de `encoded` (lo que armó ffmpeg con el pedazo justo) y los metadatos del original: los tags,
 * las tapas y todo lo demás quedan byte a byte (salvo STREAMINFO y la tabla de saltos, que son del audio nuevo).
 */
export function spliceFlac(original: Uint8Array, encoded: Uint8Array, cutStart: boolean): Uint8Array {
  const o = flacBlocks(original), e = flacBlocks(encoded)
  // la hoja de cue (CUESHEET) cuenta muestras desde el principio: si se corta el principio quedaría corrida
  if (cutStart && o.blocks.some((x) => x.type === 5)) throw new Error(T.hojaCue)
  const blocks = [e.blocks[0], ...e.blocks.filter((x) => x.type === 3), ...o.blocks.filter((x) => x.type !== 0 && x.type !== 3)]
  const size = o.prefix.length + 4 + blocks.reduce((n, x) => n + 4 + x.body.length, 0) + (encoded.length - e.audio)
  const out = new Uint8Array(size)
  out.set(o.prefix); let at = o.prefix.length
  out.set([0x66, 0x4c, 0x61, 0x43], at); at += 4
  blocks.forEach((x, k) => {
    out[at] = (k === blocks.length - 1 ? 0x80 : 0) | x.type
    out[at + 1] = x.body.length >> 16; out[at + 2] = (x.body.length >> 8) & 255; out[at + 3] = x.body.length & 255
    out.set(x.body, at + 4); at += 4 + x.body.length
  })
  out.set(encoded.subarray(e.audio), at)
  return out
}

function ffmpegRun(ffmpeg: string, args: string[], out?: (s: Readable) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-nostdin', ...args], { windowsHide: true })
    lowPriority(p.pid)
    let stdout = '', err = ''
    if (out) out(p.stdout); else p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { if (err.length < 20_000) err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(err.trim().split(/\r?\n/).pop() || T.ffmpeg(code)))))
  })
}
/** El filtro de ffmpeg que deja las muestras `from`…`to` (sin `to`: hasta el final). */
const atrim = (from: number, to: number | null) => `atrim=start_sample=${from}${to != null ? `:end_sample=${to}` : ''}`
/** MD5 del audio decodificado (PCM de 32 bits), de todo o de las muestras `from`…`to`. */
async function pcmMd5(ffmpeg: string, file: string, range?: [number, number | null]): Promise<string> {
  const af = range ? ['-af', atrim(range[0], range[1])] : []
  const md5 = (await ffmpegRun(ffmpeg, ['-i', file, '-map', '0:a:0', ...af, '-c:a', 'pcm_s32le', '-f', 'md5', '-'])).match(/MD5=([0-9a-f]+)/i)?.[1]
  if (!md5) throw new Error(T.noVerifica)
  return md5
}

/** Lee un stream de a pedazos del tamaño pedido (menos al final). */
function reader(s: Readable): (n: number) => Promise<Buffer> {
  const it = s[Symbol.asyncIterator]()
  let buf: Buffer = Buffer.alloc(0), done = false
  return async (n) => {
    while (buf.length < n && !done) { const r = await it.next(); if (r.done) done = true; else buf = buf.length ? Buffer.concat([buf, r.value as Buffer]) : (r.value as Buffer) }
    const out = buf.subarray(0, n); buf = buf.subarray(n); return out
  }
}

/**
 * El MP3 recortado tiene que sonar igual que el original corrido `offset` muestras: se decodifican los dos y se comparan
 * muestra por muestra, salvo los primeros cuadros después del corte (`warm`: la reserva de bits del MP3; ahí, como se corta
 * dentro del silencio, tiene que haber silencio: si no, arrancaría con un ruido) y el último
 * (`tail`). Devuelve cuántas muestras tiene el recortado.
 */
async function sameMp3Audio(ffmpeg: string, orig: string, trimmed: string, offset: number, warm: number, tail: number): Promise<number> {
  const args = (f: string) => ['-v', 'error', '-nostdin', '-i', f, '-map', '0:a:0', '-ac', '2', '-f', 's16le', '-']
  const pa = spawn(ffmpeg, args(orig), { windowsHide: true }), pb = spawn(ffmpeg, args(trimmed), { windowsHide: true })
  lowPriority(pa.pid); lowPriority(pb.pid)
  const ra = reader(pa.stdout), rb = reader(pb.stdout)
  const CHUNK = 1 << 16
  try {
    for (let skip = Math.max(0, offset) * 4; skip > 0;) { const x = await ra(Math.min(skip, CHUNK)); if (!x.length) break; skip -= x.length }
    for (let skip = Math.max(0, -offset) * 4; skip > 0;) { const x = await rb(Math.min(skip, CHUNK)); if (!x.length) break; skip -= x.length }
    let pos = Math.max(0, -offset), lastBad = -1, loudAtStart = 0
    for (;;) {
      const b = await rb(CHUNK)
      if (!b.length) break
      const a = await ra(b.length)
      if (a.length < b.length) throw new Error(T.masLargo)
      for (let i = 0; i < b.length && pos + (i >> 2) < warm; i += 2) loudAtStart = Math.max(loudAtStart, Math.abs(b.readInt16LE(i)))
      if (!a.equals(b)) for (let i = 0; i < b.length; i += 2) if (a.readInt16LE(i) !== b.readInt16LE(i) && pos + (i >> 2) >= warm) lastBad = pos + (i >> 2)
      pos += b.length >> 2
    }
    // −60 dB: lo que se oye (el silencio del principio de "Paja brava" daba 5 de 32.767, unos −76 dB)
    if ((lastBad >= 0 && lastBad < pos - tail) || loudAtStart > 33) throw new Error(T.noSuenaIgual('MP3'))
    return pos
  } finally {
    // hay que esperar a que se cierren: si no, en Windows el original sigue abierto un instante y moverlo a la papelera falla
    // ("EBUSY", visto al correr los tests con la PC cargada)
    // (se espera la salida, no el cierre: lo que quedó sin leer se descarta)
    await Promise.all([pa, pb].map((p) => new Promise<void>((r) => { p.stdout.resume(); if (p.exitCode != null || p.signalCode != null) r(); else { p.once('exit', () => r()); p.kill() } })))
  }
}

/**
 * Deja en `out` el audio de `src` entre los segundos `from` y `to` (en el tiempo de PAILA, como decodifica ffmpeg), con los
 * tags intactos, y lo verifica. Si algo no da, tira un error en castellano y no deja nada en `out`.
 */
export async function trimToFile(ffmpeg: string, src: string, ext: string, from: number, to: number, out: string): Promise<TrimDone> {
  const b = new Uint8Array(fs.readFileSync(src))
  try {
    if (ext === 'wav' || ext === 'aiff' || ext === 'aif') {
      const w = ext === 'wav' ? cutWav(b, from, to) : cutAiff(b, from, to)
      fs.writeFileSync(out, w.bytes)
      if (await pcmMd5(ffmpeg, out) !== await pcmMd5(ffmpeg, src, [w.s0, w.s1])) throw new Error(T.noSuenaIgual(ext.toUpperCase()))
      return { keptFrom: w.s0 / w.sampleRate, keptTo: w.s1 / w.sampleRate }
    }
    if (ext === 'flac') {
      const { sampleRate, bits, samples } = flacInfo(b)
      const s0 = Math.round(from * sampleRate), s1 = Number.isFinite(to) && (!samples || to * sampleRate < samples) ? Math.round(to * sampleRate) : null
      const fmt = bits <= 16 ? ['-sample_fmt', 's16'] : ['-sample_fmt', 's32', '-bits_per_raw_sample', String(bits)]
      await ffmpegRun(ffmpeg, ['-y', '-threads', '1', '-i', src, '-map', '0:a:0', '-map_metadata', '-1', '-af', atrim(s0, s1), '-c:a', 'flac', '-compression_level', '8', ...fmt, out])
      fs.writeFileSync(out, spliceFlac(b, new Uint8Array(fs.readFileSync(out)), s0 > 0))
      if (await pcmMd5(ffmpeg, out) !== await pcmMd5(ffmpeg, src, [s0, s1])) throw new Error(T.noSuenaIgual('FLAC'))
      return { keptFrom: s0 / sampleRate, keptTo: (s1 ?? samples) / sampleRate }
    }
    if (ext === 'mp3') {
      const c = cutMp3(b, from, to)
      fs.writeFileSync(out, c.bytes)
      const total = await sameMp3Audio(ffmpeg, src, out, c.keptFrom, c.cutStart ? 4 * c.spf + 529 : 0, c.spf)
      if (c.cutEnd && Math.abs(total - (c.keptTo - c.keptFrom)) > 2 * c.spf) throw new Error(T.noDura)
      return { keptFrom: c.keptFrom / c.sampleRate, keptTo: (c.keptFrom + total) / c.sampleRate }
    }
    throw new Error(T.noFormato(ext))
  } catch (e) { fs.rmSync(out, { force: true }); throw e }
}
