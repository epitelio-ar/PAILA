// Los pedidos del deshacer encadenado y de "Volver a como estaba" (MASTERPLAN-5, etapa 4; core/history-cadena.ts). Aparte para que
// api.ts no crezca. Deshacer una sola tanda sigue siendo `historyUndo` (api.ts): si tiene cadena, no se hace y lo dice.
import type { HistoryKind, HistoryPunto, HistoryUndoResult } from './history'

export interface HistorialApi {
  /** Deshace la tanda y antes lo que vino después y la toca (su `cadena`), de lo más nuevo a lo más viejo, de una. */
  historyUndoCadena(kind: HistoryKind, id: number): Promise<HistoryUndoResult>
  /** Los puntos de "Volver a como estaba": uno por cada Aplicar, con todo lo que deshace. */
  historyPuntos(): Promise<HistoryPunto[]>
  /** Vuelve a como estaba antes de ese Aplicar: lo deshace a él y todo lo que tocó archivos después. */
  historyVolver(tanda: number): Promise<HistoryUndoResult>
}
