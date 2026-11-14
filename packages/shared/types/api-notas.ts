// Los pedidos de la interfaz para las Notas de uso (core/notasdeuso.ts; apps/paila/electron/ipc/notas.ts). Aparte de api.ts para que no crezca.

/** Una nota que el autor (o quien use PAILA) dejó en el momento: qué le resultó raro, en qué pantalla estaba y qué venía haciendo. */
export interface NotaDeUso {
  /** ISO con hora local, por ejemplo 2026-10-24T18:03:41. */
  hora: string
  /** La pantalla donde estaba (el nombre que ve en la barra lateral). */
  pantalla: string
  /** Las pantallas por las que pasó antes, hasta 5, la más vieja primero. */
  acciones: string[]
  texto: string
  /** Nombre del PNG de la captura (en la misma carpeta), si se pudo sacar. */
  captura: string | null
}

export type NotaNueva = Pick<NotaDeUso, 'pantalla' | 'acciones' | 'texto'>

export interface NotasApi {
  /** Saca la captura de la ventana (antes de abrir la cajita, para que no salga tapada). Queda en el proceso principal hasta guardar. */
  notaCapturar(): Promise<void>
  /** Escribe la nota y la captura en la carpeta de datos. Nada sale de la PC. */
  notaGuardar(n: NotaNueva): Promise<NotaDeUso>
  /** Las notas guardadas, la más nueva primero. */
  notasLista(): Promise<NotaDeUso[]>
  /** Abre un pedido ya escrito (nota, pantalla y versión; nada más) en GitHub. No manda nada solo. */
  notaMandar(hora: string, via: 'github' | 'mail'): Promise<void>
  notasAbrirCarpeta(): Promise<void>
}
