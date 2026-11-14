// "Un disco" en NAPIA (DECISIONES 07/11; MASTERPLAN-5, etapa 5): se escribe artista y disco, NAPIA busca la lista oficial en MusicBrainz y
// Deezer para confirmar cuál es (si hay varias ediciones, se elige), primero intenta la carpeta entera de una sola persona y, si nadie la
// tiene completa, baja tema por tema lo que falta. La lógica, en packages/core/sockseek/disco.ts y disco-correr.ts.

/** Una edición del disco, como la dice MusicBrainz o Deezer. */
export interface EdicionDisco {
  fuente: 'musicbrainz' | 'deezer'
  id: string
  artista: string
  titulo: string
  /** Año (o fecha) de esa edición. */
  anio: string | null
  pais: string | null
  /** CD, vinilo, digital… */
  formato: string | null
  /** Cuántos temas tiene. */
  temas: number
  /** Disco, EP, simple, compilado. */
  tipo: string | null
  /** La aclaración de MusicBrainz ("Réplica vinilo"), si tiene. */
  nota?: string | null
  /** La que más se parece a lo escrito (solo si hay varias): se marca, pero NAPIA no la elige sola (el autor, 13/11). */
  sugerida?: boolean
  /** La original (la más vieja sin agregados), una remasterizada o una de lujo; null si no se sabe. */
  clase?: 'original' | 'remaster' | 'deLujo' | null
}

/** Un tema de la lista oficial. */
export interface TemaDisco { n: number; artist: string; title: string; duration: number | null }

/** Lo que lleva una lista de NAPIA que es un disco entero. */
export interface DiscoPedido { artista: string; titulo: string; edicion: EdicionDisco }

/** Cómo salió el primer intento (la carpeta entera de una persona). */
export interface IntentoCarpeta { llegaron: number; truchos: number; de: number }

/** Lo que encontró la búsqueda. `sinMusicbrainz`: MusicBrainz no contestó, así que puede haber más ediciones (no se elige sola). */
export interface BusquedaDisco { ediciones: EdicionDisco[]; sinMusicbrainz: boolean }

export interface DiscoNapiaApi {
  /** Las ediciones que encuentran MusicBrainz y Deezer (necesita internet; sin resultados, vacío). */
  buscarDisco(artista: string, titulo: string): Promise<BusquedaDisco>
  /** La lista de temas oficial de esa edición. */
  temasDisco(e: EdicionDisco): Promise<TemaDisco[]>
}
