// Lector propio del export.pdb de un pendrive armado por Rekordbox (MASTERPLAN-3, 4; solo lectura): temas, artistas, discos,
// géneros, tonos y playlists. El formato (DeviceSQL, páginas de 4 KB con filas indexadas desde el final) lo descifraron
// y documentaron proyectos abiertos (Deep Symmetry, "Rekordbox Export Structure Analysis"); este código es nuestro. Puro: recibe los bytes.
import { tr } from '@paila/shared/idioma'

/** Un tema tal como lo guardó Rekordbox en el pendrive. `path`: dentro del pendrive ("/Contents/Artista/Disco/x.mp3"). */
export interface PdbTrack {
  id: number
  title: string
  artist: string
  album: string
  genre: string
  key: string
  label: string
  remixer: string
  comment: string
  isrc: string
  path: string
  fileName: string
  /** Dónde están la grilla y los cues ("/PIONEER/USBANLZ/P016/0000875E/ANLZ0000.DAT"). */
  analyzePath: string
  size: number
  seconds: number
  bpm: number | null
  bitrate: number
  sampleRate: number
  year: number
  /** 0–5 estrellas. */
  rating: number
  /** 0 = sin color; 1–8 = rosa, rojo, naranja, amarillo, verde, aguamarina, azul, violeta (los de Rekordbox). */
  colorId: number
  playCount: number
}

export interface PdbPlaylist {
  id: number
  parentId: number
  name: string
  folder: boolean
  sortOrder: number
  /** Ids de los temas, en el orden de la playlist. */
  trackIds: number[]
}

export interface Pdb { tracks: PdbTrack[]; playlists: PdbPlaylist[] }

const TRACKS = 0, GENRES = 1, ARTISTS = 2, ALBUMS = 3, LABELS = 4, KEYS = 5, PLAYLIST_TREE = 7, PLAYLIST_ENTRIES = 8

/** Los colores de Rekordbox (1–8) como los escribe su XML. */
export const PDB_COLOURS: Record<number, string> = { 1: '#FF007F', 2: '#FF0000', 3: '#FFA500', 4: '#FFFF00', 5: '#00FF00', 6: '#25FDE9', 7: '#0000FF', 8: '#660099' }

class Reader {
  constructor(private b: Uint8Array, private v = new DataView(b.buffer, b.byteOffset, b.byteLength)) {}
  get length() { return this.b.length }
  u1(o: number) { return o < this.b.length ? this.b[o] : 0 }
  u2(o: number) { return o + 2 <= this.b.length ? this.v.getUint16(o, true) : 0 }
  u4(o: number) { return o + 4 <= this.b.length ? this.v.getUint32(o, true) : 0 }
  /**
   * Un texto de DeviceSQL: corto en ASCII (el primer byte impar dice el largo), largo en ASCII (0x40) o largo en UTF-16
   * (0x90), con dos bytes de largo total.
   */
  str(o: number): string {
    const k = this.u1(o)
    if (k & 1) {
      const n = (k >> 1) - 1
      return n > 0 ? latin1(this.b.subarray(o + 1, o + 1 + n)) : ''
    }
    const n = this.u2(o + 1) - 4
    if (n <= 0) return ''
    const body = this.b.subarray(o + 4, o + 4 + n)
    if (k === 0x90) return new TextDecoder('utf-16le').decode(body).replace(/\0+$/, '')
    if (k === 0x40) return latin1(body)
    return ''
  }
}
const latin1 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return s.replace(/\0+$/, '') }

/** Las filas presentes de todas las páginas de datos de una tabla (cada una con el lugar donde empieza). */
function rowsOf(r: Reader, pageSize: number, first: number, last: number): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (let p = first; !seen.has(p) && (p + 1) * pageSize <= r.length; ) {
    seen.add(p)
    const base = p * pageSize
    const flags = r.u1(base + 0x1b)
    if ((flags & 0x40) === 0) {
      // la cantidad de filas: la "grande" manda si es más grande y no vale 0x1fff (página vacía)
      const small = r.u1(base + 0x18), large = r.u2(base + 0x22)
      const rows = large > small && large !== 0x1fff ? large : small
      const heap = base + 0x28
      for (let g = 0; g * 16 < rows; g++) {
        const gBase = base + pageSize - g * 0x24
        const present = r.u2(gBase - 4)
        for (let i = 0; i < 16 && g * 16 + i < rows; i++) {
          if (!((present >> i) & 1)) continue
          const ofs = r.u2(gBase - 6 - 2 * i)
          if (heap + ofs < base + pageSize) out.push(heap + ofs)
        }
      }
    }
    if (p === last) break
    p = r.u4(base + 0x0c)
  }
  return out
}

