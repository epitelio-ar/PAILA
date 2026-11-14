// Serato, los formatos que escribe PAILA (puros, sin tocar archivos): las crates (las playlists de Serato, un archivo
// binario por crate en _Serato_\Subcrates) y los marcadores que Serato guarda dentro de cada tema ("Serato Markers2" con
// los cues, loops y el color; "Serato BeatGrid" con la grilla, también la que cambia de tempo). Formato descripto por
// Mixxx y serato-tags (Holzhaus); lo lee core/serato.ts, así que cada cosa escrita acá se puede volver a leer igual.
import type { DjMarks } from './rekordbox'

// ---- crates ----

const tlv = (tag: string, body: Buffer) => { const h = Buffer.alloc(8); h.write(tag, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]) }
const u16be = (s: string) => { const b = Buffer.from(s, 'utf16le'); for (let i = 0; i + 1 < b.length; i += 2) { const x = b[i]; b[i] = b[i + 1]; b[i + 1] = x } return b }

/**
 * La ruta como la guarda Serato en una crate: sin la letra del disco y con barras "/" ("Users/yo/Música/tema.mp3"). En Mac,
 * lo de un disco de afuera va desde su raíz, sin "/Volumes/<disco>" (la crate está en ese disco).
 */
export const seratoPath = (abs: string) => abs.replace(/\\/g, '/').replace(/^[A-Za-z]:\//, '').replace(/^\/Volumes\/[^/]+\//, '').replace(/^\/+/, '')

/** El contenido de un archivo .crate con estos temas (rutas completas), en ese orden. */
export function buildCrate(paths: string[]): Buffer {
  const cols = ['song', 'artist', 'bpm', 'key', 'album', 'length']
  return Buffer.concat([
    tlv('vrsn', u16be('1.0/Serato ScratchLive Crate')),
    tlv('osrt', Buffer.concat([tlv('tvcn', u16be('song')), tlv('brev', Buffer.from([0]))])),
    ...cols.map((c) => tlv('ovct', Buffer.concat([tlv('tvcn', u16be(c)), tlv('tvcw', u16be('0'))]))),
    ...paths.map((p) => tlv('otrk', tlv('ptrk', u16be(seratoPath(p))))),
  ])
}

/**
 * Una base de Serato vacía ("database V2" con solo su encabezado). Serato no mira las crates de un disco que no tiene base
 * (visto con Serato DJ Lite 5.0, 23/10): PAILA la crea solo si falta, y Serato la completa al abrir los temas.
 */
export const emptyDatabase = () => tlv('vrsn', u16be('2.0/Serato Scratch LIVE Database'))

/** Las rutas de una crate (para comprobar lo escrito y para no pisar una crate ajena sin avisar). */
export function readCrate(b: Buffer): string[] {
  const out: string[] = []
  const walk = (buf: Buffer) => {
    for (let p = 0; p + 8 <= buf.length;) {
      const tag = buf.toString('latin1', p, p + 4), len = buf.readUInt32BE(p + 4), body = buf.subarray(p + 8, p + 8 + len)
      p += 8 + len
      if (tag === 'otrk') walk(body)
      else if (tag === 'ptrk') { const s = Buffer.from(body); for (let i = 0; i + 1 < s.length; i += 2) { const x = s[i]; s[i] = s[i + 1]; s[i + 1] = x } out.push(s.toString('utf16le')) }
    }
  }
  walk(b)
  return out
}

/** El nombre del archivo de una crate: las carpetas se anidan con "%%" ("Fiestas%%Casamiento.crate"). */
export function crateFile(names: string[]): string {
  return names.map((n) => n.replace(/%%/g, '%').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Sin nombre').join('%%') + '.crate'
}

// ---- marcadores dentro del archivo ----

/** Colores de los hot cues de Serato (los 8 de fábrica), para los cues que vienen sin color. */
const HOT_COLORS = ['#CC0000', '#CC4400', '#CC8800', '#CCCC00', '#88CC00', '#00CC00', '#00CC88', '#00CCCC']
const rgb = (hex: string | null, fallback: string) => Buffer.from(((hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback).slice(1)), 'hex')

function entry(type: string, body: Buffer): Buffer {
  const h = Buffer.alloc(type.length + 5)
  h.write(type, 0, 'latin1')
  h.writeUInt32BE(body.length, type.length + 1)
  return Buffer.concat([h, body])
}

/**
 * "Serato Markers2" (el contenido del GEOB): los hot cues (hasta 8), los loops, el color del tema y el candado del BPM.
 * Los memory cues de Rekordbox no existen en Serato: no van. `offset` en segundos, como en el resto de los exportes.
 */
export function encodeMarkers2(m: DjMarks, colour: string | null, offset = 0): Buffer {
  const parts: Buffer[] = [Buffer.from([1, 1])]
  parts.push(entry('COLOR', Buffer.concat([Buffer.from([0]), rgb(colour, '#FFFFFF')])))
  for (const c of m.cues) {
    if (c.num < 0 || c.num > 7 || c.kind === 'memory') continue
    const name = Buffer.from(c.name ?? '', 'utf8')
    const ms = Math.max(0, Math.round((c.start + offset) * 1000))
    if (c.kind === 'loop' && c.endAt != null) {
      const b = Buffer.alloc(20)
      b[1] = c.num; b.writeUInt32BE(ms, 2); b.writeUInt32BE(Math.max(ms, Math.round((c.endAt + offset) * 1000)), 6)
      b.writeUInt32BE(0xffffffff, 10); Buffer.from([0x00, 0x27, 0xaa, 0xe1]).copy(b, 14)
      parts.push(entry('LOOP', Buffer.concat([b, name, Buffer.from([0])])))
    } else {
      const b = Buffer.alloc(12)
      b[1] = c.num; b.writeUInt32BE(ms, 2); rgb(c.color, HOT_COLORS[c.num]).copy(b, 7)
      parts.push(entry('CUE', Buffer.concat([b, name, Buffer.from([0])])))
    }
  }
  parts.push(entry('BPMLOCK', Buffer.from([m.grid ? 1 : 0])), Buffer.from([0]))
  const data = Buffer.concat(parts)
  // base64 sin el "=" final y con saltos de línea cada 72 letras; el total se rellena con ceros hasta 470 bytes, como Serato
  const b64 = data.toString('base64').replace(/=+$/, '').replace(/(.{72})/g, '$1\n').replace(/\n$/, '')
  const out = Buffer.concat([Buffer.from([1, 1]), Buffer.from(b64, 'latin1'), Buffer.from([0])])
  return out.length >= 470 ? out : Buffer.concat([out, Buffer.alloc(470 - out.length)])
}

/**
 * "Serato BeatGrid": un marcador por tramo (los del medio dicen cuántos tiempos hay hasta el siguiente; el último, el BPM).
 * Cada marcador va en un tiempo fuerte (el "1" del compás), como los pone Serato.
 */
export function encodeBeatGrid(m: DjMarks, offset = 0): Buffer | null {
  if (!m.grid?.segments.length) return null
  const segs = m.grid.segments.map((s) => ({ start: s.start + ((5 - s.beat) % 4) * (60 / s.bpm) + offset, bpm: s.bpm }))
  const b = Buffer.alloc(6 + segs.length * 8 + 1)
  b[0] = 1; b[1] = 0; b.writeUInt32BE(segs.length, 2)
  segs.forEach((s, i) => {
    const at = 6 + i * 8
    b.writeFloatBE(s.start, at)
    if (i < segs.length - 1) b.writeUInt32BE(Math.max(1, Math.round((segs[i + 1].start - s.start) * s.bpm / 60)), at + 4)
    else b.writeFloatBE(s.bpm, at + 4)
  })
  return b
}

/** En FLAC (y en los comentarios de Ogg) el mismo contenido va en base64, con el encabezado de un GEOB adelante. */
export function flacValue(desc: string, content: Buffer): string {
  const b = Buffer.concat([Buffer.from('application/octet-stream\0\0', 'latin1'), Buffer.from(`${desc}\0`, 'latin1'), content])
  return b.toString('base64').replace(/(.{72})/g, '$1\n').replace(/\n$/, '')
}
