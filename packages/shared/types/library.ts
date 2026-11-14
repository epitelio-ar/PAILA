// Tipos de la biblioteca: colecciones, carpetas, escaneo, la fila de la tabla y el análisis de calidad.
import { tr } from '@paila/shared/idioma'

export type CollectionKind = 'musica' | 'produccion' | 'proyectos' | 'sets' | 'revisar' | 'excluir'

export const KINDS: Record<CollectionKind, { label: string; help: string }> = {
  musica: { label: tr({ es: 'Música', en: 'Music' }), help: tr({ es: 'Lo que escuchás y pinchás. Se califica, se ordena y se exporta a Rekordbox.', en: 'What you listen to and play. It gets graded, organized and exported to Rekordbox.' }) },
  produccion: { label: tr({ es: 'Producción', en: 'Production' }), help: tr({ es: 'Samples, stems y acapellas. Nunca se renombran: los packs quedan como vinieron.', en: 'Samples, stems and acapellas. Never renamed: packs stay the way they came.' }) },
  proyectos: { label: tr({ es: 'Inéditos', en: 'Unreleased' }), help: tr({ es: 'Demos propios, promos y temas que te pasaron antes de que salgan. Se escuchan y van a playlists y a Rekordbox, pero PAILA no les busca nombre en internet ni los reorganiza.', en: "Your own demos, promos and tracks people sent you before they're out. You can listen to them and put them in playlists and in Rekordbox, but PAILA doesn't look up their names online or reorganize them." }) },
  sets: { label: tr({ es: 'Sets y en vivo', en: 'Sets and live' }), help: tr({ es: 'Sets, enganchados, mixes y grabaciones en vivo, tuyos o de otros. No se les inventa artista y título ni se reorganizan.', en: "Sets, mixes and live recordings, yours or someone else's. PAILA doesn't make up an artist and title for them, and doesn't reorganize them." }) },
  revisar: { label: tr({ es: 'Para revisar', en: 'To review' }), help: tr({ es: 'Parece una copia (por ejemplo de un pendrive de Rekordbox). Más adelante PAILA busca duplicados acá.', en: 'Looks like a copy (for example from a Rekordbox USB stick). Later on PAILA looks for duplicates here.' }) },
  excluir: { label: tr({ es: 'Excluir', en: 'Exclude' }), help: tr({ es: 'PAILA no mira esta carpeta.', en: "PAILA doesn't look at this folder." }) },
}

export interface FolderSuggestion {
  rel: string // ruta relativa a la raíz ('' = la raíz misma)
  name: string
  depth: number
  kind: CollectionKind
  reason: string
  audio: number
  files: number
  bytes: number
}

export interface FolderAnalysis {
  path: string
  volumeLabel: string
  volumeSerial: string
  totals: { audio: number; files: number; bytes: number }
  suggestions: FolderSuggestion[]
  /** Carpetas que ya estaban en la biblioteca y quedan adentro de esta: al agregarla se unen (core/rootmerge.ts). */
  joins: string[]
}

export interface RootInfo {
  id: number
  path: string // ruta actual (con la letra de unidad de hoy)
  volumeLabel: string
  volumeSerial: string
  available: boolean
  rules: { rel: string; kind: CollectionKind }[]
}

export interface ScanStatus {
  job: 'scan' | 'analysis' | null
  running: boolean
  paused: boolean
  phase: string
  found: number // archivos de audio encontrados
  toProbe: number // nuevos o modificados que hay que leer
  probed: number
  errors: number
  removed: number
  current: string
  startedAt: number | null
  finishedAt: number | null
  warnings: string[]
  /** Por qué está en pausa, si no la pidió el usuario (por ejemplo: modo Tranqui con la notebook a batería). */
  pauseReason: string | null
  /** Lo pausó PAILA mientras hace otra cosa: 'separar', 'grilla' o un texto ("cambiando archivos"). Sigue sola al terminar. */
  heldBy?: string | null
  /** El análisis espera que vuelva este disco ("F:"), o esta carpeta si el disco está pero ella no (core/readguard.ts). */
  waitingDisk: string | null
  /** Pidieron detener y está cortando (la pantalla muestra "Deteniendo…" sin mirar el texto de `phase`). */
  stopping: boolean
  /** Cómo terminó el último trabajo: bien, detenido o con error (null mientras corre). `phase` es solo para mostrar. */
  outcome: 'ok' | 'stopped' | 'error' | null
}

/** Intensidad del análisis: cuántos temas a la vez (ver core/analysis/intensity.ts). */
export type Intensity = 'tranqui' | 'normal' | 'fondo'

/** Lo que muestra el selector de intensidad en la pantalla Análisis. */
export interface IntensityInfo {
  /** El modo elegido (queda guardado). */
  mode: Intensity
  /** El que se aplica ahora: A fondo a batería pasa a Normal. */
  effective: Intensity
  /** Temas a la vez ahora, y los que pide cada modo en esta PC. */
  workers: number
  byMode: Record<Intensity, number>
  /** Hilos y núcleos del procesador (núcleos = null si no se pudo saber) y su nombre. */
  threads: number
  cores: number | null
  cpu: string
  onBattery: boolean
  /** Tranqui a batería: en pausa hasta que se enchufe. */
  paused: boolean
  /** Hay menos temas a la vez de los que pide el modo porque falta memoria libre. */
  limitedByMemory: boolean
  freeMb: number
  /** Un aviso para mostrar una vez (por ejemplo, que A fondo pasó a Normal al desenchufar). */
  notice: string | null
}

