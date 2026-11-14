// La hora con que se anota cada tanda del Historial (tags, papelera, Organizar, carpetas vacías y cada Aplicar). Nunca se repite ni
// va para atrás dentro de la misma app: si dos cosas pasan en el mismo milisegundo, la segunda queda un milisegundo después. El
// Historial ordena por esa hora, y el deshacer encadenado (core/history-cadena.ts) necesita saber sin dudas qué vino después: con dos
// horas iguales desempataba por el número de tanda, que es de tablas distintas, y a veces ponía primero lo que vino después.
let ultima = 0

/** La hora de ahora (ISO), siempre más nueva que la anterior que dio esta función. */
export function ahora(): string {
  ultima = Math.max(Date.now(), ultima + 1)
  return new Date(ultima).toISOString()
}
