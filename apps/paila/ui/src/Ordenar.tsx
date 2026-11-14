// Ordenar, la revisión única (MASTERPLAN-5, 2.2 y etapa 3): al entrar, PAILA arma sola la lista de lo que propone (sin botones de
// buscar) y la muestra en grupos con lo seguro tildado, lo dudoso arriba ("Para decidir vos") y un solo Aplicar, que escribe en el
// orden que no rompe nada (core/aplicar.ts). Dos preguntas, una sola vez: cómo van las carpetas (OrdenarCarpetas.tsx) y si busca
// en internet (OrdenarInternet.tsx); con el sí, lo que encuentra se suma solo. Las pantallas de cada parte (Duplicados, Arreglar
// nombres, Organizar…) siguen para ver el detalle o usar una sola.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EleccionRevision, OrganizeOptions, RevisionOrdenar } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Info, Rico } from '@paila/diseno'
import type { PageKey } from './nav'
import { T } from './Ordenar.textos'
import { T as TG } from './OrdenarGrupos.textos'
import { useAlCambiarCambios } from './hooks/useChanges'
import { EditorCarpetas, PreguntaCarpetas } from './OrdenarCarpetas'
import { GruposOrdenar } from './OrdenarGrupos'
import { ComoQueda } from './OrdenarArbol'
import { ParaDecidir } from './OrdenarDecidir'
import { BarraInternet, PreguntaInternet } from './OrdenarInternet'

