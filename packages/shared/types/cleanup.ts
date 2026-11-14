// Tipos de la limpieza: duplicados, papelera, organizador de carpetas y espacio.

/**
 * Un grupo de Duplicados. exact = el mismo archivo (o el mismo audio bit a bit); quality = el mismo audio en otra calidad
 * (por la huella acústica); probable = mismos tags y duración; version = versiones del mismo tema (radio edit, extended,
 * remix): NO son duplicados y nunca se propone tirar ninguna (keep = null).
 */
export type DupLevel = 'exact' | 'quality' | 'probable' | 'version'
export interface DupGroup {
  level: DupLevel; label: string; why: string; items: DupItem[]; keep: number | null; similarity: number | null
  /** Algo para mirar antes de elegir (por ejemplo, el mismo audio con títulos de temas distintos: un archivo mal nombrado). */
  warning: string | null
  /** Solo se parecen por el nombre: no se tilda para la papelera de fábrica, decide la persona escuchándolos (riesgo 1, MASTERPLAN-5). */
  decidir?: boolean
  /** Ya está en lo que vas a aplicar: la copia que se queda (core/repetidos-guardados.ts). */
  propuesto?: number
}
export interface TrashBatch { batchId: number; createdAt: string; reason: string | null; files: number; bytes: number; restored: boolean }
export interface TrashItem { id: number; batchId: number; rel: string; size: number; reason: string | null }
export interface TrashResult { batchId: number | null; moved: number; failed: { fileId: number; rel: string; error: string }[] }
/** Una tanda de la papelera (carpeta dentro de _PAILA/papelera). key = "rootId|carpeta"; ageDays = días desde que se creó. */
/** `trash`: la papelera donde está ("_PAILA/papelera", o "Rock/_PAILA/papelera" si la carpeta se unió con otra). */
export interface TrashFolder { key: string; rootId: number; rootPath: string; trash: string; folder: string; createdAt: string; ageDays: number; kind: 'temas' | 'reemplazo' | 'deshecho' | 'limpieza' | 'comprimido' | 'respaldo' | 'otro'; label: string; files: number; bytes: number }
/**
 * Cuánto ocupa la papelera de PAILA (core/purge.ts `trashSummary`), para la barra lateral, el aviso del Inicio y la pantalla
 * Papelera: de respaldos, de temas (los mandados y los originales de reemplazos) y lo demás. `warn`: en algún disco pasa de
 * 5 GB (o del 5 % del disco, si es chico); `limit` = ese tope (el del disco más chico con papelera).
 */
export interface TrashSummary { bytes: number; files: number; backups: number; tracks: number; other: number; warn: boolean; limit: number; offline: number }
/** Todo lo que ocupa la papelera en las carpetas conectadas. offline = carpetas de música con el disco desconectado (no se cuentan). */
export interface TrashUsage { bytes: number; files: number; folders: TrashFolder[]; offline: number }
export interface PurgeResult { deleted: number; bytes: number; folders: number; kept: { rel: string; why: string }[]; failed: { rel: string; error: string }[] }

/** `soloCarpetas`: cada tema va a su carpeta pero el archivo conserva su nombre (sin el n.º de pista ni el título de la regla). */
export interface OrganizeOptions { rule: string; dest: string; soloCarpetas?: boolean }
export interface PlannedMove { fileId: number; rootId: number; from: string; to: string }
/**
 * `clashes`: los temas que chocan con otro que va (o ya está) en el mismo lugar y quedarían con "(2)". Casi siempre son el
 * mismo tema repetido: la pantalla avisa antes y ofrece pasar por Duplicados (decidido el 22/10). `with` = el
 * otro (de dónde viene el que va a ese lugar, o el archivo que ya está ahí).
 */
