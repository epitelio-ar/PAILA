// Lo que se muestra de un tema en la tabla, sin React: artista y título a mostrar, formato, carpeta, los problemas que filtran
// la tabla y el valor de cada columna para ordenar. Lo usan la interfaz y el proceso principal (bibliotecas grandes).
import type { Grade, Track } from './types'
import { generoPrincipal } from './generos'

export const fileName = (t: Track) => t.rel.slice(t.rel.lastIndexOf('/') + 1)
export const folder = (t: Track) => (t.rel.includes('/') ? t.rel.slice(0, t.rel.lastIndexOf('/')) : '')
const baseName = (t: Track) => fileName(t).replace(/\.[^.]+$/, '')

/** Título y artista a mostrar. Si faltan tags, se usan del nombre del archivo (y se avisa). */
export function display(t: Track): { artist: string; title: string; fromName: boolean } {
  const artist = t.artist || t.albumArtist || ''
  if (t.title && artist) return { artist, title: t.title, fromName: false }
  const s = baseName(t).replace(/_/g, ' ').replace(/^\(?\d{1,3}\)?\s*[-.)]?\s*/, '')
  const m = s.match(/^(.+?)\s+-\s+(.+)$/)
  if (m && !artist) return { artist: m[1], title: t.title || m[2], fromName: true }
  return { artist, title: t.title || s, fromName: !t.title }
}

export function format(t: Track): string {
  if (t.ext === 'm4a' || t.ext === 'mp4') return t.codec === 'alac' ? 'ALAC' : 'AAC'
  if (t.ext === 'aif') return 'AIFF'
  if (t.ext === 'webm') return t.codec === 'opus' ? 'Opus' : 'WebM'
  if (t.ext === 'opus') return 'Opus'
  return t.ext.toUpperCase()
}

export const hasFlag = (t: Track, ...flags: string[]) => !!t.flags && t.flags.split(',').some((f) => flags.includes(f))

export const GRADES: Grade[] = ['A+', 'A', 'B', 'C', 'D', 'F']

export type ProblemKey = 'fake_lossless' | 'as_recorded' | 'mp3like' | 'upscaled' | 'fake_hires' | 'low' | 'damaged' | 'no_tags' | 'rekordbox' | 'bpm_doubtful' | 'missing' | 'silence'

/** Qué temas entran en cada problema (las tarjetas de Inicio; los textos están en ui/src/problems.ts). */
export const PROBLEM_TESTS: Record<ProblemKey, (t: Track) => boolean> = {
  fake_lossless: (t) => hasFlag(t, 'fake_lossless', 'maybe_transcoded'),
  // los que se cortan "como fue grabado": de a poco, o de golpe con evidencia de que es del disco (decisión del 23/10/2026)
  as_recorded: (t) => hasFlag(t, 'as_recorded', 'cut20_trusted'),
  // sin pérdida que se cortan en seco justo donde corta un MP3 de ~256: pueden venir de uno (core/analysis/grade.ts)
  mp3like: (t) => hasFlag(t, 'cut20_mp3like'),
  upscaled: (t) => hasFlag(t, 'upscaled', 'reencoded'),
  fake_hires: (t) => hasFlag(t, 'fake_hires', 'fake_24bit'),
  low: (t) => t.grade === 'D' || t.grade === 'F',
  damaged: (t) => !!t.error || hasFlag(t, 'damaged'),
  no_tags: (t) => display(t).fromName,
  missing: (t) => !!t.missing,
  rekordbox: (t) => ['wma', 'ogg', 'oga', 'opus', 'webm'].includes(t.ext),
  bpm_doubtful: (t) => hasFlag(t, 'bpm_doubtful'),
  silence: (t) => hasFlag(t, 'silence_start', 'silence_end'),
}

export type SortKey = 'order' | 'artist' | 'title' | 'album' | 'year' | 'genre' | 'format' | 'kbps' | 'sampleRate' | 'duration' | 'size' | 'folder' | 'grade' | 'bpm' | 'camelot' | 'energy'

/** El valor por el que se ordena cada columna ('order' = la posición en la playlist, se ordena aparte). */
export const SORT_VALUES: Record<Exclude<SortKey, 'order'>, (t: Track) => string | number> = {
  artist: (t) => display(t).artist.toLowerCase(),
  title: (t) => display(t).title.toLowerCase(),
  grade: (t) => (t.grade ? GRADES.indexOf(t.grade) + 1 : 0),
  bpm: (t) => t.bpm || 0,
  camelot: (t) => (t.camelot ? parseInt(t.camelot) * 2 + (t.camelot.endsWith('B') ? 1 : 0) : 0),
  energy: (t) => t.energy || 0,
  album: (t) => (t.album || '').toLowerCase(),
  year: (t) => t.year || '',
  genre: (t) => (generoPrincipal(t.genre) ?? '').toLowerCase(), // el principal, como la columna (shared/generos.ts)
  format,
  kbps: (t) => t.kbps || 0,
  sampleRate: (t) => (t.sampleRate || 0) * 100 + (t.bits || 0),
  duration: (t) => t.duration || 0,
  size: (t) => t.size,
  folder: (t) => folder(t).toLowerCase(),
}

/** Desde cuánto un tema es largo para el espectrograma (un set, un enganchado, un recital). */
export const SPECTRO_LONG_SECONDS = 12 * 60
/**
 * El espectrograma de un tema largo se arma con pedazos repartidos a lo largo (12 de 10 s): un set de 1 h tardaba 25 a 45 s
 * entero y así tarda alrededor de 1 s, y se ve igual dónde se cortan los agudos en cada parte. null = el tema entero.
 */
export function spectroPieces(duration: number | null | undefined, n = 12, seconds = 10): { start: number; seconds: number }[] | null {
  if (!duration || duration < SPECTRO_LONG_SECONDS) return null
  const last = Math.max(0, duration - seconds - 1)
  return Array.from({ length: n }, (_, i) => ({ start: Math.round((last * i) / (n - 1)), seconds }))
}
