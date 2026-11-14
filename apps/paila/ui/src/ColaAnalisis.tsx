// Modo avanzado: la cola del análisis. Qué hace el análisis ahora y qué espera en cada pasada (de cero, huellas, calidad con el motor
// nuevo, pasada precisa), con los primeros temas de cada una y los que no se pudieron leer. Se actualiza solo cada 3 segundos.
import { useEffect, useState } from 'react'
import type { AnalysisQueueView } from '@paila/shared/types'
import { Aviso, Barra, Boton, Caja, Cabecera, Info, Pildora } from '@paila/diseno'
import { n } from './format'
import { toast } from './toast'
import { textos } from '@paila/shared/idioma'

const T = textos({
  titulo: { es: 'Cola del análisis', en: 'Analysis queue' },
  info: { es: 'El análisis lee cada tema una vez y saca todo junto. Después hay pasadas más livianas que completan lo que falta o rehacen lo que mejoró del motor. Acá ves qué espera en cada una.', en: 'The analysis reads each track once and gets everything at the same time. After that there are lighter passes that fill in what is missing or redo what the engine improved. Here you see what is waiting in each one.' },
  esperan: { es: (a: string) => `${a} cosas esperan su turno.`, en: (a: string) => `${a} things are waiting for their turn.` },
  alDia: { es: 'No hay nada esperando: todo está al día.', en: 'Nothing is waiting: everything is up to date.' },
  ahora: { es: 'Ahora', en: 'Now' },
  enPausa: { es: 'en pausa', en: 'paused' },
  quieto: { es: 'El análisis está quieto. ', en: 'The analysis is idle. ' },
  deDe: { es: (a: string, b: string) => `${a} de ${b}`, en: (a: string, b: string) => `${a} of ${b}` },
  esperanN: { es: (a: string) => `${a} esperan`, en: (a: string) => `${a} waiting` },
  alDiaPildora: { es: 'al día', en: 'up to date' },
  inspeccionar: { es: 'Inspeccionar este tema', en: 'Inspect this track' },
  ymas: { es: (a: string) => `… y ${a} más.`, en: (a: string) => `… and ${a} more.` },
  noLeidos: { es: 'No se pudieron leer', en: "Couldn't be read" },
  noLeidosInfo: { es: 'Temas con un error de lectura: el análisis no los reintenta solo en cada arranque. «Reanalizar» borra el error y los vuelve a la cola.', en: 'Tracks with a read error: the analysis does not retry them on its own at every start. "Re-analyze" clears the error and puts them back in the queue.' },
  reanalizar: { es: 'Reanalizar', en: 'Re-analyze' },
  todoAnalizado: { es: 'Todo analizado.', en: 'Everything analyzed.' },
})

export default function ColaAnalisis({ onInspect }: { onInspect: (id: number) => void }) {
  const [v, setV] = useState<AnalysisQueueView | null>(null)
  useEffect(() => {
    let vivo = true
    const cargar = () => window.paila.advQueue().then((x) => { if (vivo) setV(x) }).catch(() => {})
    void cargar()
    const t = setInterval(cargar, 3000)
    return () => { vivo = false; clearInterval(t) }
  }, [])
  if (!v) return <div className="page"><div className="center"><div className="spinner" /></div></div>
  const total = v.lanes.reduce((s, l) => s + l.count, 0)
  const reanalizar = async (id: number) => toast(await window.paila.advReanalyze(id), 'ok')

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} info={T.info}
        sub={total ? T.esperan(n(total)) : T.alDia} />
      <Caja head={<><b>{T.ahora}</b>{v.paused && <Pildora tone="atencion">{T.enPausa}</Pildora>}</>} pad>
        {v.running ? (<>
          <div>{v.phase || v.running}</div>
          {v.toProbe > 0 && <><Barra value={Math.round((v.probed * 100) / v.toProbe)} /><div className="muted small">{T.deDe(n(v.probed), n(v.toProbe))}{v.current ? ` · ${v.current.split(/[\\/]/).slice(-2).join('/')}` : ''}</div></>}
        </>) : <span className="muted">{T.quieto}{v.phase}</span>}
      </Caja>
      {v.lanes.map((l) => (
        <Caja key={l.key} head={<><b>{l.label}</b><Info tip={l.help} /><Pildora tone={l.count ? 'atencion' : 'ok'}>{l.count ? T.esperanN(n(l.count)) : T.alDiaPildora}</Pildora></>} pad={l.next.length > 0}>
          {l.next.length > 0 && (<>
            <ul className="insp-items">{l.next.map((t) => <li key={t.id}><button className="link" onClick={() => onInspect(t.id)} title={T.inspeccionar}>#{t.id}</button> {t.rel} <span className="muted small">— {t.why}</span></li>)}</ul>
            {l.count > l.next.length && <div className="muted small">{T.ymas(n(l.count - l.next.length))}</div>}
          </>)}
        </Caja>
      ))}
      {v.failed.length > 0 && (
        <Caja head={<><b>{T.noLeidos}</b><Info tip={T.noLeidosInfo} /></>} pad>
          <ul className="insp-items">{v.failed.map((t) => <li key={t.id}><button className="link" onClick={() => onInspect(t.id)}>#{t.id}</button> {t.rel} <span className="muted small">— {t.why}</span> <Boton variant="ghost" size="sm" onClick={() => reanalizar(t.id)}>{T.reanalizar}</Boton></li>)}</ul>
        </Caja>
      )}
      {!total && !v.failed.length && <Aviso tone="ok">{T.todoAnalizado}</Aviso>}
    </div>
  )
}
