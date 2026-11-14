// La calidad real en NAPIA (core/sockseek/calidad.ts y control.ts): cómo va la revisión de cada tema bajado, la cuenta de la
// lista y la copia que ya tenés cuando la bajada viene a reemplazarla. Es parte del contrato de NAPIA (napia.ts lo reexporta).

/**
 * La copia que ya tenés de un tema y que viene a reemplazarse (la manda la lista «Faltan o suenan mal» de PAILA, con su análisis): lo que
 * baje sirve solo si es claramente mejor, con la misma vara que la Bandeja (core/better.ts; core/sockseek/calidad.ts, esMejor).
 */
export interface CopiaTuya {
  /** La nota de PAILA (A+ … F). */
  nota: string
  /** La calidad real en kbps (1411 = CD), si se sabe. */
  kbps: number | null
  /** Lo que es, en palabras ("MP3 128 kbps · nota D"), para mostrarlo. */
  que: string | null
  /** Las marcas del análisis ("gaps": tiene huecos; "damaged": dañado). */
  marcas?: string[]
  /** Tramos con la señal aplastada contra el techo y su volumen (para "satura más que la tuya"). */
  recortes?: number | null
  lufs?: number | null
  /** En segundos (para "dura distinto"). */
  duracion?: number | null
  /** El número del tema en la base de PAILA: NAPIA lee ahí su huella para ver si lo bajado es el mismo audio (1/11). */
  id?: number | null
}


/**
 * Cómo va la revisión de la calidad real de un tema bajado: `revisando`; `buena` (es lo que dice); `trucho` (inflado, sin
 * pérdida falso, dañado o mucho peor que lo pedido: quedó en "descartados" y espera otra fuente); `otraFuente` (bajando de
 * otro usuario); `reemplazado` (llegó uno bueno de otra fuente); `soloFalsa` (ninguna fuente sirvió); `sinMejor` (venía a
 * reemplazar una copia tuya y ninguna fuente la superó); `sinRevisar` (no se pudo analizar: se entrega igual).
 */
export type EstadoCalidad = 'revisando' | 'buena' | 'trucho' | 'otraFuente' | 'reemplazado' | 'soloFalsa' | 'sinMejor' | 'sinRevisar'
/** `noEsMejor`: está bien, pero no es claramente mejor que la copia que ya tenés (cuando viene a reemplazarla). */
/** `lenta`: no llegó a bajar: la fuente iba tan lenta que se cortó para probar otra (core/sockseek/lentitud.ts). */
/** `otraVersion`: es otra versión que la que pediste (una acapella, un remix, en vivo: core/sockseek/otraversion.ts). */
export type MotivoTrucho = 'inflado' | 'sinPerdidaFalso' | 'danado' | 'peorQuePedido' | 'noEsMejor' | 'lenta' | 'otraVersion'

export interface RevisionCalidad {
  estado: EstadoCalidad
  /** La nota de PAILA (A+ … F) del último archivo revisado. */
  nota: string | null
  /** Lo que es en realidad, en palabras ("MP3 inflado: suena como uno de 128 kbps"). */
  es: string | null
  /** Por qué se descartó la última copia trucha. */
  motivo: MotivoTrucho | null
  /** Cuántas copias truchas se descartaron (cada una de otro usuario). */
  descartadas: number
  /** Cuántas veces se buscó otra fuente. */
  intentos: number
  /** Cuántas fuentes se cortaron por lentas (no son descartadas: no llegó ningún archivo). */
  lentas?: number
  /** Cuántas fuentes se cortaron porque un pedazo, mientras bajaba, ya sonaba trucho (core/sockseek/muestra.ts). */
  enMuestra?: number
  /** Lo último que se vio (nota, es, motivo) salió de ese pedazo, no del archivo entero. */
  muestra?: boolean
  /** Cuánto bajó (0–100) de la fuente que se está probando ahora. */
  avance?: number | null
  /** La copia que ya tenés, si este tema viene a reemplazarla. */
  tuya?: CopiaTuya | null
  /** Con `otraVersion`: cuál llegó ("acapella", "remix"). */
  otra?: string
}

/** La revisión de calidad de la lista que está bajando: cuántos se descartaron, se reemplazaron o solo estaban truchos. */
export interface CuentaCalidad {
  /** Se puede revisar (NAPIA encontró ffmpeg). */
  activa: boolean
  revisando: number
  /** Temas que llegaron truchos (al menos una copia descartada). */
  descartados: number
  /** De esos, cuántos se reemplazaron por una copia buena de otra fuente. */
  reemplazados: number
  /** De esos, cuántos solo se encontraron en calidad falsa. */
  soloFalsa: number
  /** Los que venían a reemplazar una copia tuya y no apareció una mejor. */
  sinMejor: number
  /** Está buscando otras fuentes (después de la lista, con sockseek de nuevo). */
  buscandoOtra: boolean
}
