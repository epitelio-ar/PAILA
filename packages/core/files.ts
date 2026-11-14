// Recorrido de carpetas. Las rutas relativas se guardan siempre con "/" (sirven igual en Windows y Mac).
import fsp from 'node:fs/promises'
import path from 'node:path'
import { textos } from '@paila/shared/idioma'

// El aviso de una carpeta que no se pudo leer (se ve al terminar de escanear).
const T = textos({ noLeer: { es: (dir: string, m: string) => `No se pudo leer ${dir}: ${m}`, en: (dir: string, m: string) => `Couldn't read ${dir}: ${m}` } })

export const AUDIO_EXT = new Set([
  'mp3', 'flac', 'wav', 'aif', 'aiff', 'm4a', 'aac', 'alac', 'ogg', 'oga', 'opus', 'webm',
  'wma', 'ape', 'wv', 'mka', 'tta', 'dsf', 'dff',
])

const SYSTEM_DIRS = new Set(['$recycle.bin', 'system volume information', '_paila', 'node_modules'])

export const extOf = (name: string) => path.extname(name).slice(1).toLowerCase()
export const isAudio = (name: string) => AUDIO_EXT.has(extOf(name)) && !name.startsWith('._')
export const isSystemDir = (name: string) => SYSTEM_DIRS.has(name.toLowerCase()) || name.startsWith('.')
/** ¿Es un ZIP o un RAR que el escaneo anota? (Las partes 2, 3… de un rar partido van con la primera: core/archive/rarread.ts.) */
export const isArchiveName = (name: string) => /\.(zip|rar)$/i.test(name) && !/\.part0*([2-9]|[1-9]\d+)\.rar$/i.test(name) && !name.startsWith('._')
export const toAbs = (root: string, rel: string) => path.join(root, ...rel.split('/'))

/** La carpeta más larga que tienen en común todas estas carpetas ('' si ninguna). */
export function commonDir(dirs: string[]): string {
  if (!dirs.length) return ''
  let parts = dirs[0].split('/')
  for (const d of dirs.slice(1)) {
    const p = d.split('/')
    let i = 0
    while (i < parts.length && i < p.length && parts[i] === p[i]) i++
    parts = parts.slice(0, i)
  }
  return parts.filter(Boolean).join('/')
}

export interface WalkEntry { abs: string; rel: string; size: number; mtime: number }

/** Cuántos archivos de una carpeta se miran a la vez. */
const STAT_BATCH = 32

/**
 * Recorre `root` y devuelve los archivos de audio. `skipDir(rel)` permite saltear carpetas excluidas.
 * Si una carpeta no se puede leer, se avisa con `onWarn` y se sigue.
 */
export async function* walkAudio(
  root: string,
  skipDir: (rel: string) => boolean,
  onWarn: (msg: string) => void,
  /** Avisa qué carpeta se está por leer (para que la barra muestre que avanza aunque la carpeta no tenga música). */
  onDir?: (rel: string) => void,
  /** Los ZIP y RAR que encuentra (se avisan aparte: no son temas). */
  onArchive?: (e: WalkEntry) => void,
): AsyncGenerator<WalkEntry> {
  const stack = ['']
  // Solo para pruebas: PAILA_SLOW_WALK=200 espera 200 ms por carpeta, para tener tiempo de desenchufar el disco a mitad
  // del recorrido y comprobar que no se pierde nada (prueba de la Fase A del MASTERPLAN-2).
  const slow = Number(process.env.PAILA_SLOW_WALK) || 0
  while (stack.length) {
    if (slow) await new Promise((r) => setTimeout(r, slow))
    const rel = stack.pop()!
    onDir?.(rel)
    const dir = rel ? toAbs(root, rel) : root
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (e) {
      onWarn(T.noLeer(dir, (e as Error).message))
      continue
    }
    const audio: { abs: string; rel: string; archive?: boolean }[] = []
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!isSystemDir(e.name) && !skipDir(childRel)) stack.push(childRel)
      } else if (e.isFile() && isAudio(e.name)) audio.push({ abs: path.join(dir, e.name), rel: childRel })
      else if (onArchive && e.isFile() && isArchiveName(e.name)) audio.push({ abs: path.join(dir, e.name), rel: childRel, archive: true })
    }
    // Tamaño y fecha de varios archivos a la vez (de a uno, casi todo el tiempo era esperar al disco). Mismo orden.
    for (let i = 0; i < audio.length; i += STAT_BATCH) {
      const part = audio.slice(i, i + STAT_BATCH)
      const stats = await Promise.all(part.map((f) => fsp.stat(f.abs).catch(() => null))) // null: se borró mientras recorríamos
      for (let k = 0; k < part.length; k++) {
        const st = stats[k]
        if (!st) continue
        const w = { abs: part[k].abs, rel: part[k].rel, size: st.size, mtime: Math.round(st.mtimeMs) }
        if (part[k].archive) onArchive!(w); else yield w
      }
    }
  }
}
