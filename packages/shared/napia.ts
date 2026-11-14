// El contrato de NAPIA (el panel de control para sockseek): lo que se pasan el proceso principal y la interfaz.
// NAPIA no baja nada: arma la lista, corre sockseek y muestra el avance. La cuenta de Soulseek queda en la config de sockseek.

import type { CopiaTuya, CuentaCalidad, RevisionCalidad } from './napia-calidad'
import type { NotaDeUso, NotaNueva } from './types'
export * from './napia-calidad'
export * from './napia-disco'
import type { DiscoNapiaApi, DiscoPedido, IntentoCarpeta } from './napia-disco'

/** Cómo está sockseek en esta compu. Nunca trae la cuenta: solo si está puesta. */
export interface SockseekInfo {
  /** Dónde está sockseek.exe, o null si no se encontró. */
  exe: string | null
  /** De dónde salió: elegido a mano, la carpeta de programas, el PATH… */
  exeFrom: string | null
  version: string | null
  /** Es el sockseek con freno de NAPIA (no traba el router al buscar; ver apps/napia/sockseek-freno). */
  freno: boolean
  /** El archivo de configuración que va a usar sockseek (null: no hay ninguno). */
  config: string | null
  /** Dónde se crearía si no hay (la carpeta de sockseek en AppData). */
  configDefault: string
  hasUser: boolean
  hasPass: boolean
  /** La carpeta de destino que dice la config (output-dir), si tiene. */
  outputDir: string | null
  /** La config tiene acciones al terminar (on-complete): por ejemplo mover lo bajado a otra carpeta. */
  onComplete: boolean
  /** Carpetas que aparecen en esas acciones (adonde probablemente mueve lo bajado). */
  moveTo: string[]
  /** El puerto de escucha que dice la config (listen-port), si dice. */
  listenPort: number | null
  /** SoulseekQt está abierto: con la misma cuenta, sockseek no puede entrar. */
  soulseekQtOpen: boolean
}

export type Calidad = 'cualquiera' | 'buena' | 'sinperdida'

export interface NapiaOptions {
  calidad: Calidad
  /** Sacar "- 2011 Remaster" y parecidos de los títulos antes de buscar. */
  sacarRemaster: boolean
  /** Solo los primeros N (para probar). null = todos. */
  primeros: number | null
  /** No bajar los temas que ya están en la biblioteca de PAILA en buena calidad (lo que tenés en mala calidad se baja para reemplazarlo). */
  saltearTenes: boolean
  /** Que lo bajado llegue con el nombre del archivo y los tags (artista y título) como en la lista (core/sockseek/nombres.ts). Sin el dato: sí. */
  arreglarNombres?: boolean
}

/**
 * Qué temas de una lista ya están en PAILA en buena calidad (`tenes`, con el archivo que los tiene) y cuáles hay que bajar.
 * `mejorar`: los que tenés en mala calidad (nota C, D o F): se bajan igual, para reemplazar esa copia.
 */
export interface YaTenes {
  faltan: NapiaList['tracks']
  tenes: { artist: string; title: string; enPaila: string }[]
  mejorar: { artist: string; title: string; enPaila: string; nota: string }[]
}

export interface NapiaList {
  name: string
  /** De dónde parece venir ("CSV de Exportify", "Texto pegado"…). */
  source: string
  /** `reemplaza`: la copia que ya tenés y se quiere cambiar por una mejor (solo desde la lista «Faltan o suenan mal»). */
  /** `otraVersion`: en la lista «Faltan o suenan mal» dijiste que la copia parecida "No es" (otra versión): no se saltea aunque se parezca. */
  tracks: { artist: string; title: string; album: string | null; duration: number | null; reemplaza?: CopiaTuya | null; otraVersion?: boolean }[]
  skipped: string[]
  /** Un disco entero ("Un disco"): primero se busca la carpeta entera de una persona. */
  disco?: DiscoPedido
}

/** El disco de una carpeta: cuánto espacio queda y si es externo (puede no estar enchufado la próxima vez). */
export interface Disco {
  /** C:\, F:\ o \\servidor\carpeta. */
  raiz: string
  etiqueta: string | null
  libre: number | null
  total: number | null
  /** USB o extraíble. null si no se sabe. */
  externo: boolean | null
  red: boolean
}

