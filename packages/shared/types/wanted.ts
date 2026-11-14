// Tipos de la lista «Faltan o suenan mal» (por tema) y de la Bandeja vigilada con "Reemplazar todos".
import type { InboxMatch } from './quality'

/** pendiente → pedido (se exportó) → llegó (la Bandeja lo encontró) → reemplazado; o ignorar. */
export type WantedStatus = 'pendiente' | 'pedido' | 'llego' | 'reemplazado' | 'ignorar'
/**
 * Por qué conviene conseguirlo. `falta`: un tema que no tenés (por ejemplo, un archivo con su título suena como otro);
 * `falta_disco`: un tema que le falta a un disco tuyo (Discos completos). `puede_mp3`: un sin pérdida que se corta en seco donde
 * corta un MP3 de ~256 (B, pero puede venir de uno): buscar el original.
 */
export type WantedReason = 'nota' | 'lossless_falso' | 'inflado' | 'rekordbox' | 'falta' | 'falta_disco' | 'puede_mp3'

/** Las casillas de qué entra en la lista. */
export interface WantedCriteria {
  /** Nota D o F. */
  bad: boolean
  /** Nota C también. */
  fair: boolean
  /** Lossless falsos (un MP3 disfrazado de FLAC/WAV) e inflados (un MP3 de 128 re-codificado a 320). */
  fakes: boolean
  /** Formatos que Rekordbox no lee (WMA, OGG, Opus…). */
  rekordbox: boolean
  /** Sin pérdida que pueden venir de un MP3 (se cortan en seco en ~19,5 kHz): buscar el original. Sin la casilla, no entran. */
  mp3like?: boolean
}

export interface WantedItem {
  /** Clave para cambiar el estado: `f<id del tema>` o `w<id de la fila>` (los temas que faltan). */
  key: string
  fileId: number | null
  rel: string | null
  /** Para los que faltan: el archivo de tu biblioteca que tiene ese título pero suena como otro tema. */
  refRel: string | null
  artist: string
  title: string
  album: string | null
  duration: number | null
  ext: string | null
  grade: string | null
  /** La calidad real de tu copia en kbps (1411 = CD), si ya se analizó. */
  effKbps: number | null
  /** Del análisis de tu copia: sus marcas ("gaps,low_bitrate"), cuántos tramos satura y su volumen (los usa NAPIA al reemplazarla). */
  flags?: string | null
  clipEvents?: number | null
  lufs?: number | null
  /** Lo que es hoy, en castellano ("MP3 128 kbps · nota D"). */
  quality: string
  /** Lo que conviene conseguir ("FLAC (calidad CD) o MP3 320 kbps"). */
  want: string
  reasons: WantedReason[]
  status: WantedStatus
  note: string
  arrivedPath: string | null
  /** Los pedidos de los que viene (listas traídas de otro lado: «80s Mood»). */
  requests: string[]
  /** De una lista traída: dijiste "No es" a la copia que se parecía (otra versión). NAPIA lo baja aunque se parezca a lo que tenés. */
  otraVersion?: boolean
}

export interface WantedExport { text: string; count: number; marked: number }
/**
 * txt y csv: para vos (una planilla); sockseek-txt y sockseek-csv: para sockseek (el que baja de Soulseek); napia-csv: el de
 * sockseek con la nota de tu copia, para que NAPIA se quede solo con una claramente mejor ("Bajar con NAPIA").
 */
/** Qué parte de la lista: todo, mejorar la calidad de lo que ya tenés (`fileId`), o lo que no tenés (faltan, discos, listas traídas). */
export type WantedQue = 'todo' | 'calidad' | 'faltan'
export type WantedFormat = 'txt' | 'csv' | 'sockseek-txt' | 'sockseek-csv' | 'napia-csv'

