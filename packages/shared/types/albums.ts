// Tipos de la pantalla Discos: discos completos (lista de temas oficial), tapas para todo y volumen parejo (ReplayGain).

/** Una edición de un disco (MusicBrainz o Discogs), lo justo para mostrarla y elegirla. */
export interface AlbumEdition {
  /** "musicbrainz:<id>", "deezer:<id>" o "discogs:<id>". */
  ref: string
  source: 'musicbrainz' | 'deezer' | 'discogs'
  title: string
  artist: string
  date: string | null
  country: string | null
  format: string | null
  tracks: number
  /** "Deluxe", "Remaster 2011", la nota de la edición si la tiene. */
  note: string | null
  /** Cuántos de tus temas coinciden con esta edición y cuántos le faltan. */
  matched: number
  missing: number
}
export interface AlbumMissingTrack { disc: number; pos: number; title: string; artist: string; length: number | null }
/**
 * completo / faltan temas / elegir la edición a mano (dos ediciones coinciden igual de bien) / no se encontró / todavía
 * no se buscó / ignorado (lo marcaste como "no es un disco" o "no me interesa completarlo").
 */
export type AlbumStatus = 'completo' | 'faltan' | 'elegir' | 'no_encontrado' | 'sin_buscar' | 'ignorado'
export interface AlbumReport {
  key: string
  dir: string
  artist: string
  album: string
  year: string | null
  tracks: number
  status: AlbumStatus
  /** La edición elegida (sola o a mano). */
  edition: AlbumEdition | null
  /** Se eligió a mano. */
  manual: boolean
  missing: AlbumMissingTrack[]
  /** Temas que tenés dos veces (el mismo tema del disco en dos archivos). */
  repeated: { title: string; files: string[] }[]
  /** Archivos tuyos que no están en esa edición (un bonus de otra edición, o algo que no es del disco). */
  extra: string[]
  /** Las ediciones que se pueden elegir (las que coinciden). */
  options: AlbumEdition[]
  /** Si está completo, la edición más grande que existe (deluxe, con bonus) y cuántos temas más tiene. */
  bigger: { edition: AlbumEdition; more: number } | null
}
export interface AlbumsSummary {
  reports: AlbumReport[]
  /** Discos que no se revisan (carpeta-playlist o con menos de 3 temas): para que se sepa por qué no aparecen. */
  skipped: number
  discogs: boolean
  deezer: boolean
}

/** Una tapa propuesta para un disco. */
export interface CoverProposal {
  key: string
  dir: string
  artist: string
  album: string
  tracks: number
  /** La tapa de hoy (la más chica entre los temas), en píxeles; null = algún tema no tiene. */
  current: { width: number; height: number; trackId: number } | null
  /** Cuántos temas no tienen tapa embebida. */
  without: number
  /** Lo que hay como cover.jpg / folder.jpg en la carpeta (si es carpeta propia del disco). */
  folder: { name: string; width: number; height: number } | null
  /** La tapa nueva: dirección paila://tapa/<huella> para verla, tamaño y de dónde salió. */
  proposed: { sha: string; width: number; height: number; bytes: number; source: string } | null
  /** Qué se haría: embeber en N temas, poner cover.jpg en la carpeta. */
  embed: number
  folderFile: boolean
  /** Además se reemplaza el Folder.jpg chico (oculto) que armaba el Reproductor de Windows Media. */
  windowsFolder: boolean
  /** Por qué no se propone nada (ya tiene una buena, no se encontró…). */
  why: string | null
  /** Ya está para aplicar (no se vuelve a ofrecer hasta buscar de nuevo). */
  staged?: boolean
  /** Ya se puso (se aplicó después de buscar): no se vuelve a ofrecer. */
  puesta?: boolean
  /** Los temas del disco hoy (para "Dejar como está"; core/covers-guardadas.ts). */
  ids?: number[]
}

/** Volumen parejo de un tema. */
/** `wrong`: el volumen parejo del tema que había puesto otro programa y no coincide con lo que se escucha (se corrige). */
export interface GainTrack { id: number; rel: string; lufs: number | null; gain: number | null; peak: number | null; albumGain: number | null; current: string | null; why: string | null; wrong: number | null }
export interface GainAlbum { key: string | null; artist: string; album: string; gain: number | null; peak: number | null; tracks: GainTrack[] }
export interface GainPlan {
  albums: GainAlbum[]
  /** Temas listos para escribir, sin analizar todavía, que ya tienen el mismo valor y que no se pueden escribir. */
  ready: number
  notAnalyzed: number
  same: number
  /** Ya tienen el volumen parejo de otro programa y coincide con lo que mide PAILA (menos de 1 dB): se deja. */
  other: number
  /** Tenían el de otro programa mal puesto (1 dB o más de diferencia): van con los listos, para corregirlos. */
  wrong: number
  cantWrite: number
}
