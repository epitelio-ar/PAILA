// Pantalla Recortar silencios (masterplan 4, 4A.3): busca dónde cortar los silencios largos del principio y del final
// (core/trim.ts), deja escuchar cada lado antes y después, y pasa lo elegido a Cambios pendientes. Se llega desde el Centro
// de problemas. Aplicar y deshacer van por Cambios pendientes y el Historial.
import { useEffect, useRef, useState } from 'react'
import type { TrimPlan, TrimProposal } from '@paila/shared/types'
import { Boton, Cabecera, Info, Rico } from '@paila/diseno'
import { num, textos } from '@paila/shared/idioma'
import { Icon } from './icons'
import { JobPanel, useJob } from './jobs'
import { n } from './format'
import { toast } from './toast'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const s = (x: number) => `${num(Math.round(x * 10) / 10)} s`
const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`

const T = textos({
  titulo: { es: 'Recortar silencios', en: 'Trim silences' },
  sub: { es: 'Que tus temas no tarden en arrancar ni queden callados al final.', en: "So your tracks don't take long to start or go quiet at the end." },
  intro: {
    es: 'PAILA avisa los temas que tardan 2 s o más en sonar, o que quedan 5 s o más callados al final. Acá los recorta {que}, sin perder calidad y con los tags intactos {como}. Nada se escribe hasta que aplicás en Cambios pendientes, y se puede deshacer. Los sample packs nunca se tocan, y en los temas con marcas de DJ se corta solo el final {dj}.',
    en: 'PAILA flags tracks that take 2 s or more to start, or stay silent for 5 s or more at the end. Here it trims them {que}, without losing quality and with the tags untouched {como}. Nothing is written until you apply in Pending changes, and it can be undone. Sample packs are never touched, and in tracks with DJ marks only the end is trimmed {dj}.',
  },
  que: {
    es: 'Se corta solo lo que no se oye: lo que está por debajo de −80 dB, como el silencio digital de un CD o el final mudo de un video. Lo que se oye, aunque sea un golpe suelto, no se toca; un ruido de fondo bajito (una cinta, un vinilo, el público de un vivo) tampoco. Queda un respiro: 0,3 s antes de que empiece a sonar y 1 s después de que termine, para que no arranque ni corte en seco.',
    en: "Only what can't be heard is trimmed: anything below −80 dB, like a CD's digital silence or the mute end of a video. Anything you can hear, even a single knock, is left alone; so is a quiet background noise (a tape, a vinyl, a live crowd). A little breath is kept: 0.3 s before the sound starts and 1 s after it ends, so it doesn't start or stop abruptly.",
  },
  como: {
    es: 'Sin perder calidad: en los MP3 se sacan pedazos enteros del archivo sin volver a comprimir (los tags quedan idénticos); en los FLAC, WAV y AIFF no se pierde nada. Antes de reemplazar, PAILA compara el recortado con el original y, si no suena igual, no lo usa. El original queda en la papelera de PAILA y se vuelve con Deshacer, en el Historial.',
    en: "Without losing quality: in MP3s whole pieces of the file are removed without compressing again (the tags stay identical); in FLAC, WAV and AIFF nothing is lost. Before replacing, PAILA compares the trimmed file with the original and, if it doesn't sound the same, it isn't used. The original stays in the PAILA trash and comes back with Undo, in History.",
  },
  dj: {
    es: 'Si un tema tiene cues o grilla de Rekordbox o de Serato, cortar el principio correría todas esas marcas: en esos temas se corta solo el final.',
    en: 'If a track has Rekordbox or Serato cues or a beatgrid, trimming the start would shift all those marks: in those tracks only the end is trimmed.',
  },
  temas: { es: 'temas', en: 'tracks' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  buscarTip: { es: 'Lee cada tema con el aviso, entero, para ver dónde cortar. No toca ningún archivo.', en: "Reads each flagged track in full to see where to trim. It doesn't touch any file." },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  buscarDeNuevo: { es: 'Buscar de nuevo', en: 'Search again' },
  buscar: { es: 'Buscar dónde cortar', en: 'Find where to trim' },
  pasar: { es: (k: string) => `Sumar ${k} a lo que vas a aplicar`, en: (k: string) => `Add ${k} to what you are going to apply` },
  pasados: {
    es: (k: string) => `Quedaron ${k} recortes en Cambios pendientes. Revisalos abajo y aplicá; se deshacen desde el Historial.`,
    en: (k: string) => `${k} trims are now in Pending changes. Check them below and apply; they're undone from History.`,
  },
  nada: { es: 'No hay silencios para recortar.', en: 'There are no silences to trim.' },
  nadaPorque: { es: 'No hay silencios para recortar (los que tienen el aviso no se pueden cortar: mirá abajo por qué).', en: "There are no silences to trim (the flagged ones can't be trimmed: see why below)." },
  todos: { es: 'Elegir todos', en: 'Select all' },
  tema: { es: 'Tema', en: 'Track' },
  alEmpezar: { es: 'Al empezar', en: 'At the start' },
  alTerminar: { es: 'Al terminar', en: 'At the end' },
  queda: { es: 'Queda', en: 'Remains' },
  seCortan: { es: (x: string) => `se cortan ${x}`, en: (x: string) => `${x} trimmed` },
  noSeToca: { es: 'no se toca', en: 'left as is' },
  de: { es: (d: string) => `de ${d}`, en: (d: string) => `of ${d}` },
  antes: { es: 'antes', en: 'before' },
  despues: { es: 'después', en: 'after' },
  antesTip: { es: 'Como está ahora, con el silencio', en: 'As it is now, with the silence' },
  despuesTip: { es: 'Como va a quedar', en: "How it's going to be" },
  noSeRecortan: { es: (k: string) => `No se recortan: ${k}`, en: (k: string) => `Not trimmed: ${k}` },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  verPorQue: { es: 'Ver por qué', en: 'See why' },
})

