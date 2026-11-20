// El cover.jpg de la carpeta de un disco (lo que leen muchos reproductores y servidores caseros), y el Folder.jpg chico de
// Windows si lo hay, como un cambio pendiente más: se anota en el tema que representa al disco, se escribe sin cortes a
// medias y se deshace. Nada se pierde: lo que había (y lo que se pone) queda guardado en "tapas" (core/coverstore.ts).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { imageInfo, side, type CoverStore } from './coverstore'
import { num, textos } from '@paila/shared/idioma'
import { reemplazar } from './reemplazar'

// lo que se ve en Cambios pendientes y el Historial, y por qué no se pudo (el nombre "cover.jpg" no cambia)
const T = textos({
  noQuedo: { es: (f: string) => `${f} no quedó guardado`, en: (f: string) => `${f} was not saved` },
  coverNoQuedo: { es: 'El cover.jpg no quedó guardado', en: 'The cover.jpg was not saved' },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  sinCarpeta: { es: 'La carpeta ya no está', en: 'The folder is no longer there' },
  sinDato: { es: 'sin dato', en: 'no data' },
  disco: { es: (g: string) => `disco ${g}`, en: (g: string) => `album ${g}` },
})

/** El nombre del archivo de tapa que escribe PAILA. Solo JPG: es el que leen todos. */
export const FOLDER_COVER = 'cover.jpg'
/** Los nombres de tapa de carpeta que se reconocen (para no pisar una buena con una peor). */
export const FOLDER_NAMES = ['cover.jpg', 'folder.jpg', 'front.jpg', 'cover.jpeg', 'folder.jpeg', 'cover.png', 'folder.png', 'albumart.jpg']

/** El Folder.jpg (casi siempre oculto y de sistema) que armaba el Reproductor de Windows Media: la tapa, pero de 200×200. */
const WINDOWS_FOLDER = 'folder.jpg'

/**
 * Cómo están hoy las tapas de la carpeta del tema: `{ cover, folder }` (cover.jpg y Folder.jpg, cada uno como valor de
 * tapa { mime, ref } o null). null si no hay ninguna. Leerlas las guarda en "tapas" (para poder volver a ponerlas).
 */
export function readFolderCover(trackPath: string, store: CoverStore): string | null {
  const dir = path.dirname(trackPath)
  const one = (f: string | null) => (f ? store.refValue(fs.readFileSync(f)) : null)
  const cover = one(findFile(dir, FOLDER_COVER)), folder = one(findFile(dir, WINDOWS_FOLDER))
  return cover || folder ? JSON.stringify({ cover: cover && JSON.parse(cover), folder: folder && JSON.parse(folder) }) : null
}

/** Reemplaza el contenido sin borrar ni crear el archivo: así un Folder.jpg oculto y de sistema sigue siéndolo. */
function replaceInPlace(file: string, bytes: Buffer) {
  const fd = fs.openSync(file, 'r+')
  try { fs.writeSync(fd, bytes, 0, bytes.length, 0); fs.ftruncateSync(fd, bytes.length); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  if (!fs.readFileSync(file).equals(bytes)) throw new Error(T.noQuedo(path.basename(file)))
}

/** El archivo con ese nombre, sin importar mayúsculas ("Cover.JPG"). */
export function findFile(dir: string, name: string): string | null {
  try { const hit = fs.readdirSync(dir).find((n) => n.toLowerCase() === name); return hit ? path.join(dir, hit) : null } catch { return null }
}

/**
 * Pone una tapa en la carpeta (`value` = la imagen { mime, ref }): el cover.jpg, y también el Folder.jpg de Windows si hay
 * uno más chico. O vuelve a como estaba (`value` = lo que devolvió esta función o `readFolderCover`; null = sin tapas).
 * Devuelve cómo estaba (para el diario). El cover.jpg se escribe a un temporal y se cambia de nombre: nunca queda a medias.
 * Lo que había antes ya está en la carpeta "tapas" de PAILA (se guardó al leerlo), así que sacarlo no pierde nada. Al deshacer una tapa
 * que puso PAILA donde no había, `quitar` la manda a la papelera de PAILA en vez de sacarla (core/restos.ts, tapaAPapelera).
 */
export function writeFolderCover(trackPath: string | null, value: string | null, store: CoverStore, quitar?: (file: string) => void): string | null {
  if (!trackPath) throw new Error(T.sinDisco)
  const dir = path.dirname(trackPath)
  if (!fs.existsSync(dir)) throw new Error(T.sinCarpeta)
  const before = readFolderCover(trackPath, store)
  const coverFile = findFile(dir, FOLDER_COVER), folderFile = findFile(dir, WINDOWS_FOLDER)
  const setCover = (bytes: Buffer | null) => {
    if (!bytes) { if (coverFile) (quitar ?? fs.rmSync)(coverFile); return } // guardada en "tapas": deshacer la vuelve a poner
    const tmp = path.join(dir, `.${FOLDER_COVER}.paila-${crypto.randomBytes(3).toString('hex')}`)
    fs.writeFileSync(tmp, bytes)
    try { reemplazar(tmp, coverFile ?? path.join(dir, FOLDER_COVER)) } catch (e) { fs.rmSync(tmp, { force: true }); throw e } // en Windows reemplaza de una vez
    if (!fs.readFileSync(coverFile ?? path.join(dir, FOLDER_COVER)).equals(bytes)) throw new Error(T.coverNoQuedo)
  }
  const v = value ? JSON.parse(value) as { ref?: string; data?: string; cover?: object | null; folder?: object | null } : null
  if (v && ('cover' in v || 'folder' in v)) {
    // volver a como estaba
    setCover(v.cover ? store.bytesOf(JSON.stringify(v.cover)) : null)
    if (v.folder && folderFile) replaceInPlace(folderFile, store.bytesOf(JSON.stringify(v.folder)))
    return before
  }
  if (!v) { setCover(null); return before }
  const bytes = store.bytesOf(value!)
  setCover(bytes)
  if (folderFile && side(imageInfo(fs.readFileSync(folderFile))) < side(imageInfo(bytes))) replaceInPlace(folderFile, bytes)
  return before
}

/** El volumen parejo en palabras, para Cambios pendientes y el Historial ("-6,5 dB · disco -7,1 dB"). */
export function gainText(v: string | null): string | null {
  if (!v) return T.sinDato
  try {
    const g = JSON.parse(v) as { tg: number | null; ag: number | null }
    const db = (x: number) => `${x > 0 ? '+' : ''}${num(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dB`
    return [g.tg != null ? db(g.tg) : null, g.ag != null ? T.disco(db(g.ag)) : null].filter(Boolean).join(' · ') || T.sinDato
  } catch { return v }
}
