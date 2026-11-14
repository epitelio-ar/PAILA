// Leer un rekordbox.xml entero (Fase F, solo lectura): cada tema con su identificador, puntaje, color, comentarios y "my
// tags", la grilla (TEMPO) y los cue points (POSITION_MARK). Lo exporta Rekordbox desde Archivo → Exportar colección en
// formato xml. Puro: recibe el texto.
import type { GridSegment } from './analysis/grid'
import { tr } from '@paila/shared/idioma'

/** Un cue point o un loop. `num` -1 = memory cue; 0–7 = hot cue A–H. `type` 0 = cue, 4 = loop (1–3: fade y carga, raros). */
export interface RbCue { name: string; type: number; start: number; end: number | null; num: number; color: string | null }

export interface RbTrack {
  trackId: string
  /** Ruta normal ("D:/Música/…"), ya decodificada. */
  path: string
  name: string
  artist: string
  size: number | null
  seconds: number | null
  bpm: number | null
  key: string | null
  /** 0–5 estrellas (Rekordbox guarda 0, 51, 102, 153, 204 o 255). */
  stars: number
  /** "#RRGGBB" o null. */
  colour: string | null
  /** El comentario sin los "my tags". */
  comments: string
  myTags: string[]
  playCount: number
  grid: GridSegment[]
  cues: RbCue[]
  /** El texto original del tema (para volver a escribirlo igual si hace falta). */
  attrs: Record<string, string>
}

export const xmlUnesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&')

const attrsOf = (s: string) => {
  const a: Record<string, string> = {}
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) a[m[1]] = xmlUnesc(m[2])
  return a
}