/** Escuchar un pedazo de un tema (de `from` a `to` segundos): para comparar el antes y el después de cada corte. */
function useSnippet() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const play = (key: string, id: number, from: number, to: number) => {
    const a = audio.current ?? (audio.current = new Audio())
    if (playing === key) { a.pause(); setPlaying(null); return }
    a.ontimeupdate = () => { if (a.currentTime >= to) { a.pause(); setPlaying(null) } }
    a.onended = () => setPlaying(null)
    const start = () => { a.currentTime = Math.max(0, from); a.play().then(() => setPlaying(key)).catch(() => setPlaying(null)) }
    if (a.src.endsWith(`/audio/${id}`)) start()
    else { a.src = `paila://audio/${id}`; a.onloadedmetadata = start }
  }
  return { playing, play }
}

export default function Silencios({ onStaged }: { onStaged: () => void }) {
  const job = useJob('recortar')
  const [plan, setPlan] = useState<TrimPlan | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [showSkipped, setShowSkipped] = useState(false)
  const snip = useSnippet()
  const show = (p: TrimPlan | null) => { setPlan(p); setChosen(new Set(p?.items.map((i) => i.fileId) ?? [])) }
  useEffect(() => { window.paila.trimLast().then(show).catch(() => {}) }, [])
  const was = useRef(false)
  useEffect(() => { if (was.current && !job?.running) window.paila.trimLast().then(show); was.current = !!job?.running }, [job?.running])
  const search = () => window.paila.trimPlan().catch((e) => toast(clean(e), 'error'))
  const stage = async () => {
    try {
      await window.paila.trimStage([...chosen]); onStaged()
      toast(T.pasados(n(chosen.size)))
    } catch (e) { toast(clean(e), 'error') }
  }
  const toggle = (id: number) => setChosen((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x })

  /** Los botones para escuchar un lado: antes (con el silencio) y después (como va a quedar). */
  const listen = (p: TrimProposal, side: 'start' | 'end') => {
    const sound = side === 'start' ? p.silenceStart : p.duration - p.silenceEnd
    const before: [number, number] = side === 'start' ? [0, sound + 3] : [Math.max(0, sound - 5), p.duration]
    const after: [number, number] = side === 'start' ? [p.from, sound + 3] : [Math.max(0, sound - 5), p.to]
    const btn = (what: 'antes' | 'despues', [a, b]: [number, number]) => {
      const key = `${p.fileId}-${side}-${what}`
      return <button className="link small" onClick={() => snip.play(key, p.fileId, a, b)} title={what === 'antes' ? T.antesTip : T.despuesTip}>
        <Icon name={snip.playing === key ? 'pause' : 'play'} size={11} className="ic-inline" /> {what === 'antes' ? T.antes : T.despues}
      </button>
    }
    return <span className="row-tight">{btn('antes', before)} · {btn('despues', after)}</span>
  }

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <p className="muted small"><Rico texto={T.intro} partes={{ que: <Info tip={T.que} />, como: <Info tip={T.como} />, dj: <Info tip={T.dj} /> }} /></p>
      {job && <JobPanel job={job} unit={T.temas} onDismiss={() => window.paila.dismissJob('recortar')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('recortar')}>{T.cancelar}</Boton>}</JobPanel>}
      <div className="row">
        <Boton disabled={!!job?.running} onClick={search} title={T.buscarTip}>
          {job?.running ? T.buscando : plan ? T.buscarDeNuevo : T.buscar}
        </Boton>
        {plan && chosen.size > 0 && <Boton onClick={stage}>{T.pasar(n(chosen.size))}</Boton>}
      </div>
      {plan && !plan.items.length && <div className="callout">{plan.skipped.length ? T.nadaPorque : T.nada}</div>}
      {plan && plan.items.length > 0 && (
        <table className="simple small">
          <thead><tr>
            <th><input type="checkbox" checked={chosen.size === plan.items.length} onChange={(e) => setChosen(new Set(e.target.checked ? plan.items.map((i) => i.fileId) : []))} title={T.todos} /></th>
            <th>{T.tema}</th><th>{T.alEmpezar}</th><th>{T.alTerminar}</th><th>{T.queda}</th>
          </tr></thead>
          <tbody>{plan.items.map((p) => (
            <tr key={p.fileId}>
              <td><input type="checkbox" checked={chosen.has(p.fileId)} onChange={() => toggle(p.fileId)} /></td>
              <td title={p.rel}>{p.rel.split('/').pop()}{p.note && <div className="muted">{p.note}</div>}</td>
              <td>{p.cutStart ? <>{T.seCortan(s(p.from))} {listen(p, 'start')}</> : <span className="muted">{p.silenceStart >= 2 ? T.noSeToca : '–'}</span>}</td>
              <td>{p.cutEnd ? <>{T.seCortan(s(p.duration - p.to))} {listen(p, 'end')}</> : <span className="muted">–</span>}</td>
              <td className="num">{mmss(p.to - p.from)} <span className="muted">{T.de(mmss(p.duration))}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {plan && plan.skipped.length > 0 && (
        <div className="box">
          <div className="box-head" style={{ cursor: 'pointer' }} onClick={() => setShowSkipped(!showSkipped)}>
            <b>{T.noSeRecortan(n(plan.skipped.length))}</b><span className="muted small push-right">{showSkipped ? T.ocultar : T.verPorQue}</span>
          </div>
          {showSkipped && <table className="simple small"><tbody>{plan.skipped.map((k) => <tr key={k.fileId}><td title={k.rel}>{k.rel.split('/').pop()}</td><td className="muted">{k.why}</td></tr>)}</tbody></table>}
        </div>
      )}
    </div>
  )
}
