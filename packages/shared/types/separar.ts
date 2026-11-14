// Separar voz (masterplan 4, 4B.6; core/stems): lo que muestra su sección en DJ y producción. Es para uno o pocos temas a la
// vez: el modelo se baja aparte, cada tema tarda unas dos veces lo que dura y lo separado va a una carpeta propia.
import type { Grade } from './library'

/** A dónde va lo separado (adentro de una carpeta de música, para que se vea en PAILA y se pueda deshacer). */
export interface StemsDestino {
  rootId: number | null
  /** Relativa a la carpeta de música, con "/". */
  rel: string | null
  abs: string | null
  /** false = la de fábrica («Acapellas e instrumentales (PAILA)»). */
  chosen: boolean
  available: boolean
  error: string | null
}

/** Un tema, como lo muestra la sección. */
export interface StemsTema {
  id: number
  /** «Artista - Título», o el nombre del archivo. */
  name: string
  duration: number | null
  grade: Grade | null
  bpm: number | null
  musicKey: string | null
}

/** Un tema ya separado (una tanda del Historial). */
/** Las partes que salen: acapella e instrumental (Separar voz) o acapella, batería, bajo y resto (Separar en 4). */
export type StemsParte = 'acapella' | 'instrumental' | 'bateria' | 'bajo' | 'resto'
/** Cómo se separa un tema: en voz e instrumental, o en 4. */
export type StemsModo = 'voz' | 'cuatro' | 'max'

export interface StemsHecho {
  batch: number
  at: string
  /** El nombre del archivo original. */
  source: string
  /** Cada parte que salió (ruta completa), en el orden en que se muestran. */
  partes: Partial<Record<StemsParte, string | null>>
  available: boolean
}

export interface StemsInfo {
  modelo: { ready: boolean; bytes: number }
  /** Separar en 4 (opcional, se baja aparte): `bytes` es lo que falta bajar (el motor puede estar ya). */
  cuatro: { ready: boolean; bytes: number }
  /** Separar en 4 con máxima calidad (los cuatro especialistas, aparte). */
  max: { ready: boolean; bytes: number }
  destino: StemsDestino
  /** A dónde va lo separado en 4 partes. */
  destino4: StemsDestino
  /** Lo que espera para separarse, en orden (el primero es el que se está separando, si `actual`). */
  cola: (StemsTema & { modo: StemsModo })[]
  actual: { id: number; done: number; total: number } | null
  /** Los que esperan una versión mejor antes de separarse ("Buscar uno mejor"). */
  esperando: (StemsTema & { desde: string })[]
  hechos: StemsHecho[]
  /** Las notas de calidad desde las que se avisa que conviene conseguir uno mejor. */
  avisaEn: Grade[]
  /** Segundos de proceso por segundo de tema (para el tiempo estimado). */
  ritmo: number
}

/** Al sumar temas: los de baja calidad no entran solos (salvo "Separar igual"): se avisa y se elige. */
export interface StemsAgregado { info: StemsInfo; bajaCalidad: StemsTema[] }
