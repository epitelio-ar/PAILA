// Tipos de "Traer una lista de otro lado" (core/requests.ts): un CSV de Spotify, un texto pegado o un .m3u, emparejado
// con la biblioteca, que se convierte en una playlist y suma lo que falta a la lista «Faltan o suenan mal».

/** Cómo se encontró el tema: isrc, ruta, archivo (mismo nombre y tamaño en otra carpeta), huella (suena igual) y exacto (mismos artistas y título, nombre por nombre) = seguro; probable y version = se confirman a mano; none = no está. */
export type RequestMatchKind = 'isrc' | 'ruta' | 'archivo' | 'huella' | 'exacto' | 'probable' | 'version' | 'none' | 'llego'
/**
 * tenes = está en la playlist · baja = está, pero en baja calidad (D/F, inflado o FLAC falso): también va a la Lista para
 * conseguir · falta = no lo tenés (va a la lista «Faltan o suenan mal») · revisar = probable u otra versión sin confirmar.
 */
export type RequestState = 'tenes' | 'baja' | 'falta' | 'revisar'
/** si = es el mismo · no = no es (va a la lista «Faltan o suenan mal») · ambos = "Los dos": el tuyo entra a la playlist y la versión pedida va a la lista «Faltan o suenan mal» (y entra al lado cuando llega). */
export type RequestDecision = 'si' | 'no' | 'ambos'

export interface RequestFile { id: number; rel: string; artist: string | null; title: string | null; duration: number | null; ext: string; grade: string | null; quality: string; low: boolean }
export interface RequestItem {
  /** Fila guardada (0 en la vista previa). */
  id: number
  position: number
  artist: string
  title: string
  album: string | null
  duration: number | null
  isrc: string | null
  kind: RequestMatchKind
  /** Por qué, en castellano. */
  why: string
  /** El tema de tu biblioteca que se le encontró (también para "otra versión"). */
  file: RequestFile | null
  decision: RequestDecision | null
  state: RequestState
  /** Cuántas copias más del mismo tema tenés (se usa la mejor). */
  copies: number
  /** Con "Los dos": este es la versión pedida y el número es el lugar del tuyo en la lista. */
  versionOf?: number | null
}
export interface RequestCounts { tenes: number; baja: number; falta: number; revisar: number }
export interface RequestPreview {
  name: string
  /** De dónde parece venir ("CSV de Exportify", "Texto pegado"). */
  source: string
  items: RequestItem[]
  counts: RequestCounts
  /** Filas o líneas que no se entendieron. */
  skipped: string[]
  /** Cuántos temas de tu biblioteca tienen ISRC en los tags (para el emparejamiento seguro). */
  withIsrc: number
  /** Una lista que ya trajiste con el mismo nombre (y su playlist sigue): se ofrece actualizarla en vez de armar «(2)». */
  existing?: { id: number; name: string; playlistName: string | null } | null
}
export interface RequestSummary { id: number; name: string; source: string; createdAt: string; undone: boolean; playlistId: number | null; playlistName: string | null; counts: RequestCounts; total: number }
export interface RequestDetail extends RequestSummary { items: RequestItem[] }

// ---- Playlists traídas de Rekordbox (rekordbox.xml) o de un pendrive de CDJ (core/listimport.ts) ----
export type ImportSourceKind = 'xml' | 'pendrive'
/** Un tema de una playlist traída: como en un pedido, con la clave del tema en la colección (para confirmarlo una vez en todas). */
export interface ImportItem extends RequestItem { key: string }
export interface ImportListPreview { key: string; name: string; folders: string[]; total: number; counts: RequestCounts }
export interface ImportPreview {
  /** Para pedir el detalle y crear (vale hasta la próxima vista previa). */
  token: string
  kind: ImportSourceKind
  /** "Rekordbox" o "Pendrive E:". */
  label: string
  /** El archivo o la carpeta de donde se leyó. */
  origin: string
  /** Temas distintos en las playlists. */
  tracks: number
  /** Cómo se encontró cada tema: misma ruta, mismo archivo en otra carpeta, huella, ISRC, exacto por nombre, probable, otra versión o no está. */
  how: { ruta: number; archivo: number; huella: number; isrc: number; exacto: number; probable: number; version: number; none: number }
  lists: ImportListPreview[]
  /** Del pendrive: de cuántos temas que tenés se puede recuperar la grilla, los cues, las estrellas y el color. */
  dj: { tracks: number; grids: number; cues: number; stars: number; colours: number } | null
  /** Temas sin pareja segura cuyo archivo está en esta compu: se pueden buscar por la huella del sonido. */
  printable: number
  /** Ya se buscó por huella. */
  printed: boolean
  /** Del XML: temas que están en esta compu pero no en la biblioteca de PAILA (videos, proyectos): quedan afuera, no van a la lista «Faltan o suenan mal». */
  outside: { count: number; examples: string[] }
}
export interface ImportResult { id: number; playlists: number; inLists: number; toGet: number; folderName: string; dj: { grids: number; cues: number } }
