// Escucha A/B (o A/B/C…): varios archivos suenan sincronizados y con un botón cambiás cuál se oye, en el mismo segundo.
// La usan Reemplazar y Duplicados.
import { Icon } from './icons'
import { useEffect, useRef, useState } from 'react'
import { Boton } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

const T = textos({
  pausa: { es: 'Pausa', en: 'Pause' },
  escuchar: { es: 'Escuchar', en: 'Listen' },
  hint: { es: 'Cambiá entre A y B mientras suena para comparar en el mismo segundo.', en: 'Switch between A and B while it plays to compare at the very same second.' },
  volumen: { es: 'Escuchá con el mismo volumen: a veces uno suena más fuerte solo por ser otro master.', en: 'Listen at the same volume: sometimes one sounds louder just because it is a different master.' },
})

export interface ABSource { label: string; url: string; title?: string }

/** `elegido`: desde afuera (el "Escuchar" de una fila de Duplicados) se elige qué copia se oye y arranca. */
export function ABPlayer({ sources, hint, elegido }: { sources: ABSource[]; hint?: string; elegido?: { lado: number; at: number } | null }) {
  const refs = useRef<(HTMLAudioElement | null)[]>([])
  const [side, setSide] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const all = () => refs.current.filter((x): x is HTMLAudioElement => !!x)
  useEffect(() => { refs.current.forEach((x, i) => { if (x) x.muted = i !== side }) }, [side, sources.length])
  const toggle = () => {
    const xs = all(), lead = refs.current[0]
    if (!lead || !xs.length) return
    if (playing) { xs.forEach((x) => x.pause()); setPlaying(false); return }
    xs.forEach((x) => { if (x !== lead) x.currentTime = lead.currentTime })
    Promise.all(xs.map((x) => x.play())).then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  const seek = (v: number) => { all().forEach((x) => { x.currentTime = v }); setT(v) }
  useEffect(() => () => { all().forEach((x) => x.pause()) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!elegido) return; setSide(elegido.lado); if (!playing) toggle() }, [elegido]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ab">
      {sources.map((s, i) => (
        <audio key={s.url} ref={(el) => { refs.current[i] = el }} src={s.url} muted={i !== side}
          onTimeUpdate={i === 0 ? (e) => setT(e.currentTarget.currentTime) : undefined}
          onLoadedMetadata={i === 0 ? (e) => setDur(e.currentTarget.duration) : undefined}
          onEnded={i === 0 ? () => setPlaying(false) : undefined} />
      ))}
      <Boton size="sm" onClick={toggle}>{playing ? <><Icon name="pause" size={13} className="ic-inline" /> {T.pausa}</> : <><Icon name="play" size={13} className="ic-inline" /> {T.escuchar}</>}</Boton>
      <div className="ab-switch">
        {sources.map((s, i) => <button key={s.url} className={`btn small ${side === i ? '' : 'ghost'}`} title={s.title} onClick={() => setSide(i)}>{s.label}</button>)}
      </div>
      <input type="range" min={0} max={dur || 1} step={0.1} value={t} onChange={(e) => seek(Number(e.target.value))} className="ab-seek" />
      <span className="muted small">{hint ?? T.hint} {T.volumen}</span>
    </div>
  )
}
