// Botón compartido de PAILA y NAPIA: principal, secundario (ghost), de peligro o aplicar (verde: el que cambia los archivos); chico, normal o grande; elegido y cargando.
import type { ButtonHTMLAttributes } from 'react'

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** principal (color de la app), secundario, de peligro (borra o cambia cosas de verdad) o aplicar (verde: Aplicar los Cambios pendientes, para que se distinga entre tantos amarillos: la persona 2, 1/11). */
  variant?: 'primary' | 'ghost' | 'danger' | 'aplicar'
  size?: 'sm' | 'md' | 'lg'
  /** Elegido (por ejemplo la opción activa de un grupo de botones). */
  selected?: boolean
  /** Hay algo en curso: muestra una ruedita y no deja volver a apretar. */
  loading?: boolean
}

/** Mismas formas y estados en las dos apps: normal, encima, elegido, desactivado, cargando. */
export function Boton({ variant = 'primary', size = 'md', selected, loading, className, disabled, type = 'button', children, ...rest }: BotonProps) {
  const cls = ['btn', variant === 'ghost' && 'ghost', variant === 'danger' && 'danger', variant === 'aplicar' && 'aplicar', size === 'sm' && 'small', size === 'lg' && 'big', selected && 'on', loading && 'loading', className].filter(Boolean).join(' ')
  return <button type={type} className={cls} disabled={disabled || loading} aria-pressed={selected} aria-busy={loading || undefined} {...rest}>{children}</button>
}
