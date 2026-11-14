// "Volver a como estaba el día…" en el Historial (MASTERPLAN-5, 3.4): un punto por cada Aplicar. Volver a uno deshace ese Aplicar y
// todo lo que tocó archivos después, de lo más nuevo a lo más viejo, con la misma vista previa (qué se deshace, una por una). El botón
// dice siempre qué deshace. Los puntos salen de core/history-cadena.ts (`puntos`).
import { useEffect, useState } from 'react'
import type { HistoryPunto } from '@paila/shared/types'
import { cant, fecha, fechaHora, num, textos } from '@paila/shared/idioma'
import { ConfirmarBoton } from './Confirmar'
import { Icon } from './icons'
import { conTeclado } from './conTeclado'

const T = textos({
  titulo: { es: 'Volver a como estaba el día…', en: 'Go back to how it was on…' },
  ayuda: {
    es: 'Un punto por cada vez que apretaste Aplicar. Volver a uno deshace ese Aplicar y todo lo que cambió archivos después, de lo más nuevo a lo más viejo.',
    en: 'One point for each time you pressed Apply. Going back to one undoes that Apply and everything that changed files afterwards, newest first.',
  },
  antesDe: { es: (cuando: string) => `Antes del Aplicar del ${cuando}`, en: (cuando: string) => `Before the Apply of ${cuando}` },
  boton: { es: (k: number) => `Volver acá (deshace ${cant(k, 'tanda', 'tandas')})`, en: (k: number) => `Go back here (undoes ${cant(k, 'batch', 'batches')})` },
  pregunta: { es: (cuando: string) => `¿Volver a como estaba antes del Aplicar del ${cuando}?`, en: (cuando: string) => `Go back to how it was before the Apply of ${cuando}?` },
  seDeshacen: { es: 'Se deshacen, de la más nueva a la más vieja:', en: 'These are undone, newest first:' },
  yMas: { es: (k: string) => `… y ${k} más`, en: (k: string) => `… and ${k} more` },
  playlists: { es: 'Tus playlists y las listas traídas quedan como están.', en: 'Your playlists and imported lists stay as they are.' },
  si: { es: 'Sí, volver', en: 'Yes, go back' },
  volviendo: { es: 'Volviendo…', en: 'Going back…' },
})

const cuando = (iso: string) => fechaHora(iso, { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
const VISTA = 8

/** `version`: cambia cuando cambia el Historial (se vuelven a pedir los puntos). */
export default function HistoryVolver({ version, busy, onVolver }: { version: unknown; busy: boolean; onVolver: (p: HistoryPunto) => void }) {
  const [puntos, setPuntos] = useState<HistoryPunto[] | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [yendo, setYendo] = useState<number | null>(null)
  useEffect(() => { void window.paila.historyPuntos().then(setPuntos) }, [version])
  useEffect(() => { if (!busy) setYendo(null) }, [busy])
  if (!puntos?.length) return null
  return (
    <div className="box hist-volver">
      <div className="box-head clicable" onClick={() => setAbierto(!abierto)} {...conTeclado(() => setAbierto(!abierto))} title={T.ayuda}>
        <Icon name="history" size={14} className="ic-inline" /> <b>{T.titulo}</b>
        <span className="muted small">{fecha(puntos[puntos.length - 1].at, { day: 'numeric', month: 'numeric' })} – {fecha(puntos[0].at, { day: 'numeric', month: 'numeric' })} · {num(puntos.length)}</span>
        <span className="push-right" />
        <button className="link" aria-label={T.titulo} onClick={(ev) => { ev.stopPropagation(); setAbierto(!abierto) }}><Icon name="chevron" size={13} className={abierto ? 'abierto' : ''} /></button>
      </div>
      {abierto && <div className="hist-detail">
        <p className="muted small">{T.ayuda}</p>
        {puntos.map((p) => (
          <div key={p.tanda} className="hist-punto">
            <div><b>{T.antesDe(cuando(p.at))}</b> <span className="muted small">{p.summary}</span></div>
            {p.canUndo
              ? <ConfirmarBoton variant="ghost" size="sm" disabled={busy} deshacer="atras" si={T.si} pregunta={T.pregunta(cuando(p.at))}
                  aviso={<span className="small">{T.seDeshacen}<ul className="hist-cadena">{p.entradas.slice(0, VISTA).map((x) => <li key={`${x.kind}:${x.id}`}>{x.summary} <span className="muted">· {cuando(x.at)}</span></li>)}</ul>
                    {p.entradas.length > VISTA && <span className="muted">{T.yMas(num(p.entradas.length - VISTA))} </span>}{T.playlists}</span>}
                  onSi={() => { setYendo(p.tanda); onVolver(p) }}>{yendo === p.tanda ? T.volviendo : T.boton(p.entradas.length)}</ConfirmarBoton>
              : <span className="muted small">{p.whyNot}</span>}
          </div>
        ))}
      </div>}
    </div>
  )
}
