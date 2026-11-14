// Los pedidos del Aplicar único para el puente (preload.ts; ipc/aplicar.ts). Aparte para que preload.ts no crezca.
import type { IpcRenderer } from 'electron'
import type { AplicarApi } from '@paila/shared/types'

export const aplicarPreload = (ipc: IpcRenderer): AplicarApi => ({
  repetidosUltimo: () => ipc.invoke('dup:ultimo'),
  sumarRepetidos: (items, grupo) => ipc.invoke('propuestas:repetidos', items, grupo),
  sumarMover: (o, conChoques) => ipc.invoke('propuestas:mover', o, conChoques),
  sacarPropuestas: (tipo, fileIds) => ipc.invoke('propuestas:sacar', tipo, fileIds),
})
