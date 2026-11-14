// Ventana con todos los atajos de teclado (se abre con Ctrl+/ o con ? fuera de un campo de texto).
import { useEffect, useState } from 'react'
import { Cabecera, Ventana } from '@paila/diseno'
import { ATAJOS } from './atajos'
import { tr } from '@paila/shared/idioma'

export default function AtajosAyuda() {
  const [abierta, setAbierta] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const escribiendo = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (((e.ctrlKey || e.metaKey) && e.key === '/') || (!escribiendo && e.key === '?')) { e.preventDefault(); setAbierta((a) => !a) }
      else if (e.key === 'Escape') setAbierta(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!abierta) return null
  return (
    <Ventana onClose={() => setAbierta(false)} className="atajos">
      <Cabecera nivel={3} titulo={tr({ es: 'Atajos de teclado', en: 'Keyboard shortcuts' })} />
      {ATAJOS.map((g) => (
        <section key={g.grupo}>
          <h4 className="muted">{g.grupo}</h4>
          <dl className="atajos-lista">
            {g.items.map((a) => <div key={a.teclas}><dt><kbd>{a.teclas}</kbd></dt><dd>{a.hace}</dd></div>)}
          </dl>
        </section>
      ))}
    </Ventana>
  )
}
