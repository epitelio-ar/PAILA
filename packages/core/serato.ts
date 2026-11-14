// Marcadores de Serato que ya están dentro de los archivos (Fase F, solo lectura): cue points, loops, el color del tema y
// la grilla ("Serato Markers2" y "Serato BeatGrid"). En MP3, AIFF y WAV van en un cuadro GEOB del tag ID3; en FLAC, en el
// comentario SERATO_MARKERS_V2 / SERATO_BEATGRID (en base64). Formato descripto por Mixxx (docs de "Serato Metadata Format").
import fs from 'node:fs'

export interface SeratoCue { kind: 'hot' | 'loop'; index: number; startMs: number; endMs: number | null; color: string | null; name: string }
export interface SeratoMarkers { cues: SeratoCue[]; colour: string | null; bpmLocked: boolean | null; grid: { position: number; bpm: number } | null }

const hex = (b: Buffer, at: number) => '#' + b.subarray(at, at + 3).toString('hex').toUpperCase()

/** Lo de adentro de "Serato Markers2": versión 0x01 0x01 + base64 (con saltos de línea y a veces sin el relleno final). */
export function parseMarkers2(obj: Buffer): Omit<SeratoMarkers, 'grid'> {
  const out: Omit<SeratoMarkers, 'grid'> = { cues: [], colour: null, bpmLocked: null }
  if (obj.length < 3 || obj[0] !== 1 || obj[1] !== 1) return out
  let b64 = obj.subarray(2).toString('latin1').replace(/[^A-Za-z0-9+/]/g, '')
  b64 = b64.slice(0, b64.length - (b64.length % 4 === 1 ? 1 : 0))
  const data = Buffer.from(b64, 'base64')
  if (data.length < 2 || data[0] !== 1 || data[1] !== 1) return out
  let p = 2
  while (p < data.length) {
    const z = data.indexOf(0, p)
    if (z < 0 || z === p) break
    const type = data.toString('latin1', p, z)
    if (z + 5 > data.length) break
    const len = data.readUInt32BE(z + 1)
    const e = data.subarray(z + 5, z + 5 + len)
    p = z + 5 + len
    if (type === 'CUE' && e.length >= 13) {
      const nameEnd = e.indexOf(0, 12)
      out.cues.push({ kind: 'hot', index: e[1], startMs: e.readUInt32BE(2), endMs: null, color: hex(e, 7), name: e.toString('utf8', 12, nameEnd < 0 ? e.length : nameEnd) })
    } else if (type === 'LOOP' && e.length >= 21) {
      const nameEnd = e.indexOf(0, 20)
      out.cues.push({ kind: 'loop', index: e[1], startMs: e.readUInt32BE(2), endMs: e.readUInt32BE(6), color: null, name: e.toString('utf8', 20, nameEnd < 0 ? e.length : nameEnd) })
    } else if (type === 'COLOR' && e.length >= 4) out.colour = hex(e, 1)
    else if (type === 'BPMLOCK' && e.length >= 1) out.bpmLocked = e[0] === 1
  }
  return out
}

/** "Serato BeatGrid": versión 0x01 0x00, cuántos marcadores y el último (posición en segundos y BPM). Solo la grilla recta. */
export function parseBeatGrid(obj: Buffer): { position: number; bpm: number } | null {
  if (obj.length < 6 || obj[0] !== 1 || obj[1] !== 0) return null
  const n = obj.readUInt32BE(2)
  if (n < 1 || 6 + n * 8 > obj.length) return null
  const last = 6 + (n - 1) * 8
  const first = obj.readFloatBE(6)
  const bpm = obj.readFloatBE(last + 4)
  // con más de un marcador la grilla cambia de tempo: se toma el primero con el BPM del último (Serato casi siempre usa uno)
  return bpm > 20 && bpm < 300 && Number.isFinite(first) ? { position: Math.round(first * 1000) / 1000, bpm: Math.round(bpm * 100) / 100 } : null
}

const syncsafe = (b: Buffer, at: number) => ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f)

