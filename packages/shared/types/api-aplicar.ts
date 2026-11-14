// Los pedidos del Aplicar único (MASTERPLAN-5, etapa 2): lo último que encontró Duplicados (guardado en la base) y sumar a la lista
// de lo que vas a aplicar las copias de más y lo que mueve Organizar. La lista, descartar y aplicar son `pendingChanges`,
// `discardChanges` y `applyChanges` (api.ts): ahí van también la papelera y mover.
import type { DupGroup, OrganizeOptions } from './cleanup'
import type { PendingChange } from './tags'

export interface AplicarApi {
  /** Lo último que encontró Duplicados, al día con la música de hoy (sin buscar de nuevo); null si nunca se buscó. */
  repetidosUltimo(): Promise<{ grupos: DupGroup[]; at: string; cambiaron: number } | null>
  /** Suma las copias de más ([tema, copia que se queda]); `grupo`: los temas de esos grupos (lo sumado antes de ellos se reemplaza). */
  sumarRepetidos(items: [number, number | null][], grupo: number[]): Promise<PendingChange[]>
  /** Suma lo que mueve Organizar con esa regla. Los que chocan con otro solo con `conChoques` (quedan con "(2)", a la vista). */
  sumarMover(o: OrganizeOptions, conChoques: boolean): Promise<PendingChange[]>
  /** Saca de la lista lo de la papelera o lo que se mueve (de esos temas, o todo): no toca ningún archivo. */
  sacarPropuestas(tipo: 'papelera' | 'mover' | 'reemplazo', fileIds?: number[]): Promise<PendingChange[]>
}
