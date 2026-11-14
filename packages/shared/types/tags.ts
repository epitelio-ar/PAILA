// Tipos de los tags: Cambios pendientes, acciones masivas, el asistente "Arreglar nombres y tags" y MusicBrainz.
import type { TidyProfile, TidyRule } from '../tidy-profiles'

export type EditableField = 'title' | 'artist' | 'albumArtist' | 'album' | 'track' | 'year' | 'genre'
/**
 * Algo para aplicar (la lista única de arriba, core/aplicar.ts). 'papelera' y 'mover' son propuestas (core/propuestas.ts), con `id`
 * negativo; los demás campos, cambios de Cambios pendientes (core/changes.ts).
 */
export interface PendingChange {
  id: number; fileId: number; rel: string; field: EditableField | 'filename' | 'extension' | 'cover' | 'replaygain' | 'folderCover' | 'comment' | 'serato' | 'trim' | 'bpm' | 'key' | 'papelera' | 'mover' | 'reemplazo'; before: string | null; after: string | null
  /** Por qué falló la última vez que se aplicó: se muestra aparte, con "Sacarlos", y "Aplicar" ya no lo incluye (core/changes.ts). */
  error?: string
}
export interface ApplyResult { batchId: number | null; applied: number; failed: { fileId: number; rel: string; error: string }[] }
export interface JournalBatch { batchId: number; appliedAt: string; files: number; changes: number; undone: boolean }

/** Acciones de edición masiva (ver core/tagactions.ts). Todas arman cambios pendientes: no escriben nada. */
export type TagAction =
  | { type: 'replace'; field: EditableField; find: string; repl: string; regex?: boolean }
  | { type: 'case'; field: EditableField; mode: 'title' | 'lower' | 'upper' | 'sentence' }
  | { type: 'number'; pad?: boolean; start?: number }
  | { type: 'mojibake' }
  | { type: 'youtube' }
  | { type: 'filenameToTag'; pattern: string }
  | { type: 'folderToTag' }
  | { type: 'tagToFilename'; pattern: string }
  | { type: 'refresh' } // no hace nada: solo vuelve a leer lo pendiente

export interface SavedAction { name: string; action: TagAction }

export type TidyStep = 'mojibake' | 'filename' | 'junk' | 'style' | 'official' | 'folder' | 'extension' | 'filenames' | 'djtags'
/** 'bpm' y 'key' = el BPM y el tono del tag (el paso 'djtags' solo los borra: `to` vacío). */
type TidyField = EditableField | 'filename' | 'extension' | 'bpm' | 'key'
export interface TidyExample { rel: string; field: TidyField; from: string | null; to: string }
/** Algo del asistente para que la persona mire: `staged` = se propone igual (con aviso); si no, no se propone. */
export interface TidyReview { id: number; rel: string; field: TidyField; from: string | null; to: string; why: string; staged: boolean; /** 'oficial' = lo propuso internet (al aceptarlo o dejarlo, se anota en el diccionario). */ origin?: 'oficial'; /** true = un nombre de archivo que chocaría con otro: no se puede aceptar (es un duplicado). */ blocked?: boolean }
export interface Completeness { total: number; artist: number; title: number; album: number; year: number; genre: number }
/** Un tema largo que parece un set: se propone para la colección "Sets y en vivo". */
export interface TidySet { id: number; rel: string; minutes: number; why: string }
/** Cuánto propone cada perfil de nombres, y ejemplos de lo que agrega sobre el anterior. */
export interface TidyProfileCount { key: TidyProfile; count: number; tracks: number; extra: TidyExample[] }
export interface TidyReport {
  /** `detail`: qué encontró el paso, en palabras (el de BPM y tono: cuántos de cada motivo). */
  steps: { key: TidyStep; label: string; count: number; tracks: number; examples: TidyExample[]; warning?: string; detail?: string }[]
  leftover: { count: number; sample: string[] }
  review: TidyReview[]
  kept: number
  sets: TidySet[]
  byRule: Partial<Record<TidyRule, { count: number; examples: TidyExample[] }>>
  before: Completeness
  after: Completeness
  total: number
  /** Las reglas con las que se calculó (las del perfil elegido, o "a medida"). */
  rules: TidyRule[]
  /** Al abrir, solo el perfil elegido (sin ejemplos): los demás llegan después con `tidyProfiles`. */
  profiles: TidyProfileCount[]
  /** Cuántos temas que cambian de nombre de archivo vinieron del rekordbox.xml (Rekordbox los pierde hasta volver a importar). */
  inRekordbox?: number
  /** Búsquedas de nombres oficiales guardadas (0 = todavía no se buscó en internet: el perfil Oficial no agrega nada). */
  searched: number
}

export interface MbProposal { fileId: number; rel: string; current: { artist: string; title: string; album: string | null; year: string | null; genre: string | null }; mbid: string; score: number; confidence: 'alta' | 'media'; artist: string; title: string; album: string | null; year: string | null; genre: string | null; releaseId: string | null; suspicious: boolean; fills: { field: 'album' | 'year' | 'genre' | 'track'; value: string }[] }
export interface MbStatus { candidates: number; pending: number; found: number; none: number; errors: number }
