// ⓘ con tooltip: una explicación corta para cada término técnico, en un globito (va al <body>: no se corta dentro de cajas con scroll ni hereda su opacidad).
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Ícono ⓘ: al pasar el mouse o con el teclado (Tab) muestra la explicación. */
export function Info({ tip, children = 'ⓘ' }: { tip: string; children?: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const below = r.top < 140
    setPos({ x: Math.max(8, Math.min(r.left + r.width / 2 - 170, window.innerWidth - 348)), y: below ? r.bottom + 6 : r.top - 6, below })
  }
  return (
    <span className="info" tabIndex={0} role="img" aria-label={tip} onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setPos(null)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setPos(null)}>
      {children}
      {pos && createPortal(<span className="info-tip" role="tooltip" style={{ left: pos.x, top: pos.y, transform: pos.below ? undefined : 'translateY(-100%)' }}>{tip}</span>, document.body)}
    </span>
  )
}
