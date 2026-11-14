// Tipos de "Llevar la música": copiar al celular (convirtiendo), playlists .m3u8 para reproductores de PC y el chequeo
// "listo para tu servidor" (Plex, Jellyfin, Navidrome).

/** De dónde salen los temas: una playlist o los temas elegidos en la tabla (con un nombre para la carpeta). */
export type CarrySource = { playlistId: number } | { ids: number[]; name: string }

export type PhoneFormat = 'aac' | 'mp3'
/**
 * chica: 128 kbps · normal: 192 · alta: 256 (AAC) o 320 (MP3). Es un techo: solo se achica lo que pesa más, nunca se
 * agranda. original: todo se copia tal cual, sin convertir.
 */
export type PhoneQuality = 'chica' | 'normal' | 'alta' | 'original'
/** lista: una carpeta con los temas numerados en orden · discos: Artista/Álbum/, como una biblioteca. */
export type CarryLayout = 'lista' | 'discos'

/** Un celular (o reproductor) conectado por cable como "dispositivo portátil" (MTP): Windows lo ve, pero no tiene letra. */
export interface PhoneDevice {
  /** Cómo lo encuentra Windows (opaco; para las pruebas puede ser una carpeta común). */
  id: string
  name: string
  /** Lo que tiene adentro: "Almacenamiento interno compartido", "Tarjeta SD"… */
  storages: { name: string; freeBytes: number | null; totalBytes: number | null }[]
  /** iPhone: por cable solo deja ver las fotos; la música se pasa con Apple Music o iTunes. */
  apple: boolean
}
/** Adónde va en el celular: almacenamiento + carpeta (por ejemplo "Music"); adentro se crea la carpeta de la playlist. */
export interface PhoneTarget {
  id: string
  name: string
  storage: string
  folder: string
}

export interface PhoneOptions {
  /** Carpeta de la PC. Si hay `device`, no se usa: se convierte a una carpeta temporal y se pasa al celular. */
  dest: string
  device?: PhoneTarget | null
  format: PhoneFormat
  quality: PhoneQuality
  layout: CarryLayout
  /** Solo en `lista`: 001 - Artista - Título. */
  numbered: boolean
}
export interface PhoneItem {
  fileId: number
  rel: string
  action: 'copy' | 'convert'
  /** Dónde queda, relativo a la carpeta de destino (con /). */
  outRel: string
  kbps: number | null
  estBytes: number
  srcBytes: number
  why: string
}
export interface PhonePlan {
  name: string
  folder: string
  items: PhoneItem[]
  skipped: { fileId: number; rel: string; reason: string }[]
  warnings: string[]
  totalBytes: number
  srcBytes: number
  freeBytes: number | null
  copyCount: number
  convertCount: number
  /** Al celular: cómo se ve el destino ("Galaxy A54 › Almacenamiento interno › Music › Viaje"). */
  deviceFolder?: string
  /** El destino cae dentro de la biblioteca: no se deja pasar (el aviso, en `warnings`, cambia con el idioma). */
  insideLibrary?: boolean
}
export interface PhoneResult {
  copied: number
  converted: number
  skippedExisting: number
  failed: { name: string; error: string }[]
  /** Salió bien pero hay algo para saber (el original ya estaba cortado, se le puso la tapa de la carpeta…). */
  notes: { name: string; note: string }[]
  folder: string
  m3u: string | null
  cancelled: boolean
  /** Al celular: cuántos archivos llegaron (verificados por tamaño) y cuántos ya estaban. */
  device?: { sent: number; already: number; folder: string }
}

export interface M3uOptions {
  dir: string
  /** Rutas relativas a la carpeta de la playlist (sirven si movés todo junto); si no, completas (C:\…). */
  relative: boolean
}
export interface M3uResult {
  dir: string
  files: { name: string; tracks: number; missing: number }[]
  /** Temas que tuvieron que ir con la ruta completa porque están en otro disco que la playlist. */
  absoluteFallback: number
}

export type ServerIssueId = 'carpetas' | 'artista' | 'titulo' | 'album' | 'anio' | 'pista' | 'compilado' | 'tapas'
export interface ServerIssue {
  id: ServerIssueId
  /** "Temas sin año". */
  label: string
  /** Por qué le importa a un servidor (para el ⓘ). */
  why: string
  /** imprescindible: el servidor los muestra mal · conviene: se ven, pero incompletos. */
  level: 'imprescindible' | 'conviene'
  count: number
  /** Qué se cuenta (un dato, no se muestra tal cual: la pantalla elige "tema/temas" o "disco/discos" en su idioma). */
  unit: 'temas' | 'discos'
  examples: string[]
  /** Pantalla donde se arregla. */
  go: 'organize' | 'tidy' | 'online' | 'albums' | 'library'
  /** El nombre de esa pantalla ("Biblioteca"), para el botón "Ir a …". */
  goLabel: string
  /** Si hace falta, qué hacer ahí ("elegí los temas del disco → Numerar"). */
  goHow?: string
}
export interface ServerCheck {
  tracks: number
  albums: number
  /** Temas sin ningún problema. */
  okTracks: number
  /** Temas sin nada imprescindible mal: el servidor los muestra bien (quizás incompletos). */
  okEssential: number
  issues: ServerIssue[]
}
