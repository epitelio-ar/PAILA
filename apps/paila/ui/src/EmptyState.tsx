// Cartel que se muestra cuando una pantalla todavía no tiene nada para mostrar (logo, título y una explicación).
import logo from './assets/logo.png'

/** Pantalla vacía con la mascota: un título corto y qué hacer. */
export default function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <img src={logo} alt="" />
      <b>{title}</b>
      {children && <span style={{ maxWidth: 420 }}>{children}</span>}
    </div>
  )
}
