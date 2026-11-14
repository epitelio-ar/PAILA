// Tipos de las playlists: virtuales, desde carpetas, al pendrive y "Mejorar playlist".
import type { Grade } from './library'
import type { DupItem } from './cleanup'

export type PlaylistKind = 'list' | 'folder' | 'smart'
export interface SmartRules { text?: string; genre?: string; bpmMin?: number; bpmMax?: number; gradeMin?: Grade; camelot?: string; addedDays?: number }
export interface PlaylistNode { id: number; parentId: number | null; name: string; kind: PlaylistKind; rules: SmartRules | null; count: number; position: number }

export interface FolderProposal { dir: string; name: string; kind: 'album' | 'playlist' | 'dudosa'; count: number; artists: number; albums: number; reason: string; trackIds: number[]; sample: string[] }

export interface ExportOptions { dest: string; keepFlac: boolean; convert: boolean; numbered: boolean; subfolder: boolean; fat32: boolean }
export interface ExportItem { fileId: number; rel: string; action: 'copy' | 'convert'; targetExt: string; outName: string; estBytes: number; why: string | null }
export interface ExportPlan { items: ExportItem[]; skipped: { fileId: number; rel: string; reason: string }[]; warnings: string[]; totalBytes: number; freeBytes: number | null; copyCount: number; convertCount: number; folder: string }
export interface ExportProgress { done: number; total: number; current: string; errors: number }
export interface ExportResult { copied: number; converted: number; skippedExisting: number; failed: { name: string; error: string }[]; folder: string; m3u: string | null; cancelled: boolean }

export interface ImproveProposal { playlistId: number; currentId: number; betterId: number; current: DupItem; better: DupItem; reason: string }

/** "Limpiar playlist": los repetidos en otra calidad (queda `keep`, se sacan `drop`) y los desaparecidos hace rato. */
export interface CleanPreview { playlistId: number; total: number; groups: { keep: DupItem; drop: DupItem[] }[]; missing: DupItem[] }
/** "Fusionar playlists": cuántos temas quedan y cuáles se sacan por ser el mismo tema en otra calidad. */
export interface MergePreview {
  playlists: { id: number; name: string; count: number }[]
  /** Temas sumando todas las listas. */
  total: number
  /** Temas que quedan en la nueva. */
  unique: number
  /** Veces que el mismo archivo estaba en más de una lista. */
  sameFile: number
  /** Temas que se sacan por estar también en otra calidad. */
  otherQuality: number
  examples: { drop: DupItem; keep: DupItem }[]
}
/** Una fusión o limpieza anotada para el Historial. */
export interface PlaylistOpBatch { id: number; at: string; undone: boolean; files: number; summary: string }
export interface PlaylistOpDetailRow { rel: string; what: string; before: string | null; after: string | null; undone: boolean }
