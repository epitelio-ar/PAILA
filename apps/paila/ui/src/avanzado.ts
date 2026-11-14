// El modo avanzado (apagado de fábrica): muestra el muestrario de diseño, el inspector de un tema, la cola del análisis y el registro
// de operaciones, para quien programa, usa agentes de código o quiere ver qué hace PAILA por dentro. Se prende en Configuración →
// Pantalla o con Ctrl+K y queda guardado en esta PC. No cambia nada de cómo trabaja PAILA: solo muestra más.
import { useEffect, useState } from 'react'

const KEY = 'paila.avanzado'
const ev = 'paila-avanzado'
export function leerAvanzado(): boolean { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function ponerAvanzado(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* sin almacenamiento: vale hasta cerrar */ }
  window.dispatchEvent(new CustomEvent(ev))
}
/** Si el modo avanzado está prendido (se actualiza al cambiarlo desde cualquier lado). */
export function useAvanzado(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(leerAvanzado)
  useEffect(() => { const f = () => setOn(leerAvanzado()); window.addEventListener(ev, f); return () => window.removeEventListener(ev, f) }, [])
  return [on, ponerAvanzado]
}
