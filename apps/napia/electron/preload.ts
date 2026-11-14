// Puente entre la pantalla de NAPIA y su proceso principal: expone `window.napia` (el contrato está en @paila/shared/napia).
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { NapiaApi, RunStatus, TandaEstado } from '@paila/shared/napia'

const api: NapiaApi = {
  info: () => ipcRenderer.invoke('napia:info'),
  chooseExe: () => ipcRenderer.invoke('napia:chooseExe'),
  openConfig: () => ipcRenderer.invoke('napia:openConfig'),
  openSockseekPage: () => ipcRenderer.invoke('napia:openSockseekPage'),
  openList: (p) => ipcRenderer.invoke('napia:openList', p),
  parseText: (text, name) => ipcRenderer.invoke('napia:parseText', text, name),
  initialList: () => ipcRenderer.invoke('napia:initialList'),
  buscarDisco: (artista, titulo) => ipcRenderer.invoke('napia:buscarDisco', artista, titulo),
  temasDisco: (e) => ipcRenderer.invoke('napia:temasDisco', e),
  estilo: () => ipcRenderer.invoke('napia:estilo'),
  onEstilo: (cb) => {
    const fn = (_e: unknown, e: 'actual' | 'historieta') => cb(e)
    ipcRenderer.on('napia:estilo', fn)
    return () => { ipcRenderer.removeListener('napia:estilo', fn) }
  },
  notaCapturar: () => ipcRenderer.invoke('notas:capturar'),
  notaGuardar: (n) => ipcRenderer.invoke('notas:guardar', n),
  destino: () => ipcRenderer.invoke('napia:destino'),
  chooseDestino: (reset) => ipcRenderer.invoke('napia:chooseDestino', reset),
  confirmDestino: () => ipcRenderer.invoke('napia:confirmDestino'),
  options: () => ipcRenderer.invoke('napia:options'),
  setOptions: (o) => ipcRenderer.invoke('napia:setOptions', o),
  previous: (name) => ipcRenderer.invoke('napia:previous', name),
  yaTenes: (list) => ipcRenderer.invoke('napia:yaTenes', list),
  tanda: () => ipcRenderer.invoke('napia:tanda'),
  onTanda: (cb) => {
    const fn = (_e: unknown, t: TandaEstado) => cb(t)
    ipcRenderer.on('napia:tanda', fn)
    return () => { ipcRenderer.removeListener('napia:tanda', fn) }
  },
  sumarATanda: (list, reintento) => ipcRenderer.invoke('napia:sumarATanda', list, reintento),
  sacarDeTanda: (id) => ipcRenderer.invoke('napia:sacarDeTanda', id),
  renombrarEnTanda: (id, name) => ipcRenderer.invoke('napia:renombrarEnTanda', id, name),
  moverEnTanda: (id, delta) => ipcRenderer.invoke('napia:moverEnTanda', id, delta),
  deNuevoEnTanda: (id) => ipcRenderer.invoke('napia:deNuevoEnTanda', id),
  limpiarTanda: () => ipcRenderer.invoke('napia:limpiarTanda'),
  start: () => ipcRenderer.invoke('napia:start'),
  cancel: (saltear) => ipcRenderer.invoke('napia:cancel', saltear),
  historial: () => ipcRenderer.invoke('napia:historial'),
  sacarDelHistorial: (id) => ipcRenderer.invoke('napia:sacarDelHistorial', id),
  variantes: (temas) => ipcRenderer.invoke('napia:variantes', temas),
  verEnPaila: (folder, tema) => ipcRenderer.invoke('napia:verEnPaila', folder, tema),
  status: () => ipcRenderer.invoke('napia:status'),
  onStatus: (cb) => {
    const fn = (_e: unknown, s: RunStatus) => cb(s)
    ipcRenderer.on('napia:status', fn)
    return () => { ipcRenderer.removeListener('napia:status', fn) }
  },
  openFolder: (p) => ipcRenderer.invoke('napia:openFolder', p),
  saveMissing: (temas, nombre) => ipcRenderer.invoke('napia:saveMissing', temas, nombre),
  openPaila: () => ipcRenderer.invoke('napia:openPaila'),
  puerto: (probar) => ipcRenderer.invoke('napia:puerto', probar),
  openRouter: () => ipcRenderer.invoke('napia:openRouter'),
  firewall: () => ipcRenderer.invoke('napia:firewall'),
  arreglarFirewall: () => ipcRenderer.invoke('napia:arreglarFirewall'),
  abrirWindows: (que) => ipcRenderer.invoke('napia:abrirWindows', que),
  pathForFile: (f) => webUtils.getPathForFile(f),
}

contextBridge.exposeInMainWorld('napia', api)
// el idioma (el de PAILA), antes de que corra la pantalla: @paila/shared/idioma lo lee de acá
contextBridge.exposeInMainWorld('pailaIdioma', ipcRenderer.sendSync('napia:idioma'))
// Una lista que llegó con NAPIA ya abierto (otra vez "Abrir con NAPIA"): la pantalla la lee con openList.
ipcRenderer.on('napia:list', (_e, f: string) => window.dispatchEvent(new CustomEvent('napia:list', { detail: f })))
