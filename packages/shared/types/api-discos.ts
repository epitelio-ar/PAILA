// Los pedidos de la interfaz para los discos de la biblioteca (el pie de la barra lateral): cuál es cada uno y expulsarlo.
// Aparte de api.ts para que no crezca: PailaApi los extiende.

/** Un disco donde está una carpeta de tu música: su nombre, su letra, el espacio y si es externo (se puede expulsar). */
export interface DiscoRaiz {
  rootId: number
  /** La carpeta de la biblioteca ("F:\Música"). */
  carpeta: string
  /** El nombre del disco ("el autor SSD") o, si no tiene, el de la carpeta. */
  nombre: string
  /** "F:" (null: en red o sin letra). */
  letra: string | null
  conectado: boolean
  /** USB o tarjeta: se puede expulsar desde PAILA. null: no se sabe. */
  externo: boolean | null
  libre: number | null
  total: number | null
}

export interface DiscosApi {
  discos(): Promise<DiscoRaiz[]>
  /** Expulsa el disco de esa carpeta (pausa el análisis y espera que nada lo esté usando). */
  expulsarDisco(rootId: number): Promise<{ ok: boolean; mensaje: string }>
}
