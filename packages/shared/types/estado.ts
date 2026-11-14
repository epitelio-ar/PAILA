// "El estado de la colección" (MASTERPLAN-5, 3.1 y etapa 1): cuánto falta en cada parte, contado de la música y no de marcas.
// Lo calcula el núcleo (core/estado.ts) desde la base; el Inicio y las pestañas lo leen por un solo pedido.
import type { OrganizeOptions } from './cleanup'

/** Las partes, en el orden en que conviene hacerlas (los repetidos primero: no se arregla lo que se va a tirar). */
export type GrupoEstado = 'repetidos' | 'internet' | 'nombres' | 'tapas' | 'carpetas' | 'sonido'
export const GRUPOS_ESTADO: readonly GrupoEstado[] = ['repetidos', 'internet', 'nombres', 'tapas', 'carpetas', 'sonido']

/** Un renglón de "Ver cuáles": un tema (o un disco entero, en tapas) con lo que se muestra. */
export interface FilaEstado { ids: number[]; texto: string; detalle?: string }

export interface GrupoCuenta {
  /** Cuántos temas faltan (discos, en tapas). 0 = hecho. null = todavía no se puede saber (`espera` dice por qué). */
  n: number | null
  /** Los primeros que faltan (hasta 300), para "Ver cuáles" y "Dejar como está". */
  filas: FilaEstado[]
  /** Los que la persona dejó como están: no cuentan ni vuelven a aparecer. */
  dejados: number
  /** Por qué no hay número: PAILA sigue escuchando la música, lo está calculando, o no se pudo contar (`error` dice qué pasó). */
  espera?: 'escuchando' | 'calculando' | 'error'
  error?: string
  /**
   * Lo que se cuenta aparte, según la parte: repetidos = grupos que se parecen solo por el nombre (para decidir vos); tapas = discos
   * sin revisar (de `n`); carpetas = temas que solo cambiarían de nombre (de `n`).
   */
  aparte?: number
}

export interface EstadoColeccion {
  total: number
  /** Temas que PAILA ya escuchó (tienen su nota). */
  escuchados: number
  /** Hay datos para decir cómo suena la música: 50 temas escuchados o el 10 %. Antes no hay veredicto. */
  hayVeredicto: boolean
  grupos: Record<GrupoEstado, GrupoCuenta>
  /** La regla con que se cuenta "fuera de su carpeta": la última que aplicaste en Organizar, o la de fábrica. */
  regla: OrganizeOptions
  /** La regla está guardada en la base (si no, es la de fábrica: quien ordenó antes del 02/11 la tenía solo en la ventana). */
  reglaGuardada: boolean
}

export interface EstadoApi {
  /** Cómo está la colección ahora (sale de la base: si deshacés algo, vuelve a contar). */
  estado(): Promise<EstadoColeccion>
  /** "Dejar como está": esos temas dejan de contar en esa parte (con `si` = false, vuelven; 'todos', todos los de esa parte). Queda en la base. */
  dejarComoEsta(grupo: GrupoEstado, ids: number[] | 'todos', si?: boolean): Promise<EstadoColeccion>
  /** Guarda la regla de carpetas con que se cuenta (la que la ventana recordaba de antes del 02/11) y el estado nuevo. */
  estadoRegla(o: OrganizeOptions): Promise<EstadoColeccion>
  /** Avisa cuando el estado cambió por algo que terminó de calcularse aparte (los repetidos). Devuelve cómo dejar de escuchar. */
  onEstado(cb: () => void): () => void
}
