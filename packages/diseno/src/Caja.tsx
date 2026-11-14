// Caja (tarjeta) y aviso compartidos: la caja agrupa cosas con su encabezado; el aviso dice algo con el color de su función.
import type { HTMLAttributes, ReactNode } from 'react'

export interface CajaProps extends HTMLAttributes<HTMLDivElement> {
  /** Encabezado (título, píldoras, botones). */
  head?: ReactNode
  /** Apagada: se ve opaca (algo que se decidió saltear). */
  skipped?: boolean
  /** Elegida: borde con el color de la app. */
  selected?: boolean
  /** Con margen adentro (para texto y controles; sin él, para listas que van de borde a borde). */
  pad?: boolean
  /** Algo falló en esta caja. */
  error?: boolean
}

export function Caja({ head, skipped, selected, error, pad, className, children, ...rest }: CajaProps) {
  const cls = ['box', skipped && 'skipped', selected && 'on', error && 'is-error', className].filter(Boolean).join(' ')
  return <div className={cls} {...rest}>{head && <div className="box-head">{head}</div>}{pad ? <div className="box-body">{children}</div> : children}</div>
}

export type TonoAviso = 'info' | 'ok' | 'atencion' | 'error'
const CLASE_AVISO: Record<TonoAviso, string> = { info: '', ok: ' hint-ok', atencion: ' hint-warn', error: ' hint-error' }

/** Aviso en la página: dato (color de la app), listo (verde), atención (ámbar) o error (rojo). */
export function Aviso({ tone = 'info', className, children, ...rest }: { tone?: TonoAviso } & HTMLAttributes<HTMLDivElement>) {
  return <div className={`hint${CLASE_AVISO[tone]}${className ? ' ' + className : ''}`} role={tone === 'error' ? 'alert' : 'status'} {...rest}>{children}</div>
}
