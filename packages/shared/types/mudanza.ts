// Tipos de "Pasar a otra compu" (core/mudanza.ts y core/mudanza-traer.ts): el archivo con todo, lo que trae y cuántos
// temas reengancha en la compu nueva. También los pedidos de la interfaz (MudanzaApi, que PailaApi extiende).

/** Cuánto hay en una base: lo que se muestra antes de traer y lo que compara la corrida supervisada. */
export interface MudanzaConteos {
  temas: number
  analizados: number
  /** Temas con huella del sonido o huella acústica. */
  huellas: number
  playlists: number
  enPlaylists: number
  /** Renglones del Historial (tags, papelera, Organizar, reemplazos…). */
  historial: number
  pendientes: number
  vistas: number
  diccionario: number
}

/** Una carpeta de música de la compu de origen. */
export interface MudanzaCarpeta {
  rootId: number
  /** Dónde estaba en la otra compu, tal cual ("D:\Música", "/Users/ana/Music"). */
  origen: string
  disco: string
  temas: number
  /** Si en esta compu existe una carpeta con la misma ruta (la misma compu, o el mismo disco con la misma letra). */
  sugerida: string | null
}

export interface MudanzaResumen {
  archivo: string
  fecha: string
  /** Versión de PAILA que lo armó. */
  version: string
  /** "Windows", "Mac" o "Linux". */
  sistema: string
  carpetas: MudanzaCarpeta[]
  conteos: MudanzaConteos
  /** Claves de servicios (Discogs, AcoustID…) que tenía y no viajan. */
  clavesQuitadas: string[]
}

/** Cuántos temas de una carpeta se encontraron en su lugar nuevo. */
export interface MudanzaEmparejado {
  rootId: number
  carpeta: string
  porRuta: number
  /** Misma ruta con otras mayúsculas o acentos escritos de otra forma (Windows → Mac). */
  porMayusculas: number
  /** Mismo tamaño y mismo nombre, en otra subcarpeta. */
  porNombre: number
  /** Mismo tamaño y misma fecha, con otro nombre. */
  porFecha: number
  faltan: number
  /** De los que faltan, cuántos ya faltaban en la otra compu (estaban desaparecidos allá). */
  yaFaltaban: number
  /** Algunos de los que faltan (ruta relativa), para mostrarlos. */
  ejemplosFaltan: string[]
  /** Archivos de la carpeta nueva que la otra compu no tenía: los suma el primer escaneo. */
  nuevos: number
  /** Encontrados con otro tamaño: se vuelven a leer y analizar (los cambiaron en la otra compu). */
  cambiados: number
}

/** Lo que tiene ahora la PAILA de esta compu (para no pisarlo sin preguntar). */
export interface MudanzaDestino { temas: number; playlists: number; historial: number }

export interface MudanzaAbierto { resumen: MudanzaResumen; destino: MudanzaDestino }

export interface MudanzaApi {
  /** Elige dónde guardar el archivo con todo y lo arma. null si se canceló. */
  mudanzaExportar(): Promise<{ archivo: string; tamano: number; clavesQuitadas: string[] } | null>
  /** Elige el archivo traído de la otra compu y dice qué tiene. null si se canceló. */
  mudanzaAbrir(): Promise<MudanzaAbierto | null>
  /** Busca los temas de esa carpeta en `carpeta` (o, sin carpeta, pide elegirla). null si se canceló. */
  mudanzaCarpeta(rootId: number, carpeta?: string): Promise<MudanzaEmparejado | null>
  /** Arma la base nueva con las carpetas elegidas, deja una copia de la actual y reabre PAILA. */
  mudanzaTraer(rootIds: number[]): Promise<void>
}
