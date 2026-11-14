// Tipos de los ZIP y RAR de la biblioteca (masterplan 3, punto 4): qué hay adentro, lo que se leyó de cada tema y sacarlos
// a una carpeta al lado (con vista previa y deshacer).

/** Cómo está un comprimido: se puede abrir, tiene clave, está dañado, le falta una parte o no tiene música. */
export type ArchiveStatus = 'ok' | 'clave' | 'roto' | 'falta-parte' | 'sin-musica'

export interface ArchiveSummary {
  id: number
  rootId: number
  /** Ruta dentro de la carpeta de música (con "/"). */
  rel: string
  name: string
  folder: string
  size: number
  format: 'zip' | 'rar'
  /** Partes (un rar partido en .part1, .part2…). */
  volumes: number
  /** RAR "sólido": abrir un tema del final obliga a leer todo lo de antes. */
  solid: boolean
  /** Es material de producción (sample pack, drum kit): se muestra, pero nunca se saca ni se toca. */
  samplePack: boolean
  status: ArchiveStatus
  /** Por qué (si no está "ok") o un aviso. */
  note: string | null
  /** Archivos adentro (sin carpetas), cuántos son música y cuánto pesa la música. */
  files: number
  audio: number
  audioBytes: number
  /** Temas ya leídos (tags y nota) y su duración total en segundos. */
  read: number
  seconds: number
  /** Temas de adentro que ya están afuera, en tu Música (mismo tamaño y formato): el comprimido puede sobrar. */
  outside: number
  /** La última vez que se sacó con PAILA (sin deshacer): a qué carpeta. */
  extractedTo: string | null
  /** Su disco está conectado. */
  available: boolean
}

export interface ArchiveEntryRow {
  id: number
  archiveId: number
  /** Lugar en el comprimido (lo que se usa para sacarlo). */
  idx: number
  name: string
  folder: string
  size: number
  audio: boolean
  /** Tapa, .cue, registro del ripeo, textos del disco: salen junto con la música. */
  companion: boolean
  /** Por qué no se puede abrir (clave, falta una parte), o null. */
  blocked: string | null
  codec: string | null; sampleRate: number | null; bits: number | null; channels: number | null; kbps: number | null; duration: number | null
  artist: string | null; title: string | null; album: string | null; track: string | null; year: string | null; genre: string | null
  /** Nota de calidad (A+ a F), lo que es en realidad y por qué. */
  grade: string | null
  gradeIs: string | null
  gradeWhy: string[]
  bpm: number | null
  key: string | null
  readAt: string | null
  error: string | null
  /** Ya está afuera, en tu Música. */
  outside: boolean
}

export interface ArchiveReadResult { archives: number; read: number; errors: number }

/** Vista previa de "Sacar al lado": la carpeta nueva (o la que ya está) y cada archivo con su destino. */
export interface ArchiveExtractPlan {
  archiveId: number
  archiveRel: string
  rootId: number
  /** La carpeta donde van (relativa a la carpeta de música) y si ya existe. */
  folderRel: string
  folderExists: boolean
  items: { idx: number; name: string; rel: string; size: number; audio: boolean }[]
  skipped: { name: string; why: string }[]
  bytes: number
  /** Espacio libre en ese disco (null si no se sabe). */
  free: number | null
  /** Cómo estaba el comprimido al armar la vista previa (si cambia, no se aplica). */
  size: number
  mtime: number
}

export interface ArchiveExtractResult { batch: number; done: number; failed: { name: string; error: string }[]; folder: string }

/** Vista previa de "Mandar el comprimido a la papelera": qué archivos van (un rar partido son varios) y por qué se puede. */
export interface ArchiveTrashPlan {
  archiveId: number
  archiveRel: string
  rootId: number
  /** Los archivos del comprimido (rutas relativas a la carpeta de música) y lo que pesan. */
  files: { rel: string; size: number; mtime: number }[]
  bytes: number
  /** Temas de adentro, y cuántos ya están afuera (tienen que ser todos). */
  audio: number
  outside: number
}

export interface ArchiveTrashResult { batch: number; done: number; failed: { name: string; error: string }[]; bytes: number }