/** Los cuadros GEOB de un tag ID3v2 (v2.3 o v2.4): descripción → contenido. */
export function geobFrames(tag: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  if (tag.length < 10 || tag.toString('latin1', 0, 3) !== 'ID3') return out
  const ver = tag[3]
  if (ver < 3) return out
  const size = Math.min(tag.length, 10 + syncsafe(tag, 6))
  let p = 10
  if (tag[5] & 0x40) p += ver === 4 ? syncsafe(tag, 10) : 4 + tag.readUInt32BE(10)
  while (p + 10 <= size) {
    const id = tag.toString('latin1', p, p + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const len = ver === 4 ? syncsafe(tag, p + 4) : tag.readUInt32BE(p + 4)
    const body = tag.subarray(p + 10, p + 10 + len)
    p += 10 + len
    if (id !== 'GEOB' || body.length < 4) continue
    // codificación (1 byte), tipo MIME\0, nombre de archivo\0, descripción\0, contenido
    const enc = body[0]
    const wide = enc === 1 || enc === 2
    const mimeEnd = body.indexOf(0, 1)
    const term = (from: number) => {
      if (!wide) return body.indexOf(0, from)
      for (let i = from; i + 1 < body.length; i += 2) if (body[i] === 0 && body[i + 1] === 0) return i
      return -1
    }
    const fileEnd = term(mimeEnd + 1)
    if (fileEnd < 0) continue
    const descStart = fileEnd + (wide ? 2 : 1)
    const descEnd = term(descStart)
    if (descEnd < 0) continue
    const raw = body.subarray(descStart, descEnd)
    const desc = wide ? raw.toString('utf16le').replace(/^﻿/, '') : raw.toString('latin1')
    out.set(desc, body.subarray(descEnd + (wide ? 2 : 1)))
  }
  return out
}

/** El tag ID3 de un archivo: al principio (MP3) o en el bloque "ID3 " / "id3 " (AIFF y WAV). */
function id3Of(file: string, ext: string): Buffer | null {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(12)
    fs.readSync(fd, head, 0, 12, 0)
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const len = 10 + syncsafe(head, 6)
      const tag = Buffer.alloc(Math.min(len, 64 << 20))
      fs.readSync(fd, tag, 0, tag.length, 0)
      return tag
    }
    if (ext !== 'aif' && ext !== 'aiff' && ext !== 'wav') return null
    const big = head.toString('latin1', 0, 4) === 'FORM'
    const total = fs.fstatSync(fd).size
    let p = 12
    const ch = Buffer.alloc(8)
    while (p + 8 <= total) {
      fs.readSync(fd, ch, 0, 8, p)
      const id = ch.toString('latin1', 0, 4)
      const len = big ? ch.readUInt32BE(4) : ch.readUInt32LE(4)
      if (/^id3 $/i.test(id)) { const tag = Buffer.alloc(Math.min(len, 64 << 20)); fs.readSync(fd, tag, 0, tag.length, p + 8); return tag }
      p += 8 + len + (len & 1)
    }
    return null
  } finally { fs.closeSync(fd) }
}

/** Los comentarios de un FLAC (bloque VORBIS_COMMENT): nombre en mayúsculas → valor. */
function flacComments(file: string): Map<string, string> {
  const out = new Map<string, string>()
  const fd = fs.openSync(file, 'r')
  try {
    const h = Buffer.alloc(4)
    fs.readSync(fd, h, 0, 4, 0)
    if (h.toString('latin1') !== 'fLaC') return out
    let p = 4
    for (let last = false; !last;) {
      if (fs.readSync(fd, h, 0, 4, p) < 4) break
      last = !!(h[0] & 0x80)
      const type = h[0] & 0x7f, len = h.readUIntBE(1, 3)
      if (type === 4) {
        const b = Buffer.alloc(len)
        fs.readSync(fd, b, 0, len, p + 4)
        let q = 4 + b.readUInt32LE(0)
        const n = b.readUInt32LE(q); q += 4
        for (let i = 0; i < n && q + 4 <= b.length; i++) {
          const l = b.readUInt32LE(q); const s = b.toString('utf8', q + 4, q + 4 + l); q += 4 + l
          const eq = s.indexOf('=')
          if (eq > 0) out.set(s.slice(0, eq).toUpperCase(), s.slice(eq + 1))
        }
        break
      }
      p += 4 + len
    }
    return out
  } finally { fs.closeSync(fd) }
}

/** En FLAC el valor es base64 de "application/octet-stream\0\0<descripción>\0" + el mismo contenido que el GEOB. */
function flacObject(v: string | undefined): Buffer | null {
  if (!v) return null
  const b = Buffer.from(v.replace(/\s/g, ''), 'base64')
  const a = b.indexOf(0), c = a >= 0 ? b.indexOf(0, a + 1) : -1, d = c >= 0 ? b.indexOf(0, c + 1) : -1
  return d >= 0 ? b.subarray(d + 1) : null
}

/** Los marcadores de Serato de un archivo, o null si no tiene (o el formato no los guarda donde PAILA los busca). */
export function readSerato(file: string, ext: string): SeratoMarkers | null {
  const e = ext.toLowerCase()
  try {
    let m2: Buffer | null = null, grid: Buffer | null = null
    if (e === 'flac') {
      const c = flacComments(file)
      m2 = flacObject(c.get('SERATO_MARKERS_V2')); grid = flacObject(c.get('SERATO_BEATGRID'))
    } else if (['mp3', 'aif', 'aiff', 'wav'].includes(e)) {
      const tag = id3Of(file, e)
      if (!tag) return null
      const g = geobFrames(tag)
      m2 = g.get('Serato Markers2') ?? null; grid = g.get('Serato BeatGrid') ?? null
    } else return null
    if (!m2 && !grid) return null
    const m = m2 ? parseMarkers2(m2) : { cues: [], colour: null, bpmLocked: null }
    const r: SeratoMarkers = { ...m, grid: grid ? parseBeatGrid(grid) : null }
    return r.cues.length || r.colour || r.grid ? r : null
  } catch { return null }
}
