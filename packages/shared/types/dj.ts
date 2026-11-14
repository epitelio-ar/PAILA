// Tipos de las funciones para DJs: Rekordbox, equipos y conversión de lo que no leen.

export interface DeviceProfile { id: string; label: string; formats: string[]; maxSampleRate: number; note: string }
/** `maxKhz`: solo si el problema es la frecuencia de muestreo (hasta cuántos kHz llega el equipo); con eso se agrupan. */
export interface CompatReport { device: DeviceProfile; ok: number; issues: { fileId: number; rel: string; reason: string; maxKhz?: number }[] }
export interface Unreadable { id: number; rel: string; ext: string; codec: string | null; lossless: boolean; size: number }
/** 'mp3' = MP3 320 (lo lee todo, pierde un poquito más); 'flac' = sin pérdida extra (ocupa unas 5 veces más). */
export type DjTarget = 'mp3' | 'flac'
export interface ConvertResult { converted: number; trashedBytes: number; failed: { rel: string; error: string }[] }
/** Rango de BPM de un estilo (core/analysis/bpmrange.ts): con qué palabras del género o la carpeta se reconoce y desde qué BPM empieza (va hasta el doble). */
export interface BpmStyle { name: string; words: string[]; min: number }
export interface RekordboxResult { file: string; tracks: number; playlists: number; skipped: { rel: string; reason: string }[]; /** Temas con grilla y con cues. */ grids: number; cues: number }

// ---- Fase F: Rekordbox y cabina, nivel pro ----
/** De dónde salió una grilla: la que ya tenía Rekordbox, la de Serato, Beat This! (red neuronal) o degara (Essentia). */
export type GridMethod = 'rekordbox' | 'serato' | 'beatthis' | 'degara'
/** Un cue point en el tiempo de PAILA. `num`: -1 = memory cue; 0–7 = hot cue A–H. */
export interface DjCue { source: 'rekordbox' | 'serato' | 'paila' | 'tracklist'; kind: 'hot' | 'memory' | 'loop'; num: number; start: number; endAt: number | null; name: string; color: string | null }
export interface DjImportResult {
  source: 'rekordbox' | 'serato'
  /** Temas que tenía el XML (o archivos revisados, en Serato). */
  tracks: number
  /** Los que se encontraron en PAILA (en Serato: los que tenían marcadores). */
  matched: number
  /** De esos, los encontrados por nombre de archivo y tamaño (se movieron de carpeta). */
  byName: number
  grids: number
  cues: number
  stars: number
  colours: number
  myTags: number
  /** Temas de la Música del XML que no están en PAILA (hasta 200). */
  unmatched: string[]
}
/** Opciones del rekordbox.xml: con grilla y con cues (los de Rekordbox o Serato siempre; los sugeridos, si se pide). */
export interface RekordboxExportOptions { grid: boolean; suggestedCues: boolean; /** La grilla variable de PAILA en los temas que se mueven, aunque Rekordbox tenga una fija. */ pailaWhenMoving?: boolean }
/** Los otros programas de DJ a los que exporta PAILA (core/djexport.ts). */
export type DjApp = 'traktor' | 'serato' | 'virtualdj' | 'engine'
/** `intoFiles` (solo Serato): la grilla y los cues van también dentro de los archivos, pasando por Cambios pendientes. */
export interface DjExportOptions extends RekordboxExportOptions { intoFiles?: boolean }
export interface DjExportResult {
  app: DjApp
  /** Lo que se escribió (el .nml, las crates, la base de VirtualDJ y sus listas, la de Engine DJ). */
  written: string[]
  /** Copias de lo que había antes, por si hay que volver atrás. */
  backups: string[]
  tracks: number; playlists: number; grids: number; cues: number
  skipped: { rel: string; reason: string }[]
  /** Temas con grilla que cambia de tempo que el programa no acepta: van con un solo BPM. */
  simplified: number
  /** Serato: cuántos temas quedaron en Cambios pendientes con su grilla y cues, y cuántos ya tenían lo de Serato (no se tocan). */
  staged?: number; alreadyIn?: number
  /** VirtualDJ y Engine DJ: temas que ya estaban en su base con grilla o cues propios (se dejan como estaban). */
  kept?: number
  /** Engine DJ: las bibliotecas nuevas que se armaron (la de un disco que todavía no tenía la suya). */
  created?: string[]
}
/** Cómo se calcula la grilla: con la placa de video (Beat This!), con el procesador (Beat This!, más lento) o rápido (degara). */
export interface GridEngineInfo { beatThis: boolean; gpu: string | null; missing: string | null; modelsDir: string | null; secondsPerTrack: number }
/** `setsOut`: cuántos Sets (mixes enteros) quedan afuera de la pasada de toda la Música. */
export interface GridPlan { tracks: number; already: number; seconds: number; engine: 'gpu' | 'cpu' | 'degara'; setsOut?: number }

// ---- Armado de set ----
export interface SetTrack { id: number; artist: string; title: string; bpm: number | null; camelot: string | null; energy: number | null; duration: number | null }
/** Cómo pega un tema con el siguiente: tono (Camelot), BPM y salto de energía. */
export interface SetTransition { key: 'igual' | 'vecino' | 'relativo' | 'diagonal' | 'choca' | null; bpmPct: number | null; energyJump: number | null; score: number }
export interface SetCurve { tracks: SetTrack[]; transitions: SetTransition[] }
export interface NextSuggestion { track: SetTrack; transition: SetTransition; why: string; inPlaylist: boolean }
/** Un tema que combina para pasar después (la ficha): tono vecino y BPM a ±6 %. */
export interface Combina { id: number; artist: string; title: string; bpm: number | null; camelot: string | null; grade: string | null }

// ---- Energía a tu oído y estilo por el sonido (MASTERPLAN-3, punto 3) ----
/** Un tema para marcar su energía: la de PAILA hoy y la que marcó la persona (null = sin marcar). */
export interface EnergyMarkTrack { id: number; artist: string; title: string; paila: number | null; mark: number | null }
/** Las marcas hechas, cuántas hacen falta para ajustar y con cuántas se ajustó la última vez. */
export interface EnergyMarksState { marks: EnergyMarkTrack[]; min: number; calibratedWith: number; calibratedAt: string | null }
/** Cuánto acertaba antes y después de ajustar (% de marcas a ±1, dejando cada una afuera del ajuste) y cuántos temas cambiaron. */
export interface EnergyCalibrateResult { ok: boolean; marks: number; before: number; after: number; changed: number }
/** El modelo de estilos (se baja aparte): si está, qué falta, cuánto pesa y cuánto falta escuchar. */
/** `missing`: qué falta, para mostrar; `toDownload`: lo que falta es bajar el modelo (el botón Bajar ya lo dice). */
export interface SoundStyleInfo { ready: boolean; missing: string | null; toDownload: boolean; bytes: number; pending: number; heard: number }
