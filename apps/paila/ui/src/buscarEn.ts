// Buscar en la biblioteca desde cualquier pantalla: tocar el artista o el disco en Escuchando o en la ficha, o una nota en
// Análisis, abre la biblioteca con esa búsqueda (App.tsx escucha el evento). Lo que se ve tocable tiene que hacer algo
// (prueba con la persona 2, 01/11: tocaba el disco, el artista y las notas, y no pasaba nada).
const EVENTO = 'paila:buscar'

export const buscarEnBiblioteca = (q: string) => window.dispatchEvent(new CustomEvent<string>(EVENTO, { detail: q }))

/** La búsqueda de los temas con esa nota (la entiende shared/tableview.ts: "nota:F"). */
export const buscarNota = (g: string) => buscarEnBiblioteca(`nota:${g}`)

export function alBuscar(f: (q: string) => void) {
  const h = (e: Event) => f((e as CustomEvent<string>).detail)
  window.addEventListener(EVENTO, h)
  return () => window.removeEventListener(EVENTO, h)
}
