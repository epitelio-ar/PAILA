// Los pedidos de Ordenar, la revisión única, para el puente (preload.ts; ipc/ordenar.ts). Aparte para que preload.ts no crezca.
import type { IpcRenderer } from 'electron'
import type { OrdenarApi } from '@paila/shared/types'

export const ordenarPreload = (ipc: IpcRenderer): OrdenarApi => ({
  revision: () => ipc.invoke('ordenar:leer'),
  armarRevision: () => ipc.invoke('ordenar:armar'),
  tildarRevision: (claves, on) => ipc.invoke('ordenar:tildar', claves, on),
  decidirRevision: (clave, eleccion) => ipc.invoke('ordenar:decidir', clave, eleccion),
  carpetasRevision: (o) => ipc.invoke('ordenar:carpetas', o),
  ejemplosCarpetas: (o) => ipc.invoke('ordenar:ejemplos', o),
  decidirVarias: (lista) => ipc.invoke('ordenar:decidirVarias', lista),
  internetRevision: (si) => ipc.invoke('ordenar:internet', si),
  onRevisionLista: (cb) => { const l = () => cb(); ipc.on('ordenar:listo', l); return () => { ipc.removeListener('ordenar:listo', l) } },
})
