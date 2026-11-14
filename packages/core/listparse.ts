// Leer una lista traída de otro lado (MASTERPLAN-2, 4b): un CSV de Spotify (el de "80s Mood", Exportify, TuneMyMusic…),
// un texto pegado con un "Artista - Título" por línea, o un .m3u de otra compu (aunque las rutas no existan acá).
// Funciones puras: texto → temas en el orden de la lista. Emparejarlos con la biblioteca es core/listmatch.ts.
// No depende de la interfaz ni de la biblioteca: lo usan PAILA y NAPIA (el panel de sockseek; decisión del 20/10).
import path from 'node:path'
import { cleanBase } from './names'
import { textos } from '@paila/shared/idioma'
import type { CopiaTuya } from '@paila/shared/napia'
import { COPIA_COLS, OTRA_VERSION_COL } from './listexport'

/** De dónde viene la lista, como se muestra (los nombres de columnas que se reconocen, en COLUMNS, son datos: no se traducen). */
const T = textos({
  csvDe: { es: (p: string) => `CSV de ${p}`, en: (p: string) => `${p} CSV` },
  texto: { es: 'Texto pegado', en: 'Pasted text' },
  m3u: { es: 'Lista .m3u', en: '.m3u list' },
})

/** "Artista - Título" del nombre de un archivo (sin n.º de tema ni basura de páginas), o null. */
function fileGuess(base: string): { artist: string; title: string } | null {
  const b = cleanBase(base.replace(/\.[^.\s]{2,4}$/, '')).replace(/^\d{1,3}(?:\s*[-.)_]\s*|\s+)(?=\S)/, '')
  const parts = b.split(/\s+[-–—]\s+/)
  if (parts.length < 2 || /^\d{1,3}$/.test(parts[0])) return null
  return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
}

export interface ListEntry {
  /** 1, 2, 3…: el orden de la lista. */
  position: number
  artist: string
  title: string
  album: string | null
  /** En segundos. */
  duration: number | null
  /** El código único de cada grabación (si la lista lo trae). */
  isrc: string | null
  /** Solo en un .m3u: la ruta tal como venía (si existe en esta compu, se empareja por la ruta). */
  path: string | null
  /** Solo en el CSV para NAPIA de la lista «Faltan o suenan mal»: la copia que ya tenés y viene a reemplazarse. */
  tengo?: CopiaTuya | null
  /** Solo en el CSV para NAPIA: es otra versión de una copia tuya (dijiste "No es"), no se saltea. */
  otraVersion?: boolean
}
export type ListFormat = 'csv' | 'texto' | 'm3u'
export interface ParsedList {
  format: ListFormat
  /** De dónde parece venir, en el idioma de la pantalla ("CSV de Exportify" / "Exportify CSV"). */
  source: string
  entries: ListEntry[]
  /** Líneas o filas que no se entendieron. */
  skipped: string[]
}

/** Un ISRC de verdad: 2 letras de país, 3 del dueño, 2 del año y 5 números ("USEE10251351"). Los tags a veces traen basura. */
export const cleanIsrc = (v: string | null | undefined): string | null => {
  const s = (v ?? '').replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s) ? s : null
}

/** "04:24", "1:02:03", "264", "264000" (milisegundos) → segundos. `ms`: la columna dice que son milisegundos. */
export function parseDuration(v: string, ms = false): number | null {
  const s = v.trim()
  if (!s) return null
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$/)
  if (m) return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3])
  const n = Number(s.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return ms || n > 36_000 ? Math.round(n / 100) / 10 : n
}

/** Filas de un CSV (comillas, comas o saltos de línea adentro de las comillas). Detecta el separador: coma, punto y coma o tabulador. */
export function csvRows(text: string): string[][] {
  const t = text.replace(/^﻿/, '')
  const first = t.slice(0, t.search(/\r?\n|$/))
  const count = (ch: string) => first.replace(/"[^"]*"/g, '').split(ch).length
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0]
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && !cell) quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

