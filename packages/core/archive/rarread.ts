// Leer un .rar sin descomprimirlo: recorre los encabezados (RAR4 y RAR5, también partido en varias partes) y anota qué hay
// adentro, cuánto pesa y dónde están sus bytes. Escrito a partir de la descripción pública del formato (técnicas de RAR 5.0
// y la de RAR 2.9/4): no usa código de unRAR, que no se puede repartir con PAILA. Descomprimir lo hace libarchive
// (archive/libarchive.ts) con un "mini RAR" armado acá con solo lo que hace falta (`rarMini`).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { decodeName } from './names'
import { T } from './textos'

/** Un pedazo de un archivo de adentro: en qué parte del .rar está, su encabezado y sus datos. */
export interface RarPart { vol: number; head: number; headLen: number; data: number; dataLen: number }
export interface RarEntry {
  name: string; size: number; packed: number; dir: boolean; encrypted: boolean; mtime: number | null
  /** Necesita lo de antes para descomprimirse (RAR "sólido"). */
  solid: boolean
  parts: RarPart[]
}
export interface RarListing {
  version: 4 | 5
  /** Las partes, en orden (una sola si no está partido). */
  volumes: string[]
  solid: boolean
  /** Con clave hasta para ver los nombres: no se puede listar. */
  locked: boolean
  /** La parte que falta (null si están todas). */
  missing: string | null
  entries: RarEntry[]
}

const SIG5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
const SIG4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
const MAX_HEAD = 2 * 1024 * 1024

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len)
  return b.subarray(0, fs.readSync(fd, b, 0, len, pos))
}

/** Número de largo variable de RAR5 (7 bits por byte, el bit alto dice que sigue). */
function vint(b: Buffer, p: number): [number, number] {
  let v = 0, mul = 1
  for (let i = 0; i < 10 && p < b.length; i++) {
    const c = b[p++]
    v += (c & 0x7f) * mul; mul *= 128
    if (!(c & 0x80)) return [v, p]
  }
  throw new Error(T.rarDanado)
}
const encodeVint = (n: number) => { const o: number[] = []; do { let c = n % 128; n = Math.floor(n / 128); if (n) c |= 0x80; o.push(c) } while (n); return Buffer.from(o) }

/** ¿Es una parte que no es la primera? ("disco.part2.rar"; las viejas .r00 no terminan en .rar.) Esas no se listan solas. */
export const isLaterVolume = (name: string) => /\.part0*([2-9]|[1-9]\d+)\.rar$/i.test(name)

/** El nombre de la parte siguiente: "x.part01.rar" → "x.part02.rar"; el estilo viejo "x.rar" → "x.r00" → "x.r01"… */
export function nextVolume(file: string): string {
  const m = file.match(/^(.*\.part)(\d+)(\.rar)$/i)
  if (m) return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') + m[3]
  if (/\.rar$/i.test(file)) return file.replace(/\.rar$/i, file.endsWith('.RAR') ? '.R00' : '.r00')
  const o = file.match(/^(.*\.)([a-z])(\d\d)$/i)
  if (!o) throw new Error(T.rarSiguiente)
  const n = Number(o[3]) + 1
  return n < 100 ? `${o[1]}${o[2]}${String(n).padStart(2, '0')}` : `${o[1]}${String.fromCharCode(o[2].charCodeAt(0) + 1)}00`
}

const dosTime = (t: number) => { const d = new Date(1980 + (t >>> 25), ((t >>> 21) & 15) - 1, (t >>> 16) & 31, (t >>> 11) & 31, (t >>> 5) & 63, (t & 31) * 2); return Number.isNaN(d.getTime()) ? null : d.getTime() }

