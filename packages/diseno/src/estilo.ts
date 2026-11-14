// El estilo de la ventana: "actual" (el de siempre) o "historieta" (bocetos-4: viñetas con borde de tinta, sellos, la
// figurita). Es `data-estilo` en <html>: los estilos de historieta.css se prenden solos. Se elige en PAILA (primera vez y
// Configuración → Pantalla) y NAPIA lo hereda (lo lee al abrir). Se guarda en esta PC. De fábrica (quien no eligió): historieta
// (decidido el 22/10); el sobrio queda a un clic en la barra lateral, y quien ya eligió se respeta.
import { T } from './textos'
import { useEffect, useState } from 'react'

export type Estilo = 'actual' | 'historieta'
export const ESTILO_DE_FABRICA: Estilo = 'historieta'
export const ESTILOS: { key: Estilo; label: string; detalle: string }[] = [
  { key: 'historieta', label: T.historieta, detalle: T.historietaDetalle },
  { key: 'actual', label: T.sobrio, detalle: T.sobrioDetalle },
]

const KEY = 'paila.estilo'
const ev = 'paila-estilo'
const valido = (v: unknown): v is Estilo => v === 'actual' || v === 'historieta'

/** El estilo guardado en esta PC; si nunca se eligió (o no se puede leer), el de fábrica. */
export function leerEstilo(): Estilo {
  try { const v = localStorage.getItem(KEY); return valido(v) ? v : ESTILO_DE_FABRICA } catch { return ESTILO_DE_FABRICA }
}

function aplicar(e: Estilo) {
  if (e === 'historieta') document.documentElement.dataset.estilo = 'historieta'
  else delete document.documentElement.dataset.estilo
}

/** Cambia el estilo en toda la ventana, lo recuerda y (si la app lo sabe hacer) se lo pasa al otro programa. */
export function ponerEstilo(e: Estilo, compartir?: (e: Estilo) => void) {
  try { localStorage.setItem(KEY, e) } catch { /* sin almacenamiento: vale hasta cerrar */ }
  aplicar(e)
  compartir?.(e)
  window.dispatchEvent(new CustomEvent(ev))
}

/** Al arrancar: el estilo guardado en esta ventana, o el que llega de afuera (NAPIA lo recibe de PAILA). */
export function iniciarEstilo(deAfuera?: Estilo | null) {
  if (valido(deAfuera)) { try { localStorage.setItem(KEY, deAfuera) } catch { /* nada */ } aplicar(deAfuera) } else aplicar(leerEstilo())
}

/** El estilo de ahora (se actualiza al cambiarlo desde cualquier lado). */
export function useEstilo(compartir?: (e: Estilo) => void): [Estilo, (e: Estilo) => void] {
  const [e, setE] = useState<Estilo>(() => (document.documentElement.dataset.estilo === 'historieta' ? 'historieta' : 'actual'))
  useEffect(() => {
    const f = () => setE(document.documentElement.dataset.estilo === 'historieta' ? 'historieta' : 'actual')
    window.addEventListener(ev, f)
    return () => window.removeEventListener(ev, f)
  }, [])
  return [e, (x) => ponerEstilo(x, compartir)]
}
