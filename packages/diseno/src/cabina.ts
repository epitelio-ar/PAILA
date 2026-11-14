// Modo cabina: alto contraste y letra más grande, para leer la pantalla de lejos o con poca luz (una cabina de DJ, un
// escenario). Es `data-cabina` en <html>: los tokens de tokens.css cambian solos. Se guarda en esta PC (localStorage).
import { useEffect, useState } from 'react'

const KEY = 'paila.cabina'
const ev = 'paila-cabina'

/** Alto de una fila de la tabla de temas: cómoda (dos renglones) o compacta (uno), y más alta en cabina. */
export const filaAlto = (cabina: boolean, compacta = false) => (cabina ? (compacta ? 36 : 56) : compacta ? 26 : 44)

export function leerCabina(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** Prende o apaga el modo cabina en toda la ventana y lo recuerda. */
export function ponerCabina(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* sin almacenamiento: vale hasta cerrar */ }
  if (on) document.documentElement.dataset.cabina = '1'
  else delete document.documentElement.dataset.cabina
  window.dispatchEvent(new CustomEvent(ev))
}

/** Al arrancar la app: deja la ventana como la persona la dejó la última vez. */
export function iniciarCabina() { if (leerCabina()) document.documentElement.dataset.cabina = '1' }

/** Si el modo cabina está prendido (se actualiza al cambiarlo desde cualquier lado). */
export function useCabina(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => document.documentElement.dataset.cabina === '1')
  useEffect(() => {
    const f = () => setOn(document.documentElement.dataset.cabina === '1')
    window.addEventListener(ev, f)
    return () => window.removeEventListener(ev, f)
  }, [])
  return [on, ponerCabina]
}