/** Lista lo que hay en un .rar (la primera parte, si está partido: sigue solo por las demás). */
export function listRar(file: string): RarListing {
  const out: RarListing = { version: 5, volumes: [], solid: false, locked: false, missing: null, entries: [] }
  let cur = file
  for (let vol = 0; vol < 1000; vol++) {
    if (vol > 0 && !fs.existsSync(cur)) { out.missing = path.basename(cur); break }
    out.volumes.push(cur)
    const fd = fs.openSync(cur, 'r')
    let more: boolean
    try {
      const head = readAt(fd, 0, 8)
      if (head.equals(SIG5)) { out.version = 5; more = rar5(fd, vol, out) }
      else if (head.subarray(0, 7).equals(SIG4)) { out.version = 4; more = rar4(fd, vol, out) }
      else throw new Error(vol ? T.rarNoParte(path.basename(cur)) : T.rarNoEs)
    } finally { fs.closeSync(fd) }
    if (!more || out.locked) break
    cur = nextVolume(cur)
  }
  return out
}

/** Suma un pedazo: si sigue de la parte anterior, va al mismo archivo. */
function addPart(out: RarListing, e: Omit<RarEntry, 'parts' | 'packed'>, part: RarPart, continues: boolean) {
  const last = out.entries[out.entries.length - 1]
  if (continues && last && last.name === e.name) { last.parts.push(part); last.packed += part.dataLen; return }
  out.entries.push({ ...e, packed: part.dataLen, parts: [part] })
}

/** RAR 5: bloques "CRC32, largo, tipo, banderas…". Devuelve si hay otra parte después de esta. */
function rar5(fd: number, vol: number, out: RarListing): boolean {
  const size = fs.fstatSync(fd).size
  let pos = SIG5.length
  while (pos + 7 <= size) {
    const pre = readAt(fd, pos, 14)
    const [headSize, bodyAt] = vint(pre, 4)
    if (headSize < 2 || headSize > MAX_HEAD) throw new Error(T.rarDanado)
    const b = readAt(fd, pos + bodyAt, headSize)
    if (b.length < headSize) throw new Error(T.rarCortado)
    const headLen = bodyAt + headSize
    let p = 0, type: number, hflags: number, extraSize = 0, dataSize = 0
    ;[type, p] = vint(b, p); [hflags, p] = vint(b, p)
    if (hflags & 1) [extraSize, p] = vint(b, p)
    if (hflags & 2) [dataSize, p] = vint(b, p)
    if (type === 1) { // encabezado principal
      const [aflags] = vint(b, p)
      if (aflags & 4) out.solid = true
    } else if (type === 2) { // un archivo
      let fflags: number, unp: number, mtime: number | null = null, comp: number, nameLen: number
      ;[fflags, p] = vint(b, p); [unp, p] = vint(b, p); [, p] = vint(b, p) // atributos
      if (fflags & 2) { mtime = b.readUInt32LE(p) * 1000; p += 4 }
      if (fflags & 4) p += 4 // CRC
      ;[comp, p] = vint(b, p); [, p] = vint(b, p); [nameLen, p] = vint(b, p) // sistema que lo armó
      const name = b.subarray(p, p + nameLen).toString('utf8')
      let encrypted = false
      for (let x = headSize - extraSize; x < headSize;) { // área extra: registros "largo, tipo, datos"
        const [len, q] = vint(b, x)
        const [rt, r] = vint(b, q)
        if (rt === 1) encrypted = true
        if (rt === 3 && !mtime) { const [tf, s] = vint(b, r); if (tf & 2) mtime = tf & 1 ? b.readUInt32LE(s) * 1000 : Number(b.readBigUInt64LE(s) / 10000n) - 11644473600000 }
        x = q + len
      }
      addPart(out, { name, size: unp, dir: !!(fflags & 1), encrypted, mtime, solid: !!(comp & 0x40) },
        { vol, head: pos, headLen, data: pos + headLen, dataLen: dataSize }, !!(hflags & 8))
    } else if (type === 4) { out.locked = true; return false } // encabezados con clave
    else if (type === 5) { const [eflags] = vint(b, p); return !!(eflags & 1) } // fin: ¿hay otra parte?
    pos += headLen + dataSize
  }
  return false
}

