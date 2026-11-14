// El botón "Opinar" de la barra de arriba (y Ctrl+Mayús+N): una cajita para escribir qué te resultó raro o confuso. Al guardar,
// PAILA anota la hora, la pantalla, por dónde venías y una captura de la ventana (core/notasdeuso.ts). Nada sale de la PC.
import { useEffect, useRef, useState } from 'react'
import { Boton, Cabecera, Ventana } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { toast } from './toast'
import { useAvanzado } from './avanzado'
import { NAV_AVANZADO, NAV_GROUPS, NAV_HISTORY, NAV_PLAYLISTS, NAV_SETTINGS, NAV_TOP, NAV_TRASH, type PageKey } from './nav'

const T = textos({
  anotar: { es: 'Opinar', en: 'Feedback' },
  anotarTip: { es: 'Opiná sobre lo que te resultó raro o confuso, sin salir de PAILA (Ctrl+Mayús+N). Se guarda con una captura de la ventana, solo en esta PC.', en: 'Tell us what felt odd or confusing without leaving PAILA (Ctrl+Shift+N). It is saved with a screenshot of the window, on this PC only.' },
  titulo: { es: '¿Qué te resultó raro o confuso?', en: 'What felt odd or confusing?' },
  tip: { es: 'PAILA guarda tu texto con la hora, la pantalla donde estabas, las últimas pantallas por las que pasaste y una captura de la ventana. Queda en la carpeta de datos de esta PC (Configuración → Notas de uso); no se manda a ningún lado.', en: 'PAILA saves your text with the time, the screen you were on, the last screens you went through and a screenshot of the window. It stays in this PC\'s data folder (Settings → Usage notes); nothing is sent anywhere.' },
  pista: { es: 'Contalo como se te ocurra: no hace falta decir dónde estabas, PAILA ya lo anota.', en: "Say it however it comes: you don't need to say where you were, PAILA already notes it." },
  placeholder: { es: 'Por ejemplo: no entendí qué hace este botón…', en: "For example: I didn't get what this button does…" },
  guardar: { es: 'Guardar', en: 'Save' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  guardada: { es: 'Nota guardada', en: 'Note saved' },
  noSePudo: { es: 'No se pudo guardar la nota', en: "The note couldn't be saved" },
  ficha: { es: 'Ficha de un tema', en: 'Track details' },
  biblioteca: { es: 'Biblioteca', en: 'Library' },
})

const ITEMS = [...NAV_TOP, ...NAV_GROUPS.flatMap((g) => g.items), NAV_PLAYLISTS, NAV_TRASH, NAV_HISTORY, NAV_SETTINGS, ...NAV_AVANZADO]
/** El nombre de la pantalla como se ve en la barra lateral. */
export const nombreDePantalla = (p: PageKey) => p === 'ficha' ? T.ficha : p === 'library' ? T.biblioteca : ITEMS.find((x) => x.page === p)?.label ?? p

/** Las últimas pantallas por las que se pasó (la actual, al final); `pantallas().slice(0, -1)` es "por dónde venía". */
function useRecorrido(page: PageKey) {
  const lista = useRef<string[]>([])
  useEffect(() => {
    const n = nombreDePantalla(page)
    document.documentElement.dataset.pagina = n // lo lee el modo prueba (electron/prueba.ts)
    if (lista.current[lista.current.length - 1] !== n) lista.current = [...lista.current, n].slice(-6)
  }, [page])
  return lista
}

export default function Anotar({ page }: { page: PageKey }) {
  const recorrido = useRecorrido(page)
  // solo con el modo avanzado (para quien hace PAILA): una opinión común irá en un botón de ayuda aparte
  const [avanzado] = useAvanzado()
  const [abierta, setAbierta] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const ocupada = useRef(false)

  // la captura se saca antes de abrir la cajita, para que no salga tapada por ella
  const abrir = async () => {
    if (ocupada.current) return
    ocupada.current = true
    try { await window.paila.notaCapturar() } catch { /* se anota sin captura */ }
    setTexto(''); setAbierta(true)
  }
  const cerrar = () => { ocupada.current = false; setAbierta(false) }
  const guardar = async () => {
    if (!texto.trim() || guardando) return
    setGuardando(true)
    try {
      const vistas = recorrido.current
      await window.paila.notaGuardar({ pantalla: vistas[vistas.length - 1] ?? nombreDePantalla(page), acciones: vistas.slice(0, -1), texto })
      toast(T.guardada); cerrar()
    } catch { toast(T.noSePudo, 'error') }
    setGuardando(false)
  }

  useEffect(() => {
    if (!avanzado) return
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); void abrir() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [avanzado])

  if (!avanzado) return null
  return (
    <>
      <Boton variant="ghost" size="sm" onClick={() => void abrir()} title={T.anotarTip}>{T.anotar}</Boton>
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
