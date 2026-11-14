// Atajos de teclado según el sistema: en Mac la tecla de los atajos es Cmd (⌘), no Ctrl. Los textos de la interfaz se
// escriben con "Ctrl" y pasan por `teclas()`, que en Mac los muestra con "Cmd". Los atajos ya andan con las dos teclas
// (`e.ctrlKey || e.metaKey`); esto es solo lo que se lee en pantalla.

/** ¿La ventana corre en una Mac? (en el proceso principal, process.platform; en la interfaz, lo que dice el navegador) */
export const esMac: boolean = typeof process !== 'undefined' && typeof process.platform === 'string'
  ? process.platform === 'darwin'
  : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

/** "Ctrl+K" → "Cmd+K" en Mac (también "Ctrl + →" y "Ctrl+clic"); en Windows queda igual. */
export const teclas = (texto: string, mac = esMac): string => (mac ? texto.replace(/\bCtrl\b/g, 'Cmd') : texto)

/** Los `<input>` que no son para escribir (un atajo de una letra sí tiene que andar con el foco en una casilla). */
const NO_ES_TEXTO = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])

/**
 * ¿El foco está en un campo donde se escribe? Ahí los atajos de una letra (S, R, M, Q, E, la barra espaciadora, G + letra)
 * no se disparan. Un `<input>` sin `type` también es de texto: el de Ctrl+K no lo tenía y la S, la R o la M se las comía
 * el reproductor ("Duplicados" quedaba "Duplicado" y se prendía el aleatorio; prueba de usabilidad con teclado, 27/10/2026).
 */
export function escribiendo(el: EventTarget | Element | null | undefined): boolean {
  const e = el as HTMLElement | null
  if (!e || typeof e.tagName !== 'string') return false
  const tag = e.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable) return true
  if (tag !== 'INPUT') return !!e.closest?.('[contenteditable=true]')
  return !NO_ES_TEXTO.has(((e as HTMLInputElement).type || 'text').toLowerCase())
}
