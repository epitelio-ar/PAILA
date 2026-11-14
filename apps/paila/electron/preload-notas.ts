// Los pedidos de las Notas de uso para el puente (preload.ts). Aparte para que preload.ts no crezca.
import type { IpcRenderer } from 'electron'
import type { NotasApi } from '@paila/shared/types'

export const notasPreload = (ipc: IpcRenderer): NotasApi => ({
  notaCapturar: () => ipc.invoke('notas:capturar'),
  notaGuardar: (n) => ipc.invoke('notas:guardar', n),
  notasLista: () => ipc.invoke('notas:lista'),
  notaMandar: (hora, via) => ipc.invoke('notas:mandar', hora, via),
  notasAbrirCarpeta: () => ipc.invoke('notas:carpeta'),
})
