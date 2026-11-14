// El Chequeo (Configuración → Chequeo): lo que le puede impedir andar a PAILA, control por control, con ✓ / ⚠ y su arreglo.
// Lo arma core/chequeo.ts; los mismos controles salen solos como aviso cuando algo falla al usarse (un disco lleno, una clave).
import type { FirewallDiag, ResultadoArreglo } from '../napia'

export type ControlId = 'programas' | 'carpetas' | 'datos' | 'espacio' | 'clave-discogs' | 'clave-acoustid' | 'clave-lastfm'
  | 'musicbrainz' | 'base' | 'napia-firewall' | 'napia-puerto'

/** ok · info (no es un problema, pero se puede mejorar) · atencion · mal · nose (no se pudo probar). */
export type EstadoControl = 'ok' | 'info' | 'atencion' | 'mal' | 'nose'

export type ArregloControl =
  /** Ir a una pantalla de PAILA (y a una parte de Configuración). */
  | { tipo: 'ir'; etiqueta: string; pagina: 'space' | 'trash' | 'settings'; seccion?: string }
  /** El arreglo del firewall, con el permiso de Windows (lo mismo que "Arreglarlo" en NAPIA). */
  | { tipo: 'firewall'; etiqueta: string }
  /** Abrir una pantalla de Windows (el tipo de red o el firewall): lo decide la persona. */
  | { tipo: 'windows'; etiqueta: string; que: 'red' | 'firewall' }
  /** Probar este control de nuevo. */
  | { tipo: 'repetir'; etiqueta: string }

export interface Control {
  id: ControlId
  estado: EstadoControl
  /** Qué se mira ("ffmpeg y ffprobe"). */
  titulo: string
  /** Qué ⓘ va al lado del título. */
  tip: string
  /** Cómo está, en una línea. */
  resumen: string
  /** Por qué y qué consecuencia tiene, en párrafos (pueden llevar **negrita** y {info} / {perfil} / {bloquearTodo}: los ⓘ del firewall). */
  detalle: string[]
  arreglos: ArregloControl[]
  /** Qué hacen los arreglos, en una línea. */
  nota: string | null
  /** Para hacerlo a mano si el botón no pudo (el comando del firewall). */
  aMano?: string | null
}

export interface ChequeoApi {
  /** Corre todos los controles (va mandando cada uno por `onChequeoControl` a medida que termina). */
  chequeo(): Promise<Control[]>
  /** Uno solo, de nuevo. null si ya no corresponde (por ejemplo, NAPIA no está). */
  chequeoUno(id: ControlId): Promise<Control | null>
  /** "Arreglarlo" del firewall de NAPIA, con el permiso de Windows. */
  chequeoArreglarFirewall(): Promise<{ resultado: ResultadoArreglo; control: Control | null; firewall: FirewallDiag | null }>
  chequeoAbrirWindows(que: 'red' | 'firewall'): Promise<void>
  onChequeoControl(cb: (c: Control) => void): () => void
  /** Algo falló al usarse (un disco lleno, una clave rechazada…): el control con su arreglo, para avisarlo sin abrir el Chequeo. */
  onChequeoAviso(cb: (c: Control) => void): () => void
}
