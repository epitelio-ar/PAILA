// Espectrogramas y reproductor (protocolo paila://audio/<id>).
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import type { Library } from '@paila/core/library'
import { spectroPieces } from '@paila/shared/trackinfo'

type TrackFile = NonNullable<ReturnType<Library['trackFile']>>

const run = (bin: string, args: string[]) => new Promise<void>((resolve, reject) => {
  execFile(bin, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, _o, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim().split('\n').pop()))
    else resolve()
  })
})

// Lo que se convierte una sola vez, aunque lo pidan dos veces seguidas.
const inFlight = new Map<string, Promise<void>>()
function once(out: string, make: () => Promise<void>): Promise<void> {
  if (fs.existsSync(out)) return Promise.resolve()
  let p = inFlight.get(out)
  if (!p) {
    const tmp = out + '.tmp' + path.extname(out)
    p = make()
      .then(() => fs.renameSync(tmp, out), (e) => { fs.rmSync(tmp, { force: true }); throw e })
      .finally(() => inFlight.delete(out))
    inFlight.set(out, p)
  }
  return p
}
const key = (id: number, f: TrackFile) => `${id}-${f.size}-${Math.round(f.mtime)}`

/** Deja solo los `keep` archivos más nuevos de una carpeta de caché. */
function trim(dir: string, keep: number) {
  const files = fs.readdirSync(dir).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f.n), { force: true })
}

/** Espectrograma (tiempo × frecuencia, como Spek) en PNG; de un tema largo, con pedazos repartidos (spectroPieces). Con leyenda (Reemplazar, en userData/spectro/) o sin leyenda (la ficha,
 *  en userData/espectro/: dibuja encima la escala de kHz y la línea donde se corta el sonido; de 0 abajo a la mitad del muestreo arriba, lineal). */
export async function spectrogram(ffmpeg: string, dir: string, id: number, f: TrackFile, leyenda = true, duration?: number | null): Promise<string> {
  fs.mkdirSync(dir, { recursive: true })
  // un tema largo (un set de 1 h): pedazos repartidos a lo largo, no el tema entero (ver spectroPieces)
  const pieces = spectroPieces(duration)
  const out = path.join(dir, key(id, f) + (pieces ? '-pedazos' : '') + '.png')
  const pic = leyenda ? 'showspectrumpic=s=640x320:legend=1:mode=combined:color=intensity:scale=log:fscale=lin'
    : 'showspectrumpic=s=800x300:legend=0:mode=combined:color=intensity:scale=log:fscale=lin'
  const input = pieces ? pieces.flatMap((p) => ['-ss', String(p.start), '-t', String(p.seconds), '-i', f.path]) : ['-i', f.path]
  const graph = pieces ? `${pieces.map((_, i) => `[${i}:a:0]`).join('')}concat=n=${pieces.length}:v=0:a=1,${pic}` : `[0:a:0]${pic}`
  await once(out, () => run(ffmpeg, ['-v', 'error', '-y', ...input, '-filter_complex', graph, '-frames:v', '1', out + '.tmp.png']))
  trim(dir, 2000)
  return 'data:image/png;base64,' + fs.readFileSync(out).toString('base64')
}

/** Forma de onda (la silueta del volumen a lo largo del tema) en PNG blanco sobre transparente, guardada en userData/onda/.
 *  El reproductor la usa como máscara para pintar lo que ya sonó y lo que falta. */
export async function waveform(ffmpeg: string, dir: string, id: number, f: TrackFile): Promise<string> {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, key(id, f) + '.png')
  await once(out, () => run(ffmpeg, ['-v', 'error', '-y', '-i', f.path, '-filter_complex',
    '[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1200x120:colors=white:scale=sqrt',
    '-frames:v', '1', out + '.tmp.png']))
  trim(dir, 500)
  return 'data:image/png;base64,' + fs.readFileSync(out).toString('base64')
}

/** Tapa chica (JPG de 240 px) sacada del archivo, guardada en userData/tapas/: para mostrar muchas a la vez (Inicio, tabla)
 *  sin pasar la tapa entera de cada tema. null si el archivo no trae tapa. */
export async function coverThumb(ffmpeg: string, dir: string, id: number, f: TrackFile): Promise<string | null> {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, key(id, f) + '.jpg'), none = out + '.sin'
  if (fs.existsSync(none)) return null
  try {
    await once(out, () => run(ffmpeg, ['-v', 'error', '-y', '-i', f.path, '-an', '-map', '0:v:0', '-frames:v', '1',
      '-vf', 'scale=240:240:force_original_aspect_ratio=increase,crop=240:240', '-q:v', '4', out + '.tmp.jpg']))
  } catch { fs.writeFileSync(none, ''); return null }
  trim(dir, 3000)
  return 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64')
}

// Formatos que el reproductor de Chromium no abre: se pasan antes a WAV.
const CONVERT_EXT = ['wma', 'aif', 'aiff', 'ape', 'wv', 'tta']
const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm',
}

async function playable(ffmpeg: string, cacheDir: string, id: number, f: TrackFile): Promise<{ file: string; mime: string }> {
  const ext = f.ext.toLowerCase()
  if (!CONVERT_EXT.includes(ext) && f.codec !== 'alac') return { file: f.path, mime: MIME[ext] || 'application/octet-stream' }
  fs.mkdirSync(cacheDir, { recursive: true })
  const out = path.join(cacheDir, key(id, f) + '.wav')
  await once(out, () => run(ffmpeg, ['-v', 'error', '-y', '-i', f.path, '-map', '0:a:0', '-c:a', 'pcm_s16le', out + '.tmp.wav']))
  trim(cacheDir, 30)
  return { file: out, mime: 'audio/wav' }
}

/** Respuesta del protocolo paila://audio/<id>, con soporte de Range para poder adelantar. */
export async function audioResponse(req: Request, lib: Library, ffmpeg: string | null, cacheDir: string, candidates: Map<number, string> = new Map()): Promise<Response> {
  const id = Number(new URL(req.url).pathname.replace(/^\//, ''))
  // ids negativos = archivos candidatos que el usuario eligió para comparar (solo los registrados, nunca rutas arbitrarias)
  const cand = id < 0 ? candidates.get(id) : undefined
  const f = cand && fs.existsSync(cand) ? { path: cand, ext: path.extname(cand).slice(1).toLowerCase(), codec: null, size: fs.statSync(cand).size, mtime: fs.statSync(cand).mtimeMs } : id < 0 ? null : lib.trackFile(id)
  if (!f || !fs.existsSync(f.path)) return new Response('No se encontró el archivo', { status: 404 })
  let src: { file: string; mime: string }
  try {
    src = ffmpeg ? await playable(ffmpeg, cacheDir, id, f) : { file: f.path, mime: MIME[f.ext] || 'application/octet-stream' }
  } catch (e) {
    return new Response((e as Error).message, { status: 500 })
  }
  const size = fs.statSync(src.file).size
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
  let start = 0, end = size - 1
  if (range) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])) }
    else if (range[2]) start = Math.max(0, size - Number(range[2]))
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const body = Readable.toWeb(fs.createReadStream(src.file, { start, end })) as unknown as ReadableStream
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': src.mime, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  })
}