/** Cómo se emparejó: `mismo` (huella: el mismo audio), `version` y `dudoso` (huella, no se reemplazan solos), `probable` (tags o nombre + duración). */
export type InboxMatchKind = 'mismo' | 'version' | 'dudoso' | 'probable'
/** reemplazar: el mismo audio y mejor de verdad · mirar: a mano · no-sirve: el mismo audio pero no es mejor · falta: un tema que no tenías. */
export type InboxDecision = 'reemplazar' | 'mirar' | 'no-sirve' | 'falta' | 'sin-pareja' | 'error'

export interface InboxCheck {
  ok: boolean
  newGrade: string
  newLabel: string
  oldGrade: string | null
  /** Por qué no sirve (vacío si sirve), en el idioma de la pantalla. */
  problems: string[]
  /** Lo mismo en castellano: es lo que se anota en `no-sirvió/motivos.txt`, que no cambia de idioma. */
  problemsEs?: string[]
  /** El único problema es que el tema de tu biblioteca todavía no se analizó (no se decide: se mira a mano). */
  notAnalyzed?: boolean
  /** Pasa, pero con aviso (otro master). */
  warnings: string[]
}

export interface InboxResult {
  path: string; name: string; ext: string; size: number; kbps: number | null; duration: number | null; codec: string | null
  artist: string | null; title: string | null
  match: (InboxMatch & { kind: InboxMatchKind; wantedId: number | null; sharedSeconds: number | null }) | null
  missing: { wantedId: number; artist: string; title: string; refRel: string | null } | null
  check: InboxCheck | null
  decision: InboxDecision
  /** Una línea que explica la decisión (en el idioma de la pantalla cuando se revisó). */
  why: string
  checkedAt: string
  /** Tamaño y fecha del tema de la biblioteca cuando se revisó: si cambió (se reemplazó a mano, se retagueó), se revisa de nuevo. */
  libStamp: string | null
  /** Lo que midió el análisis del archivo nuevo: para elegir entre dos que llegaron para el mismo tema, como en Duplicados. */
  sound?: { clipEvents: number | null; lufs: number | null; cutoff: number | null; encoder: string | null; sampleRate: number | null; gaps: boolean }
  /**
   * El motivo en castellano y en inglés (usabilidad, 2.ª tanda, P3): si se cambia el idioma, la Bandeja muestra el de hoy sin
   * volver a revisar el archivo. Lo guardado antes no lo tiene: queda en el idioma de cuando se revisó.
   */
  idiomas?: Record<'es' | 'en', InboxMotivo>
}
/** Lo que se lee de un archivo de la Bandeja, en un idioma. */
export interface InboxMotivo { why: string; problems: string[]; warnings: string[] }

export interface InboxWatchState {
  folder: string | null
  watching: boolean
  /** Archivos esperando turno (incluye los que todavía se están bajando). */
  queue: number
  current: string | null
  lastFullScan: string | null
  auto: boolean
  error: string | null
  /** Sube cada vez que se termina de revisar un archivo (la pantalla recarga la lista). */
  processed: number
  /** Cuántos reemplazó solo el modo automático desde que se abrió PAILA. */
  autoHechos: number
}

export interface InboxPlanItem { path: string; name: string; fileId: number; rel: string; newRel: string; oldGrade: string | null; newGrade: string; inRekordbox: boolean; warnings: string[] }
/** La simulación de "Reemplazar todos": qué se reemplaza y qué va a `no-sirvió/` (nada se hace hasta confirmar). */
export interface InboxPlan { replace: InboxPlanItem[]; reject: { path: string; name: string; reason: string }[]; rekordbox: number }
export interface InboxApplyResult { replaced: number; rejected: number; failed: { name: string; error: string }[] }
/**
 * La vista previa de "Pasar a tu Música" (core/inboxadd.ts): los temas de la Bandeja que no tenías y adónde irían
 * (`rel`, dentro de la carpeta de música `root`). Nada se toca hasta confirmar.
 */
export interface InboxAddPlan {
  root: string | null
  folder: string | null
  items: { path: string; name: string; rel: string; decision: 'falta' | 'sin-pareja'; artist: string | null; title: string | null; why: string }[]
}
export interface InboxAddResult { added: number; failed: { name: string; error: string }[]; batch: number; folder: string }
