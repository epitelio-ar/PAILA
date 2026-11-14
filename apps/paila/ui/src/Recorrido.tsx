// El recorrido de la primera vez: la oreja muestra, en globos, lo que se puede (y conviene) hacer con la música. Sale solo
// una vez, cuando termina el primer escaneo después de elegir la carpeta, y se vuelve a ver desde Ctrl+K o Configuración.
// Cada paso ilumina una parte de la pantalla (si no está a la vista, el globo va al centro).
import { useEffect, useState } from 'react'
import { Boton } from '@paila/diseno'
import type { PageKey } from './nav'
import oreja from './assets/oreja-1.png'
import { tr, textos } from '@paila/shared/idioma'

const T = textos({
  rotulo: { es: (a: number, b: number) => `${a} de ${b}`, en: (a: number, b: number) => `${a} of ${b}` },
  aria: { es: (a: number, b: number) => `Recorrido, paso ${a} de ${b}`, en: (a: number, b: number) => `Tour, step ${a} of ${b}` },
  cerrar: { es: 'Cerrar', en: 'Close' },
  saltear: { es: 'Saltear', en: 'Skip' },
  atras: { es: 'Atrás', en: 'Back' },
  siguiente: { es: 'Siguiente', en: 'Next' },
  aOrdenar: { es: 'A ordenar', en: "Let's tidy up" },
})

const KEY = 'paila.recorrido'
const EV = 'paila-recorrido'

/** La primera vez que se elige la carpeta: el recorrido queda pedido para cuando termine el escaneo. */
export function pedirRecorrido() { try { if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, 'pendiente') } catch { /* nada */ } }
/** Abrirlo a mano (Ctrl+K, Configuración). */
export function verRecorrido() { window.dispatchEvent(new CustomEvent(EV)) }

interface Paso { pagina?: PageKey; donde?: () => Element | null; titulo: string; texto: string }
const q = (s: string) => () => document.querySelector(s)
const lado = (pagina: PageKey) => q(`.side-item[data-page="${pagina}"]`)
const PASOS: Paso[] = [
  { pagina: 'home', donde: q('.heroe'), titulo: tr({ es: 'Hola, soy la oreja', en: "Hi, I'm PAILA" }), texto: tr({ es: 'Estoy escuchando tu música, tema por tema: seguí usando PAILA mientras tanto. Acá ves cuánta cera tiene tu música: cuanto más la arreglás, menos cera me queda.', en: "I'm listening to your music, track by track: keep using PAILA meanwhile. Here you see how much wax your music has: the more you fix it, the less wax I have left." }) },
  { donde: lado('problemas'), titulo: tr({ es: 'Por dónde empezar', en: 'Where to start' }), texto: tr({ es: 'El Centro de problemas junta lo que conviene arreglar: temas que dicen tener más calidad de la que tienen, sin tags, repetidos o que no se leen. Cada grupo trae su arreglo.', en: "The Problem center gathers what's worth fixing: tracks that claim more quality than they have, with no tags, duplicated or unreadable. Each group comes with its fix." }) },
  { pagina: 'library', donde: () => [...document.querySelectorAll('.th')].find((x) => /nota|grade/i.test(x.textContent ?? '')) ?? null, titulo: tr({ es: 'La nota de cada tema', en: 'The grade of each track' }), texto: tr({ es: 'De la A a la F según cómo suena de verdad, no según lo que dice el archivo: un MP3 "de 320" que en realidad es de 128 se saca una nota baja. Elegí un tema y en su ficha te explico por qué.', en: 'From A to F based on how it really sounds, not on what the file says: a "320" MP3 that is really a 128 gets a low grade. Pick a track and I\'ll explain why in its details.' }) },
  { donde: q('.pestanas'), titulo: tr({ es: 'De izquierda a derecha', en: 'From left to right' }), texto: tr({ es: 'Las pestañas son Inicio, Tu música, Ordenar, Sonido y Llevar (y DJ, si prendés esas herramientas). Adentro de cada una, las partes van numeradas. Antes de tocar un archivo te muestro qué va a cambiar.', en: "The tabs are Home, Your music, Organize, Sound and Take along (and DJ, if you turn those tools on). Inside each one, the parts are numbered. Before I touch a file I'll show you what will change." }) },
  { donde: q('.pestana[data-seccion="sonido"]'), titulo: tr({ es: 'Lo que conviene conseguir', en: "What's worth getting" }), texto: tr({ es: 'Los temas flojos o que te faltan van a la lista «Faltan o suenan mal», para buscarlos en mejor calidad cuando quieras.', en: 'Weak tracks and the ones you\'re missing go to the "Missing or low quality" list, so you can look for them in better quality whenever you like.' }) },
  { donde: q('.player'), titulo: tr({ es: 'Escuchar', en: 'Listen' }), texto: tr({ es: 'Doble clic en un tema (o la barra espaciadora) y suena. En Escuchando lo ves en grande, con la cola de lo que sigue.', en: 'Double-click a track (or press Space) and it plays. In Now playing you see it big, with the queue of what comes next.' }) },
  { donde: lado('history'), titulo: tr({ es: 'No rompo nada', en: "I don't break anything" }), texto: tr({ es: 'Ningún cambio se hace sin que lo veas antes en Cambios pendientes. Todo queda en el Historial, con Deshacer, y lo que borrás va a la Papelera de PAILA.', en: "No change happens without you seeing it first in Pending changes. Everything stays in History, with Undo, and whatever you delete goes to PAILA's Trash." }) },
  { donde: q('.side-switches'), titulo: tr({ es: 'Dos interruptores a mano', en: 'Two switches at hand' }), texto: tr({ es: 'Abajo en la barra lateral: las herramientas para DJ y producción (BPM, tono, programas de DJ), que vienen apagadas, y el estilo, historieta o sobrio. Los cambiás cuando quieras.', en: 'At the bottom of the sidebar: the DJ and production tools (BPM, key, DJ software), which start turned off, and the style, Comic or Studio. You can change them any time.' }) },
  { donde: q('.searchbox'), titulo: tr({ es: 'Y todo lo demás, con Ctrl+K', en: 'And everything else, with Ctrl+K' }), texto: tr({ es: 'Escribí lo que querés hacer ("duplicados", "pendrive", "tapas") y te llevo. Este recorrido lo volvés a ver desde Ctrl+K o Configuración.', en: 'Type what you want to do ("duplicates", "USB drive", "covers") and I\'ll take you there. You can see this tour again from Ctrl+K or Settings.' }) },
]

