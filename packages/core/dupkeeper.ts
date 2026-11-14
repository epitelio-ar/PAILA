// Cuál copia de un grupo de duplicados conviene conservar (pickKeeper): la nota, el formato, cuánto satura, el bitrate, los tags,
// el lugar. Lo usan Duplicados, "Mejorar esta playlist" y fusionar playlists.
import { isCopyName } from './dupnames'
import { DJ_UNREADABLE_EXTS } from './convert'
import type { DupItem } from '@paila/shared/types'

/**
 * Satura más que otra copia: 5 tramos o más con la señal aplastada contra el techo (3 muestras seguidas al máximo, como los
 * cuenta el análisis), bastantes más que la otra (5, o el 10 %) y 1 dB más fuerte: otro master, más aplastado. Es la regla de la
 * Bandeja (inboxflow.ts). Un pico de más de 0 dB entre muestras no alcanza (ensayo del 24/10); y con el mismo volumen, contar
 * algunos recortes más es un efecto de cómo se codificó, no otro master. Como "sí o no", casi todo el pop y la cumbia de hoy
 * "satura" y entre dos que saturan decidía la ruta más corta: en "TODOS CON EL CELU" se quedaba la de 703 recortes y 2 dB más
 * fuerte (repaso de criterios del 24/10).
 */
const CLIPS = 5
const LOUDER_DB = 1
const GRADE_RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'tta'])
const NOT_EVERYWHERE = new Set(DJ_UNREADABLE_EXTS)
/**
 * Diferencias de corte más chicas que esto son ruido de la medición (en la Música, las copias iguales difieren hasta ~100 Hz). Y el
 * corte solo compara copias que deberían llegar arriba (sin pérdida, o 256 kbps o más): en un MP3 de 128 cortar en 16 kHz es lo que
 * hace LAME para que suene mejor, no una señal de peor fuente (sin esto ganaban los 128 que llegan a 20 kHz, repaso del 24/10).
 */
const CUTOFF_HZ = 500
const FULL_KBPS = 256
/** Hecho con ffmpeg (Lavf, Lavc): es lo que dejan los programas que bajan de YouTube; un MP3 de tienda o de un CD lo hace LAME. */
const FFMPEG_ENC = /^lav[fc]/i
/** El nombre dice que viene de una página de descargas ("[www.slider.kz]", "y2mate.com - …", "[www.CUMBIADEHOY.com]"). */
const DOWNLOAD_NAME = /slider\.kz|y2mate|youtube|\bwww\.[\w-]+\.\w/i

function clipsMore(a: DupItem, b: DupItem): boolean {
  const ca = a.clipEvents ?? 0, cb = b.clipEvents ?? 0
  const louder = a.lufs == null || b.lufs == null || a.lufs - b.lufs >= LOUDER_DB
  return ca >= CLIPS && ca > cb + Math.max(5, cb * 0.1) && louder
}

/**
 * Cuál conviene conservar: la que no tiene huecos, mejor nota, sin pérdida (y entre los sin pérdida, FLAC: guarda tags y ocupa
 * menos que un WAV con el mismo audio; entre los con pérdida, el formato que lee cualquier equipo antes que WMA, OGG u Opus), la que
 * satura menos, más bitrate; con todo eso igual, lo que mide el análisis (llega más arriba en los agudos, no está recomprimida con
 * ffmpeg, no es un MP3 a 48 kHz), con tags, el original antes que la copia "(1)", en Música antes que en "Para revisar", en la
 * carpeta de su disco antes que una copia suelta (de un compilado, de un set), la que no viene de una página de descargas y la ruta
 * más corta. A igual nota y formato, la que no satura antes que la que sí, aunque suene más bajo: el volumen se empareja después y
 * la distorsión no tiene arreglo (el autor, 24/10).
 */
export function pickKeeper(items: DupItem[]): number {
  const format = (i: DupItem) => {
    const lossless = LOSSLESS.has(i.ext)
    // un WMA y un MP3 de la misma nota: el WMA no lo lee Rekordbox ni se le pueden escribir tags, y convertirlo pierde algo
    // más; antes ganaba el que tenía tags y se iba el MP3 ("Panic show" de La Renga, repaso del 24/10)
    return [GRADE_RANK[i.grade ?? ''] ?? 6, lossless ? 0 : 1, lossless ? (i.ext === 'flac' ? 0 : 1) : NOT_EVERYWHERE.has(i.ext) ? 1 : 0]
  }
  const sameFormat = (a: DupItem, b: DupItem) => format(a).join() === format(b).join()
  const lossyOf = (i: DupItem) => !LOSSLESS.has(i.ext)
  // el corte de agudos solo cuenta si se separa de verdad del mejor de las copias de la misma nota y formato
  const full = (i: DupItem) => !lossyOf(i) || (i.kbps ?? 0) >= FULL_KBPS
  const bestCut = (i: DupItem) => Math.max(...items.filter((j) => sameFormat(i, j) && full(j)).map((j) => j.cutoff ?? 0))
  const score = (i: DupItem) => {
    const lossless = LOSSLESS.has(i.ext)
    return [
      i.gaps ? 1 : 0, // con huecos pierde contra una limpia aunque sea de menos calidad (el autor, 24/10): la dañada se va y el tema queda en la lista «Faltan o suenan mal»
      ...format(i),
      items.some((j) => j !== i && sameFormat(i, j) && clipsMore(i, j)) ? 1 : 0, // satura más que otra copia de la misma nota y formato
      lossless ? 0 : -(i.kbps ?? 0),
      // a igual nota, formato y saturación, desempata el análisis (el autor: "¿analizando no podés encontrar cuál es mejor?")
      full(i) && i.cutoff != null && bestCut(i) - i.cutoff >= CUTOFF_HZ ? 1 : 0, // llega menos arriba
      lossyOf(i) && FFMPEG_ENC.test(i.encoder ?? '') ? 1 : 0, // recomprimido con ffmpeg
      lossyOf(i) && (i.sampleRate ?? 0) === 48000 ? 1 : 0, // un MP3 a 48 kHz sale de un video de YouTube (Opus)
      i.tagged ? 0 : 1,
      isCopyName(i.rel) ? 1 : 0, // "Tema (1).mp3" es la copia del navegador: se queda el original
      i.kind === 'musica' ? 0 : 1, // si hay una copia en "Para revisar", se queda la de Música
      i.inAlbum ? 0 : 1, // la del disco: si se fuera, el disco quedaría incompleto (la de un compilado suele tener la ruta más corta)
      DOWNLOAD_NAME.test(i.rel) ? 1 : 0, // si todo lo demás es igual, la que no viene de una página de descargas
      i.rel.length,
    ]
  }
  return [...items].sort((a, b) => {
    const x = score(a), y = score(b)
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k]
    return a.id - b.id
  })[0].id
}
