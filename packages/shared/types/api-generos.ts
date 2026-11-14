// Los pedidos de la interfaz para "Géneros desde internet" (core/genres-find.ts y core/genres-run.ts): buscar en Discogs y
// Last.fm, ver las propuestas y mandarlas a Cambios pendientes. Aparte de api.ts para que no crezca: PailaApi los extiende.
import type { GenreLevel, GenreReport, GenresStatus } from './genres'

export interface GenerosApi {
  genresStatus(): Promise<GenresStatus>
  /** Proceso largo "genres": pregunta a Discogs y a Last.fm por los temas sin género. `retry`: reintenta los que dieron error. */
  genresRun(retry: boolean): Promise<unknown>
  genresReport(level: GenreLevel): Promise<GenreReport>
  /** Propone en Cambios pendientes el género de esos temas (recalculado, con ese nivel) y "misma cosa, escrita distinto" (`spelling`: los valores de antes). */
  /** held: los que quedaron "para mirar a mano" en Arreglar nombres (otra herramienta de más confianza ya puso ese dato). */
  genresStage(ids: number[], level: GenreLevel, spelling: string[]): Promise<{ staged: number; held: number }>
}
