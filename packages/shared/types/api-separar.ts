// Los pedidos de la interfaz para Separar voz (core/stems; apps/paila/electron/ipc/separar.ts). Aparte de api.ts para que no crezca.
import type { StemsAgregado, StemsInfo, StemsModo, StemsTema } from './separar'

export interface SepararApi {
  stemsInfo(): Promise<StemsInfo>
  /** Baja el modelo y onnxruntime-node (proceso 'separar-modelo'), verificados por huella; 'cuatro', el de separar en 4. */
  stemsDownload(cual?: StemsModo): Promise<StemsInfo>
  /** Sin nada (o 'voz') saca todo; 'cuatro', solo el modelo de 4. */
  stemsRemove(cual?: StemsModo): Promise<StemsInfo>
  /** Temas que coinciden con lo que se escribe (artista, título o nombre del archivo). */
  stemsSearch(q: string): Promise<StemsTema[]>
  /** Suma temas a la cola (proceso 'separar'). Sin `igual`, los de baja calidad vuelven en `bajaCalidad` sin sumarse. */
  stemsAdd(ids: number[], igual: boolean, modo?: StemsModo): Promise<StemsAgregado>
  /** "Buscar uno mejor": a la lista «Faltan o suenan mal», y quedan esperando en la sección. */
  stemsWait(ids: number[]): Promise<StemsInfo>
  /** Saca un tema de la cola o de los que esperan. */
  stemsDrop(id: number): Promise<StemsInfo>
  stemsPickFolder(): Promise<StemsInfo>
  stemsResetFolder(): Promise<StemsInfo>
  /** Para escuchar un archivo separado: la dirección paila:// que lo sirve. */
  stemsPlay(file: string): Promise<string>
  /** Mostrar el archivo en su carpeta. */
  stemsShow(file: string): Promise<void>
  onStems(cb: (info: StemsInfo) => void): () => void
}
