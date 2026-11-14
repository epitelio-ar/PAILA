// Los temas que se sueltan sobre «Separar voz» en la barra lateral: quedan acá hasta que la sección los toma (si estaba
// abierta, se le avisa; si no, los toma al abrirse). Así el aviso de baja calidad lo hace siempre la sección.
let pendientes: number[] = []
let avisar: (() => void) | null = null

export function soltarParaSeparar(ids: number[]) {
  pendientes = [...pendientes, ...ids.filter((id) => !pendientes.includes(id))]
  avisar?.()
}

/** La sección se anota al abrirse; devuelve cómo dejar de escuchar. */
export function alSoltar(cb: () => void): () => void {
  avisar = cb
  if (pendientes.length) cb()
  return () => { if (avisar === cb) avisar = null }
}

/** Los temas soltados (y se vacía la lista). */
export function tomarSoltados(): number[] {
  const ids = pendientes
  pendientes = []
  return ids
}
