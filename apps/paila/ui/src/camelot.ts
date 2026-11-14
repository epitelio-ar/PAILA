// Colores de la rueda Camelot (la que usan los DJ para el tono): cada número tiene su color, el mismo en la tabla, la ficha
// y el reproductor. Los vecinos de la rueda tienen colores parecidos, así se ve de un vistazo qué mezcla con qué.
const CAMELOT = ['#5ee6c6', '#5fd3ef', '#6fb5ff', '#8f9bff', '#b48cff', '#e28cf0', '#ff8fbf', '#ff9a8a', '#ffb36b', '#ffd25e', '#e5ea62', '#a9ec74']

/** Color de un tono Camelot ("8A", "12B"…), o null si no hay. */
export function camelotColor(c: string | null | undefined): string | null {
  const n = c ? parseInt(c, 10) : NaN
  return Number.isFinite(n) && n >= 1 && n <= 12 ? CAMELOT[n - 1] : null
}
