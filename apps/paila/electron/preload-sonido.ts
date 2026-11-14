// Los pedidos de Sonido, una sola historia, para el puente (preload.ts; ipc/sonido.ts). Aparte para que preload.ts no crezca.
import type { IpcRenderer } from 'electron'
import type { EstadoNapia, SonidoApi } from '@paila/shared/types'

export const sonidoPreload = (ipc: IpcRenderer): SonidoApi => ({
  sonidoResumen: () => ipc.invoke('sonido:resumen'),
  napiaEstado: () => ipc.invoke('sonido:napia'),
  onNapiaEstado: (cb) => { const l = (_e: unknown, e: EstadoNapia | null) => cb(e); ipc.on('sonido:napia', l); return () => { ipc.removeListener('sonido:napia', l) } },
  mandarANapia: (que) => ipc.invoke('sonido:mandar', que),
  verNapia: () => ipc.invoke('sonido:verNapia'),
  tildarReemplazos: (fileIds, on) => ipc.invoke('sonido:tildar', fileIds, on),
})
