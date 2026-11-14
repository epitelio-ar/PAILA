// Convertir los formatos que Rekordbox y las CDJ no leen (WMA, OGG, Opus) a uno que sí, sin perder lo ordenado:
// el tema conserva tags, tapa, nombre y playlists (usa el Reemplazo), y el original va a la papelera (se puede deshacer).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { lowPriority } from './lowpriority'
import { visible, type Db } from './db'
import { pcmHash } from './audiohash'
import { probe } from './probe'
import type { Replacer } from './replace'
import type { ConvertResult, Unreadable } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  sinDisco: { es: 'El disco no está conectado o el archivo ya no está', en: "The drive isn't connected or the file is no longer there" },
  noCoincide: { es: 'La verificación del audio no coincide: no se reemplaza', en: "The audio check doesn't match: it isn't replaced" },
  noDura: { es: (a: string, b: string) => `El archivo convertido no dura lo mismo (${a} s → ${b} s): no se reemplaza`, en: (a: string, b: string) => `The converted file doesn't have the same length (${a} s → ${b} s): it isn't replaced` },
})

/**
 * Destino para los que tienen pérdida (WMA común, OGG, Opus):
 * - 'mp3': MP3 320, lo lee cualquier equipo. Es convertir de un formato con pérdida a otro: se pierde un poquito más (casi nada a 320).
 * - 'flac': no se pierde nada más, pero ocupa unas 5 veces más y la calidad sigue siendo la del original.
 * Los WMA sin pérdida (WMA Lossless) van siempre a FLAC y se verifican bit a bit.
 */
export type DjTarget = 'mp3' | 'flac'


const LOSSY = ['wmav1', 'wmav2', 'wmapro', 'wmavoice', 'vorbis', 'opus']
const LOSSLESS = ['wmalossless']
/** Extensiones que Rekordbox y las CDJ no leen (Duplicados, a igual nota, se queda con la que sí). */
export const DJ_UNREADABLE_EXTS = ['wma', 'asf', 'ogg', 'oga', 'opus', 'webm']
const EXTS = DJ_UNREADABLE_EXTS

/** Temas de la Música (y Para revisar) en formatos que Rekordbox no lee. Los samples y proyectos no se tocan. */
export function djUnreadable(db: Db): Unreadable[] {
  const rows = db.prepare(
    `SELECT id, rel_path AS rel, ext, codec, size FROM files
     WHERE ${visible()} AND error IS NULL AND kind IN ('musica', 'revisar') AND ext IN (${EXTS.map(() => '?').join(',')})
     ORDER BY rel_path`,
  ).all(...EXTS) as { id: number; rel: string; ext: string; codec: string | null; size: number }[]
  return rows.filter((r) => LOSSY.includes(r.codec ?? '') || LOSSLESS.includes(r.codec ?? '')).map((r) => ({ ...r, lossless: LOSSLESS.includes(r.codec ?? '') }))
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    lowPriority(p.pid)
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).pop() || `ffmpeg terminó con código ${code}`))))
  })
}


export async function convertForDj(
  db: Db, ids: number[], target: DjTarget, pathOf: (id: number) => string | null, replacer: Replacer, ffmpeg: string, ffprobe: string, workDir: string,
  onProgress: (p: { done: number; total: number; current: string }) => void = () => {}, isCancelled: () => boolean = () => false,
): Promise<ConvertResult> {
  const res: ConvertResult = { converted: 0, trashedBytes: 0, failed: [] }
  const byId = new Map(djUnreadable(db).map((u) => [u.id, u]))
  fs.mkdirSync(workDir, { recursive: true })
  let i = 0
  for (const id of ids) {
    if (isCancelled()) break
    const u = byId.get(id)
    onProgress({ done: i++, total: ids.length, current: u?.rel ?? '' })
    if (!u) continue // ya no está, ya se convirtió, o es de una colección que no se toca
    const src = pathOf(id)
    const ext = u.lossless || target === 'flac' ? 'flac' : 'mp3'
    const tmp = path.join(workDir, `dj-${id}.${ext}`)
    try {
      if (!src || !fs.existsSync(src)) throw new Error(T.sinDisco)
      const codec = ext === 'mp3'
        ? ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3']
        : u.lossless ? ['-c:a', 'flac', '-compression_level', '8']
          // de con pérdida a FLAC: 24 bits para no recortar nada del audio decodificado
          : ['-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's32', '-bits_per_raw_sample', '24']
      await run(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-i', src, '-map', '0:a:0', '-vn', ...codec, tmp])
      if (u.lossless) {
        // Sin pérdida → sin pérdida: tiene que sonar idéntico, bit a bit.
        const [a, b] = await Promise.all([pcmHash(ffmpeg, src), pcmHash(ffmpeg, tmp)])
        if (a !== b) throw new Error(T.noCoincide)
      } else {
        // Con pérdida: no puede ser idéntico; se verifica que el nuevo se lea entero y dure lo mismo.
        await pcmHash(ffmpeg, tmp)
        const [d0, d1] = await Promise.all([probe(ffprobe, src), probe(ffprobe, tmp)])
        if (d0.duration == null || d1.duration == null || Math.abs(d0.duration - d1.duration) > 0.5) {
          throw new Error(T.noDura(String(d0.duration ?? '?'), String(d1.duration ?? '?')))
        }
      }
      await replacer.replace(id, tmp, { keepTags: true, keepCover: true, sameName: true, keepDj: true })
      res.converted++; res.trashedBytes += u.size
    } catch (e) {
      res.failed.push({ rel: u.rel, error: (e as Error).message })
    } finally { fs.rmSync(tmp, { force: true }) }
  }
  onProgress({ done: i, total: ids.length, current: '' })
  return res
}
