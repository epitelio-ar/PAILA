// La revisión única, "Ordenar" (MASTERPLAN-5, 2.2 y etapa 3): todo lo que PAILA propone para la colección, en grupos, con lo
// dudoso aparte ("Para decidir vos") y un solo Aplicar. La arma y la lee core/revision.ts; la muestra la pantalla Ordenar.
import type { OrganizeOptions } from './cleanup'

/** rep = repetidos a la papelera · nom = nombres y datos · net = de internet · tap = tapas · mov = a su carpeta. */
export type GrupoRevision = 'rep' | 'nom' | 'net' | 'tap' | 'mov'
export const GRUPOS_REVISION: readonly GrupoRevision[] = ['rep', 'nom', 'net', 'tap', 'mov']

/** Un cambio de la lista. `on` = tildado (va en Aplicar); destildado sigue a la vista. */
export interface FilaRevision {
  clave: string; fileId: number; rel: string
  /** Qué cambia: el campo de tags ('artist', 'title', 'cover'…), 'papelera' o 'mover'. */
  campo: string
  antes: string | null; despues: string | null
  on: boolean
  /** Por qué no se pudo aplicar la última vez (no entra en Aplicar hasta que se resuelva). */
  error?: string
}

export interface ItemPar { id: number; rel: string; kbps: number | null; duration: number | null; grade: string | null }
/** Lo dudoso, con su pregunta: dos temas que se parecen solo por el nombre, dos que irían al mismo lugar, uno sin artista. */
export type CartaRevision =
  | { tipo: 'par'; clave: string; items: ItemPar[]; keep: number | null; porQue: string }
  | { tipo: 'choque'; clave: string; fileId: number; rel: string; conId: number | null; con: string; destino: string }
  | { tipo: 'quien'; clave: string; fileId: number; rel: string; sugerido: { artista: string; titulo: string } | null }

/**
 * La respuesta a una carta. par: 'mejor' (se queda el mejor), 'distintos' (no son repetidos) o { quedaId }. choque: 'version' (los
 * dos, con "(2)"), 'dejar' (este no se mueve) o { quedaId } (el otro a la papelera). quien: { artista, titulo } o 'dejar'.
 */
export type EleccionRevision = 'mejor' | 'distintos' | 'version' | 'dejar' | { quedaId: number } | { artista: string; titulo: string }

/** Cómo quiere las carpetas: con una regla, sin tocarlas, o todavía no se preguntó. */
export type ModoCarpetas = 'regla' | 'no-tocar' | null

export interface RevisionOrdenar {
  grupos: Record<GrupoRevision, FilaRevision[]>
  decidir: CartaRevision[]
  carpetas: ModoCarpetas
  /** La regla elegida; antes de contestar, la forma que ya tiene la música (si se ve una clara) o la de fábrica. */
  regla: OrganizeOptions
  /** Antes de contestar: la forma que ya tienen tus carpetas (core/forma-actual.ts), para proponerla como elegida. */
  formaHoy: OrganizeOptions | null
  /** Lo tildado, listo para Aplicar. */
  listos: number
  /** Temas de Rekordbox que se mueven (para avisar en "A su carpeta"). */
  enRekordbox: number
  /** Internet, una sola vez: qué contestó (null = todavía no se le preguntó) y si está buscando ahora. */
  internet: { elegido: 'si' | 'no' | null; buscando: boolean }
}

export interface OrdenarApi {
  /** La revisión como está (sin buscar nada). */
  revision(): Promise<RevisionOrdenar>
  /** PAILA vuelve a armar lo que puede proponer sola (repetidos seguros, nombres, carpetas) y la devuelve. */
  armarRevision(): Promise<RevisionOrdenar>
  /** Tildar o destildar cambios (las carpetas se recalculan solas). */
  tildarRevision(claves: string[], on: boolean): Promise<RevisionOrdenar>
  decidirRevision(clave: string, eleccion: EleccionRevision): Promise<RevisionOrdenar>
  /** Varias respuestas de una ("Quedarme con el mejor en los 25"): las carpetas se recalculan una sola vez. */
  decidirVarias(lista: [string, EleccionRevision][]): Promise<RevisionOrdenar>
  /** La regla de carpetas elegida, o null = "No tocar mis carpetas". */
  carpetasRevision(o: OrganizeOptions | null): Promise<RevisionOrdenar>
  /** Los temas que se moverían con esa forma y sirven de ejemplo (sin choques ni repetidos sin decidir). */
  ejemplosCarpetas(o: OrganizeOptions): Promise<{ fileId: number; from: string; to: string }[]>
  /** La respuesta a "¿Busco en internet lo que falta?" (se pregunta una vez). Con el sí, arranca a buscar. */
  internetRevision(si: boolean): Promise<RevisionOrdenar>
  /** Avisa cuando la lista cambió sola (internet sumó algo). Devuelve cómo dejar de escuchar. */
  onRevisionLista(cb: () => void): () => void
}
