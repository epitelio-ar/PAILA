// Sonido, una sola historia (MASTERPLAN-5, 2.4 y etapa 5): suena mal → buscar mejor con NAPIA → llegó (la Bandeja lo reconoce y lo
// verifica) → aplicar, sin cambiar de ventana. El estado de NAPIA (lo lee PAILA de su enlace: core/sockseek/enlace.ts) y el resumen de
// las tres partes. Lo responde apps/paila/electron/ipc/sonido.ts.

/** Un tema que terminó en NAPIA: llegó bien, llegó trucho o no estaba. */
export interface UltimoNapiaVista { artist: string; title: string; estado: 'llego' | 'trucho' | 'noEsta'; frase: string }

/** En qué anda NAPIA, visto desde PAILA. */
export interface EstadoNapia {
  /** NAPIA está abierta (escribió hace poco). */
  abierta: boolean
  corriendo: boolean
  lista: string | null
  hechos: number
  total: number
  bajados: number
  truchos: number
  noEncontrados: number
  /** Listas que esperan en la tanda. */
  enEspera: number
  /** Qué le falta para bajar (null: lista). */
  falta: 'sockseek' | 'cuenta' | 'carpeta' | null
  ultimos: UltimoNapiaVista[]
  /** Cómo terminó la última lista. */
  fin: { lista: string; bajados: number; noConseguidos: number; hora: number; cortada: boolean } | null
}

export interface EjemploSonido { key: string; fileId: number | null; artist: string; title: string; grade: string | null; frase: string }
/** Lo que llegó a la Bandeja, en una frase. */
export interface LlegadaSonido { path: string; name: string; decision: string; frase: string; artist: string | null; title: string | null; /** Las copias mejores: el tema tuyo que reemplazan. */ fileId?: number; rel?: string }

export interface ResumenSonido {
  /** Temas tuyos que suenan peor de lo que podrían (sin los reemplazados, los ignorados ni los que ya llegaron). */
  suenanMal: { n: number; ejemplos: EjemploSonido[] }
  /** Los de tus listas (y los que les faltan a tus discos) que no tenés. */
  faltan: { n: number; ejemplos: EjemploSonido[] }
  llegaron: {
    /** Copias mejores verificadas, ya sumadas a lo que vas a aplicar (PAILA propone). */
    enLista: number
    /** De esas, las que destildaste o no se pudieron aplicar. */
    apagadas: number
    /** Temas que no tenías (van a tu Música con "Pasar a tu Música"). */
    nuevos: number
    /** Lo que no sirvió o hay que mirar a mano. */
    otros: LlegadaSonido[]
    /** Las copias mejores, con su frase (para ver qué entra). */
    mejores: LlegadaSonido[]
    /** Archivos esperando que la Bandeja los revise. */
    revisando: number
  }
  /** La carpeta que vigila la Bandeja (null: ninguna). */
  bandeja: string | null
}

export type QueMandar = 'calidad' | 'faltan'

export interface SonidoApi {
  sonidoResumen(): Promise<ResumenSonido>
  napiaEstado(): Promise<EstadoNapia | null>
  /** Avisa cada vez que cambia lo que dice NAPIA (cada 3 s mientras baja). */
  onNapiaEstado(cb: (e: EstadoNapia | null) => void): () => void
  /** Manda a NAPIA lo que suena mal o lo que falta, y que empiece a bajar sola (sin traerla adelante si está lista). */
  mandarANapia(que: QueMandar): Promise<{ count: number; bandeja: string | null } | null>
  /** Trae NAPIA adelante (para lo que solo se hace ahí: la cuenta de Soulseek, la carpeta). */
  verNapia(): Promise<void>
  /** Tilda o destilda copias mejores (de esos temas): siguen a la vista; Aplicar saltea las destildadas. */
  tildarReemplazos(fileIds: number[], on: boolean): Promise<ResumenSonido>
}