type Caja = { top: number; left: number; width: number; height: number }

export default function Recorrido({ listo, onPage }: { listo: boolean; onPage: (p: PageKey) => void }) {
  const [paso, setPaso] = useState<number | null>(null)
  const [caja, setCaja] = useState<Caja | null>(null)

  // a mano, desde Ctrl+K o Configuración
  useEffect(() => { const f = () => setPaso(0); window.addEventListener(EV, f); return () => window.removeEventListener(EV, f) }, [])
  // solo, la primera vez: con la música ya escaneada y sin otra ventana abierta 
  useEffect(() => {
    if (!listo || paso != null) return
    let pedido = false
    try { pedido = localStorage.getItem(KEY) === 'pendiente' } catch { /* nada */ }
    if (!pedido) return
    const t = setInterval(() => { if (!document.querySelector('.modal')) { clearInterval(t); setPaso(0) } }, 1500)
    return () => clearInterval(t)
  }, [listo, paso])

  const p = paso != null ? PASOS[paso] : null
  useEffect(() => { if (p?.pagina) onPage(p.pagina) }, [paso]) // eslint-disable-line react-hooks/exhaustive-deps
  // dónde está lo que se señala (se sigue mirando: la pantalla puede tardar en armarse o cambiar de tamaño)
  useEffect(() => {
    if (!p) return
    let primera = true
    const medir = () => {
      const el = p.donde?.()
      if (!el) { setCaja(null); return }
      if (primera) { el.scrollIntoView({ block: 'nearest' }); primera = false }
      const r = el.getBoundingClientRect()
      setCaja(r.width ? { top: r.top, left: r.left, width: r.width, height: r.height } : null)
    }
    medir()
    const t = setInterval(medir, 300)
    return () => clearInterval(t)
  }, [p])

  const cerrar = () => { setPaso(null); try { localStorage.setItem(KEY, 'visto') } catch { /* nada */ } }
  useEffect(() => {
    if (paso == null) return
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
      else if (e.key === 'ArrowRight') setPaso((x) => (x != null && x < PASOS.length - 1 ? x + 1 : x))
      else if (e.key === 'ArrowLeft') setPaso((x) => (x ? x - 1 : x))
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [paso])

  if (!p || paso == null) return null
  const ultimo = paso === PASOS.length - 1
  return (
    <div className="recorrido" role="dialog" aria-label={T.aria(paso + 1, PASOS.length)}>
      {caja ? <div className="rec-luz" style={{ top: caja.top - 6, left: caja.left - 6, width: caja.width + 12, height: caja.height + 12 }} /> : <div className="rec-velo" />}
      <div className="rec-globo-caja" style={lugar(caja)}>
        <img className="rec-oreja" src={oreja} alt="" />
        <div className="rec-globo">
          <div className="rotulo">{T.rotulo(paso + 1, PASOS.length)}</div>
          <b className="titulo">{p.titulo}</b>
          <p>{p.texto}</p>
          <div className="rec-botones">
            <Boton variant="ghost" size="sm" onClick={cerrar}>{ultimo ? T.cerrar : T.saltear}</Boton>
            <span className="grow" />
            {paso > 0 && <Boton variant="ghost" size="sm" onClick={() => setPaso(paso - 1)}>{T.atras}</Boton>}
            <Boton size="sm" onClick={() => { if (ultimo) { cerrar(); onPage('problemas') } else setPaso(paso + 1) }}>{ultimo ? T.aOrdenar : T.siguiente}</Boton>
          </div>
        </div>
      </div>
    </div>
  )
}

/** El globo va al lado de lo que señala: a la derecha si entra, si no a la izquierda, abajo o arriba; sin nada, al centro. */
const ANCHO = 470, ALTO = 230, M = 16
function lugar(c: Caja | null): React.CSSProperties {
  const W = window.innerWidth, H = window.innerHeight
  const dentro = (top: number, left: number) => ({ top: Math.max(M, Math.min(top, H - ALTO - M)), left: Math.max(M, Math.min(left, W - ANCHO - M)) })
  if (!c) return dentro((H - ALTO) / 2, (W - ANCHO) / 2)
  if (c.left + c.width + M + ANCHO < W && c.width < W / 2) return dentro(c.top, c.left + c.width + M)
  if (c.left - M - ANCHO > 0 && c.width < W / 2) return dentro(c.top, c.left - M - ANCHO)
  if (c.top + c.height + M + ALTO < H) return dentro(c.top + c.height + M, c.left)
  return dentro(c.top - M - ALTO, c.left)
}
