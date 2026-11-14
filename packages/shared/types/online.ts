// Tipos de la Fase C: claves de los servicios de internet, búsqueda de nombres oficiales y diccionario de artistas.

export type KeyService = 'discogs' | 'acoustid' | 'audd' | 'lastfm'
/** Resultado de la última prueba de una clave. */
export interface KeyTest { ok: boolean; msg: string; at: string }
/** Estado de una clave (nunca viaja la clave en sí a la interfaz). */
export interface KeyStatus {
  /** El usuario pegó una clave propia. */
  own: boolean
  /** Discogs: clave de aplicación (key + secret) o código personal. */
  kind?: 'app' | 'token'
  /** PAILA trae una clave incluida (armada en el instalador). */
  builtIn: boolean
  test: KeyTest | null
}
export interface OnlineKeysStatus { discogs: KeyStatus; acoustid: KeyStatus; audd: KeyStatus; /** Last.fm: etiquetas para los géneros (opcional) */ lastfm: KeyStatus; deezer: boolean; /** AudD (tipo Shazam) prendido: viene apagado */ auddOn: boolean; secure: boolean }
/** Lo que se pega en la configuración. null = borrar la clave propia. */
export type DiscogsKeyInput = { key: string; secret: string } | { token: string }

export type NameSource = 'musicbrainz' | 'deezer' | 'discogs' | 'acoustid' | 'audd'
export interface NamesStatus {
  /** Temas con artista y título, artistas distintos y temas sin nombre con huella acústica. */
  tracks: number; artists: number; unnamed: number
  /** Pedidos que faltan por fuente (0 si la fuente no se usa). */
  left: Record<NameSource, number>
  /** Pedidos ya hechos (bien y con error) por fuente. */
  done: Partial<Record<NameSource, { ok: number; error: number }>>
  /** Minutos que faltan, aproximado (las fuentes trabajan a la vez). */
  minutes: number
  /** Temas con algo para revisar (un nombre oficial distinto del que tienen): lo que se ve en "Arreglar nombres y tags". */
  proposals: number
}

export type DictOrigin = 'edicion' | 'aceptado' | 'importado' | 'a mano'
export interface DictEntry { from: string; to: string; origin: DictOrigin; createdAt: string }
export interface DictImport { added: number; same: number; clashes: { from: string; mine: string; theirs: string }[] }
