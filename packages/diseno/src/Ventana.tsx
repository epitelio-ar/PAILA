// Ventana (modal) compartida: fondo oscuro, caja con botón de cerrar y cierre al tocar afuera (salvo que esté ocupada).
// Con teclado: al abrir, el foco entra a la ventana; Tab da vueltas adentro (no se escapa a la pantalla de atrás); Escape cierra
// (salvo ocupada) y al cerrar el foco vuelve a donde estaba (prueba de usabilidad, solo teclado, 27/10/2026).
import { T } from './textos'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icono'

export interface VentanaProps {
  onClose: () => void
  /** Ocupada (aplicando algo): no se puede cerrar tocando afuera ni con la cruz. */
  busy?: boolean
  /** Clase extra de la caja (por ejemplo el ancho). */
  className?: string
  children: ReactNode
}

const ENFOCABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Ventana({ onClose, busy, className, children }: VentanaProps) {
  const caja = useRef<HTMLDivElement>(null)
  const cerrar = useRef(onClose)
  cerrar.current = onClose
  const ocupada = useRef(busy)
  ocupada.current = busy
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    const el = caja.current
    // el primer campo para escribir; si no hay, la caja misma (no un botón: un Enter sin querer no tiene que aplicar nada)
    ;(el?.querySelector<HTMLElement>('input:not([disabled]):not([type=checkbox]):not([type=radio]), textarea:not([disabled])') ?? el)?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (!el || e.defaultPrevented) return
      // otra ventana abierta encima (la de más arriba es la última del documento) se ocupa ella
      const todas = document.querySelectorAll('.modal')
      if (todas[todas.length - 1] !== el) return
      if (e.key === 'Escape') { if (!ocupada.current) { e.preventDefault(); cerrar.current() } return }
      if (e.key !== 'Tab') return
      const f = [...el.querySelectorAll<HTMLElement>(ENFOCABLE)].filter((x) => x.offsetParent !== null)
      if (!f.length) { e.preventDefault(); return }
      const i = f.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus() }
    }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); if (antes && document.contains(antes)) antes.focus() }
  }, [])
  return (
    <div className="modal-back" onClick={busy ? undefined : onClose}>
      <div ref={caja} tabIndex={-1} className={`modal${className ? ' ' + className : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} disabled={busy} title={T.cerrar} aria-label={T.cerrar}><Icon name="close" size={14} /></button>
        {children}
      </div>
    </div>
  )
}
