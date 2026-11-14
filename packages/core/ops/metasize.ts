// Cuánto ocupan los metadatos de un archivo de audio (tags, tapas, índices), sin el audio: es lo que va a guardar el respaldo
// liviano (ops/delta.ts) cuando PAILA cambie algo de adentro. Sirve para la vista previa ("unos 3 MB") antes de escribir
// nada: lee solo los encabezados de cada formato, sin decodificar. Si no conoce el formato, cuenta el archivo entero.
import fs from 'node:fs'
import path from 'node:path'

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len)
  const n = fs.readSync(fd, b, 0, len, pos)
  return b.subarray(0, n)
}

/** Recorre bloques "tipo + tamaño" (RIFF, AIFF, MP4) y suma todos menos el del audio. */
function chunks(fd: number, size: number, start: number, audio: string[], head: (b: Buffer) => { id: string; len: number; hdr: number } | null, pad: boolean) {
  let meta = start, pos = start
  for (let guard = 0; pos + 8 <= size && guard < 10000; guard++) {
    const h = head(readAt(fd, pos, 16))
    if (!h || h.len < 0) return size
    const total = h.hdr + h.len + (pad && h.len % 2 ? 1 : 0)
    if (!audio.includes(h.id)) meta += Math.min(total, size - pos)
    else meta += h.hdr
    if (h.len === 0 && h.hdr === 0) break
    pos += total
  }
  return meta
}

/** Los bytes de metadatos de un archivo (estimado), o el tamaño entero si no se sabe leer. */
export function metaBytes(file: string): number {
  let fd: number
  try { fd = fs.openSync(file, 'r') } catch { return 0 }
  try {
    const size = fs.fstatSync(fd).size
    const ext = path.extname(file).slice(1).toLowerCase()
    const b = readAt(fd, 0, 12)
    const tag = b.toString('latin1', 0, 4)
    if (ext === 'mp3' || b.toString('latin1', 0, 3) === 'ID3') {
      const ss = b.toString('latin1', 0, 3) === 'ID3' ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0) : 0
      const tail = readAt(fd, Math.max(0, size - 160), Math.min(160, size))
      const v1 = tail.length >= 128 && tail.toString('latin1', tail.length - 128, tail.length - 125) === 'TAG' ? 128 : 0
      const ape = tail.length >= 32 + v1 ? tail.subarray(tail.length - v1 - 32, tail.length - v1) : null
      const apeLen = ape && ape.toString('latin1', 0, 8) === 'APETAGEX' ? ape.readUInt32LE(12) + 32 : 0
      return Math.min(size, ss + v1 + apeLen + 2048)
    }
    if (tag === 'fLaC') {
      let pos = 4
      for (let last = false, guard = 0; !last && pos + 4 <= size && guard < 1000; guard++) {
        const h = readAt(fd, pos, 4)
        last = (h[0] & 0x80) !== 0
        pos += 4 + ((h[1] << 16) | (h[2] << 8) | h[3])
      }
      return Math.min(size, pos)
    }
    if (tag === 'RIFF' || tag === 'RF64') return chunks(fd, size, 12, ['data'], (h) => h.length >= 8 ? { id: h.toString('latin1', 0, 4), len: h.readUInt32LE(4), hdr: 8 } : null, true)
    if (tag === 'FORM') return chunks(fd, size, 12, ['SSND'], (h) => h.length >= 8 ? { id: h.toString('latin1', 0, 4), len: h.readUInt32BE(4), hdr: 8 } : null, true)
    if (b.toString('latin1', 4, 8) === 'ftyp') {
      return chunks(fd, size, 0, ['mdat'], (h) => {
        if (h.length < 8) return null
        const len32 = h.readUInt32BE(0), id = h.toString('latin1', 4, 8)
        if (len32 === 1 && h.length >= 16) return { id, len: Number(h.readBigUInt64BE(8)) - 16, hdr: 16 }
        if (len32 === 0) return { id, len: size, hdr: 8 }
        return { id, len: len32 - 8, hdr: 8 }
      }, false)
    }
    if (tag === 'OggS') {
      // las páginas del principio con posición 0 son los encabezados (tags y tapa incluidos)
      let pos = 0
      for (let guard = 0; pos + 27 <= size && guard < 1000; guard++) {
        const h = readAt(fd, pos, 27)
        if (h.toString('latin1', 0, 4) !== 'OggS') break
        if (guard > 0 && h.readBigInt64LE(6) !== 0n) break
        const segs = readAt(fd, pos + 27, h[26])
        pos += 27 + h[26] + segs.reduce((s, x) => s + x, 0)
      }
      return Math.min(size, pos)
    }
    return size
  } catch { return 0 } finally { fs.closeSync(fd) }
}
