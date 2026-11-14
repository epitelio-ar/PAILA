// Cuánto puede ocupar una tanda y si entra en el disco de la carpeta de NAPIA (el autor, 1/11: arrancó 1.350 temas en C:
// con 26 GB libres). NAPIA prefiere FLAC: se calcula con lo que ocupa un FLAC promedio, así el aviso llega antes que el disco lleno.
export const MB_POR_TEMA = 35e6

/** Lo que puede ocupar bajar `temas` y si no entra en `libre` bytes (null: no se sabe cuánto queda, no se avisa). */
export function espacioTanda(temas: number, libre: number | null | undefined): { ocupa: number; noEntra: boolean } {
  const ocupa = temas * MB_POR_TEMA
  return { ocupa, noEntra: libre != null && temas > 0 && ocupa > libre }
}