/**
 * Dónde queda lo bajado: una carpeta propia de NAPIA (por defecto Música\NAPIA), con una subcarpeta por lista
 * ("<lista>", sin el día: lo nuevo de la misma lista se suma ahí). No depende de la config de sockseek. Lo que está bajando y los archivos de sockseek quedan en los
 * datos de NAPIA, nunca mezclados con la música.
 */
export interface Destino {
  folder: string
  /** Es la de siempre (Música\NAPIA), no una que elegiste. */
  porDefecto: boolean
  /** Ya dijiste que está bien (la primera vez NAPIA muestra dónde va a guardar y pregunta). */
  confirmado: boolean
  /** La carpeta que vigila la Bandeja de PAILA, si se sabe. */
  bandeja: string | null
  disco: Disco | null
}

export type TrackState = 'espera' | 'buscando' | 'bajando' | 'bajado' | 'yaEstaba' | 'noEncontrado' | 'fallo' | 'cancelado'

export interface TrackProgress {
  artist: string
  title: string
  state: TrackState
  /** 0–100 mientras baja. */
  percent: number | null
  /** Por qué no se pudo, en castellano. */
  detail: string | null
  /** Dónde quedó (bajado o ya estaba). */
  path: string | null
  /** mp3, flac… y kbps si se saben. */
  format: string | null
  /** De qué usuario de Soulseek se bajó (para pedirle a sockseek otra fuente si era trucho). */
  fuente?: string | null
  /** Cómo se llama el archivo en la compu de ese usuario (con su carpeta): con ese nombre queda el pedazo a medio bajar. */
  archivo?: string | null
  /** Mientras baja: cuánto lleva y cuánto pesa, en bytes (para cortar una fuente muy lenta: core/sockseek/lentitud.ts). */
  bytes?: number | null
  total?: number | null
  /** La calidad real, revisada apenas terminó de bajar (core/sockseek/calidad.ts). null: no se revisó (o no hacía falta). */
  calidad?: RevisionCalidad | null
}

export type ProblemKind = 'sinCuenta' | 'claveMal' | 'login' | 'echado' | 'pausaBusquedas' | 'noArranco' | 'noConecta' | 'routerTrabado'

import type { FirewallApi, FirewallDiag } from './firewall-tipos'
export type { CasoFirewall, FirewallApi, FirewallDiag, PerfilRed, ResultadoArreglo } from './firewall-tipos'
/**
 * El puerto por el que los demás usuarios de Soulseek se conectan con sockseek. Cerrado igual se baja (sockseek los llama a
 * ellos); abierto, se conecta con más gente. NAPIA le pide al router que lo abra (UPnP o NAT-PMP) mientras sockseek baja, y
 * lo cierra al terminar.
 */
export interface PuertoInfo {
  port: number
  /** De dónde sale el número: la config de sockseek o el que usa sockseek si no dice nada. */
  desde: 'config' | 'sockseek'
  /** Lo que contestó el router. null: todavía no se probó (o se está probando). */
  router: null
    | { ok: true; via: 'upnp' | 'natpmp'; nombre: string | null; confirmado: boolean; dobleNat: boolean; externalIp: string | null }
    | { ok: false; motivo: 'sinRouter' | 'ocupado' | 'rechazado'; detalle: string; nombre: string | null }
  /** La prueba desde internet (la del servidor de Soulseek). Solo se puede mientras sockseek está abierto. */
  afuera: 'abierto' | 'cerrado' | null
  /** El firewall de Windows para sockseek en la red de ahora (null: no se sabe todavía, u otro sistema). */
  firewall: FirewallDiag | null
  /** El router (puerta de enlace) y la IP de esta compu en la red de la casa, para abrirlo a mano. */
  gateway: string | null
  ipLocal: string | null
  probando: boolean
}

export interface RunStatus {
  running: boolean
  /** La lista de la tanda que está bajando (o la última que bajó). */
  tandaId: string | null
  listName: string | null
  folder: string | null
  tracks: TrackProgress[]
  counts: Record<TrackState, number>
  /** Cortes con otros usuarios: normales, sockseek prueba con otro. */
  peerErrors: number
  problem: { kind: ProblemKind; text: string } | null
  /** Cómo está el puerto en esta corrida (null antes de la primera). */
  puerto: PuertoInfo | null
  /** Terminó (bien, cancelado o con un problema). */
  finished: null | { at: string; cancelled: boolean; exitCode: number | null }
  /** Las últimas líneas de sockseek, tal cual (para "Ver detalle"). */
  log: string[]
  /** La revisión de la calidad real (null antes de la primera). */
  calidad: CuentaCalidad | null
}

