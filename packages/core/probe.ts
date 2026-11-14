// Lectura de formato y tags con ffprobe.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { textos } from '@paila/shared/idioma'

// Por qué no se pudo leer un archivo (se guarda con el tema y se ve en la tabla y la ficha).
const T = textos({
  fallo: { es: 'ffprobe falló', en: 'ffprobe failed' },
  respuesta: { es: 'Respuesta inválida de ffprobe', en: 'Invalid response from ffprobe' },
  sinAudio: { es: 'El archivo no tiene audio', en: 'The file has no audio' },
})

const require = createRequire(import.meta.url)

/**
 * ffprobe incluido con PAILA. En Windows, el del mismo armado que ffmpeg (gyan.dev 6.1.1, `npm run ffprobe:bajar`): en la app,
 * resources\ffprobe; en desarrollo, apps/paila/recursos/ffprobe (desde el código o desde el armado de electron-vite). En Mac, y
 * en Windows si todavía no se bajó, el de ffprobe-static (en la app empaquetada vive fuera del .asar).
 */
export function findFfprobe(): string | null {
  if (process.platform === 'win32') {
    const aca = path.dirname(fileURLToPath(import.meta.url))
    const res = (process as { resourcesPath?: string }).resourcesPath
    const lugares = [res && path.join(res, 'ffprobe', 'ffprobe.exe'), path.join(aca, '../../apps/paila/recursos/ffprobe/ffprobe.exe'), path.join(aca, '../../recursos/ffprobe/ffprobe.exe')]
    const p = lugares.find((l) => l && fs.existsSync(l))
    if (p) return p
  }
  try {
    const p: string = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked')
    if (fs.existsSync(p)) return p
  } catch { /* sigue */ }
  const enPaila = desempacado(path.join('ffprobe-static', 'bin', process.platform, process.arch, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'))
  return enPaila && fs.existsSync(enPaila) ? enPaila : null
}

/**
 * Un programa de node_modules que el instalador deja afuera del .asar (app.asar.unpacked). Hace falta para NAPIA: vive en
 * resources/napia, fuera del node_modules de PAILA, y require no lo encuentra (ver apps/paila/electron/arranque.ts).
 */
function desempacado(rel: string): string | null {
  const res = (process as { resourcesPath?: string }).resourcesPath
  return res ? path.join(res, 'app.asar.unpacked', 'node_modules', rel) : null
}

/** ffmpeg incluido con PAILA (para analizar, espectrogramas y convertir). */
export function findFfmpeg(): string | null {
  try {
    const p: string = (require('ffmpeg-static') as string).replace('app.asar', 'app.asar.unpacked')
    if (p && fs.existsSync(p)) return p
  } catch { /* sigue */ }
  const enPaila = desempacado(path.join('ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))
  return enPaila && fs.existsSync(enPaila) ? enPaila : null
}

export interface ProbeResult {
  codec: string | null
  sampleRate: number | null
  bits: number | null
  channels: number | null
  kbps: number | null
  duration: number | null
  artist: string | null
  albumArtist: string | null
  title: string | null
  album: string | null
  track: string | null
  year: string | null
  genre: string | null
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
const str = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())

export function probe(ffprobe: string, file: string): Promise<ProbeResult> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-select_streams', 'a:0', file]
  return new Promise((resolve, reject) => {
    execFile(ffprobe, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, out, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop() || T.fallo))
      let j
      try { j = JSON.parse(out) } catch { return reject(new Error(T.respuesta)) }
      const s = (j.streams || [])[0]
      if (!s) return reject(new Error(T.sinAudio))
      const f = j.format || {}
      const tags: Record<string, string> = {}
      for (const src of [f.tags, s.tags]) if (src) for (const [k, v] of Object.entries(src)) tags[k.toLowerCase()] = String(v)
      const fmtBits: Record<string, number> = { s16: 16, s16p: 16, s32: 24, s32p: 24, u8: 8 }
      const lossy = /^(mp3|aac|vorbis|opus|wma)/.test(s.codec_name || '')
      resolve({
        codec: str(s.codec_name),
        sampleRate: num(s.sample_rate),
        bits: lossy ? null : num(s.bits_per_raw_sample) ?? num(s.bits_per_sample) ?? fmtBits[s.sample_fmt] ?? null,
        channels: num(s.channels),
        kbps: (() => { const b = num(s.bit_rate) ?? num(f.bit_rate); return b ? Math.round(b / 1000) : null })(),
        duration: (() => { const d = num(s.duration) ?? num(f.duration); return d ? Math.round(d * 10) / 10 : null })(),
        artist: str(tags.artist),
        albumArtist: str(tags.album_artist ?? tags.albumartist ?? tags['album artist']),
        title: str(tags.title),
        album: str(tags.album),
        track: str(tags.track ?? tags.tracknumber),
        year: str((tags.date ?? tags.year ?? '').slice(0, 4)),
        genre: str(tags.genre),
      })
    })
  })
}
