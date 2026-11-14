// Los pedidos de la interfaz para recortar silencios (core/trim.ts). Aparte de api.ts para que no crezca.
import type { TrimPlan } from './trim'
import type { PendingChange } from './tags'

export interface RecortarApi {
  /** Busca dónde cortar (lee cada tema con el aviso de silencio largo, entero). Corre como proceso 'recortar'. */
  trimPlan(): Promise<TrimPlan>
  /** La última búsqueda (si se cambió de pantalla mientras buscaba), o null. */
  trimLast(): Promise<TrimPlan | null>
  /** Pasa a Cambios pendientes los recortes elegidos de la última búsqueda. */
  trimStage(fileIds: number[]): Promise<PendingChange[]>
}
