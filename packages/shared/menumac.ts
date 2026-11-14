// El menú de arriba en Mac, para PAILA y NAPIA (en Windows no hay: la ventana no lo muestra). En Mac hace falta: sin el menú
// Edición no andan Cmd+C, Cmd+V ni Cmd+Z en los campos de texto, y sin el de la app no hay "Salir" (Cmd+Q). Puro: devuelve
// la plantilla para `Menu.buildFromTemplate` de Electron; cada programa la arma en su proceso principal, con el idioma ya puesto.
import { textos } from './idioma'

/** Un renglón del menú (lo que pide Electron, sin depender de él). */
export interface MacMenuItem { label?: string; role?: string; type?: 'separator'; accelerator?: string; click?: () => void; submenu?: MacMenuItem[] }

const T = textos({
  acercaDe: { es: (app: string) => `Acerca de ${app}`, en: (app: string) => `About ${app}` },
  servicios: { es: 'Servicios', en: 'Services' },
  ocultar: { es: (app: string) => `Ocultar ${app}`, en: (app: string) => `Hide ${app}` },
  ocultarDemas: { es: 'Ocultar los demás', en: 'Hide others' },
  mostrarTodo: { es: 'Mostrar todo', en: 'Show all' },
  salir: { es: (app: string) => `Salir de ${app}`, en: (app: string) => `Quit ${app}` },
  edicion: { es: 'Edición', en: 'Edit' },
  deshacer: { es: 'Deshacer', en: 'Undo' },
  rehacer: { es: 'Rehacer', en: 'Redo' },
  cortar: { es: 'Cortar', en: 'Cut' },
  copiar: { es: 'Copiar', en: 'Copy' },
  pegar: { es: 'Pegar', en: 'Paste' },
  todo: { es: 'Seleccionar todo', en: 'Select all' },
  ver: { es: 'Ver', en: 'View' },
  normal: { es: 'Tamaño normal', en: 'Actual size' },
  grande: { es: 'Más grande', en: 'Zoom in' },
  chico: { es: 'Más chico', en: 'Zoom out' },
  completa: { es: 'Pantalla completa', en: 'Full screen' },
  ventana: { es: 'Ventana', en: 'Window' },
  minimizar: { es: 'Minimizar', en: 'Minimize' },
  agrandar: { es: 'Agrandar', en: 'Zoom' },
  alFrente: { es: 'Traer todo al frente', en: 'Bring all to front' },
  abrirNapia: { es: 'Abrir NAPIA', en: 'Open NAPIA' },
})
/** "Abrir NAPIA", para el menú de PAILA. */
export const abrirNapiaLabel = () => T.abrirNapia

const sep: MacMenuItem = { type: 'separator' }

/**
 * `app`: el nombre del programa ("PAILA"); `otra`: el renglón para abrir el otro programa de la familia ("Abrir NAPIA"), si
 * se puede.
 */
export function macMenu(app: string, otra?: { label: string; click: () => void }): MacMenuItem[] {
  return [
    {
      label: app,
      submenu: [
        { role: 'about', label: T.acercaDe(app) },
        ...(otra ? [sep, { label: otra.label, click: otra.click }] : []),
        sep,
        { role: 'services', label: T.servicios },
        sep,
        { role: 'hide', label: T.ocultar(app) },
        { role: 'hideOthers', label: T.ocultarDemas },
        { role: 'unhide', label: T.mostrarTodo },
        sep,
        { role: 'quit', label: T.salir(app) },
      ],
    },
    {
      label: T.edicion,
      submenu: [
        { role: 'undo', label: T.deshacer },
        { role: 'redo', label: T.rehacer },
        sep,
        { role: 'cut', label: T.cortar },
        { role: 'copy', label: T.copiar },
        { role: 'paste', label: T.pegar },
        { role: 'selectAll', label: T.todo },
      ],
    },
    {
      label: T.ver,
      submenu: [
        { role: 'resetZoom', label: T.normal },
        { role: 'zoomIn', label: T.grande },
        { role: 'zoomOut', label: T.chico },
        sep,
        { role: 'togglefullscreen', label: T.completa },
      ],
    },
    {
      label: T.ventana,
      submenu: [
        { role: 'minimize', label: T.minimizar },
        { role: 'zoom', label: T.agrandar },
        sep,
        { role: 'front', label: T.alFrente },
      ],
    },
  ]
}