/** Lo que dice el `_index.csv` de una lista que ya se bajó antes. */
export interface IndexSummary {
  file: string
  bajados: number
  noEncontrados: number
  pendientes: number
  /** Archivos .incomplete: quedaron a medio bajar. */
  aMedias: number
}

// ---------- bajar en tanda, historial y reintento ----------

/** Cómo está cada lista de la tanda. "frenada": terminó con un problema que frena las que siguen (la cuenta, el router…). */
export type EstadoTanda = 'espera' | 'bajando' | 'terminada' | 'cortada' | 'frenada'

/** Cuántos de cada cosa al terminar una lista. */
export interface ResumenLista {
  total: number
  bajados: number
  /** Ya se habían bajado antes con esta misma lista (sockseek los saltea). */
  yaEstaban: number
  noEncontrados: number
  noSePudieron: number
  /** Cortados o que no llegaron a terminar. */
  sinTerminar: number
  /** Ya estaban en PAILA y ni se buscaron. */
  yaEnPaila: number
  /** Llegaron truchos (calidad falsa): cuántos, cuántos se reemplazaron por otra fuente y cuántos solo estaban así. */
  descartados?: number
  reemplazados?: number
  soloFalsa?: number
  /** Venían a reemplazar una copia tuya y no apareció una mejor. */
  sinMejor?: number
}

export interface TandaItem {
  id: string
  list: NapiaList
  estado: EstadoTanda
  /** Cuántos temas se van a buscar (sin lo que ya está en PAILA ni repetidos). null: no se sabe todavía. */
  aBajar: number | null
  /** Es un reintento de lo que no se encontró, con otra búsqueda (va a la misma carpeta de la lista). */
  reintento: boolean
  resumen: ResumenLista | null
  /** Dónde quedaron sus temas (la carpeta de la lista). */
  folder: string | null
  /** Por qué se frenó, en castellano. */
  problema: string | null
  /** Un disco: cómo salió el intento de la carpeta entera (después se baja tema por tema lo que falta). */
  carpeta?: IntentoCarpeta | null
}

export interface TandaEstado {
  items: TandaItem[]
  /** La tanda se paró (un problema o la cortaste): las que faltan siguen en espera hasta que aprietes "Seguir". */
  frenada: { motivo: string } | null
}

/** Por qué no llegó un tema: nadie lo tiene, no se pudo bajar, solo se encontró en calidad falsa o no apareció uno mejor que el tuyo. */
export type EstadoFalta = 'noEncontrado' | 'fallo' | 'soloFalsa' | 'sinMejor'

/** Una lista que se bajó: lo que guarda el historial de NAPIA (historial.json en su carpeta de datos). */
export interface EntradaHistorial {
  id: string
  /** La lista de la tanda de la que salió (una misma lista puede bajarse varias veces: "Otra vez"). */
  tandaId: string
  lista: string
  reintento: boolean
  inicio: string
  fin: string
  carpeta: string | null
  total: number
  bajados: number
  yaEstaban: number
  yaEnPaila: number
  noEncontrados: number
  noSePudieron: number
  sinTerminar: number
  /** Calidad falsa (las entradas de antes del 24/10/2026 no lo tienen). */
  descartados?: number
  reemplazados?: number
  soloFalsa?: number
  sinMejor?: number
  cortada: boolean
  problema: string | null
  /** Lo que no llegó (para reintentar con otra búsqueda). */
  faltan: { artist: string; title: string; estado: EstadoFalta; detalle: string | null }[]
  llegaron: { artist: string; title: string; path: string | null }[]
}

export interface Busqueda { artist: string; title: string }
export type TipoVariante = 'limpia' | 'principal' | 'original'
/** Otra forma de buscar un tema que no se encontró (core/sockseek/reintento.ts). */
export interface Variante extends Busqueda {
  tipo: TipoVariante
  /** Cómo se llama esta forma de buscar ("Sin agregados"). */
  etiqueta: string
  /** Qué cambió respecto de la búsqueda de antes, en palabras ("Sin «feat. Snow»"). */
  cambios: string[]
}

