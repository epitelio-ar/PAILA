// Tipos de "Géneros desde internet" (MASTERPLAN-3, punto 4): el género propuesto para cada tema sin género (Discogs y
// Last.fm), "misma cosa, escrita distinto" y el estado de la búsqueda.

/**
 * Nivel de detalle: como ya lo tenés en tu biblioteca (por familia: "Rock" a secas si así ponés el rock, estilos si así
 * ponés la electrónica), el estilo ("Deep House", "Rock Nacional") o el género general ("Electronic", "Rock").
 */
export type GenreLevel = 'biblioteca' | 'estilo' | 'general'
export type GenreSource = 'discogs' | 'lastfm' | 'musicbrainz'

export interface GenreProposal {
  fileId: number; rel: string; artist: string | null; title: string | null
  /** Lo que tiene hoy (vacío o algo que no dice nada, como "Other"). */
  current: string | null
  genre: string; conf: 'alta' | 'media'
  /** "disco": lo dicen los otros temas del mismo disco. */
  sources: (GenreSource | 'disco')[]
  why: string; others: string[]
}
/** Temas con un género que es lo mismo que otro de la biblioteca, escrito distinto ("rock" y "Rock"). */
export interface SpellingGroup { from: string; to: string; ids: number[] }
export interface GenreReport {
  proposals: GenreProposal[]
  spelling: SpellingGroup[]
  /** Temas sin género (o con "Other"…), los que ya tienen uno (no se tocan) y los que se dejan por haberlos tocado a mano. */
  empty: number; withGenre: number; handTouched: number
}

export interface GenresStatus {
  /** Temas sin género con artista y título (los que se buscan). */
  tracks: number
  /** Pedidos que faltan por fuente (0 si no hay clave). */
  left: { discogs: number; lastfm: number }
  keys: { discogs: boolean; lastfm: boolean }
  /** Minutos que faltan, aproximado (las dos fuentes trabajan a la vez). */
  minutes: number
}