/** `inRekordbox`: cuántos de los que se mueven vinieron del rekordbox.xml (Rekordbox los pierde hasta volver a importar). */
export interface OrganizePlan { moves: PlannedMove[]; inRekordbox?: number; alreadyOk: number; skipped: { fileId: number; rel: string; reason: string; /** sin artista o título que sirvan, o varios con los mismos: Ordenar pregunta de quién es */ motivo?: 'sinTags' | 'mismosTags' }[]; extras: { rootId: number; from: string; to: string }[]; conflicts: number; clashes?: { fileId: number; from: string; to: string; with: string }[] }
/** purgedAt: si se vació la papelera con archivos de esta tanda (limpiezas de Espacio), cuándo. */
export interface OrganizeBatch { batchId: number; createdAt: string; files: number; extras: number; undone: boolean; purgedAt: string | null }
/** cancelled: se apretó Cancelar en el medio (lo movido queda movido y se puede deshacer; lo demás, donde estaba). */
export interface OrganizeResult {
  batchId: number | null; moved: number; extras: number; failed: { rel: string; error: string }[]; cancelled?: boolean
  /** Las carpetas que quedaron vacías al mover y se sacaron: su tanda de "Carpetas vacías" (core/emptydirs.ts), o null. */
  carpetas?: number | null
}

export interface DupItem { id: number; rel: string; ext: string; size: number; kbps: number | null; duration: number | null; grade: string | null; kind: string; tagged: boolean; artist: string | null; title: string | null; playlists: string[]
  /** Está en la carpeta de su disco (hay 4 temas o más de ese álbum en la carpeta): sacarlo de ahí deja el disco incompleto. */
  inAlbum?: boolean
  /** Recortes (la señal aplastada contra el techo) y volumen (LUFS) del análisis: a igual nota y formato, se queda la que satura menos. */
  clipEvents?: number | null; lufs?: number | null
  /** Tiene huecos (cuadros que no se pueden leer): pierde contra una copia limpia aunque sea de menos calidad (el autor, 24/10). */
  gaps?: boolean
  /** Para desempatar copias de la misma nota: hasta dónde llegan los agudos (Hz), el encoder ("LAME3.99r", "Lavf") y la frecuencia. */
  cutoff?: number | null; encoder?: string | null; sampleRate?: number | null }

export interface SpaceNode { n: string; b: number; c: number; g: Record<string, number>; f: Record<string, number>; id?: number; ch?: SpaceNode[] }
export interface JunkFile { rel: string; rootId: number; size: number; kind: 'video' | 'comprimido' | 'basura' | 'imagen' | 'lista' | 'proyecto'; why: string }
/** `emptyDirs`: las carpetas vacías, de la más adentro a la de afuera (se pueden sacar: core/emptydirs.ts). */
export interface JunkReport { files: JunkFile[]; emptyDirs: { rootId: number; rel: string }[]; byKind: Record<string, { count: number; bytes: number }> }
/** `wavAiff.inRekordbox`: cuántos de esos están en Rekordbox (pasar a FLAC les cambia la extensión: lo avisa Espacio). */
export interface SavingsReport { wavAiff: { count: number; bytes: number; saving: number; inRekordbox: number }; fakeLossless: { count: number; bytes: number; saving: number } }
export interface ShrinkResult { converted: number; savedBytes: number; failed: { rel: string; error: string }[] }

/**
 * Respaldo liviano por paso (core/ops/backup.ts): antes de cambiar lo de adentro de un archivo de tu Música, PAILA guarda solo
 * lo que cambia (los metadatos de antes, con la huella del archivo entero). La vista previa: cuántos archivos, cuánto va a
 * ocupar (estimado, `bytes`), dónde va (la carpeta de respaldos de cada disco); `problem` si no se puede (falta lugar o el
 * disco) y `warning` si ocuparía más del 10 % del lugar libre (se puede seguir igual).
 */
export interface BackupPlan { files: number; bytes: number; dirs: string[]; problem: string | null; warning: string | null }
/**
 * Un respaldo hecho. `ref` = la tanda (del Historial) a la que pertenece; `complete` false = se cortó en el medio (sirve para
 * los temas que llegaron a cambiar); `light` false = copias completas de los archivos (como los hacía la 0.5.3); `trashDir` =
 * dónde quedó en la papelera de PAILA si la persona lo "borró" (se recupera de ahí hasta vaciarla).
 */
export interface BackupInfo { id: number; op: string; ref: number | null; rootId: number | null; dir: string; files: number; bytes: number; createdAt: string; complete: boolean; exists: boolean; light: boolean; trashDir: string | null }
