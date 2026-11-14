// Las carpetas se escanean solas al abrir PAILA (el autor, 13/11), y queda un botón chico arriba para hacerlo a mano. Escanear no
// toca archivos (solo los lee) y lo que no cambió no se vuelve a leer: al abrir, PAILA se pone al día con lo que agregaste, moviste o
// borraste con ella cerrada, y después sigue con el análisis pendiente. No escanea si no hay carpetas todavía (la primera vez, el
// recorrido de bienvenida), si algo ya está corriendo, en una captura (PAILA_SNAPSHOT) o si se pide que no (PAILA_SIN_ESCANEO_AL_ABRIR=1).

export interface AlAbrir {
  /** Cuántas carpetas tiene la biblioteca. */
  carpetas: number
  /** Ya hay un escaneo o un análisis corriendo, u otra operación con el candado. */
  ocupada: boolean
  snapshot: boolean
  env?: Record<string, string | undefined>
}

/** ¿Escanea al abrir? Si no, solo sigue con el análisis que haya quedado pendiente. */
export const escanearAlAbrir = (o: AlAbrir) => o.carpetas > 0 && !o.ocupada && !o.snapshot && (o.env ?? process.env).PAILA_SIN_ESCANEO_AL_ABRIR !== '1'
