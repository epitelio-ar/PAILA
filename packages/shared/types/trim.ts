// Recortar los silencios largos del principio y del final (core/trim.ts): la propuesta para cada tema y lo que no se recorta.

/** Dónde cortar un tema. Los segundos están en el tiempo del tema como lo decodifica PAILA. */
export interface TrimProposal {
  fileId: number; rel: string; ext: string
  /** Tamaño y fecha del archivo al proponerlo: si cambian antes de aplicar, no se toca. */
  size: number; mtime: number
  duration: number
  /** Segundos que no se oyen (debajo de −80 dB) al principio y al final. */
  silenceStart: number; silenceEnd: number
  /** Qué lados se cortan y qué queda: de `from` a `to`. */
  cutStart: boolean; cutEnd: boolean; from: number; to: number
  /** Por qué se corta solo un lado (por ejemplo, marcas de Rekordbox), o null. */
  note: string | null
}

export interface TrimPlan {
  items: TrimProposal[]
  /** Los que tienen el aviso pero no se recortan, y por qué. */
  skipped: { fileId: number; rel: string; why: string }[]
}