export interface NapiaApi extends FirewallApi, DiscoNapiaApi {
  /** "Anotar": saca la captura de la ventana (antes de abrir la cajita) y guarda la nota en las notas de uso de PAILA. */
  notaCapturar: () => Promise<void>
  notaGuardar: (n: NotaNueva) => Promise<NotaDeUso>
  info: (refresh?: boolean) => Promise<SockseekInfo>
  chooseExe: () => Promise<SockseekInfo>
  openConfig: () => Promise<string | null>
  openSockseekPage: () => Promise<void>
  /** Elegir un archivo de lista (o leer el que se soltó en la ventana). */
  openList: (path?: string) => Promise<NapiaList | null>
  parseText: (text: string, name: string) => Promise<NapiaList>
  /** La lista que llegó al abrir NAPIA con un archivo (por ejemplo desde PAILA). */
  initialList: () => Promise<NapiaList | null>
  /** El estilo que eligió PAILA (null si no hay PAILA o no eligió): NAPIA se ve igual. */
  estilo: () => Promise<'actual' | 'historieta' | null>
  /** Avisa cuando el estilo cambia en PAILA con NAPIA abierta. Devuelve con qué dejar de escuchar. */
  onEstilo: (cb: (e: 'actual' | 'historieta') => void) => () => void
  destino: () => Promise<Destino>
  /** Elegir otra carpeta (queda confirmada) o, con `reset`, volver a Música\NAPIA. */
  chooseDestino: (reset?: boolean) => Promise<Destino>
  /** "Sí, guardar acá": confirma la carpeta que se muestra (la primera vez). */
  confirmDestino: () => Promise<Destino>
  options: () => Promise<NapiaOptions>
  setOptions: (o: NapiaOptions) => Promise<NapiaOptions>
  /** Lo que ya se bajó antes de esta misma lista (su `_index.csv`). */
  previous: (name: string) => Promise<IndexSummary | null>
  /** Cuáles de los temas de la lista ya están en PAILA (según las opciones: si no saltea, ninguno). */
  yaTenes: (list: NapiaList) => Promise<YaTenes>
  /** La tanda: las listas para bajar una detrás de otra. */
  tanda: () => Promise<TandaEstado>
  onTanda: (cb: (t: TandaEstado) => void) => () => void
  /** Suma una lista al final de la tanda (también mientras baja otra). */
  sumarATanda: (list: NapiaList, reintento?: boolean) => Promise<TandaEstado>
  sacarDeTanda: (id: string) => Promise<TandaEstado>
  renombrarEnTanda: (id: string, name: string) => Promise<TandaEstado>
  moverEnTanda: (id: string, delta: number) => Promise<TandaEstado>
  /** Vuelve a poner en espera una lista que ya terminó. */
  deNuevoEnTanda: (id: string) => Promise<TandaEstado>
  /** Saca de la vista las que ya terminaron. */
  limpiarTanda: () => Promise<TandaEstado>
  /** Baja las listas en espera, una detrás de otra (si la tanda estaba frenada, sigue). */
  start: () => Promise<RunStatus>
  /** Corta. Con `saltear`, corta solo la lista actual y sigue con la próxima. */
  cancel: (saltear?: boolean) => Promise<RunStatus>
  historial: () => Promise<EntradaHistorial[]>
  sacarDelHistorial: (id: string) => Promise<EntradaHistorial[]>
  /** Otras formas de buscar cada tema (en el mismo orden). */
  variantes: (temas: Busqueda[]) => Promise<Variante[][]>
  /** Abre PAILA en su Bandeja, mostrando lo que llegó a esa carpeta. */
  verEnPaila: (folder: string, tema?: string) => Promise<'abierto' | 'noEsta'>
  status: () => Promise<RunStatus>
  onStatus: (cb: (s: RunStatus) => void) => () => void
  openFolder: (path: string) => Promise<void>
  /** Guarda lo que no se encontró como lista de texto, para probar más tarde o buscarlo por otro lado. */
  saveMissing: (temas?: Busqueda[], nombre?: string) => Promise<string | null>
  openPaila: () => Promise<'abierto' | 'yaAbierto' | 'noEsta'>
  /** Cómo está el puerto; con `probar`, le pide al router que lo abra un momento (y lo vuelve a cerrar) para ver si puede. */
  puerto: (probar?: boolean) => Promise<PuertoInfo>
  /** Abre en el navegador la página del router (la puerta de enlace que encontró NAPIA). */
  openRouter: () => Promise<void>
  pathForFile: (f: File) => string
}
