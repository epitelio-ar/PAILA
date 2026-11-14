// Engine DJ (los equipos Denon DJ Prime y SC6000, los Numark, y Engine DJ en la compu): el formato de lo que guarda de cada
// tema (tono, grilla, pads, loops) y el paso de la grilla y los cues de PAILA a los suyos. Las bases, en core/enginedb.ts.
// El formato de cada dato (comprimido con zlib y su largo adelante, casi todo en big endian) está documentado por libdjinterop
// (github.com/xsco/libdjinterop, LGPL-3.0): se usó como referencia del formato; el código es propio.
import zlib from 'node:zlib'
import type { DjMarks, Picked } from './rekordbox'

// ---- tono ----

/** La nota de cada semitono desde Do, como la escribe PAILA ("C#m", "Bb"). */
const PC: Record<string, number> = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 }
/**
 * El tono como lo numera Engine: por el círculo de quintas, cada mayor seguida de su relativa menor (Do = 0, La menor = 1,
 * Sol = 2, Mi menor = 3… Re menor = 23).
 */
export function engineKey(key: string | null): number | null {
  const m = key?.trim().match(/^([A-G][#b]?)(m?)$/)
  const pc = m ? PC[m[1]] : undefined
  if (pc == null) return null
  return m![2] ? ((((pc + 3) * 7) % 12) * 2 + 1) : ((pc * 7) % 12) * 2
}

// ---- los datos de cada tema (blobs) ----

/** Comprimido como lo guarda Engine: 4 bytes con el largo sin comprimir y después zlib. */
export function pack(raw: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(raw.length)
  return Buffer.concat([len, zlib.deflateSync(raw)])
}
export function unpack(blob: Uint8Array | null | undefined): Buffer {
  if (!blob || blob.length < 4) return Buffer.alloc(0)
  const b = Buffer.from(blob)
  return b.readUInt32BE(0) === 0 ? Buffer.alloc(0) : zlib.inflateSync(b.subarray(4))
}

/** Un marcador de la grilla: el número de tiempo y dónde cae (en muestras). */
export interface EngineMarker { index: number; sample: number }
export interface EngineCue { label: string; sample: number; color: string | null }
export interface EngineLoop { label: string; start: number; end: number; color: string | null }

/** Los colores de los 8 pads de Engine, para los cues sin color. */
const PADS = ['#EAC532', '#EA8F32', '#B855BF', '#BA2A41', '#86C64B', '#20C67C', '#00A8B1', '#158EE2']
const argb = (hex: string | null, slot: number) => {
  const h = /^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex! : PADS[slot % 8]
  return Buffer.from([255, parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])
}
/** El nombre de un cue: su largo en un byte, así que hasta 255 bytes (sin cortar una letra por la mitad). */
function label(s: string): Buffer {
  let b = Buffer.from(s, 'utf8')
  if (b.length > 255) b = Buffer.from(Buffer.from(s, 'utf8').subarray(0, 255).toString('utf8').replace(/�$/, ''), 'utf8')
  return Buffer.concat([Buffer.from([b.length]), b])
}
const dBE = (x: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b }
const dLE = (x: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b }
const i64BE = (x: number) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(Math.round(x))); return b }
const i64LE = (x: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(Math.round(x))); return b }

/** trackData: frecuencia de muestreo, cantidad de muestras, tono y el volumen promedio (que PAILA no tiene: 0). */
export function trackData(sr: number, samples: number, key: number | null): Buffer {
  const k = Buffer.alloc(4)
  k.writeInt32BE(key ?? 0)
  return pack(Buffer.concat([dBE(sr), i64BE(samples), k, dBE(0), dBE(0), dBE(0)]))
}

/**
 * El trackData que Engine ya tenía (con el volumen que midió al analizar), con el tono de PAILA si lo hay. null si no había
 * uno que se pueda leer.
 */
export function keepTrackData(prior: Uint8Array | null, key: number | null): Buffer | null {
  let raw: Buffer
  try { raw = unpack(prior) } catch { return null }
  if (raw.length < 44) return null
  if (key != null) raw.writeInt32BE(key, 16)
  return pack(raw)
}

/** beatData: la grilla, dos veces (la de Engine y la ajustada: van iguales), con los 9 bytes en cero que trae la real. */
export function beatData(sr: number, samples: number, markers: EngineMarker[]): Buffer {
  const grid = Buffer.concat([i64BE(markers.length), ...markers.map((m, i) => {
    const b = Buffer.alloc(24)
    b.writeDoubleLE(m.sample, 0)
    b.writeBigInt64LE(BigInt(m.index), 8)
    b.writeInt32LE(markers[i + 1] ? markers[i + 1].index - m.index : 0, 16)
    return b
  })])
  return pack(Buffer.concat([dBE(sr), dBE(samples), Buffer.from([markers.length ? 1 : 0]), grid, grid, Buffer.alloc(9)]))
}

