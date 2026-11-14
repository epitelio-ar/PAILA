// Avisos breves que aparecen en pantalla (listo, información, error): `toast()` los crea y `ToastHost` los muestra.
import { Icon } from './icons'
import { useEffect, useState } from 'react'

export type ToastKind = 'ok' | 'info' | 'error'
interface Toast { id: number; text: string; kind: ToastKind }

const listeners = new Set<(t: Toast) => void>()
/** Los que llegan antes de que se muestre la pantalla principal (por ejemplo al abrir) esperan acá. */
const queued: Toast[] = []
let seq = 0

/** Muestra un cartelito arriba a la derecha, desde cualquier parte de la interfaz. */
export function toast(text: string, kind: ToastKind = 'ok') {
  const t = { id: ++seq, text, kind }
  if (!listeners.size) queued.push(t)
  listeners.forEach((l) => l(t))
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const on = (t: Toast) => {
      setItems((x) => [...x.slice(-3), t])
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.kind === 'error' ? 9000 : 5500)
    }
    listeners.add(on)
    queued.splice(0).forEach(on)
    return () => { listeners.delete(on) }
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
          <span className="toast-ico"><Icon name={t.kind === 'ok' ? 'check' : t.kind === 'error' ? 'alert' : 'info'} size={14} /></span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
