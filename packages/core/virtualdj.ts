// VirtualDJ: su base (database.xml) y sus listas (MyLists\*.vdjfolder), puro. La base se completa, no se reemplaza: los temas que
// VirtualDJ ya conoce conservan todo lo suyo (tags, información, automix); si ya tienen cues puestos por vos, ni siquiera
// se les cambia la grilla. El BPM va como lo guarda VirtualDJ (segundos por tiempo: 60/BPM) y los tiempos en segundos.
import path from 'node:path'
import type { DjMarks, Picked } from './rekordbox'

const esc = (s: string | number | null | undefined) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const n6 = (x: number) => x.toFixed(6).replace(/\.?0+$/, '')
/** La ruta como la guarda VirtualDJ: con "\" en Windows ("D:\Música\x.mp3"); en Mac, tal cual ("/Volumes/SSD/x.mp3"). */
const winPath = (abs: string) => (/^[A-Za-z]:/.test(abs) ? abs.replace(/\//g, '\\') : abs)

export interface VdjSong { t: Picked['tracks'][number]; marks: DjMarks; /** segundos a sumarle al tiempo de Rekordbox */ offset: number }

/** El primer tiempo fuerte de la grilla (el "1" del compás), en el tiempo de VirtualDJ. */
function firstDownbeat(m: DjMarks, offset: number): number | null {
  const s = m.grid?.segments[0]
  if (!s) return null
  return Math.max(0, s.start + ((5 - s.beat) % 4) * (60 / s.bpm) + offset)
}

/** Lo que PAILA pone en un tema: el análisis (Scan) y los puntos (Poi): la grilla y los cues. */
function scanAndPois(s: VdjSong, pad: string): string[] {
  const out: string[] = []
  const bpm = s.marks.grid?.bpm ?? s.t.bpm
  const db = firstDownbeat(s.marks, s.offset)
  // Phase: dónde arranca la grilla en VirtualDJ 2026 ("fluid beatgrid"); las versiones anteriores leen el Poi beatgrid
  if (bpm || s.t.musicKey) out.push(`${pad}<Scan Version="801"${bpm ? ` Bpm="${n6(60 / bpm)}"` : ''}${db != null ? ` Phase="${n6(db)}"` : ''}${s.t.musicKey ? ` Key="${esc(s.t.musicKey)}"` : ''} Flag="32768" />`)
  if (db != null) out.push(`${pad}<Poi Pos="${n6(db)}" Type="beatgrid" />`)
  let extra = 9 // los memory cues de Rekordbox van después de los 8 pads
  for (const c of s.marks.cues) {
    const pos = n6(Math.max(0, c.start + s.offset))
    const num = c.kind !== 'memory' && c.num >= 0 && c.num <= 7 ? c.num + 1 : extra++
    if (c.kind === 'loop' && c.endAt != null && bpm) out.push(`${pad}<Poi Name="${esc(c.name)}" Pos="${pos}" Size="${n6((c.endAt - c.start) * bpm / 60)}" Num="${num}" Type="loop" />`)
    else out.push(`${pad}<Poi Name="${esc(c.name)}" Pos="${pos}" Num="${num}" Type="cue" />`)
  }
  return out
}

function newSong(s: VdjSong): string {
  const t = s.t
  const tags = [`Author="${esc(t.artist)}"`, `Title="${esc(t.title ?? path.basename(t.abs, path.extname(t.abs)))}"`, t.genre ? `Genre="${esc(t.genre)}"` : '', t.album ? `Album="${esc(t.album)}"` : '',
    t.track && Number(t.track) ? `TrackNumber="${Number(t.track)}"` : '', t.year && /^\d{4}/.test(t.year) ? `Year="${t.year.slice(0, 4)}"` : '', 'Flag="1"'].filter(Boolean).join(' ')
  return [` <Song FilePath="${esc(winPath(t.abs))}" FileSize="${t.size}">`, `  <Tags ${tags} />`,
    `  <Infos${t.duration ? ` SongLength="${n6(t.duration)}"` : ''}${t.kbps ? ` Bitrate="${t.kbps}"` : ''} />`, ...scanAndPois(s, '  '), ' </Song>'].join('\n')
}

/** Un tema que VirtualDJ ya tenía: se le cambian el análisis, la grilla y los cues; lo demás queda igual. */
function updateSong(block: string, s: VdjSong): string {
  const lines = block.split('\n')
  const head = lines[0], tail = lines[lines.length - 1]
  const body = lines.slice(1, -1).filter((l) => !/^\s*<Scan\b/.test(l) && !/^\s*<Poi\b[^>]*Type="(beatgrid|cue|loop)"/.test(l))
  return [head, ...body, ...scanAndPois(s, '  '), tail].join('\n')
}

const SONG = /<Song\b[^>]*?(?:\/>|>[\s\S]*?<\/Song>)/g
const pathOf = (block: string) => { const m = block.match(/FilePath="([^"]*)"/); return m ? unesc(m[1]).toLowerCase() : null }

/**
 * La base con los temas de PAILA: los nuevos al final, los que ya estaban actualizados (salvo que tengan cues propios:
 * `kept`). `before`: la base de hoy, o null si VirtualDJ todavía no la creó.
 */
export function mergeDatabase(before: string | null, songs: VdjSong[]): { xml: string; kept: number } {
  const want = new Map(songs.map((s) => [winPath(s.t.abs).toLowerCase(), s]))
  let kept = 0
  if (before == null || !/<VirtualDJ_Database\b/.test(before)) {
    return { xml: ['<?xml version="1.0" encoding="UTF-8"?>', '<VirtualDJ_Database Version="8.5">', ...songs.map(newSong), '</VirtualDJ_Database>', ''].join('\n').replace(/\n/g, '\r\n'), kept }
  }
  const seen = new Set<string>()
  let xml = before.replace(/\r\n/g, '\n').replace(SONG, (block) => {
    const p = pathOf(block)
    const s = p ? want.get(p) : undefined
    if (!s || !p) return block
    seen.add(p)
    // un tema con cues puestos en VirtualDJ es tuyo: no se toca
    if (/<Poi\b[^>]*Type="cue"/.test(block) || /<Poi\b(?![^>]*Type=)[^>]*Num="/.test(block)) { kept++; return block }
    return updateSong(block.endsWith('/>') ? block.replace(/\s*\/>$/, '>\n </Song>') : block, s)
  })
  const added = songs.filter((s) => !seen.has(winPath(s.t.abs).toLowerCase())).map(newSong)
  if (added.length) xml = xml.replace(/<\/VirtualDJ_Database>\s*$/, `${added.join('\n')}\n</VirtualDJ_Database>\n`)
  // VirtualDJ escribe con fin de línea de Windows
  return { xml: xml.replace(/\n/g, '\r\n'), kept }
}

/** Una lista de VirtualDJ (MyLists): los temas en orden, con su ruta completa. */
export function buildList(tracks: Picked['tracks']): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<VirtualFolder noDuplicates="no" singleDrive="no" ordered="yes">',
    ...tracks.map((t, i) => ` <song path="${esc(winPath(t.abs))}" size="${t.size}"${t.duration ? ` songlength="${n6(t.duration)}"` : ''} artist="${esc(t.artist)}" title="${esc(t.title ?? path.basename(t.abs, path.extname(t.abs)))}" idx="${i}" />`),
    '</VirtualFolder>', ''].join('\r\n')
}
