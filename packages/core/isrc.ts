// Códigos ISRC de la biblioteca (el código único de cada grabación) leídos de los tags con ffprobe y guardados en
// `file_isrc` mientras el archivo no cambie (tamaño y fecha). Con ellos una lista de Spotify se empareja seguro.
// La primera vez se leen todos (~1 min cada 4.000 temas); después, solo los nuevos o cambiados.
import { execFile } from 'node:child_process'
import { visible, type Db } from './db'
import { cleanIsrc } from './listparse'

interface Todo { id: number; size: number; mtime: number }

/** El ISRC de un archivo (TSRC en MP3, ISRC en FLAC, M4A y los demás), o null. */
export function readIsrc(ffprobe: string, file: string): Promise<string | null> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_entries', 'format_tags:stream_tags', file]
  return new Promise((resolve) => execFile(ffprobe, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) return resolve(null)
    try {
      const j = JSON.parse(out) as { format?: { tags?: Record<string, string> }; streams?: { tags?: Record<string, string> }[] }
      for (const tags of [j.format?.tags, ...(j.streams ?? []).map((s) => s.tags)]) {
        for (const [k, v] of Object.entries(tags ?? {})) if (/^(?:isrc|tsrc)$/i.test(k) && cleanIsrc(v)) return resolve(cleanIsrc(v))
      }
    } catch { /* sin tags */ }
    resolve(null)
  }))
}

export class IsrcIndex {
  constructor(private db: Db, private ffprobe: string, private pathOf: (id: number) => string | null) {}

  /** Los temas de Música y Para revisar que no tienen el ISRC leído (o cambiaron desde que se leyó). */
  private todo(): Todo[] {
    return this.db.prepare(
      `SELECT f.id, f.size, f.mtime FROM files f LEFT JOIN file_isrc i ON i.file_id = f.id
       WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar') AND (i.file_id IS NULL OR i.size != f.size OR i.mtime != f.mtime)`,
    ).all() as unknown as Todo[]
  }

  pending(): number { return this.todo().length }

  /** Lee lo que falta, de a varios a la vez. Lo que está en un disco desconectado queda para la próxima. */
  async refresh(onProgress?: (done: number, total: number) => void, isCancelled: () => boolean = () => false, parallel = 6): Promise<{ read: number; found: number }> {
    const todo = this.todo()
    const save = this.db.prepare('INSERT INTO file_isrc (file_id, size, mtime, isrc) VALUES (?, ?, ?, ?) ON CONFLICT (file_id) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, isrc = excluded.isrc')
    let i = 0, read = 0, found = 0
    await Promise.all(Array.from({ length: parallel }, async () => {
      while (i < todo.length && !isCancelled()) {
        const t = todo[i++]
        const file = this.pathOf(t.id)
        if (file) {
          const isrc = await readIsrc(this.ffprobe, file)
          save.run(t.id, t.size, t.mtime, isrc)
          if (isrc) found++
        }
        read++
        onProgress?.(read, todo.length)
      }
    }))
    return { read, found }
  }

  /** id del tema → ISRC (solo los que tienen). */
  map(): Map<number, string> {
    return new Map((this.db.prepare('SELECT file_id AS id, isrc FROM file_isrc WHERE isrc IS NOT NULL').all() as { id: number; isrc: string }[]).map((r) => [r.id, r.isrc]))
  }
}
