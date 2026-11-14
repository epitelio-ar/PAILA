// Tipos de lo que PAILA hizo y está haciendo: Historial, recuperación tras un corte y procesos en segundo plano.

/**
 * Recuperación tras un corte (core/recovery.ts): lo que PAILA encontró a medias al abrir y qué hizo con cada cosa.
 * completado = ya se había hecho, se terminó de anotar; no-hecho = no se llegó a tocar; vuelto-atras = quedó a medias y
 * volvió a como estaba; revisar = no se pudo resolver solo; pendiente = está en un disco que no está conectado.
 */
export interface RecoveryItem { id: number; op: string; result: 'completado' | 'no-hecho' | 'vuelto-atras' | 'revisar' | 'pendiente'; message: string; startedAt: string }
export interface RecoveryReport { items: RecoveryItem[]; pending: number }

/**
 * Historial único (core/history.ts): todo lo que PAILA hizo sobre archivos, del más nuevo al más viejo, con deshacer por tanda.
 * 'organizar' = Organizar carpetas; 'limpieza' = archivos que no son música mandados a la papelera desde Espacio;
 * 'conversion' = WAV/AIFF → FLAC (Espacio) o WMA/OGG/Opus → MP3/FLAC (Rekordbox), agrupadas por corrida; 'recorte' = silencios
 * recortados (core/trim.ts, con el Reemplazo: el original en la papelera);
 * 'playlist' = Mejorar playlist (no toca archivos, cambia qué versión está en la lista); 'pedido' = una lista traída de
 * otro lado (core/requests.ts: crea una playlist y suma lo que falta a la lista «Faltan o suenan mal»; tampoco toca archivos);
 * 'listas' = playlists fusionadas o limpiadas (core/playlistops.ts; deshacer las devuelve como estaban).
 * 'bandeja' = temas de la Bandeja que no tenías, pasados a tu Música (core/inboxadd.ts; deshacer los devuelve a la Bandeja).
 */
/** vaciado: una vez que se vació la papelera (no se deshace). copia: lo copiado afuera de tu Música (pendrive, celular, otros programas; core/history-copies.ts): no se deshace, tu Música no se tocó. */
/** aplicar: todo lo que se aplicó junto con un solo Aplicar (MASTERPLAN-5, 3.3: papelera → tags → mover → tapas), que se deshace de una. */
export type HistoryKind = 'aplicar' | 'tags' | 'papelera' | 'organizar' | 'limpieza' | 'reemplazo' | 'conversion' | 'recorte' | 'playlist' | 'pedido' | 'traidas' | 'bandeja' | 'listas' | 'vaciado' | 'comprimido' | 'comprimido-papelera' | 'copia' | 'separar' | 'carpetas'
export interface HistoryEntry {
  kind: HistoryKind
  /** Número de tanda (en conversiones, el del primer reemplazo de la corrida). Con `kind` identifica la entrada. */
  id: number
  at: string
  /** Cuántos temas o archivos tocó. */
  files: number
  /** Qué se hizo, en castellano ("Se cambió el género de 12 temas"). */
  summary: string
  /** Ya se deshizo entera. */
  undone: boolean
  canUndo: boolean
  /** Por qué no se puede deshacer (null si se puede). */
  whyNot: string | null
  /** Aviso para tener en cuenta antes de deshacer (una parte ya se deshizo, algunos temas se movieron después…). */
  note: string | null
  /**
   * Dónde quedó el respaldo de los archivos de esta tanda (core/ops/backup.ts), si se hizo uno (antes de aplicar o de deshacer).
   * `light` false = copias completas (como las hacía la 0.5.3). `id`: para borrarlo desde el Historial ("Todo bien").
   */
  backups?: { id: number; dir: string; files: number; bytes: number; op: string; exists: boolean; light: boolean }[]
  /** En un Aplicar: sus partes, en el orden en que se aplicaron (cada una es una tanda de su registro). */
  partes?: HistoryRef[]
  /**
   * Lo que vino después y la toca (los mismos temas, el mismo lugar o una carpeta que creó): deshacer esta deshace antes esas, de la
   * más nueva a la más vieja, de una (MASTERPLAN-5, 3.4). Vacío o ausente: se deshace sola.
   */
  cadena?: (HistoryRef & { summary: string; at: string; files: number })[]
}
export interface HistoryRef { kind: HistoryKind; id: number }
/**
 * "Volver a como estaba": un punto por cada Aplicar. Deshace ese Aplicar y todo lo que tocó archivos después, de lo más nuevo a lo más
 * viejo (`entradas`, en ese orden). Las playlists y las listas traídas no se tocan.
 */
export interface HistoryPunto {
  tanda: number; at: string; summary: string
  entradas: (HistoryRef & { summary: string; at: string; files: number })[]
  canUndo: boolean; whyNot: string | null
}
export interface HistoryDetailRow { name: string; folder: string; what: string; before: string | null; after: string | null; undone: boolean }
export interface HistoryDetail { rows: HistoryDetailRow[]; total: number }
export interface HistoryUndoResult {
  done: number; failed: { rel: string; error: string }[]
  /** Deshacer en cadena o volver a un punto: cuántas tandas se deshicieron, y las carpetas vacías que había creado PAILA y se sacaron. */
  tandas?: number; carpetas?: number
}

/** Un proceso largo en segundo plano (ver core/jobs.ts). */
export interface JobState {
  kind: string; label: string; running: boolean; done: number; total: number; current: string
  found: number; errors: number; startedAt: number; finishedAt: number | null; summary: string | null; cancelling: boolean; failed: boolean
  /** Qué archivos tuvieron problemas y por qué. */
  problems: { name: string; error: string }[]
  /** En fila: espera a que termine `job` (su nombre), porque los dos usan `service` (MusicBrainz, Discogs). */
  waiting: { job: string; service: string } | null
}
