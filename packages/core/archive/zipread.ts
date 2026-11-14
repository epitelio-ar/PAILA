// Leer un .zip sin abrirlo entero: el índice del final (directorio central) dice qué hay adentro, cuánto pesa y dónde
// empieza cada archivo. Sacar uno es leer solo sus bytes (guardado tal cual o con deflate, lo de casi todos los zip).
// Sin dependencias: zlib de Node. Los métodos raros (bzip2, lzma…) los saca libarchive (archive/libarchive.ts).
import fs from 'node:fs'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { decodeName } from './names'
import { T } from './textos'

export interface ZipEntry {
  name: string
  size: number
  packed: number
  /** 0 = guardado tal cual, 8 = deflate; otros, raros (los saca libarchive). */
  method: number
  crc: number
  encrypted: boolean
  dir: boolean
  mtime: number | null
  /** Dónde empieza su encabezado local (los datos van después). */
  offset: number
}

const EOCD = 0x06054b50, EOCD64 = 0x06064b50, LOC64 = 0x07064b50, CEN = 0x02014b50, LOC = 0x04034b50

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len)
  const n = fs.readSync(fd, b, 0, len, pos)
  return n === len ? b : b.subarray(0, n)
}

/** Fecha y hora de MS-DOS → milisegundos (hora local). */
function dosDate(time: number, date: number): number | null {
  if (!date) return null
  const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** La lista de lo que hay adentro. Falla con un error en castellano si no es un zip o está cortado. */
export function listZip(file: string): ZipEntry[] {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    // el final del índice está en los últimos 22 bytes, más un comentario de hasta 64 KB
    const tailLen = Math.min(size, 22 + 65535)
    const tail = readAt(fd, size - tailLen, tailLen)
    let at = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { at = i; break }
    if (at < 0) throw new Error(T.zipSinIndice)
    let count = tail.readUInt16LE(at + 10)
    let cdSize = tail.readUInt32LE(at + 12)
    let cdOffset = tail.readUInt32LE(at + 16)
    // ZIP64 (más de 4 GB o más de 65.535 archivos)
    if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && at >= 20 && tail.readUInt32LE(at - 20) === LOC64) {
      const z = readAt(fd, Number(tail.readBigUInt64LE(at - 20 + 8)), 56)
      if (z.length === 56 && z.readUInt32LE(0) === EOCD64) {
        count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOffset = Number(z.readBigUInt64LE(48))
      }
    }
    if (cdOffset + cdSize > size) throw new Error(T.zipCortado)
    const cd = readAt(fd, cdOffset, cdSize)
    const out: ZipEntry[] = []
    let p = 0
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CEN) throw new Error(T.zipIndiceDanado)
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10)
      let packed = cd.readUInt32LE(p + 20), unpacked = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42)
      const nLen = cd.readUInt16LE(p + 28), xLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32)
      const rawName = cd.subarray(p + 46, p + 46 + nLen)
      const extra = cd.subarray(p + 46 + nLen, p + 46 + nLen + xLen)
      let unicode: string | null = null
      for (let x = 0; x + 4 <= extra.length;) {
        const id = extra.readUInt16LE(x), len = extra.readUInt16LE(x + 2), d = extra.subarray(x + 4, x + 4 + len)
        if (id === 0x0001) { // ZIP64: van solo los que no entraron en 32 bits, en este orden
          let k = 0
          const big = () => { const v = k + 8 <= d.length ? Number(d.readBigUInt64LE(k)) : 0; k += 8; return v }
          if (unpacked === 0xffffffff) unpacked = big()
          if (packed === 0xffffffff) packed = big()
          if (offset === 0xffffffff) offset = big()
        } else if (id === 0x7075 && d.length > 5) unicode = d.subarray(5).toString('utf8') // nombre en Unicode (Info-ZIP)
        x += 4 + len
      }
      const name = (unicode ?? decodeName(rawName, (flags & 0x800) !== 0)).replace(/\\/g, '/')
      out.push({
        name, size: unpacked, packed, method, crc: cd.readUInt32LE(p + 16), encrypted: (flags & 1) !== 0,
        dir: name.endsWith('/'), mtime: dosDate(cd.readUInt16LE(p + 12), cd.readUInt16LE(p + 14)), offset,
      })
      p += 46 + nLen + xLen + cLen
    }
    return out
  } finally { fs.closeSync(fd) }
}

/** Dónde empiezan los datos de un archivo del zip (después de su encabezado local) y cuánto miden. */
export function zipDataRange(file: string, e: ZipEntry): { start: number; end: number } {
  const fd = fs.openSync(file, 'r')
  try {
    const h = readAt(fd, e.offset, 30)
    if (h.length < 30 || h.readUInt32LE(0) !== LOC) throw new Error(T.zipSinArchivo)
    const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28)
    return { start, end: start + e.packed }
  } finally { fs.closeSync(fd) }
}

/** ¿Lo puede sacar este lector? (Sin clave, guardado tal cual o con deflate.) */
export const zipCanRead = (e: ZipEntry) => !e.encrypted && (e.method === 0 || e.method === 8)

/**
 * Saca un archivo del zip a `dest` leyendo solo sus bytes, y comprueba el CRC (si el zip está dañado, falla y no deja nada).
 * `signal` corta a mitad de camino.
 */
export async function extractZipEntry(file: string, e: ZipEntry, dest: string, signal?: AbortSignal): Promise<void> {
  if (!zipCanRead(e)) throw new Error(T.zipOtroLector)
  const { start, end } = zipDataRange(file, e)
  let crc = 0, n = 0
  const count = new Transform({ transform(chunk: Buffer, _enc, cb) { crc = zlib.crc32(chunk, crc); n += chunk.length; cb(null, chunk) } })
  const src = e.packed ? fs.createReadStream(file, { start, end: end - 1 }) : (async function* () { /* vacío */ })()
  try {
    if (e.method === 8) await pipeline(src, zlib.createInflateRaw(), count, fs.createWriteStream(dest), { signal })
    else await pipeline(src, count, fs.createWriteStream(dest), { signal })
    if (n !== e.size || (crc >>> 0) !== (e.crc >>> 0)) throw Object.assign(new Error(T.zipNoCoincide), { danado: true })
  } catch (err) {
    fs.rmSync(dest, { force: true })
    // el aviso de "está dañado" va tal cual; cualquier otro error, con "No se pudo sacar del zip" adelante (marca, no texto)
    throw (err as Error).name === 'AbortError' || (err as { danado?: boolean }).danado ? err : new Error(T.zipNoSacar((err as Error).message))
  }
}
