// Tipos del modo avanzado: el inspector de un tema (`npm run tema` y la ventana de la app), la cola del análisis y el registro de operaciones.

/** Una línea del inspector: qué es y su valor tal cual está guardado. */
export interface InspectRow { label: string; value: string }
/** Un bloque del inspector. `items`: una lista de cosas sueltas (playlists, cambios…); `empty`: qué decir si no hay nada. */
export interface InspectSection { key: string; title: string; help?: string; rows: InspectRow[]; items?: string[]; empty?: string }
/** Todo lo que PAILA ve y decide de un tema. */
export interface TrackInspection { id: number; rel: string; abs: string | null; title: string; sections: InspectSection[] }
/** Resultado de buscar un tema por lo que escribió la persona: uno solo, varios parecidos o ninguno. */
export type TrackLookup = { found: number } | { choices: { id: number; rel: string }[] } | null

/** Un tema que espera en la cola del análisis. */
export interface QueueItem { id: number; rel: string; why: string }
/** La cola del análisis: qué pasada falta, cuántos temas y los primeros. */
export interface QueueLane { key: string; label: string; help: string; count: number; next: QueueItem[] }
export interface AnalysisQueueView {
  /** Qué está haciendo el análisis ahora ('' = nada). */
  running: string; phase: string; probed: number; toProbe: number; current: string; paused: boolean
  lanes: QueueLane[]
  /** Temas que no se pudieron leer (con el motivo). */
  failed: QueueItem[]
}

/** Una operación del registro: algo que PAILA hizo (o dejó a medias) sobre archivos. */
export interface OpLogEntry { id: number; source: 'diario' | 'historial'; op: string; state: string; at: string; detail: string; files: number }

/** Lo que contesta "Inspeccionar un tema": el tema (con el mismo texto que `npm run tema`), varios parecidos para elegir, o nada. */
export type AdvInspectResult =
  | { ok: true; data: TrackInspection; texto: string }
  | { ok: false; choices: { id: number; rel: string }[]; mensaje: string }
