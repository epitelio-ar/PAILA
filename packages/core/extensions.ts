// Extensiones equivocadas: archivos que se llaman .mp3 (o lo que sea) pero por dentro son otro formato.
// Se detectan con el códec que leyó el escaneo y se confirman mirando los primeros bytes del archivo.
import fs from 'node:fs'
import path from 'node:path'

/**
 * Qué formato es en realidad un archivo, mirando sus primeros bytes. null = no se reconoce.
 * Un tag ID3v2 al principio no siempre es un MP3: algunos programas se lo pegan adelante a un FLAC ("Barbie Girl", "Don't Start
 * Now", 22/10/2026), que es un FLAC de verdad (la librería de tags lo sabe guardar así). Con cualquier otra cosa después del tag
 * sigue siendo "MP3": hay .mp3 que son un ID3 pegado a un WebM o a un WAV con MP3 adentro (laboratorio: Jagger, Divididos), y a
 * esos se les escribe bien el ID3 de adelante, sin tocar el sonido; con la extensión "real" ya no se podrían leer sus tags.
 */
export function sniff(file: string): string | null {
  const fd = fs.openSync(file, 'r')
  try {
    let at = 0
    const head = Buffer.alloc(10)
    // puede haber más de un tag seguido; con 4 alcanza
    for (let n = 0; n < 4 && fs.readSync(fd, head, 0, 10, at) === 10 && head.toString('latin1', 0, 3) === 'ID3'; n++) {
      if (head[6] & 0x80 || head[7] & 0x80 || head[8] & 0x80 || head[9] & 0x80) break // tamaño roto: no seguir
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]
      at += 10 + size + (head[5] & 0x10 ? 10 : 0) // + el pie, si lo tiene
    }
    const b = Buffer.alloc(64)
    fs.readSync(fd, b, 0, 64, at)
    const real = sniffBytes(b)
    return at > 0 && real !== 'FLAC' ? 'MP3' : real
  } finally { fs.closeSync(fd) }
}

function sniffBytes(b: Buffer): string | null {
  const s = b.toString('latin1')
  // WebM / Matroska (lo que baja yt-dlp de YouTube): la marca EBML y, cerca, el tipo de documento
  if (b.readUInt32BE(0) === 0x1a45dfa3) return s.includes('webm') ? 'WEBM' : s.includes('matroska') ? 'MKA' : null
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'WAV'
  if (s.startsWith('fLaC')) return 'FLAC'
  if (s.startsWith('OggS')) return 'OGG'
  if (s.slice(4, 8) === 'ftyp') return 'M4A/MP4'
  if (s.startsWith('FORM')) return 'AIFF'
  // MP3: un tag ID3 que no se pudo saltear o un cuadro de MPEG (capa I/II/III; el AAC "ADTS" tiene capa 0 y no cuenta)
  if (s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return 'MP3'
  return null
}

/** Extensión correcta para cada formato real, y las que también valen. */
const REAL: Record<string, { ext: string; ok: string[] }> = {
  WAV: { ext: 'wav', ok: ['wav'] },
  FLAC: { ext: 'flac', ok: ['flac'] },
  OGG: { ext: 'ogg', ok: ['ogg', 'oga', 'opus'] },
  'M4A/MP4': { ext: 'm4a', ok: ['m4a', 'mp4', 'aac', 'alac'] },
  AIFF: { ext: 'aiff', ok: ['aif', 'aiff'] },
  MP3: { ext: 'mp3', ok: ['mp3'] },
  WEBM: { ext: 'webm', ok: ['webm', 'mka', 'mkv'] },
  MKA: { ext: 'mka', ok: ['mka', 'mkv', 'webm'] },
}

/** Códecs que se esperan para cada extensión (lo que leyó ffprobe en el escaneo). Si no está, no se revisa. */
const EXPECT: Record<string, (codec: string) => boolean> = {
  mp3: (c) => c === 'mp3',
  wav: (c) => c.startsWith('pcm_'), aif: (c) => c.startsWith('pcm_'), aiff: (c) => c.startsWith('pcm_'),
  flac: (c) => c === 'flac',
  m4a: (c) => c === 'aac' || c === 'alac', mp4: (c) => c === 'aac' || c === 'alac', aac: (c) => c === 'aac',
  ogg: (c) => ['vorbis', 'opus', 'flac'].includes(c), oga: (c) => ['vorbis', 'opus', 'flac'].includes(c), opus: (c) => c === 'opus',
}

/** ¿Vale la pena mirar este archivo? (el códec no es el que corresponde a su extensión) */
export const suspicious = (ext: string, codec: string | null) => !!codec && !!EXPECT[ext] && !EXPECT[ext](codec)

export interface ExtensionFix {
  real: string // formato real ("WAV")
  ext: string // extensión nueva, sin punto
  base: string | null // nombre nuevo sin extensión, si cambia
}

/**
 * Cómo corregir el nombre de un archivo cuya extensión miente.
 * Si el título del tema contiene la extensión vieja (el disco ".mp3" de Emilia: "La_Original.mp3"), es parte del nombre:
 * se conserva y se agrega la extensión real ("La_Original.mp3.wav"). Si no, se reemplaza ("Tema.mp3" → "Tema.m4a").
 */
export function extensionFix(rel: string, real: string, title: string | null): ExtensionFix | null {
  const r = REAL[real]
  const file = rel.slice(rel.lastIndexOf('/') + 1)
  const oldExt = path.extname(file) // con el punto y las mayúsculas como estén
  const cur = oldExt.slice(1).toLowerCase()
  if (!r || r.ok.includes(cur)) return null
  const esc = cur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inTitle = !!cur && !!title && new RegExp(`\\.${esc}(?![a-z0-9])`, 'i').test(title)
  return { real, ext: r.ext, base: inTitle ? file : null }
}

/**
 * ¿Es un MP4/M4A "fragmentado" (DASH, como los baja yt-dlp de YouTube sin reacomodar)? La librería de tags no puede
 * guardar en esos archivos. Se mira solo la lista de cajas del primer nivel.
 */
export function isFragmentedMp4(file: string): boolean {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const h = Buffer.alloc(16)
    let p = 0
    for (let n = 0; n < 64 && p + 8 <= size; n++) {
      fs.readSync(fd, h, 0, 16, p)
      const type = h.toString('latin1', 4, 8)
      if (n === 0 && type !== 'ftyp') return false
      if (type === 'moof') return true
      let box = h.readUInt32BE(0)
      if (box === 1) box = Number(h.readBigUInt64BE(8))
      if (box < 8) return false
      p += box
    }
    return false
  } finally { fs.closeSync(fd) }
}