const limpio = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
/** La regla en palabras: "Artista / Año - Disco / N.º - Título". */
const enPalabras = (o: OrganizeOptions) => [o.dest, o.rule].filter(Boolean).join('/')
  .replace(/%artista%/g, TG.artist).replace(/%(album|álbum)%/g, TG.album).replace(/%(año|anio)%/g, TG.year)
  .replace(/%(genero|género)%/g, TG.genre).replace(/%n%/g, TG.track).replace(/%(titulo|título)%/g, TG.title).replace(/\//g, ' / ')

/** El tilde se ve al toque; las carpetas, que dependen de lo tildado, llegan cuando PAILA termina la cuenta. */
function conTildes(r: RevisionOrdenar, claves: string[], on: boolean): RevisionOrdenar {
  const k = new Set(claves)
  const grupos = Object.fromEntries(Object.entries(r.grupos).map(([g, fs]) => [g, fs.map((f) => (k.has(f.clave) ? { ...f, on } : f))])) as RevisionOrdenar['grupos']
  return { ...r, grupos, listos: Object.values(grupos).reduce((n, fs) => n + fs.filter((f) => f.on && !f.error).length, 0) }
}

export default function Ordenar({ onApply, onStaged, onGo: _onGo, onPlay }: {
  /** El Aplicar de siempre (la barra de arriba): aplica lo tildado, en orden, como una tanda. */
  onApply: () => Promise<unknown>
  /** Avisa que cambió lo que está para aplicar (la barra de arriba se pone al día). */
  onStaged: () => void
  onGo: (p: PageKey) => void
  onPlay: (id: number) => void
}) {
  const [rev, setRev] = useState<RevisionOrdenar | null>(null)
  const [fase, setFase] = useState<'revision' | 'carpetas' | 'editor'>('revision')
  const [armando, setArmando] = useState(true)
  const [aplicando, setAplicando] = useState(false)
  const [vista, setVista] = useState<'lista' | 'arbol'>('lista')
  const [msg, setMsg] = useState<string | null>(null)
  // eligió la forma de las carpetas: la cuenta de adónde va cada tema lleva unos segundos (se avisa, no queda la pregunta quieta)
  const [eligiendo, setEligiendo] = useState(false)
  const ocupado = useRef(false)
  // la lista que acaba de llegar ya está al día: el aviso que dispara la barra de arriba no la vuelve a pedir
  const alDia = useRef(false)
  // la ventana pasa una función nueva en cada dibujo: se guarda aparte para no volver a armar la lista cada vez
  const avisar = useRef(onStaged); avisar.current = onStaged

  const correr = useCallback(async (f: () => Promise<RevisionOrdenar>) => {
    setMsg(null)
    try { setRev(await f()); alDia.current = true; avisar.current() } catch (e) { setMsg(limpio(e)) }
  }, [])
  const armar = useCallback(async () => {
    ocupado.current = true; setArmando(true)
    await correr(() => window.paila.armarRevision())
    setArmando(false); ocupado.current = false
  }, [correr])
  useEffect(() => { void armar() }, [armar])
  // si algo cambió por otro lado (otra pantalla, deshacer en el Historial), la lista se pone al día. Releer NO avisa a la barra de
  // arriba: avisarle vuelve a disparar este mismo aviso, y quedaban releyendo sin fin (la app no contestaba, 13/11).
  useAlCambiarCambios(() => {
    if (alDia.current) { alDia.current = false; return }
    if (!ocupado.current) void window.paila.revision().then(setRev, () => {})
  })
  // internet sumó algo: se le avisa a la barra de arriba, y su aviso relee la lista (una vez)
  useEffect(() => window.paila.onRevisionLista(() => avisar.current()), [])

  const tildar = (claves: string[], on: boolean) => { setRev((r) => r && conTildes(r, claves, on)); return correr(() => window.paila.tildarRevision(claves, on)) }
  const decidir = (clave: string, e: EleccionRevision) => correr(() => window.paila.decidirRevision(clave, e))
  const decidirVarias = (lista: [string, EleccionRevision][]) => correr(() => window.paila.decidirVarias(lista))
  const carpetas = async (o: OrganizeOptions | null) => {
    setFase('revision'); setEligiendo(true)
    await correr(() => window.paila.carpetasRevision(o))
    setEligiendo(false)
  }
  const internet = (si: boolean) => correr(() => window.paila.internetRevision(si))
  const aplicar = async () => {
    ocupado.current = true; setAplicando(true)
    try { await onApply() } finally { setAplicando(false); ocupado.current = false }
    await armar()
  }

  const cabecera = <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
  if (!rev) return <div className="page">{cabecera}{msg ? <Aviso>{T.error} {msg}</Aviso> : <p className="muted ord-armando">{T.preparando}</p>}</div>
  if (eligiendo) return <div className="page">{cabecera}<p className="muted ord-armando">{T.calculando}</p></div>
  if (fase === 'editor') return <div className="page"><EditorCarpetas regla={rev.regla} onUsar={carpetas} onVolver={() => setFase('carpetas')} /></div>
  if (fase === 'carpetas' || rev.carpetas === null) {
    return <div className="page">{cabecera}<PreguntaCarpetas regla={rev.regla} hoy={rev.formaHoy} onElegir={carpetas} onEditor={() => setFase('editor')} /></div>
  }
  if (rev.internet.elegido === null) return <div className="page">{cabecera}<PreguntaInternet onElegir={internet} /></div>

  const hay = rev.listos > 0 || rev.decidir.length > 0 || Object.values(rev.grupos).some((g) => g.length > 0)
  return (
    <div className="page ord">
      {cabecera}
      <div className="ord-carpetas muted small">
        {rev.carpetas === 'regla' ? T.carpetasCon(enPalabras(rev.regla)) : T.carpetasNoTocar}
        <button className="link" onClick={() => setFase('carpetas')}>{T.cambiar}</button>
      </div>
      {msg && <Aviso>{T.error} {msg}</Aviso>}
      <div className="ord-barra">
        <div className="ord-barra-texto">
          {armando && !hay ? <span className="ord-armando">{T.preparando}</span> : hay ? <b><Rico texto={T.propone(rev.listos)} /></b> : <b>{T.todoAlDia}</b>}
          <span className="muted small">{armando && hay ? T.reArmando : <>{T.nadaSeToca} <Info tip={T.deshacerTip} /></>}</span>
        </div>
        {rev.grupos.mov.length > 0 && (
          <span className="row ord-vistas">
            <Boton size="sm" variant="ghost" selected={vista === 'lista'} onClick={() => setVista('lista')}>{T.queVaAPasar}</Boton>
            <Boton size="sm" variant="ghost" selected={vista === 'arbol'} onClick={() => setVista('arbol')}>{T.comoQueda}</Boton>
          </span>
        )}
        {rev.listos > 0 && <Boton variant="aplicar" size="lg" loading={aplicando} disabled={armando} onClick={aplicar}>{aplicando ? T.aplicando : T.aplicar(rev.listos)}</Boton>}
      </div>
      <BarraInternet elegido={rev.internet.elegido} buscando={rev.internet.buscando} onPrender={() => void internet(true)} />
      {vista === 'arbol' && rev.grupos.mov.length > 0 ? <ComoQueda rev={rev} /> : (
        <>
          <ParaDecidir cartas={rev.decidir} onDecidir={decidir} onDecidirVarias={decidirVarias} onPlay={onPlay} />
          <GruposOrdenar rev={rev} onTildar={tildar} onCambiarCarpetas={() => setFase('carpetas')} />
        </>
      )}
    </div>
  )
}
