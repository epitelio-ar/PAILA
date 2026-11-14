// Los pedidos de la interfaz para traer tus playlists de Rekordbox o de un pendrive (core/listimport.ts) y para la tabla (A Excel
// y vistas guardadas, core/views.ts y shared/tablecsv.ts). Aparte de api.ts para que no crezca: PailaApi los extiende.
import type { SavedView } from './library'
import type { ImportItem, ImportPreview, ImportResult, ImportSourceKind, RequestDecision, RequestDetail, RequestItem, RequestPreview } from './requests'
import type { SortKey } from '../trackinfo'

export interface TablaApi {
  /** Los temas a la vista, en su orden, a un .csv para Excel con esas columnas. null = se canceló. */
  tableCsv(ids: number[], columns: { key: SortKey; label: string }[], name: string): Promise<{ path: string; count: number } | null>
  /** Vistas guardadas de la tabla (filtros, orden y columnas con un nombre). */
  views(): Promise<SavedView[]>
  /** Guarda (o, con el mismo nombre, reemplaza) una vista. Devuelve todas. */
  saveView(v: Omit<SavedView, 'id'>): Promise<SavedView[]>
  renameView(id: string, name: string): Promise<SavedView[]>
  removeView(id: string): Promise<SavedView[]>
}

export interface TraerApi {
  /** Traer una lista otra vez (core/requests-update.ts): suma lo nuevo y lo que ahora sí tenés a ese pedido y su playlist, sin armar «(2)». */
  updateRequest(id: number, items: RequestItem[]): Promise<{ detail: RequestDetail; added: number; found: number }>
  /** La lista ya traída con ese nombre (al escribirlo en la vista previa), o null. */
  requestNamed(name: string): Promise<RequestPreview['existing']>
  /** Los pendrives o discos conectados que tienen un export de Rekordbox (PIONEER/rekordbox/export.pdb). */
  importPendrives(): Promise<{ root: string; label: string }[]>
  /** Elegir el rekordbox.xml o el pendrive (`folder`: uno de los conectados) y emparejarlo con la biblioteca. null = se canceló. */
  importPick(kind: ImportSourceKind, folder?: string): Promise<ImportPreview | null>
  /** Buscar por la huella del sonido los temas que no aparecieron y cuyo archivo está en esta compu. */
  importPrints(token: string): Promise<ImportPreview>
  /** La vista previa con lo que confirmaste (clave del tema → sí / no). */
  importSummary(token: string, decisions: Record<string, RequestDecision | null>): Promise<ImportPreview>
  importItems(token: string, key: string): Promise<ImportItem[]>
  /** Crea las playlists elegidas (y, del pendrive, recupera grilla y cues si `withDj`; `lowToWanted`: los de mala calidad también a la lista «Faltan o suenan mal»). */
  importCreate(token: string, keys: string[], decisions: Record<string, RequestDecision | null>, withDj: boolean, lowToWanted: boolean): Promise<ImportResult>
  /** `--rekordbox=<rekordbox.xml>`: el XML pedido al abrir (una sola vez), para "Traer tus playlists". */
  rekordboxPedido(): Promise<string | null>
}
