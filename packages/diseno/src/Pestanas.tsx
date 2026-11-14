// Pestañas compartidas: cambiar entre vistas de la misma pantalla. Se manejan con el mouse o con las flechas del teclado.
import type { ReactNode } from 'react'

export interface PestanaItem<K extends string> { key: K; label: ReactNode; /** Un número chico al lado (cuántos hay). */ count?: number | string }

export function Pestanas<K extends string>({ items, value, onChange, label }: { items: PestanaItem<K>[]; value: K; onChange: (k: K) => void; label?: string }) {
  const move = (dir: 1 | -1) => { const i = items.findIndex((x) => x.key === value); onChange(items[(i + dir + items.length) % items.length].key) }
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); move(1) } else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) } }}>
      {items.map((it) => (
        <button key={it.key} role="tab" aria-selected={it.key === value} tabIndex={it.key === value ? 0 : -1} className={`tab${it.key === value ? ' on' : ''}`} onClick={() => onChange(it.key)}>
          {it.label}{it.count != null && <span className="tab-count num">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}
