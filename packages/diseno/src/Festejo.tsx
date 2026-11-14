// Festejo: cuando algo terminó bien, una caja verde suave con la mascota, lo que pasó y qué se puede hacer ahora. Solo para finales
// buenos (nunca en el medio del trabajo ni para un aviso común).
import type { ReactNode } from 'react'

export function Festejo({ imagen, titulo, children, acciones }: { imagen?: string; titulo: ReactNode; children?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="festejo" role="status">
      {imagen && <img src={imagen} alt="" />}
      <div className="festejo-texto">
        <b>{titulo}</b>
        {children && <div className="muted">{children}</div>}
        {acciones && <div className="row festejo-acciones">{acciones}</div>}
      </div>
    </div>
  )
}
