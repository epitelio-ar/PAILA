// Tipos del tracklist automático de sets (core/setlists.ts y core/tracklist.ts; pantalla ui/src/Tracklist.tsx).

/** De dónde salió un tema del tracklist: la biblioteca (por la huella), AcoustID, el reconocedor (AudD) o escrito a mano. */
export type TrackInSetSource = 'biblioteca' | 'acoustid' | 'audd' | 'mano'

/** Un tramo del set: un tema reconocido o un tramo sin reconocer (`source` null). */
export interface TrackInSet {
  /** Segundo del set en que entra (aproximado). */
  start: number
  /** Hasta dónde se lo escuchó (o hasta dónde llega el tramo sin reconocer). */
  until: number
  source: TrackInSetSource | null
  /** El tema de la biblioteca (si lo es) y otros archivos con el mismo audio. */
  fileId: number | null
  alsoIds: number[]
  artist: string | null
  title: string | null
  /** Ruta del tema de la biblioteca (para mostrarla); la pone quien lee. */
  rel?: string | null
  /** Seguridad: alta (varias ventanas lo reconocen), media o baja (una sola: escuchalo). */
  confidence: 'alta' | 'media' | 'baja'
  /** Velocidad a la que sonaba (1 = la original; 1,04 = un 4 % más rápido). */
  rate: number
  /** Cuántas ventanas de ~30 s lo reconocen. */
  windows: number
  /** Quitado a mano ("no es este"): no sale en el tracklist, los tags ni los cue points. */
  hidden?: boolean
  /** Uno de seguridad baja que se escuchó y es: sale como los demás. */
  confirmed?: boolean
}

export interface SetTracklist {
  fileId: number
  rel: string
  /** Duración del set en segundos. */
  seconds: number
  madeAt: string
  entries: TrackInSet[]
  /** Tamaño de la huella del set guardada (KB) y cuánto tardó (s): leer el set y buscar. */
  printKb: number
  took?: { read: number; search: number; internet: number }
  /** Cuántos tramos sin reconocer se mandaron a internet (y si faltaba la clave). */
  internet?: { asked: number; found: number; note: string | null }
  /** Cue points del tracklist guardados para Rekordbox. */
  cues?: number
}

/** Un archivo largo que puede ser un set (para elegir cuál escuchar). */
export interface SetCandidate {
  fileId: number
  rel: string
  minutes: number
  /** Por qué parece un set (core/sets.ts), o "Está en Sets y en vivo". */
  why: string
  /** Ya tiene tracklist armado (cuándo). */
  madeAt: string | null
  /** Temas reconocidos en el último tracklist. */
  found: number
}

export interface ListenOptions {
  /** Probar también el set leído a otras velocidades en lo que no se reconoce (más lento). */
  speeds?: boolean
  /** Lo que no está en la biblioteca, por AcoustID y el reconocedor (si está prendido). */
  internet?: boolean
}

/** En qué formato sale el tracklist: texto con minutos, hoja .cue (reproductores) o planilla CSV. */
export type TracklistFormat = 'txt' | 'cue' | 'csv'
