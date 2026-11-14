// NAPIA: que lo bajado llegue con nombre (pedido del autor, 24/10: "que NAPIA arregle los nombres solo"). En Soulseek los
// archivos se llaman de cualquier forma ("01-daddy_yankee-salgo_pa_la_calle-xyz.mp3") y sus tags vienen vacíos o rotos; la
// lista, en cambio, trae el artista y el título bien escritos (de Spotify, o de la lista «Faltan o suenan mal», que ya usa los nombres
// de Arreglar nombres). Así que, antes de pasar a la carpeta de la lista, cada tema que sirvió:
// - se llama "Artista - Título.ext", como en la lista;
// - lleva ese artista y ese título en los tags (solo esos dos: lo demás queda como vino). Se escribe en una copia, se compara
//   la huella del sonido con la del original (core/tagio.ts: tiene que ser idéntica, bit a bit) y recién ahí reemplaza al
//   bajado. Si algo falla, el archivo llega con los tags como vinieron (solo cambia el nombre).
// No se toca si el archivo dice una versión que la lista no ("Extended Mix", "Radio Edit"): el nombre de la lista la perdería.
// Lo que todavía no hace (queda para la Bandeja de PAILA): el perfil Oficial entero de Arreglar nombres (el estilo de las
// mayúsculas, el diccionario de artistas, los nombres de internet), el disco, el año y la tapa.
// Tests: tests/napia-calidad.test.ts.
import fs from 'node:fs'
import path from 'node:path'
import { versionRe } from '../versionwords'
import { cantWrite, checkSameAudio, hashBefore, readTags, safeName, writeTags } from '../tagio'
import { fold } from '../names'
import { textos } from '@paila/shared/idioma'

/** Las palabras de versión (las de Duplicados y la lista «Faltan o suenan mal», core/versionwords.ts), sin "original". */
const VERSION = versionRe(['mezcla', 'vivo', 'grabacion'], { flags: 'g' })
/** "Original Mix" y "Album Version" no son otra versión: es como sale el tema en Beatport o en el disco. */
const ORIGINAL = /\b(?:original|album)\s+(?:mix|version)\b/gi
const versiones = (s: string) => new Set((s.replace(/[_.]/g, ' ').replace(ORIGINAL, ' ').match(VERSION) ?? []).map((w) => fold(w)))

/** Cómo tiene que llegar: el artista y el título de la lista y el nombre del archivo. null: se deja como llegó. */
export function nombreDeLista(pedido: { artist: string; title: string }, archivo: string): { artist: string; title: string; nombre: string } | null {
  const artist = pedido.artist.trim(), title = pedido.title.trim()
  if (!title) return null
  const ext = path.extname(archivo).toLowerCase()
  const stem = path.basename(archivo.replace(/\\/g, '/'), path.extname(archivo))
  const quiere = versiones(`${artist} ${title}`)
  for (const v of versiones(stem)) if (!quiere.has(v)) return null
  const nombre = safeName(artist ? `${artist} - ${title}` : title)
  return nombre ? { artist, title, nombre: `${nombre}${ext}` } : null
}

const T = textos({ escribir: { es: 'poner el artista y el título', en: 'writing the artist and title' } })

/**
 * Le pone al archivo (todavía en la carpeta de trabajo) el artista y el título de la lista, verificado, y devuelve el nombre con
 * el que tiene que pasar a la carpeta de la lista. null: se deja como llegó.
 */
export async function arreglarArchivo(ffmpeg: string | null, pedido: { artist: string; title: string }, archivo: string): Promise<string | null> {
  const n = nombreDeLista(pedido, archivo)
  if (!n) return null
  const ext = path.extname(archivo).slice(1).toLowerCase()
  if (!ffmpeg || cantWrite({ ext }, archivo)) return n.nombre
  let ahora: { artist: string | null; title: string | null }
  try { ahora = readTags(archivo, { exact: true }) } catch { return n.nombre }
  if (ahora.artist === (n.artist || null) && ahora.title === n.title) return n.nombre
  const tmp = path.join(path.dirname(archivo), `.napia-tags-${process.pid}-${Date.now().toString(36)}.${ext}`)
  try {
    const antes = await hashBefore(ffmpeg, archivo)
    fs.copyFileSync(archivo, tmp)
    writeTags(tmp, { ...(n.artist ? { artist: n.artist } : {}), title: n.title })
    await checkSameAudio(ffmpeg, tmp, antes, T.escribir)
    fs.renameSync(tmp, archivo)
  } catch { /* el sonido cambió o no se pudo escribir: llega con los tags como vinieron */ } finally { fs.rmSync(tmp, { force: true }) }
  return n.nombre
}
