// Densidad de la tabla de temas: cómoda (dos renglones por tema) o compacta (uno solo, para muchas filas). Se acuerda; sin
// elección, de 5.000 temas para arriba arranca compacta. Ctrl+Mayús+D la cambia desde cualquier lado.
import { useEffect, useState } from 'react'

const KEY = 'paila.densidad'
/** Desde esta cantidad de temas, sin haber elegido, la tabla arranca compacta. */
export const TEMAS_PARA_COMPACTA = 5000

const guardada = (): 'comoda' | 'compacta' | null => {
  try { const v = localStorage.getItem(KEY); return v === 'comoda' || v === 'compacta' ? v : null } catch { return null }
}

/** `[compacta, cambiar]`: la tabla es compacta o cómoda. `cantidad` es cuántos temas se muestran (para el valor de fábrica). */
export function useDensidad(cantidad: number): [boolean, (compacta: boolean) => void] {
  const [elegida, setElegida] = useState(guardada)
  const compacta = elegida ? elegida === 'compacta' : cantidad >= TEMAS_PARA_COMPACTA
  const cambiar = (c: boolean) => {
    const v = c ? 'compacta' : 'comoda'
    try { localStorage.setItem(KEY, v) } catch { /* sin almacenamiento: vale hasta cerrar */ }
    setElegida(v)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); cambiar(!compacta) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // sin lista: siempre ve el valor de "compacta" de este momento
  return [compacta, cambiar]
}
