// Lo que se ofrece mejorar va de peor a mejor sonido (el autor, 13/11): «Faltan o suenan mal», los ejemplos de Sonido de un vistazo y
// la lista que va a NAPIA. Primero la nota (F, D, C…; lo que no tenés va antes que todo), y con la misma nota, el que menos kbps de
// verdad tiene (lo que se escucha, no lo que dice el archivo). Si empatan, por artista y título, para que el orden sea siempre el mismo.
const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }

export interface ConSonido { grade: string | null; effKbps: number | null; artist?: string | null; title?: string | null }

/** Para `sort`: el que peor suena, primero. */
export function peorPrimero(a: ConSonido, b: ConSonido): number {
  const nota = (RANK[b.grade ?? ''] ?? 9) - (RANK[a.grade ?? ''] ?? 9)
  if (nota) return nota
  const ka = a.effKbps ?? Number.POSITIVE_INFINITY, kb = b.effKbps ?? Number.POSITIVE_INFINITY
  if (ka !== kb) return ka < kb ? -1 : 1
  return (a.artist ?? '').localeCompare(b.artist ?? '') || (a.title ?? '').localeCompare(b.title ?? '')
}
