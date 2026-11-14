// Tipos de mejorar la calidad: reemplazo de un tema, lista de deseos y bandeja.

export interface ReplaceSide { ext: string; codec: string | null; kbps: number | null; sampleRate: number | null; bits: number | null; duration: number | null; size: number; grade: string | null; label: string | null; lufs: number | null; cutoff: number | null; why: string[]; spectrogram: string | null }
export interface ReplaceCompare { current: ReplaceSide; candidate: ReplaceSide & { path: string; artist: string | null; title: string | null }; warnings: string[]; audio: { current: string; candidate: string } }
/**
 * batch: los reemplazos de un mismo "Reemplazar todos" son una sola tanda en el Historial.
 * keepDj: el mismo audio (WAV → FLAC verificado, una conversión, un recorte que acomoda lo suyo): la grilla y los cues siguen valiendo.
 * Si no, los que calculó PAILA se vuelven a calcular y los de Rekordbox o Serato se sacan si cambió la duración o el formato.
 * `stillValid`: lo pendiente del tema que sigue valiendo con el audio nuevo. Por defecto, al reemplazar se saca lo pendiente de
 * volumen, recorte y Serato (se calculó con el audio viejo: choques del 27/10, C6); recortar silencios deja el volumen.
 */
export interface ReplaceOptions { keepTags: boolean; keepCover: boolean; sameName: boolean; batch?: string; keepDj?: boolean; stillValid?: ('replaygain' | 'serato')[] }
/** purgedAt: si se vació la papelera con el original adentro (ya no se puede deshacer). */
export interface ReplacementEntry { id: number; fileId: number; oldRel: string; newRel: string; createdAt: string; undone: boolean; purgedAt: string | null }
/** rel: dónde quedó el original. followed: el tema se había movido o renombrado y el original volvió a ese lugar nuevo. */
export interface ReplaceUndoResult { rel: string; followed: boolean }

export type WishStatus = 'pendiente' | 'buscando' | 'conseguido' | 'reemplazado' | 'ignorar'
export interface WishGroup { key: string; artist: string; album: string; status: WishStatus; note: string; tracks: number; worst: string | null; bytes: number; fixed: boolean; sample: string[] }
export interface InboxMatch { fileId: number; rel: string; ext: string; kbps: number | null; grade: string | null; duration: number | null; by: 'tags' | 'nombre' | 'sonido' }
export interface InboxItem { path: string; name: string; ext: string; size: number; kbps: number | null; sampleRate: number | null; duration: number | null; codec: string | null; artist: string | null; title: string | null; match: InboxMatch | null; looksBetter: boolean | null; note: string | null }
