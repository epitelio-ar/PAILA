// Barra de avance compartida: con porcentaje, sin saber cuánto falta (indeterminada), terminada bien o con error.
import type { CSSProperties, MouseEventHandler } from 'react'

export interface BarraProps {
  /** De 0 a 100. Sin valor (null o undefined): no se sabe cuánto falta. */
  value?: number | null
  big?: boolean
  tone?: 'acento' | 'ok' | 'error'
  className?: string
  style?: CSSProperties
  title?: string
  onClick?: MouseEventHandler<HTMLDivElement>
}

export function Barra({ value, big, tone = 'acento', className, style, title, onClick }: BarraProps) {
  const known = value != null
  const cls = ['bar', big && 'big', tone === 'ok' && 'ok', tone === 'error' && 'is-error', !known && 'indeterminate', onClick && 'clickable', className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style} title={title} onClick={onClick} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(value) : undefined}>
      <i style={{ width: `${known ? Math.max(0, Math.min(100, value)) : 100}%` }} />
    </div>
  )
}
