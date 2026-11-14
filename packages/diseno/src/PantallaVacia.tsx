// Pantalla vacía: cuando todavía no hay nada para mostrar. Dice qué pasa y qué hacer; la mascota va solo acá y en los festejos.
import type { ReactNode } from 'react'

export function PantallaVacia({ imagen, titulo, children, accion }: { imagen?: string; titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="empty-state">
      {imagen && <img src={imagen} alt="" />}
      <b>{titulo}</b>
      {children && <span style={{ maxWidth: 420 }}>{children}</span>}
      {accion}
    </div>
  )
}