/** Lee el export.pdb entero. Tira un error claro si no es uno. */
export function parsePdb(bytes: Uint8Array): Pdb {
  const r = new Reader(bytes)
  const pageSize = r.u4(4), tables = r.u4(8)
  if (r.u4(0) !== 0 || ![512, 1024, 2048, 4096, 8192, 16384].includes(pageSize) || tables < 1 || tables > 64) {
    throw new Error(tr({ es: 'Este archivo no es un export.pdb de Rekordbox.', en: "This file isn't a Rekordbox export.pdb." }))
  }
  const where = new Map<number, [number, number]>()
  for (let t = 0; t < tables; t++) {
    const o = 0x1c + t * 16
    if (!where.has(r.u4(o))) where.set(r.u4(o), [r.u4(o + 8), r.u4(o + 12)])
  }
  const rows = (type: number) => { const w = where.get(type); return w ? rowsOf(r, pageSize, w[0], w[1]) : [] }

  // tablas chicas: id → nombre
  const named = (type: number, idAt: number, nameAt: number) => {
    const m = new Map<number, string>()
    for (const o of rows(type)) m.set(r.u4(o + idAt), r.str(o + nameAt))
    return m
  }
  const genres = named(GENRES, 0, 4), labels = named(LABELS, 0, 4), keys = named(KEYS, 0, 8)
  const artists = new Map<number, string>()
  for (const o of rows(ARTISTS)) {
    const sub = r.u2(o)
    artists.set(r.u4(o + 4), r.str(o + (sub === 0x64 ? r.u2(o + 0x0a) : r.u1(o + 9))))
  }
  const albums = new Map<number, string>()
  for (const o of rows(ALBUMS)) {
    const sub = r.u2(o)
    albums.set(r.u4(o + 12), r.str(o + (sub === 0x84 ? r.u2(o + 22) : r.u1(o + 21))))
  }

  const tracks: PdbTrack[] = []
  for (const o of rows(TRACKS)) {
    const s = (i: number) => r.str(o + r.u2(o + 0x5e + 2 * i))
    const tempo = r.u4(o + 56)
    const path = s(20)
    tracks.push({
      id: r.u4(o + 72), title: s(17), artist: artists.get(r.u4(o + 68)) ?? '', album: albums.get(r.u4(o + 64)) ?? '',
      genre: genres.get(r.u4(o + 60)) ?? '', key: keys.get(r.u4(o + 32)) ?? '', label: labels.get(r.u4(o + 40)) ?? '',
      remixer: artists.get(r.u4(o + 44)) ?? '', comment: s(16), isrc: s(0), path, fileName: s(19) || path.split('/').pop() || '',
      analyzePath: s(14), size: r.u4(o + 16), seconds: r.u2(o + 84), bpm: tempo > 0 ? tempo / 100 : null, bitrate: r.u4(o + 48),
      sampleRate: r.u4(o + 8), year: r.u2(o + 80), rating: Math.min(5, r.u1(o + 89)), colorId: r.u1(o + 88), playCount: r.u2(o + 78),
    })
  }

  const lists = new Map<number, PdbPlaylist>()
  for (const o of rows(PLAYLIST_TREE)) {
    const id = r.u4(o + 12)
    lists.set(id, { id, parentId: r.u4(o), name: r.str(o + 20), folder: r.u4(o + 16) !== 0, sortOrder: r.u4(o + 8), trackIds: [] })
  }
  const entries: { list: number; at: number; track: number }[] = []
  for (const o of rows(PLAYLIST_ENTRIES)) entries.push({ at: r.u4(o), track: r.u4(o + 4), list: r.u4(o + 8) })
  entries.sort((a, b) => a.at - b.at)
  for (const e of entries) lists.get(e.list)?.trackIds.push(e.track)
  const playlists = [...lists.values()].sort((a, b) => a.parentId - b.parentId || a.sortOrder - b.sortOrder || a.id - b.id)
  return { tracks, playlists }
}
