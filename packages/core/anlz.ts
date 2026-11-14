// Lector propio de los archivos de análisis que Rekordbox deja en el pendrive (PIONEER/USBANLZ/…/ANLZ0000.DAT y .EXT;
// MASTERPLAN-3, 4; solo lectura): la grilla (PQTZ) y los cue points (PCOB en el .DAT, PCO2 con nombre y color en el .EXT).
// Formato documentado por proyectos abiertos (Deep Symmetry); el código es nuestro. Puro: recibe los bytes. Tiempos en segundos,
// en el tiempo de Rekordbox (como su XML).
import type { GridSegment } from './analysis/grid'
import type { RbCue } from './rbxml'
import { tr } from '@paila/shared/idioma'

export interface Anlz { grid: GridSegment[]; cues: RbCue[] }

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

/** Las secciones del archivo: tipo, dónde empieza, largo de su cabecera y largo total. */
function sections(b: Uint8Array): { kind: string; at: number; head: number; len: number }[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length < 12 || fourcc(b, 0) !== 'PMAI') throw new Error(tr({ es: 'Este archivo no es un análisis de Rekordbox (ANLZ).', en: "This file isn't a Rekordbox analysis file (ANLZ)." }))
  const out: { kind: string; at: number; head: number; len: number }[] = []
  for (let o = v.getUint32(4); o + 12 <= b.length; ) {
    const head = v.getUint32(o + 4), len = v.getUint32(o + 8)
    if (len < 12 || o + len > b.length) break
    out.push({ kind: fourcc(b, o), at: o, head, len })
    o += len
  }
  return out
}

/** La grilla: un tramo nuevo cada vez que cambia el tempo (como el TEMPO del XML). */
function grid(v: DataView, at: number, head: number): GridSegment[] {
  const n = v.getUint32(at + 20)
  const out: GridSegment[] = []
  for (let i = 0; i < n && at + head + i * 8 + 8 <= v.byteLength; i++) {
    const o = at + head + i * 8
    const beat = v.getUint16(o), bpm = v.getUint16(o + 2) / 100, start = v.getUint32(o + 4) / 1000
    if (!(bpm > 0)) continue
    if (!out.length || Math.abs(out[out.length - 1].bpm - bpm) > 0.001) out.push({ start, bpm, beat: Math.max(1, Math.min(4, beat || 1)) })
  }
  return out
}

/** Hot cue: 0 = memory (num -1); 1… = A, B, C… (num 0, 1, 2…). Tipo 2 = loop. */
const cueOf = (hot: number, type: number, ms: number, loopMs: number, name = '', color: string | null = null): RbCue => ({
  name, type: type === 2 ? 4 : 0, start: ms / 1000, end: type === 2 && loopMs !== 0xffffffff && loopMs > ms ? loopMs / 1000 : null, num: hot > 0 ? hot - 1 : -1, color,
})

function cuesOld(b: Uint8Array, v: DataView, at: number, head: number, len: number): RbCue[] {
  const out: RbCue[] = []
  for (let o = at + head; o + 40 <= at + len; ) {
    if (fourcc(b, o) !== 'PCPT') break
    const l = v.getUint32(o + 8)
    // status 0 = el cue está borrado
    if (v.getUint32(o + 16) !== 0) out.push(cueOf(v.getUint32(o + 12), b[o + 28], v.getUint32(o + 32), v.getUint32(o + 36)))
    if (l < 40) break
    o += l
  }
  return out
}

function cuesExt(b: Uint8Array, v: DataView, at: number, head: number, len: number): RbCue[] {
  const out: RbCue[] = []
  for (let o = at + head; o + 40 <= at + len; ) {
    if (fourcc(b, o) !== 'PCP2') break
    const l = v.getUint32(o + 8)
    let name = '', color: string | null = null
    if (l > 44) {
      const n = v.getUint32(o + 40)
      if (n > 0 && o + 44 + n <= o + l) name = new TextDecoder('utf-16be').decode(b.subarray(o + 44, o + 44 + n)).replace(/\0+$/, '')
      const c = o + 44 + n
      if (c + 4 <= o + l && b[c] !== 0) color = '#' + [b[c + 1], b[c + 2], b[c + 3]].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()
    }
    out.push(cueOf(v.getUint32(o + 12), b[o + 16], v.getUint32(o + 20), v.getUint32(o + 24), name, color))
    if (l < 40) break
    o += l
  }
  return out
}

/**
 * Lee un ANLZ (.DAT o .EXT). Si se pasan los dos, conviene pasar el .EXT también: tiene los nombres y colores de los
 * cues (`mergeAnlz`).
 */
export function parseAnlz(bytes: Uint8Array): Anlz {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const res: Anlz = { grid: [], cues: [] }
  const old: RbCue[] = [], ext: RbCue[] = []
  for (const s of sections(bytes)) {
    if (s.kind === 'PQTZ' && !res.grid.length) res.grid = grid(v, s.at, s.head)
    else if (s.kind === 'PCOB') old.push(...cuesOld(bytes, v, s.at, s.head, s.len))
    else if (s.kind === 'PCO2') ext.push(...cuesExt(bytes, v, s.at, s.head, s.len))
  }
  res.cues = sortCues(ext.length ? ext : old)
  return res
}

const sortCues = (c: RbCue[]) => c.sort((a, b) => a.start - b.start || a.num - b.num)

/** Junta lo del .DAT y el .EXT: la grilla de cualquiera, los cues del .EXT si tiene (traen nombre y color). */
export function mergeAnlz(dat: Anlz | null, ext: Anlz | null): Anlz {
  return { grid: dat?.grid.length ? dat.grid : ext?.grid ?? [], cues: ext?.cues.length ? ext.cues : dat?.cues ?? [] }
}