/** Nombre Unicode de RAR 2.9/4: los bytes "de siempre", un 0 y la parte que no entra en ellos, comprimida a su manera. */
function rar4Unicode(raw: Buffer): string {
  const z = raw.indexOf(0)
  if (z < 0) return raw.toString('utf8')
  const ansi = raw.subarray(0, z), enc = raw.subarray(z + 1)
  const outc: number[] = []
  let p = 0, flags = 0, bits = 0
  const high = enc[p++] ?? 0
  while (p < enc.length) {
    if (!bits) { flags = enc[p++]; bits = 8 }
    bits -= 2
    switch ((flags >> bits) & 3) {
      case 0: outc.push(enc[p++]); break
      case 1: outc.push(enc[p++] + (high << 8)); break
      case 2: outc.push(enc[p] + (enc[p + 1] << 8)); p += 2; break
      default: {
        const len = enc[p++]
        if (len & 0x80) { const corr = enc[p++]; for (let n = (len & 0x7f) + 2; n > 0; n--) outc.push(((ansi[outc.length] + corr) & 0xff) + (high << 8)) }
        else for (let n = (len & 0x7f) + 2; n > 0; n--) outc.push(ansi[outc.length])
      }
    }
  }
  return String.fromCharCode(...outc.filter((c) => c != null && !Number.isNaN(c)))
}

/** RAR 2.9/4: bloques "CRC16, tipo, banderas, largo". Devuelve si hay otra parte después de esta. */
function rar4(fd: number, vol: number, out: RarListing): boolean {
  const size = fs.fstatSync(fd).size
  let pos = SIG4.length
  let splitAfter = false // sin bloque de fin (RAR muy viejos): hay otra parte si el último archivo sigue en ella
  while (pos + 7 <= size) {
    const h = readAt(fd, pos, 7)
    const type = h[2], flags = h.readUInt16LE(3), headSize = h.readUInt16LE(5)
    if (headSize < 7) throw new Error(T.rarDanado)
    if (type === 0x73) { // encabezado principal
      if (flags & 0x0080) { out.locked = true; return false }
      if (flags & 0x0008) out.solid = true
      pos += headSize; continue
    }
    if (type === 0x7b) return !!(flags & 0x0001) // fin: ¿hay otra parte?
    const b = readAt(fd, pos, headSize)
    if (b.length < headSize) throw new Error(T.rarCortado)
    let add = flags & 0x8000 && headSize >= 11 ? b.readUInt32LE(7) : 0
    if (type === 0x74) { // un archivo
      const large = !!(flags & 0x100)
      let packed = b.readUInt32LE(7), unp = b.readUInt32LE(11)
      if (large) { packed += b.readUInt32LE(32) * 2 ** 32; unp += b.readUInt32LE(36) * 2 ** 32 }
      add = packed
      splitAfter = !!(flags & 2)
      const nameLen = b.readUInt16LE(26), nameAt = large ? 40 : 32
      const raw = b.subarray(nameAt, nameAt + nameLen)
      const name = (flags & 0x200 ? rar4Unicode(raw) : decodeName(raw)).replace(/\\/g, '/')
      addPart(out, { name, size: unp, dir: (flags & 0xe0) === 0xe0, encrypted: !!(flags & 4), mtime: dosTime(b.readUInt32LE(20)), solid: !!(flags & 0x10) },
        { vol, head: pos, headLen: headSize, data: pos + headSize, dataLen: packed }, !!(flags & 1))
    }
    pos += headSize + add
  }
  return splitAfter
}

// ---------- el "mini RAR" para libarchive ----------

