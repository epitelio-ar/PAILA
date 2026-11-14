// Los pedidos del estado de la colección para el puente (preload.ts). Aparte para que preload.ts no crezca.
import type { IpcRenderer } from 'electron'
import type { EstadoApi } from '@paila/shared/types'

export const estadoPreload = (ipc: IpcRenderer): EstadoApi => ({
  estado: () => ipc.invoke('estado:leer'),
  dejarComoEsta: (grupo, ids, si) => ipc.invoke('estado:dejar', grupo, ids, si),
  estadoRegla: (o) => ipc.invoke('estado:regla', o),
  onEstado: (cb) => { const l = () => cb(); ipc.on('estado:cambio', l); return () => { ipc.removeListener('estado:cambio', l) } },
})