/** "file://localhost/D:/M%C3%BAsica/x.mp3" → "D:/Música/x.mp3" (y en Mac "file://localhost/Users/…" → "/Users/…"). */
export function locationToPath(loc: string): string {
  let p = loc.replace(/^file:\/\/localhost\//i, '').replace(/^file:\/\/\//i, '')
  try { p = decodeURIComponent(p) } catch { /* queda como vino */ }
  return /^[A-Za-z]:/.test(p) ? p : '/' + p.replace(/^\/+/, '')
}

/**
 * Los "my tags" que Rekordbox agrega al comentario si está prendido "Agregar My Tag a los comentarios": van al final,
 * entre barra-asterisco ("Buen tema /* Pico / Cierre *\/"). Devuelve el comentario limpio y la lista.
 */
export function splitMyTags(comments: string): { comments: string; myTags: string[] } {
  const m = comments.match(/\s*\/\*\s*(.*?)\s*\*\/\s*$/)
  if (!m) return { comments, myTags: [] }
  return { comments: comments.slice(0, m.index).trim(), myTags: m[1].split(/\s+\/\s+/).map((t) => t.trim()).filter(Boolean) }
}

const hexColour = (s: string | undefined) => {
  const m = s?.match(/^0x([0-9a-f]{6})$/i)
  return m ? `#${m[1].toUpperCase()}` : null
}
const num = (s: string | undefined) => { const n = Number(s); return s != null && s !== '' && Number.isFinite(n) ? n : null }
const rgb = (a: Record<string, string>) => (a.Red != null && a.Green != null && a.Blue != null
  ? '#' + [a.Red, a.Green, a.Blue].map((x) => Math.max(0, Math.min(255, Number(x) || 0)).toString(16).padStart(2, '0')).join('').toUpperCase() : null)

/** Todos los temas de la colección. Los que no tienen Location (los "streaming") se saltean. */
export function parseRbXml(xml: string): RbTrack[] {
  const start = xml.indexOf('<COLLECTION'), end = xml.indexOf('</COLLECTION>')
  if (start < 0) throw new Error(tr({ es: 'Este archivo no es un rekordbox.xml (no tiene COLLECTION).', en: "This file isn't a rekordbox.xml (it has no COLLECTION)." }))
  const coll = xml.slice(start, end < 0 ? undefined : end)
  const out: RbTrack[] = []
  // cada tema: <TRACK …/> o <TRACK …> … </TRACK>
  for (const m of coll.matchAll(/<TRACK\s([^>]*?)(\/>|>([\s\S]*?)<\/TRACK>)/g)) {
    const a = attrsOf(m[1])
    if (!a.Location || !a.TrackID) continue
    const body = m[3] ?? ''
    const grid: GridSegment[] = []
    for (const t of body.matchAll(/<TEMPO\s([^>]*?)\/?>/g)) {
      const x = attrsOf(t[1])
      const s = num(x.Inizio), bpm = num(x.Bpm)
      if (s != null && bpm && bpm > 0) grid.push({ start: s, bpm, beat: Math.max(1, Math.min(4, Number(x.Battito) || 1)) })
    }
    const cues: RbCue[] = []
    for (const c of body.matchAll(/<POSITION_MARK\s([^>]*?)\/?>/g)) {
      const x = attrsOf(c[1])
      const s = num(x.Start)
      if (s == null) continue
      cues.push({ name: x.Name ?? '', type: Number(x.Type) || 0, start: s, end: num(x.End), num: x.Num != null ? Number(x.Num) : -1, color: rgb(x) })
    }
    const rating = Number(a.Rating) || 0
    const { comments, myTags } = splitMyTags(a.Comments ?? '')
    out.push({
      trackId: a.TrackID, path: locationToPath(a.Location), name: a.Name ?? '', artist: a.Artist ?? '',
      size: num(a.Size), seconds: num(a.TotalTime), bpm: num(a.AverageBpm) || null, key: a.Tonality || null,
      stars: Math.max(0, Math.min(5, Math.round(rating / 51))), colour: hexColour(a.Colour), comments, myTags,
      playCount: Number(a.PlayCount) || 0, grid: grid.sort((x, y) => x.start - y.start), cues, attrs: a,
    })
  }
  return out
}

/** Una playlist del rekordbox.xml: su nombre, las carpetas donde está (de afuera hacia adentro) y sus temas por TrackID. */
export interface RbPlaylist { name: string; folders: string[]; trackIds: string[] }

/**
 * Las playlists del rekordbox.xml (la parte PLAYLISTS), en el orden de Rekordbox. Las que nombran sus temas por ruta
 * (KeyType 1) se pasan a TrackID con la colección. Las carpetas vacías no aparecen; las playlists vacías sí.
 */
export function parseRbPlaylists(xml: string, tracks: RbTrack[] = parseRbXml(xml)): RbPlaylist[] {
  const start = xml.indexOf('<PLAYLISTS')
  if (start < 0) return []
  const end = xml.indexOf('</PLAYLISTS>', start)
  const part = xml.slice(start, end < 0 ? undefined : end)
  const byLocation = new Map(tracks.map((t) => [t.attrs.Location, t.trackId]))
  const out: RbPlaylist[] = []
  const stack: { name: string; list: RbPlaylist | null; byPath: boolean }[] = []
  for (const m of part.matchAll(/<(\/?)(NODE|TRACK)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, body, selfClose] = m
    const top = stack[stack.length - 1]
    if (tag === 'TRACK') {
      const key = attrsOf(body).Key
      const id = key && (top?.byPath ? byLocation.get(key) : key)
      if (top?.list && id) top.list.trackIds.push(id)
      continue
    }
    if (closing) { stack.pop(); continue }
    const a = attrsOf(body)
    const folders = stack.map((s) => s.name).filter((n, i) => !(i === 0 && n === 'ROOT'))
    const list = a.Type === '1' ? { name: a.Name ?? '', folders, trackIds: [] } : null
    if (list) out.push(list)
    if (!selfClose) stack.push({ name: a.Name ?? '', list, byPath: a.KeyType === '1' })
  }
  return out
}