/** quickCues: los 8 pads (los vacíos, en -1) y el cue principal (el botón CUE). */
export function quickCues(cues: (EngineCue | null)[], mainCue: number): Buffer {
  const pads = Array.from({ length: 8 }, (_, i) => cues[i] ?? null)
  return pack(Buffer.concat([
    i64BE(8),
    ...pads.map((c, i) => Buffer.concat([label(c?.label ?? ''), dBE(c ? c.sample : -1), c ? argb(c.color, i) : Buffer.alloc(4)])),
    dBE(mainCue), Buffer.from([1]), dBE(mainCue),
  ]))
}

/** loops: los 8 loops guardados. Este va sin comprimir y en little endian. */
export function loops(list: (EngineLoop | null)[]): Buffer {
  const slots = Array.from({ length: 8 }, (_, i) => list[i] ?? null)
  return Buffer.concat([i64LE(8), ...slots.map((l, i) => Buffer.concat([
    label(l?.label ?? ''), dLE(l ? l.start : -1), dLE(l ? l.end : -1), Buffer.from([l ? 1 : 0, l ? 1 : 0]), l ? argb(l.color, i) : Buffer.alloc(4),
  ]))])
}

/**
 * ¿Le pusiste algo a mano en Engine: la grilla corrida (Engine guarda la de su análisis y la ajustada: si difieren, la tocaste),
 * cues o loops? Si no se puede leer, se lo trata como propio: no se toca.
 */
export function hasOwnMarks(beat: Uint8Array | null, cues: Uint8Array | null, loopBlob: Uint8Array | null): boolean {
  try {
    const b = unpack(beat)
    if (b.length >= 25) {
      const end1 = 25 + Number(b.readBigInt64BE(17)) * 24
      const end2 = end1 + 8 + Number(b.readBigInt64BE(end1)) * 24
      if (end2 > b.length) return true
      if (!b.subarray(17, end1).equals(b.subarray(end1, end2))) return true
    }
    const q = unpack(cues)
    if (q.length >= 8) {
      let p = 8
      for (let i = Number(q.readBigInt64BE(0)); i > 0; i--) { p += 1 + q[p]; if (q.readDoubleBE(p) !== -1) return true; p += 12 }
    }
    const l = loopBlob ? Buffer.from(loopBlob) : Buffer.alloc(0)
    if (l.length >= 8) {
      let p = 8
      for (let i = Number(l.readBigInt64LE(0)); i > 0; i--) { p += 1 + l[p]; if (l[p + 16] || l[p + 17]) return true; p += 22 }
    }
    return false
  } catch { return true }
}

// ---- de la grilla y los cues de PAILA a los de Engine ----

export interface EngineSong {
  t: Picked['tracks'][number]
  /** con un solo BPM (Engine no recibe tempo variable de afuera) */
  marks: DjMarks
  /** segundos a sumarle al tiempo de Rekordbox para llegar al de Engine en este archivo */
  offset: number
  stars: number
  comment: string
}

/**
 * La grilla como la guarda Engine: un marcador cuatro tiempos antes del primer "1" del compás (el número -4) y otro pasando
 * el final, con el BPM en la distancia entre los dos.
 */
export function engineGrid(m: DjMarks, offset: number, sr: number, samples: number): EngineMarker[] {
  const s = m.grid?.segments[0]
  if (!s || !(s.bpm > 0) || !(samples > 0)) return []
  const spb = (60 / s.bpm) * sr
  const down = (s.start + ((5 - s.beat) % 4) * (60 / s.bpm) + offset) * sr
  const n = Math.max(1, Math.ceil((samples - down) / spb))
  return [{ index: -4, sample: down - 4 * spb }, { index: n, sample: down + n * spb }]
}

/** Los pads (hot cues 1 a 8), los loops guardados y el cue principal (el primer memory cue; si no hay, el primer tiempo). */
export function engineCues(m: DjMarks, offset: number, sr: number, grid: EngineMarker[]): { pads: (EngineCue | null)[]; loops: (EngineLoop | null)[]; main: number } {
  const pads: (EngineCue | null)[] = Array(8).fill(null)
  const loopSlots: (EngineLoop | null)[] = []
  const at = (sec: number) => Math.max(0, sec + offset) * sr
  for (const c of m.cues) {
    const slot = c.kind !== 'memory' && c.num >= 0 && c.num <= 7 ? c.num : -1
    if (slot >= 0 && !pads[slot]) pads[slot] = { label: c.name, sample: at(c.start), color: c.color }
    if (c.kind === 'loop' && c.endAt != null && c.endAt > c.start && loopSlots.length < 8) loopSlots.push({ label: c.name, start: at(c.start), end: at(c.endAt), color: c.color })
  }
  const memory = m.cues.find((c) => c.kind === 'memory')
  const main = memory ? at(memory.start) : grid.length ? Math.max(0, grid[0].sample + 4 * ((grid[1].sample - grid[0].sample) / (grid[1].index - grid[0].index))) : 0
  return { pads, loops: loopSlots, main }
}
