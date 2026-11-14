// Campos de formulario compartidos: un campo con su rótulo, su ⓘ y su ayuda, y una casilla (o botón de opción) grande con explicación.
import { useId, type ReactNode } from 'react'
import { Info } from './Info'

/** Un campo con rótulo arriba, ⓘ opcional y una ayuda corta abajo. El control va adentro. */
export function Campo({ label, info, ayuda, children }: { label: ReactNode; info?: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="campo">
      <label className="campo-label">{label}{info && <Info tip={info} />}</label>
      {children}
      {ayuda && <div className="campo-ayuda">{ayuda}</div>}
    </div>
  )
}

export interface CasillaProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 'checkbox' (varias a la vez) o 'radio' (una sola). */
  tipo?: 'checkbox' | 'radio'
  label: ReactNode
  /** Explicación de una línea debajo del rótulo. */
  detail?: ReactNode
  info?: string
  disabled?: boolean
}

/** Casilla grande: toda la tarjeta se puede tocar. Elegida: borde con el color de la app. */
export function Casilla({ checked, onChange, tipo = 'checkbox', label, detail, info, disabled }: CasillaProps) {
  const id = useId()
  return (
    <label htmlFor={id} className={`casilla${checked ? ' on' : ''}${disabled ? ' off' : ''}`}>
      <input id={id} type={tipo} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="casilla-cuerpo">
        <b>{label}{info && <Info tip={info} />}</b>
        {detail && <span className="muted small">{detail}</span>}
      </span>
    </label>
  )
}
