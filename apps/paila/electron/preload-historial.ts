// Los pedidos del deshacer encadenado y de "Volver a como estaba" para el puente (preload.ts; ipc/history.ts). Aparte para que
// preload.ts no crezca.
import type { IpcRenderer } from 'electron'
import type { HistorialApi } from '@paila/shared/types'

export const historialPreload = (ipc: IpcRenderer): HistorialApi => ({
  historyUndoCadena: (kind, id) => ipc.invoke('history:undoCadena', kind, id),
  historyPuntos: () => ipc.invoke('history:puntos'),
  historyVolver: (tanda) => ipc.invoke('history:volver', tanda),
})