// Fila de la tabla. Se manda como arreglo (más liviano que objetos con 100.000 temas).
export const TRACK_FIELDS = [
  'id', 'rootId', 'rel', 'kind', 'ext', 'codec', 'sampleRate', 'bits', 'channels', 'kbps', 'duration',
  'artist', 'albumArtist', 'title', 'album', 'track', 'year', 'genre', 'size', 'mtime', 'error',
  'grade', 'isLabel', 'flags', 'effKbps', 'cutoff', 'lufs', 'bpm', 'musicKey', 'camelot', 'energy', 'missing', 'tempo',
] as const
export type TrackField = (typeof TRACK_FIELDS)[number]
export type Track = {
  id: number; rootId: number; rel: string; kind: CollectionKind; ext: string; codec: string | null
  sampleRate: number | null; bits: number | null; channels: number | null; kbps: number | null; duration: number | null
  artist: string | null; albumArtist: string | null; title: string | null; album: string | null; track: string | null
  year: string | null; genre: string | null; size: number; mtime: number; error: string | null
  grade: Grade | null; isLabel: string | null; flags: string | null; effKbps: number | null; cutoff: number | null
  lufs: number | null; bpm: number | null; musicKey: string | null; camelot: string | null; energy: number | null
  /** Cuándo dejó de encontrarse en el disco (null = está). Sigue en playlists; se reconecta solo si vuelve a aparecer. */
  missing: string | null
  /** El tempo se mueve (grilla variable): "desde,hasta,promedio" en BPM, de la grilla. null = parejo o sin grilla. */
  tempo: string | null
}

/** Lo que va saliendo del análisis, para la pantalla "Qué se está analizando" (consulta liviana a la base). */
export interface AnalysisInsights {
  done: number; total: number; perMinute: number; etaMinutes: number | null
  /** Temas ya analizados a los que les faltan las huellas (se agregan en una pasada liviana, ~0,3 s por tema). */
  prints: number
  /** Temas con la nota de calidad de un motor viejo (se vuelven a medir solos en una pasada liviana). */
  quality: number
  /** Temas de Música que todavía no tienen la pasada precisa (BPM y tono confirmados con otros métodos). */
  precise: number
  grades: Record<string, number>
  recent: { id: number; title: string; artist: string; ext: string; grade: string | null; label: string | null; bpm: number | null; camelot: string | null; flags: string }[]
  curiosities: { fakeLossless: number; upscaled: number; fastest: { title: string; bpm: number } | null; slowest: { title: string; bpm: number } | null; topKeys: { camelot: string; n: number }[]; loudest: { title: string; lufs: number } | null; quietest: { title: string; lufs: number } | null }
}

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'

/**
 * Datos de PAILA de un tema que no están en los tags (la ficha): la marca "vinilo" (con la cara, si se sabe) y el país del
 * artista según MusicBrainz ("Argentina"), si ya se buscó en Completar desde internet.
 */
export interface TrackExtras { vinyl: { side: string | null } | null; country: string | null }

export interface AnalysisDetail {
  grade: Grade | null; says: string | null; isLabel: string | null; why: string[]; confidence: string | null
  flags: string[]; sound: string[]; effKbps: number | null; cutoff: number | null; cutoffDrop: number | null
  lufs: number | null; lra: number | null; truePeak: number | null; clipEvents: number | null; stereoCorr: number | null
  effBits: number | null; encoder: string | null; vbrMethod: string | null; lameLowpass: number | null
  bpm: number | null; bpmSource: string | null; bpmFast: number | null; musicKey: string | null; camelot: string | null; keyStrength: number | null
  energy: number | null; danceability: number | null; spectrum: number[]; ms: number | null; error: string | null; analyzedAt: string
  /** Segundos de silencio al principio y al final (null: todavía sin medir, core/analysis/silence.ts). */
  silenceStart: number | null; silenceEnd: number | null
  /** El estilo que sugiere el modelo de estilos por cómo suena, solo si está muy seguro (core/analysis/effnet.ts; null: no se escuchó o duda). */
  soundStyle: { style: string; genre: string; p: number } | null
}

/**
 * Una vista guardada de la tabla (MASTERPLAN-3, 4): los filtros, el orden y las columnas con un nombre, para volver desde la
 * barra lateral. Los campos son los de la tabla (SortKey y ProblemKey de shared/trackinfo.ts, como texto).
 */
export interface SavedView {
  id: string
  name: string
  kind: CollectionKind | 'todo'
  problem: string | null
  query: string
  sort: { key: string; dir: 1 | -1 }
  /** Las columnas que se veían (null = las de siempre). */
  columns: string[] | null
}

/** Lo que la ventana pide al abrir: las carpetas, el escaneo, si están ffmpeg y ffprobe, y cuántos temas hay. */
export interface AppState {
  roots: RootInfo[]
  scan: ScanStatus
  tools: { ffprobe: string | null; ffmpeg: string | null; error: string | null }
  trackCount: number
}
