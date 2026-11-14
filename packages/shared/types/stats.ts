// Estadísticas de la colección (pantalla "Estadísticas"): por década, género, formato, artistas con más discos y calidad de CD o mejor.

/** Un grupo del gráfico: su nombre, cuántos temas y cuánto ocupan. */
export interface StatBucket { label: string; tracks: number; bytes: number }

export interface CollectionStats {
  /** Temas y espacio de la colección Música. */
  tracks: number
  bytes: number
  /** Cuántos tienen cada dato (el resto aparece como "sin dato"). */
  withYear: number
  withGenre: number
  /** Por década ("1990s"), en orden cronológico. Los temas sin año no entran (ver `withYear`). */
  decades: StatBucket[]
  /** Los géneros más frecuentes (hasta 12) y, aparte, cuántos temas quedan en otros. */
  genres: StatBucket[]
  genresOther: number
  /** Por formato (MP3, FLAC…), de más a menos temas. */
  formats: StatBucket[]
  /** Artistas con más discos (discos distintos, no temas). */
  topArtists: { artist: string; albums: number; tracks: number }[]
  /** Cuántos temas tiene cada nota (A+…F), de los ya analizados. */
  byGrade: Record<string, number>
  /** Calidad de CD o mejor: nota A+ o A. `graded` = temas ya analizados. */
  cdOrBetter: { count: number; graded: number; bytes: number; hiRes: number; lossless: number }
  /**
   * Por país del artista (según MusicBrainz, de "Completar desde internet"; no está en los tags), los más frecuentes.
   * `withCountry` = temas con país conocido; `countryArtists` = artistas distintos con país.
   */
  countries: StatBucket[]
  withCountry: number
  countryArtists: number
}

/** Un disco para el Inicio ("Llegaron hace poco"): con un tema de muestra para pedir la tapa y la nota que más tiene. */
export interface RecentAlbum {
  album: string
  artist: string | null
  year: number | null
  tracks: number
  /** Un tema del disco (el primero): de ahí sale la tapa (`coverThumb`). */
  trackId: number
  /** La nota que más se repite en el disco (null si todavía no se analizó). */
  grade: string | null
}
