// Traktor: la colección y las playlists en un archivo .nml (el de Traktor Pro 3 y 4), con BPM, tono, la grilla (marcadores
// de grilla con su BPM, también para las grillas que cambian de tempo) y los cues. Se importa desde Traktor con "Import
// Another Collection": PAILA no toca la colección de Traktor. Puro: recibe lo elegido (core/rekordbox.ts `pick`).
import type { DjMarks, Picked } from './rekordbox'
import type { PlaylistNode } from '@paila/shared/types'

const esc = (s: string | number | null | undefined) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

/** Las 24 tonalidades como las numera Traktor (MUSICAL_KEY): 0 a 11 mayores desde Do, 12 a 23 menores desde Do. */
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' }
export function traktorKey(key: string | null): number | null {
  const m = key?.trim().match(/^([A-G])([#b]?)(m?)$/)
  if (!m) return null
  const root = FLATS[m[1] + m[2]] ?? m[1] + m[2]
  const i = ROOTS.indexOf(root)
  return i < 0 ? null : i + (m[3] ? 12 : 0)
}

/**
 * Ruta de Traktor: "C:" + "/:Users/:yo/:Música/:" + "tema.mp3" (cada carpeta termina en "/:"). En Mac el volumen es el nombre
 * del disco: "SSD" para "/Volumes/SSD/…" y `bootVolume` ("Macintosh HD") para lo que está en el disco de la Mac.
 */
export function traktorLocation(abs: string, bootVolume = ''): { volume: string; dir: string; file: string; key: string } {
  let p = abs.replace(/\\/g, '/')
  const m = p.match(/^([A-Za-z]:)(\/.*)?\/([^/]+)$/)
  const ext = m ? null : p.match(/^\/Volumes\/([^/]+)(\/.*)$/)
  if (ext) p = ext[2]
  const volume = m ? m[1].toUpperCase() : ext ? ext[1] : p.startsWith('/') ? bootVolume : ''
  const parts = (m ? m[2] ?? '' : p.slice(0, p.lastIndexOf('/'))).split('/').filter(Boolean)
  const dir = '/:' + parts.map((x) => `${x}/:`).join('')
  const file = m ? m[3] : p.slice(p.lastIndexOf('/') + 1)
  return { volume, dir, file, key: volume + dir + file }
}

/**
 * Los marcadores de grilla: uno por tramo, corrido hasta el primer tiempo fuerte (Traktor toma cada marcador como el "1"
 * del compás). `offset`: segundos que hay que sumarle al tiempo de Rekordbox para llegar al de Traktor en este archivo.
 */
export function gridMarkers(m: DjMarks, offset: number): { ms: number; bpm: number }[] {
  if (!m.grid) return []
  const all = m.grid.segments.map((s, i, segs) => {
    const beat = 60 / s.bpm
    let start = s.start + ((5 - s.beat) % 4) * beat
    const next = segs[i + 1]?.start
    if (next != null && start >= next) start = s.start // un tramo más corto que un compás: va donde está
    return { ms: (start + offset) * 1000, bpm: s.bpm }
  })
  // Rekordbox a veces trae varios tramos que siguen la misma grilla (mismo BPM y en fase, a compases justos): sobran
  const out: typeof all = []
  for (const g of all) {
    const prev = out[out.length - 1]
    const beats = prev ? ((g.ms - prev.ms) / 1000) * (g.bpm / 60) : NaN
    if (prev && prev.bpm === g.bpm && Math.abs(beats - Math.round(beats)) < 0.05 && Math.round(beats) % 4 === 0) continue
    out.push(g)
  }
  return out
}

export interface TraktorTrack { t: Picked['tracks'][number]; marks: DjMarks; offset: number; stars: number; comment: string }

/** El .nml entero. */
export function buildNml(tracks: TraktorTrack[], nodes: PlaylistNode[], playlistTracks: Map<number, number[]>, now = new Date(), bootVolume = ''): string {
  const date = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`
  const keyOf = new Map<number, string>()
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="no" ?>', '<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>', '<MUSICFOLDERS></MUSICFOLDERS>', `<COLLECTION ENTRIES="${tracks.length}">`]
  for (const { t, marks, offset, stars, comment } of tracks) {
    const loc = traktorLocation(t.abs, bootVolume)
    keyOf.set(t.id, loc.key)
    const title = t.title ?? loc.file.replace(/\.[^.]+$/, '')
    const bpm = marks.grid?.bpm ?? t.bpm
    const mk = traktorKey(t.musicKey)
    out.push(`<ENTRY MODIFIED_DATE="${date}" TITLE="${esc(title)}" ARTIST="${esc(t.artist)}">`)
    out.push(`<LOCATION DIR="${esc(loc.dir)}" FILE="${esc(loc.file)}" VOLUME="${esc(loc.volume)}" VOLUMEID="${esc(loc.volume)}"></LOCATION>`)
    if (t.album || t.track) out.push(`<ALBUM${t.track && Number(t.track) ? ` TRACK="${Number(t.track)}"` : ''} TITLE="${esc(t.album)}"></ALBUM>`)
    out.push('<MODIFICATION_INFO AUTHOR_TYPE="user"></MODIFICATION_INFO>')
    const info = [
      t.kbps ? `BITRATE="${t.kbps * 1000}"` : '', t.genre ? `GENRE="${esc(t.genre)}"` : '', comment ? `COMMENT="${esc(comment)}"` : '',
      t.musicKey ? `KEY="${esc(t.musicKey)}"` : '', t.duration ? `PLAYTIME="${Math.round(t.duration)}" PLAYTIME_FLOAT="${t.duration.toFixed(6)}"` : '',
      stars ? `RANKING="${stars * 51}"` : '', t.year && /^\d{4}/.test(t.year) ? `RELEASE_DATE="${t.year.slice(0, 4)}/1/1"` : '',
      `IMPORT_DATE="${date}"`, `FILESIZE="${Math.round(t.size / 1024)}"`,
    ].filter(Boolean)
    out.push(`<INFO ${info.join(' ')}></INFO>`)
    if (bpm) out.push(`<TEMPO BPM="${bpm.toFixed(6)}" BPM_QUALITY="100.000000"></TEMPO>`)
    if (mk != null) out.push(`<MUSICAL_KEY VALUE="${mk}"></MUSICAL_KEY>`)
    for (const g of gridMarkers(marks, offset)) out.push(`<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="${g.ms.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="${g.bpm.toFixed(6)}"></GRID></CUE_V2>`)
    for (const c of marks.cues) {
      const loop = c.kind === 'loop' && c.endAt != null
      // Traktor tiene 8 lugares de hot cue (0 a 7); los memory cues van como cues sin lugar
      const hot = c.kind === 'memory' || c.num < 0 || c.num > 7 ? -1 : c.num
      const start = (c.start + offset) * 1000
      out.push(`<CUE_V2 NAME="${esc(c.name || 'n.n.')}" DISPL_ORDER="0" TYPE="${loop ? 5 : 0}" START="${start.toFixed(6)}" LEN="${loop ? ((c.endAt! - c.start) * 1000).toFixed(6) : '0.000000'}" REPEATS="-1" HOTCUE="${hot}"></CUE_V2>`)
    }
    out.push('</ENTRY>')
  }
  out.push('</COLLECTION>', '<SETS ENTRIES="0"></SETS>', '<PLAYLISTS>')
  const node = (parent: number | null): string[] => nodes.filter((c) => c.parentId === parent).flatMap((c) => {
    if (c.kind === 'folder') {
      const kids = node(c.id)
      return [`<NODE TYPE="FOLDER" NAME="${esc(c.name)}"><SUBNODES COUNT="${nodes.filter((x) => x.parentId === c.id).length}">`, ...kids, '</SUBNODES></NODE>']
    }
    const keys = (playlistTracks.get(c.id) ?? []).map((id) => keyOf.get(id)).filter((k): k is string => !!k)
    return [`<NODE TYPE="PLAYLIST" NAME="${esc(c.name)}"><PLAYLIST ENTRIES="${keys.length}" TYPE="LIST" UUID="${uuid(c.id)}">`,
      ...keys.map((k) => `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${esc(k)}"></PRIMARYKEY></ENTRY>`), '</PLAYLIST></NODE>']
  })
  out.push(`<NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="${nodes.filter((c) => c.parentId == null).length}">`, ...node(null), '</SUBNODES></NODE>')
  out.push('</PLAYLISTS>', '<INDEXING></INDEXING>', '</NML>')
  return out.join('\n') + '\n'
}

/** Un identificador fijo por playlist (Traktor reconoce la misma playlist entre exportes). */
const uuid = (id: number) => `5061494c41${id.toString(16).padStart(22, '0')}`.slice(0, 32)
