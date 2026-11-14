// Los pedidos de la interfaz para los ZIP y RAR de la biblioteca (core/archives.ts y core/archive/): ver qué tienen, escuchar
// y analizar sin abrirlos enteros, y sacarlos a una carpeta al lado. Aparte de api.ts para que no crezca: PailaApi los extiende.
import type { ArchiveEntryRow, ArchiveExtractPlan, ArchiveExtractResult, ArchiveReadResult, ArchiveSummary, ArchiveTrashPlan, ArchiveTrashResult } from './archives'

export interface ArchivosApi {
  /** Los ZIP y RAR que encontró el escaneo, con lo que tienen adentro (contado). */
  archives(): Promise<ArchiveSummary[]>
  archiveEntries(id: number): Promise<ArchiveEntryRow[]>
  /** Saca solo ese tema a la caché para escucharlo: la dirección para el reproductor (paila://audio/…). */
  archivePlay(entryId: number): Promise<string>
  /** Lee tags, nota de calidad, BPM y tono de los temas (de a uno, sin abrir el comprimido entero). Proceso largo "comprimidos". */
  archiveRead(ids: number[], again?: boolean): Promise<ArchiveReadResult>
  /** Vista previa de "Sacar al lado". */
  archivePlan(id: number): Promise<ArchiveExtractPlan>
  /** Saca lo de la vista previa (va al Historial, con deshacer). Después escanea, así aparece en la biblioteca. */
  archiveExtract(plan: ArchiveExtractPlan): Promise<ArchiveExtractResult>
  /** Vista previa de "Mandar el comprimido a la papelera" (solo si todo lo de adentro ya está afuera y no es un sample pack). */
  archiveTrashPlan(id: number): Promise<ArchiveTrashPlan>
  /** Manda el comprimido a la papelera de PAILA (va al Historial, se restaura). Después escanea. */
  archiveTrash(plan: ArchiveTrashPlan): Promise<ArchiveTrashResult>
  /** Muestra el comprimido (o, con `folderRel`, esa carpeta) en el Explorador. */
  archiveShow(id: number, folderRel?: string): Promise<void>
}
