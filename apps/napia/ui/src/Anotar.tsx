// El botón "Anotar" de NAPIA (y Ctrl+Mayús+N), igual que el de PAILA: una cajita para escribir qué te resultó raro o confuso.
// Se guarda con la hora, la pantalla y una captura, en las notas de uso de PAILA (Configuración → Notas de uso). Nada sale de la PC.
import { useEffect, useRef, useState } from 'react'
import { Boton, Cabecera, Ventana } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

const T = textos({
  anotar: { es: 'Anotar', en: 'Note' },
  anotarTip: { es: 'Anotá qué te resultó raro o confuso, sin salir de NAPIA (Ctrl+Mayús+N). Se guarda con una captura de la ventana, solo en esta PC.', en: 'Jot down what felt odd or confusing without leaving NAPIA (Ctrl+Shift+N). It is saved with a screenshot of the window, on this PC only.' },
  titulo: { es: '¿Qué te resultó raro o confuso?', en: 'What felt odd or confusing?' },
  tip: { es: 'NAPIA guarda tu texto con la hora, la pantalla donde estabas y una captura de la ventana, junto con las notas de PAILA (en PAILA: Configuración → Notas de uso). No se manda a ningún lado.', en: "NAPIA saves your text with the time, the screen you were on and a screenshot of the window, together with PAILA's notes (in PAILA: Settings → Usage notes). Nothing is sent anywhere." },
  pista: { es: 'Contalo como se te ocurra: no hace falta decir dónde estabas, NAPIA ya lo anota.', en: "Say it however it comes: you don't need to say where you were, NAPIA already notes it." },
  placeholder: { es: 'Por ejemplo: no entendí qué hace este botón…', en: "For example: I didn't get what this button does…" },
  guardar: { es: 'Guardar', en: 'Save' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  guardada: { es: 'Nota guardada', en: 'Note saved' },
  noSePudo: { es: 'No se pudo guardar la nota', en: "The note couldn't be saved" },
  bajar: { es: 'Bajar', en: 'Download' },
  historial: { es: 'Historial', en: 'History' },
})

export default function Anotar({ vista }: { vista: 'bajar' | 'historial' }) {
  const [abierta, setAbierta] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const ocupada = useRef(false)
  const pantalla = useRef('')
  pantalla.current = vista === 'historial' ? T.historial : T.bajar

  // la captura se saca antes de abrir la cajita, para que no salga tapada por ella
  const abrir = async () => {
    if (ocupada.current) return
    ocupada.current = true
    try { await window.napia.notaCapturar() } catch { /* se anota sin captura */ }
    setTexto(''); setAviso(null); setAbierta(true)
  }
  const cerrar = () => { ocupada.current = false; setAbierta(false) }
  const guardar = async () => {
    if (!texto.trim() || guardando) return
    setGuardando(true)
    try {
      await window.napia.notaGuardar({ pantalla: pantalla.current, acciones: [], texto })
      setAviso(T.guardada); setTimeout(() => setAviso(null), 2500); cerrar()
    } catch { setAviso(T.noSePudo) }
    setGuardando(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); void abrir() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <Boton variant="ghost" size="sm" onClick={() => void abrir()} title={T.anotarTip}>{T.anotar}</Boton>
      {aviso && <span className="small muted" role="status">{aviso}</span>}
      {abierta && (
        <Ventana onClose={cerrar} busy={guardando}>
          <Cabecera nivel={3} titulo={T.titulo} info={T.tip} sub={T.pista} />
          <textarea autoFocus rows={6} style={{ width: '100%', margin: '8px 0' }} placeholder={T.placeholder} value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void guardar() } }} />
          <div className="actionrow">
            <Boton onClick={() => void guardar()} disabled={!texto.trim() || guardando}>{T.guardar}</Boton>
            <Boton variant="ghost" onClick={cerrar} disabled={guardando}>{T.cancelar}</Boton>
          </div>
        </Ventana>
      )}
    </>
  )
}
