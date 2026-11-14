// NAPIA: la lista que se le pasa a sockseek y sus argumentos. Funciones puras (sin procesos ni archivos), con tests.
// Siempre se le da un CSV propio (Artist,Title,Album,Length, el mismo de "Exportar para sockseek" de PAILA): así cualquier
// entrada (Chosic, Exportify, texto pegado, la lista «Faltan o suenan mal») llega igual, con la duración que mejora la búsqueda.
// sockseek guarda lo bajado en <destino>/<nombre de la lista>/ y anota todo en su índice: con el mismo nombre, la próxima
// vez saltea lo que ya bajó. NAPIA le da como destino su carpeta de trabajo y el índice en sus datos (ver carpetas.ts), y
// reemplaza las acciones al terminar de la config de sockseek (por ejemplo "mover a Completo") por una que no hace nada:
// lo que se pasa por la línea de comandos pisa la config y sus perfiles automáticos.
import { sockseekCsv, type ExportTrack } from '../listexport'
import { requestTitle, sameSong, titleParts } from '../listmatch'
import type { Calidad, NapiaOptions } from '@paila/shared/napia'

/** Un nombre que sirve de archivo y de carpeta en Windows ("80s Mood", no "80s: Mood?"). */
export function listFileName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return (/^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `${clean} (lista)` : clean).slice(0, 80) || 'Lista'
}

/**
 * Los temas tal como van a sockseek: con `sacarRemaster`, sin " - 2011 Remaster" (casi nadie lo usa en Soulseek); sin
 * repetidos ni renglones sin título (repetido = el mismo tema aunque cambie "feat." o un remaster: sameSong); con `primeros`, solo esos. Son también las filas del avance (sockseek las nombra igual).
 */
export function listRows<T extends ExportTrack>(tracks: T[], o: Pick<NapiaOptions, 'sacarRemaster' | 'primeros'> & Partial<NapiaOptions>): T[] {
  const seen = new Map<string, T[]>() // por título base: así no se compara cada tema con todos
  const rows = tracks.map((t) => (o.sacarRemaster ? { ...t, title: requestTitle(t.title) } : t)).filter((t) => {
    if (!t.title.trim()) return false
    const k = titleParts(t.title).base || t.title.toLowerCase()
    const same = seen.get(k) ?? []
    if (same.some((s) => s.artist.toLowerCase() === t.artist.toLowerCase() && s.title.toLowerCase() === t.title.toLowerCase() || sameSong(s, t))) return false
    seen.set(k, [...same, t]); return true
  })
  return o.primeros ? rows.slice(0, o.primeros) : rows
}

/** El CSV para sockseek (Artist,Title,Album,Length). */
export const listCsv = (tracks: ExportTrack[], o: Pick<NapiaOptions, 'sacarRemaster' | 'primeros'> & Partial<NapiaOptions>) => sockseekCsv(listRows(tracks, o))

const SIN_PERDIDA = 'flac,wav,aiff,aif'

/**
 * Qué se le pide a sockseek según la calidad elegida: lo obligatorio (--format, --min-bitrate: lo que no cumple no se baja) y
 * lo preferido (--pref-…: entre los que sirven, cuáles van primero). sockseek ordena primero por que sea el tema (título,
 * artista, duración), después por el formato preferido y después por los kbps preferidos (ResultSorter de sockseek 3.0.6).
 * De fábrica prefiere MP3 (--pref-format mp3): sin esto, "Buena calidad" elegía un MP3 de 320 antes que un FLAC.
 */
export const CALIDAD_ARGS: Record<Calidad, string[]> = {
  // nada obligatorio, pero primero lo mejor: sin pérdida, después 320, después lo que haya
  cualquiera: ['--pref-format', SIN_PERDIDA, '--pref-min-bitrate', '320'],
  // obligatorio 320 o sin pérdida (los FLAC y WAV pasan siempre: tienen más kbps; los MP3 de menos de 320 no); primero sin pérdida
  buena: ['--min-bitrate', '320', '--pref-format', SIN_PERDIDA],
  // obligatorio sin pérdida; primero FLAC (más liviano que un WAV o un AIFF, y con tags de verdad)
  sinperdida: ['--format', SIN_PERDIDA, '--pref-format', 'flac'],
}

export interface ArgsInput {
  /** El CSV armado con listCsv. */
  csvPath: string
  /** null: la carpeta de la config de sockseek (output-dir). */
  outputDir: string | null
  options: NapiaOptions
  /** El puerto que NAPIA abrió en el router: se le dice a sockseek para estar seguros de que escucha en ese. */
  listenPort?: number | null
  /** Es el sockseek con freno: las búsquedas duran 8 s en vez de 5 (con el freno, las respuestas llegan más espaciadas). */
  freno?: boolean
  /** Dónde va el índice de sockseek (en vez de <destino>/<lista>/_index.csv, mezclado con la música). */
  indexPath?: string
  /** Que no corran las acciones al terminar de la config de sockseek (NAPIA mueve lo bajado). */
  sinAcciones?: boolean
  /** Usuarios que no hay que usar: los que compartían una copia trucha (al buscar otra fuente, core/sockseek/control.ts). */
  vetados?: string[]
}

/** Una acción al terminar que no hace nada: pisa las de la config (sockseek pide un comando después de "--"). */
export const ACCION_VACIA = process.platform === 'win32' ? 'when=success scope=track hidden -- cmd /c rem' : 'when=success scope=track hidden -- true'

/**
 * Los argumentos de sockseek. `--progress-json` da el avance tema por tema en líneas JSON (lo lee core/sockseek/progress.ts).
 * La cuenta nunca va acá: la toma sockseek de su config.
 */
export function buildArgs({ csvPath, outputDir, options, listenPort, freno, indexPath, sinAcciones, vetados }: ArgsInput): string[] {
  return [
    csvPath, '--input-type', 'csv',
    ...(outputDir ? ['-o', outputDir] : []),
    ...CALIDAD_ARGS[options.calidad],
    ...(listenPort ? ['--listen-port', String(listenPort)] : []),
    ...(freno ? ['--search-timeout', '8000'] : []),
    ...(indexPath ? ['--index-path', indexPath] : []),
    ...(sinAcciones ? ['--on-complete', ACCION_VACIA] : []),
    ...(vetados?.length ? ['--banned-users', vetados.join(',')] : []),
    '--progress-json',
  ]
}

/** El comando como lo escribiría alguien en la consola (para "Ver detalle"): rutas con espacios entre comillas. */
export const commandLine = (exe: string, args: string[]) => [exe, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')