const crcOf = (b: Buffer) => zlib.crc32(b) >>> 0
function block5(body: Buffer): Buffer {
  const size = encodeVint(body.length)
  const crc = Buffer.alloc(4); crc.writeUInt32LE(crcOf(Buffer.concat([size, body])))
  return Buffer.concat([crc, size, body])
}
function block4(rest: Buffer): Buffer { // rest = desde el tipo hasta el final
  const b = Buffer.concat([Buffer.alloc(2), rest])
  b.writeUInt16LE(crcOf(rest) & 0xffff, 0)
  return b
}

/** Qué bytes leer, y en qué orden, para descomprimir un archivo: pedazos fijos (Buffer) y rangos de las partes. */
export type Piece = Buffer | { vol: number; start: number; len: number }

/**
 * Lo mínimo para que libarchive saque `e`: la firma, un encabezado principal, el del archivo y sus datos (todas las partes
 * juntas, si estaba partido), y el fin. Si es "sólido" hace falta todo lo de antes: va el .rar desde el principio hasta
 * el final de este archivo (solo sin partes). null si no se puede (sólido y partido en varias partes).
 */
export function rarMini(list: RarListing, e: RarEntry, readHead: (p: RarPart) => Buffer): Piece[] | null {
  const end = list.version === 5 ? block5(Buffer.concat([encodeVint(5), encodeVint(0), encodeVint(0)])) : block4(Buffer.from([0x7b, 0x00, 0x40, 0x07, 0x00]))
  if (e.solid) {
    if (list.volumes.length > 1) return null
    const last = e.parts[e.parts.length - 1]
    return [{ vol: 0, start: 0, len: last.data + last.dataLen }, end]
  }
  const sig = list.version === 5 ? SIG5 : SIG4
  const main = list.version === 5 ? block5(Buffer.concat([encodeVint(1), encodeVint(0), encodeVint(0)])) : block4(Buffer.from([0x73, 0x00, 0x00, 0x0d, 0x00, 0, 0, 0, 0, 0, 0]))
  const data: Piece[] = e.parts.map((p) => ({ vol: p.vol, start: p.data, len: p.dataLen }))
  const lastHead = readHead(e.parts[e.parts.length - 1])
  const head = e.parts.length === 1 ? readHead(e.parts[0]) : list.version === 5 ? joinHead5(lastHead, e.packed) : joinHead4(lastHead, e.packed)
  if (!head) return null
  return [sig, main, head, ...data, end]
}

/** Encabezado RAR5 de un archivo partido, rehecho como si estuviera entero (sin "sigue en la otra parte" y con todo el largo). */
function joinHead5(h: Buffer, total: number): Buffer {
  const [, bodyAt] = vint(h, 4)
  const b = h.subarray(bodyAt)
  let p = 0, type: number, hflags: number, extra = 0
  ;[type, p] = vint(b, p); [hflags, p] = vint(b, p)
  if (hflags & 1) [extra, p] = vint(b, p)
  if (hflags & 2) [, p] = vint(b, p)
  const flags = (hflags & ~0x18) | 2
  return block5(Buffer.concat([encodeVint(type), encodeVint(flags), ...(flags & 1 ? [encodeVint(extra)] : []), encodeVint(total), b.subarray(p)]))
}

/** Lo mismo en RAR 2.9/4 (CRC de 16 bits; con más de 4 GB hace falta que ya traiga los campos grandes). */
function joinHead4(h: Buffer, total: number): Buffer | null {
  const b = Buffer.from(h)
  const flags = b.readUInt16LE(3) & ~0x03
  if (total >= 2 ** 32 && !(flags & 0x100)) return null
  b.writeUInt16LE(flags, 3)
  b.writeUInt32LE(total % 2 ** 32, 7)
  if (flags & 0x100) b.writeUInt32LE(Math.floor(total / 2 ** 32), 32)
  return block4(b.subarray(2))
}

/** El encabezado tal cual de un pedazo (para el mini RAR). */
export function readRarHead(list: RarListing, p: RarPart): Buffer {
  const fd = fs.openSync(list.volumes[p.vol], 'r')
  try { return readAt(fd, p.head, p.headLen) } finally { fs.closeSync(fd) }
}