/** Nombres de columna de cada dato, como los escriben Spotify, Exportify, TuneMyMusic, Soundiiz y planillas a mano. */
const COLUMNS: Record<'title' | 'artist' | 'album' | 'duration' | 'isrc', string[]> = {
  title: ['song', 'track name', 'title', 'track', 'name', 'song name', 'track title', 'nombre', 'canción', 'cancion', 'tema', 'título', 'titulo'],
  artist: ['artist', 'artist name(s)', 'artist name', 'artists', 'artist(s)', 'artist names', 'artista', 'artistas', 'intérprete', 'interprete'],
  album: ['album', 'album name', 'álbum', 'disco'],
  duration: ['duration', 'duration (ms)', 'track duration (ms)', 'duration_ms', 'duración', 'duracion', 'time', 'length', 'duración (ms)'],
  isrc: ['isrc'],
}
const looksLikeCsv = (text: string) => {
  const head = csvRows(text.split(/\r?\n/, 1)[0] ?? '')[0]?.map((h) => h.trim().toLowerCase()) ?? []
  return head.length >= 2 && head.some((h) => COLUMNS.title.includes(h)) && head.some((h) => COLUMNS.artist.includes(h))
}

/** Varios artistas separados por coma sin espacio ("Tears For Fears,Oleta Adams") o por punto y coma: se escriben con ", ". */
const artistText = (s: string) => s.split(/\s*;\s*|,(?=\S)/).map((x) => x.trim()).filter(Boolean).join(', ')

export function parseCsv(text: string): ParsedList {
  const rows = csvRows(text)
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (k: keyof typeof COLUMNS) => { for (const name of COLUMNS[k]) { const i = head.indexOf(name); if (i >= 0) return i } return -1 }
  const ti = col('title'), ai = col('artist'), al = col('album'), di = col('duration'), ii = col('isrc')
  const ms = di >= 0 && /ms/.test(head[di])
  // la copia que ya tenés (el CSV para NAPIA de la lista «Faltan o suenan mal», listexport.napiaCsv)
  const ci = (k: keyof typeof COPIA_COLS) => head.indexOf(COPIA_COLS[k].toLowerCase())
  const ni = ci('nota'), ki = ci('kbps'), qi = ci('que'), mi = ci('marcas'), ri = ci('recortes'), li = ci('lufs'), di2 = ci('id'), oi = head.indexOf(OTRA_VERSION_COL.toLowerCase())
  const numero = (r: string[], i: number) => { const v = i >= 0 ? (r[i] ?? '').trim() : ''; return v && Number.isFinite(Number(v)) ? Number(v) : null }
  const tengo = (r: string[], duracion: number | null): CopiaTuya | null => {
    const nota = ni >= 0 ? (r[ni] ?? '').trim().toUpperCase() : ''
    if (!/^(A\+|[ABCDF])$/.test(nota)) return null
    const kbps = numero(r, ki)
    return {
      nota, kbps: kbps && kbps > 0 ? kbps : null, que: qi >= 0 ? (r[qi] ?? '').trim() || null : null,
      marcas: mi >= 0 ? (r[mi] ?? '').split(/[\s,]+/).filter(Boolean) : [], recortes: numero(r, ri), lufs: numero(r, li), duracion, id: numero(r, di2),
    }
  }
  const from = head.includes('track uri') ? 'Exportify' : head.includes('parent genres') || head.includes('song preview') ? 'Chosic' : head.includes('playlist name') || head.some((h) => h.startsWith('spotify - ')) ? 'TuneMyMusic'
    : head.includes('spotify track id') ? 'Spotify' : null
  const source = from ? T.csvDe(from) : 'CSV'
  const entries: ListEntry[] = [], skipped: string[] = []
  for (const r of rows.slice(1)) {
    const title = (r[ti] ?? '').trim(), artist = artistText(r[ai] ?? '')
    if (!title) { skipped.push(r.join(', ').slice(0, 120)); continue }
    const duration = di >= 0 ? parseDuration(r[di] ?? '', ms) : null
    entries.push({ position: entries.length + 1, artist, title, album: al >= 0 ? (r[al] ?? '').trim() || null : null, duration, isrc: ii >= 0 ? cleanIsrc(r[ii]) : null, path: null, ...(ni >= 0 ? { tengo: tengo(r, duration) } : {}), ...(oi >= 0 && /^(?:yes|1|true)$/i.test((r[oi] ?? '').trim()) ? { otraVersion: true } : {}) })
  }
  return { format: 'csv', source, entries, skipped }
}

