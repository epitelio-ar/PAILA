// Un .zip chico armado en memoria (para "Exportar diagnóstico"): archivos de texto comprimidos con deflate, sin
// dependencias (zlib de Node). Sin carpetas, sin cifrado y sin ZIP64: alcanza para unos pocos MB.
import zlib from 'node:zlib'

export interface ZipEntry { name: string; data: string | Buffer }

/** Fecha y hora en el formato de MS-DOS que usa el zip. */
function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Arma el zip con `entries` (nombres en UTF-8). */
export function makeZip(entries: ZipEntry[], when = new Date()): Buffer {
  const { time, date } = dosTime(when)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    const packed = zlib.deflateRawSync(raw)
    const crc = zlib.crc32(raw)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6) // nombre en UTF-8
    head.writeUInt16LE(8, 8); head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12)
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(raw.length, 22)
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(head, name, packed)
    centrals.push(central, name)
    offset += head.length + name.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

/** Lee un zip armado por `makeZip` (para los tests y para revisar lo que se exportó). */
export function readZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let p = buf.readUInt32LE(endAt + 16)
  for (let i = 0; i < buf.readUInt16LE(endAt + 10); i++) {
    const nameLen = buf.readUInt16LE(p + 28); const local = buf.readUInt32LE(p + 42); const size = buf.readUInt32LE(p + 20)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    out.set(name, zlib.inflateRawSync(buf.subarray(start, start + size)).toString('utf8'))
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return out
}
