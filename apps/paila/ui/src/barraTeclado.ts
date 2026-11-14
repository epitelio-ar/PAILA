// La barra lateral con teclado (usabilidad, 2.ª tanda, P2): toda la barra es una sola parada del Tab y adentro se camina con
// las flechas ↑↓ (también ←→, para los íconos de abajo), Inicio y Fin; Enter abre. Antes, llegar a una herramienta costaba
// 60–76 Tab. Es el "tabindex móvil" de las listas: un solo renglón tiene tabindex 0 (el último que tuvo el foco o, si no, la
// pantalla abierta), los demás -1. Los campos para escribir (nombre de una playlist nueva) no entran: ahí las flechas son del texto.
import { useEffect, type RefObject } from 'react'
import { escribiendo } from '@paila/shared/teclas'

const PARADAS = 'button, [tabindex], select, a[href]'

/** Los renglones y botones de la barra que se ven, en orden. */
export function paradas(barra: HTMLElement): HTMLElement[] {
  return [...barra.querySelectorAll<HTMLElement>(PARADAS)]
    .filter((el) => !(el as HTMLButtonElement).disabled && !escribiendo(el) && !el.closest('.pl-menu-flota') && el.getClientRects().length > 0)
}

/** Deja una sola parada con tabindex 0: `actual` si sigue en la barra; si no, la pantalla abierta (.on) o la primera. */
export function ordenar(barra: HTMLElement, actual: HTMLElement | null): HTMLElement | null {
  const ps = paradas(barra)
  const elegida = (actual && ps.includes(actual) ? actual : null) ?? ps.find((p) => p.classList.contains('on')) ?? ps[0] ?? null
  for (const p of ps) { const t = p === elegida ? '0' : '-1'; if (p.getAttribute('tabindex') !== t) p.setAttribute('tabindex', t) }
  return elegida
}

/** A qué parada lleva la tecla, desde la `i` de `total` (null: no es una tecla de la barra). */
export function destino(tecla: string, i: number, total: number): number | null {
  if (!total) return null
  if (tecla === 'ArrowDown' || tecla === 'ArrowRight') return Math.min(total - 1, i + 1)
  if (tecla === 'ArrowUp' || tecla === 'ArrowLeft') return Math.max(0, i - 1)
  if (tecla === 'Home') return 0
  if (tecla === 'End') return total - 1
  return null
}

/** Pone las flechas en `ref` (la barra entera: la navegación y los íconos de abajo). */
export function useFlechasBarra(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const barra = ref.current
    if (!barra) return
    let actual: HTMLElement | null = null, abierta: Element | null = null
    const poner = () => {
      // si cambió la pantalla abierta (Ctrl+K, el Inicio) con el foco afuera, se vuelve a entrar por ella
      const on = barra.querySelector('.on')
      if (on !== abierta) { abierta = on; if (!barra.contains(document.activeElement)) actual = null }
      actual = ordenar(barra, actual)
    }
    poner()
    // la barra cambia sola (grupos que se abren, playlists que llegan, la pantalla abierta): se vuelve a ordenar. Sin esperar un
    // cuadro (requestAnimationFrame): con la ventana oculta o minimizada no llega, y la barra quedaba sin entrada para el Tab
    const obs = new MutationObserver(poner)
    obs.observe(barra, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled'] })
    const alEntrar = (e: FocusEvent) => { const t = e.target as HTMLElement; if (paradas(barra).includes(t)) { actual = t; poner() } }
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || escribiendo(e.target)) return
      const ps = paradas(barra)
      const i = ps.indexOf(e.target as HTMLElement)
      if (i < 0) return
      const j = destino(e.key, i, ps.length)
      if (j == null) return
      e.preventDefault()
      actual = ps[j]
      poner()
      ps[j].focus()
    }
    barra.addEventListener('focusin', alEntrar)
    barra.addEventListener('keydown', tecla)
    return () => {
      obs.disconnect()
      barra.removeEventListener('focusin', alEntrar); barra.removeEventListener('keydown', tecla)
    }
  }, [ref])
}