/**
 * Un "Artista - Título" por línea. Acepta el número adelante ("1. ", "01 - "), la duración al final ("(3:45)" o "3:45") y
 * tabuladores (pegado de una planilla). Sin " - " la línea es solo el título.
 */
export function parseText(text: string): ParsedList {
  const entries: ListEntry[] = [], skipped: string[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    // la lista de sockseek (la exporta PAILA): s:"Artista - Tema", con condiciones opcionales después; a:"…" es un disco
    const sk = line.match(/^(s:|a:)?"([^"]+)"(?:\s+.*)?$/i)
    if (sk?.[1]?.toLowerCase() === 'a:') { skipped.push(raw.slice(0, 120)); continue }
    if (sk) line = sk[2].trim()
    line = line.replace(/^(?:#?\d{1,4}\s*[.)\-–:]\s+|#\d{1,4}\s+)/, '')
    let duration: number | null = null
    const d = line.match(/\s*[([]?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]?\s*$/)
    if (d && d.index! > 0) { duration = parseDuration(d[1]); line = line.slice(0, d.index).trim() }
    const parts = line.includes('\t') ? line.split('\t').map((x) => x.trim()).filter(Boolean) : line.split(/\s+[-–—]\s+/)
    const [artist, title] = parts.length >= 2 ? [parts[0], parts.slice(1).join(' - ')] : ['', parts[0] ?? '']
    if (!title.trim()) { skipped.push(raw.slice(0, 120)); continue }
    entries.push({ position: entries.length + 1, artist: artistText(artist), title: title.trim(), album: null, duration, isrc: null, path: null })
  }
  return { format: 'texto', source: T.texto, entries, skipped }
}

/** Un .m3u o .m3u8: el nombre sale de "#EXTINF:duración,Artista - Título" o, si no hay, del nombre del archivo. */
export function parseM3u(text: string): ParsedList {
  const entries: ListEntry[] = [], skipped: string[] = []
  let info: { duration: number | null; label: string } | null = null
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const inf = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i)
    if (inf) { info = { duration: Number(inf[1]) > 0 ? Number(inf[1]) : null, label: inf[2].trim() }; continue }
    if (line.startsWith('#')) continue
    const file = line.startsWith('file:') ? decodeURIComponent(line.replace(/^file:\/+/, '')) : line
    const base = path.win32.basename(file)
    const fromLabel = info?.label ? parseText(info.label).entries[0] : undefined
    const guess = fileGuess(base)
    const artist = fromLabel?.artist || guess?.artist || ''
    const title = fromLabel?.title || guess?.title || base.replace(/\.[^.]+$/, '')
    if (!title) skipped.push(line.slice(0, 120))
    else entries.push({ position: entries.length + 1, artist, title, album: null, duration: info?.duration ?? null, isrc: null, path: file })
    info = null
  }
  return { format: 'm3u', source: T.m3u, entries, skipped }
}

/** Lee la lista según el nombre del archivo (si lo hay) o lo que parece el texto. */
export function parseList(text: string, fileName?: string): ParsedList {
  const ext = fileName ? path.extname(fileName).toLowerCase() : ''
  if (ext === '.m3u' || ext === '.m3u8' || /^﻿?#EXTM3U/i.test(text.trimStart())) return parseM3u(text)
  if (ext === '.csv' || ext === '.tsv' || looksLikeCsv(text)) return parseCsv(text)
  return parseText(text)
}

/**
 * El link de una playlist o un disco de Spotify, si el texto es eso. PAILA no lee la página de Spotify (no es oficial ni
 * estable, decisión del 20/10): ofrece bajar el CSV en Chosic o Exportify y traerlo.
 */
export function spotifyLink(text: string): string | null {
  const m = text.match(/https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]+)/) ?? text.match(/spotify:(playlist|album):([A-Za-z0-9]+)/)
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null
}
