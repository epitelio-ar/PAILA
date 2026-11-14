// Motor de operaciones único (docs/diseno/motor-operaciones.md): una operación es un plan de pasos, y cada paso es de un
// tipo que dice dónde puede haber quedado el archivo si se corta en el medio (eso usa la recuperación).
import type { JournalOp } from '../journal'

/**
 * mover: un archivo de la biblioteca cambia de lugar (organizar, papelera, restaurar, limpieza, deshacer).
 * escribir: se reescribe en su lugar (tags, tapa, volumen; puede cambiar el nombre o la extensión).
 * reemplazar: el archivo de hoy va a la papelera y entra otro (reemplazo, conversión, WAV→FLAC).
 * borrar: borrado real, solo dentro de _PAILA/papelera (vaciar).
 * sacar: un archivo de afuera de la biblioteca se mueve (Bandeja → usados/ o no-sirvió/; lo sacado de un comprimido, de la
 *   carpeta de trabajo a su lugar, o a la papelera al deshacer). Rutas completas.
 * copiar: se escribe algo afuera de tu Música sin tocarla (pendrive, celular, los archivos de Traktor, Serato, VirtualDJ y
 *   Rekordbox, listas .m3u8). `src` es el tema (relativo a su carpeta de música) o null si se arma de cero; `dst`, una ruta
 *   completa. Siempre pasa por una copia temporal al lado (core/ops/copy.ts).
 */
export type StepKind = 'mover' | 'escribir' | 'reemplazar' | 'borrar' | 'sacar' | 'copiar'

/** Qué tipo de paso es cada operación del diario (también para las anotaciones que dejó una versión anterior de PAILA). */
export const OP_KIND: Record<JournalOp, StepKind> = {
  organizar: 'mover', 'deshacer-organizar': 'mover', limpieza: 'mover', papelera: 'mover', restaurar: 'mover',
  tags: 'escribir', 'deshacer-tags': 'escribir',
  reemplazo: 'reemplazar', 'deshacer-reemplazo': 'reemplazar',
  vaciar: 'borrar',
  bandeja: 'sacar', abrir: 'sacar', 'deshacer-abrir': 'sacar', 'zip-papelera': 'sacar', 'zip-restaurar': 'sacar', separar: 'sacar', 'deshacer-separar': 'sacar',
  copia: 'copiar',
}

export interface Step<D = unknown> {
  kind: StepKind
  op: JournalOp
  /** null = fuera de la biblioteca (Bandeja): `src` y `dst` son rutas completas. */
  rootId: number | null
  fileId: number | null
  /** Relativas a la carpeta de música (con "/"), o completas si `rootId` es null. En 'copiar', `dst` es siempre completa. */
  src: string
  dst: string | null
  /** Lo que guarda el diario y necesita `annotate` (lo mismo que guardaba cada módulo antes del motor). */
  data: D
  /** Cómo estaba el archivo cuando se armó la vista previa: si cambió, el paso se saltea. */
  size?: number
  mtime?: number
  /** Espacio libre que hace falta en el disco de destino (una copia; mover dentro del mismo disco no suma). */
  bytes?: number
  /** Textos propios de cada operación cuando falta el origen o el destino está ocupado. */
  missing?: string
  taken?: string
}

export interface StepFailure<D = unknown> { step: Step<D>; error: string }

export interface RunResult<D = unknown> {
  done: Step<D>[]
  /** No se tocaron: los sacaron los chequeos previos o fallaron (con el motivo). */
  failed: StepFailure<D>[]
  cancelled: boolean
}
