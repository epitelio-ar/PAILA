// "Tu energía" (pestaña de Armar un set, MASTERPLAN-3 punto 3): marcás de 1 a 10 unos temas que conocés y PAILA ajusta la
// energía de toda tu Música a tu oído (core/energiamarcas.ts). Abajo, el modelo de estilos (opcional, se baja aparte), que
// también afina la energía.
import { useEffect, useState } from 'react'
import type { EnergyCalibrateResult, EnergyMarksState, EnergyMarkTrack, SoundStyleInfo } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Info, Pildora, Rico } from '@paila/diseno'
import { textos, num } from '@paila/shared/idioma'
import { Icon } from './icons'

const T = textos({
  marcar: {
    es: 'Escuchá un poco cada tema y elegí cuánta energía tiene para vos: 1 es para relajarse, 5 es para mover la cabeza, 10 es lo más arriba que pincharías. No hay respuestas correctas: es tu criterio.',
    en: 'Listen to each track for a bit and choose how much energy it has for you: 1 is for relaxing, 5 is for nodding your head, 10 is the highest you would play. There are no right answers: it is your call.',
  },
  ajuste: {
    es: 'PAILA busca la combinación de lo que mide (volumen, cuánto invita a bailar, tempo, brillo y, si está el modelo de estilos, si suena agresivo o tranqui) que más se parece a tus marcas, y la usa en toda tu Música.',
    en: 'PAILA looks for the mix of what it measures (loudness, how danceable it is, tempo, brightness and, if the styles model is there, whether it sounds aggressive or chill) that best matches your marks, and uses it across all your Music.',
  },
  acierto: {
    es: 'De tus marcas, cuántas da PAILA a un punto o menos de diferencia. Para no hacer trampa, cada marca se prueba con un ajuste hecho sin ella.',
    en: 'Of your marks, how many PAILA gets within one point. To keep it honest, each mark is tested with an adjustment made without it.',
  },
  modelo: {
    es: 'Discogs-EffNet, de la Universitat Pompeu Fabra (Barcelona): escucha unos segundos de cada tema y dice a qué estilo suena (techno, reggaetón, punk…) y si suena agresivo, tranquilo o de fiesta. Su licencia solo permite usarlo sin fines comerciales (CC BY-NC), por eso no viene con PAILA: se baja aparte desde la página de la UPF.',
    en: 'Discogs-EffNet, from Universitat Pompeu Fabra (Barcelona): it listens to a few seconds of each track and says which style it sounds like (techno, reggaeton, punk…) and whether it sounds aggressive, calm or party-like. Its license only allows non-commercial use (CC BY-NC), so it does not come with PAILA: it is downloaded separately from the UPF page.',
  },
  titulo: { es: 'Tu energía', en: 'Your energy' },
  intro: {
    es: (min: number) => `Marcá de 1 a 10 unos temas que conozcas {marcar}. Con ${min} o más, PAILA ajusta la energía de toda tu Música a tu oído {ajuste}.`,
    en: (min: number) => `Rate a few tracks you know from 1 to 10 {marcar}. With ${min} or more, PAILA adjusts the energy of all your Music to your ear {ajuste}.`,
  },
  marcados: {
    es: (k: number, min: number) => `${k} ${k === 1 ? 'marcado' : 'marcados'}${k < min ? ` · faltan ${min - k}` : ''}`,
    en: (k: number, min: number) => `${k} rated${k < min ? ` · ${min - k} to go` : ''}`,
  },
  ajustar: { es: 'Ajustar a mi oído', en: 'Adjust to my ear' },
  deFabrica: { es: 'Volver a la de fábrica', en: 'Back to the default' },
  otros: { es: 'Otros temas', en: 'Other tracks' },
  ajustadaCon: { es: (k: number) => `Ajustada con ${k} marcas.`, en: (k: number) => `Adjusted with ${k} marks.` },
  listo: {
    es: (antes: number, despues: number, cambio: number) => `Listo: de tus marcas, PAILA acertaba a un punto o menos en el ${antes} %; ahora, en el ${despues} % {info}. Cambió la energía de ${num(cambio)} temas.`,
    en: (antes: number, despues: number, cambio: number) => `Done: of your marks, PAILA was within one point ${antes}% of the time; now ${despues}% {info}. The energy of ${num(cambio)} ${cambio === 1 ? 'track' : 'tracks'} changed.`,
  },
  sinEnergia: {
    es: 'Todavía no hay temas analizados con energía: dejá que PAILA analice tu Música (pantalla Análisis).',
    en: 'There are no analyzed tracks with energy yet: let PAILA analyze your Music (Analysis screen).',
  },
  escuchar: { es: 'Escuchar', en: 'Play' },
  escucharTema: { es: (t: string) => `Escuchar ${t}`, en: (t: string) => `Play ${t}` },
  energiaHoy: { es: 'La energía que le da PAILA hoy', en: 'The energy PAILA gives it today' },
  energiaDe: { es: (t: string) => `Energía de ${t}`, en: (t: string) => `Energy of ${t}` },
  desmarcar: { es: 'Tocá de nuevo para desmarcar', en: 'Tap again to clear it' },
  energiaV: { es: (v: number) => `Energía ${v}`, en: (v: number) => `Energy ${v}` },
  estilo: { es: 'Estilo por el sonido (opcional)', en: 'Style by sound (optional)' },
  listoModelo: {
    es: (heard: number, pending: number) => `El modelo de estilos está listo. Ya escuchó ${num(heard)} temas${pending ? `; faltan ${num(pending)} (lo hace en segundo plano, con el análisis)` : ''}. En la ficha de cada tema aparece a qué estilo suena cuando está muy seguro, y la energía lo tiene en cuenta. {quitar}`,
    en: (heard: number, pending: number) => `The styles model is ready. It has already listened to ${num(heard)} ${heard === 1 ? 'track' : 'tracks'}${pending ? `; ${num(pending)} to go (it does this in the background, with the analysis)` : ''}. On each track's details page it shows which style it sounds like when it is very sure, and the energy takes it into account. {quitar}`,
  },
  quitar: { es: 'Quitar el modelo', en: 'Remove the model' },
  sinModelo: {
    es: (mb: string) => `PAILA puede escuchar a qué estilo suena cada tema (techno, reggaetón, punk…) y con eso calcular mejor la energía: en una prueba con 83 temas, acertó a un punto o menos en el 83 % (sin el modelo, en el 69 %). El estilo solo se sugiere cuando está muy seguro, y nunca cambia tus tags sin que lo pidas. Pesa ${mb} y se baja de la página de la UPF; su licencia es solo para uso no comercial.`,
    en: (mb: string) => `PAILA can listen to which style each track sounds like (techno, reggaeton, punk…) and use that to work out the energy better: in a test with 83 tracks, it was within one point 83% of the time (without the model, 69%). The style is only suggested when it is very sure, and it never changes your tags unless you ask. It weighs ${mb} and is downloaded from the UPF page; its license is for non-commercial use only.`,
  },
  bajar: { es: (mb: string) => `Bajar el modelo (${mb}, uso no comercial)`, en: (mb: string) => `Download the model (${mb}, non-commercial use)` },
})

const fmtMb = (b: number) => `${Math.round(b / 1e6)} MB`

export default function EnergiaMarcas({ onPlay, onChanged }: { onPlay: (id: number) => void; onChanged: () => void }) {
  const [cands, setCands] = useState<EnergyMarkTrack[] | null>(null)
  const [state, setState] = useState<EnergyMarksState | null>(null)
  const [result, setResult] = useState<EnergyCalibrateResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<SoundStyleInfo | null>(null)
  const [modelErr, setModelErr] = useState<string | null>(null)

  const loadCands = () => window.paila.energyCandidates(24).then(setCands).catch(() => setCands([]))
  useEffect(() => { void loadCands(); void window.paila.energyMarks().then(setState); void window.paila.soundStyleInfo().then(setModel) }, [])

  const markOf = (id: number) => state?.marks.find((m) => m.id === id)?.mark ?? null
  const mark = async (id: number, v: number | null) => setState(await window.paila.energyMark(id, v))
  const calibrate = async () => {
    setBusy(true)
    try { const r = await window.paila.energyCalibrate(); setResult(r); setState(await window.paila.energyMarks()); if (r.changed) onChanged() } finally { setBusy(false) }
  }
  const reset = async () => { setBusy(true); try { await window.paila.energyReset(); setResult(null); setState(await window.paila.energyMarks()); onChanged() } finally { setBusy(false) } }
  const download = async () => {
    setModelErr(null)
    try { setModel(await window.paila.soundStyleDownload()) } catch (e) { setModelErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }

  const n = state?.marks.length ?? 0, min = state?.min ?? 12
  // los marcados que no están en la lista de sugeridos también se ven (para corregirlos)
  const shown = [...(cands ?? []), ...(state?.marks ?? []).filter((m) => !cands?.some((c) => c.id === m.id))]

  return (
    <div>
      <Cabecera nivel={3} titulo={T.titulo} info={T.marcar} />
      <p className="small"><Rico texto={T.intro(min)} partes={{ marcar: <Info tip={T.marcar} />, ajuste: <Info tip={T.ajuste} /> }} /></p>
      <div className="row">
        <Pildora tone={n >= min ? 'ok' : 'info'}>{T.marcados(n, min)}</Pildora>
        <Boton size="sm" disabled={n < min || busy} onClick={() => void calibrate()}>{T.ajustar}</Boton>
        {!!state?.calibratedWith && <Boton size="sm" variant="ghost" disabled={busy} onClick={() => void reset()}>{T.deFabrica}</Boton>}
        <Boton size="sm" variant="ghost" onClick={() => void loadCands()}>{T.otros}</Boton>
        {!!state?.calibratedWith && <span className="muted small">{T.ajustadaCon(state.calibratedWith)}</span>}
      </div>
      {result?.ok && <Aviso tone="ok"><Rico texto={T.listo(result.before, result.after, result.changed)} partes={{ info: <Info tip={T.acierto} /> }} /></Aviso>}
      {!cands ? <div className="spinner" /> : !shown.length ? <p className="muted small">{T.sinEnergia}</p> : (
        <div className="box" style={{ marginTop: 8 }}>
          {shown.map((t) => {
            const m = markOf(t.id)
            return (
              <div key={t.id} className="box-row" style={{ display: 'grid', gridTemplateColumns: '32px 1fr 64px auto', gap: 8, alignItems: 'center', cursor: 'default' }}>
                <Boton size="sm" variant="ghost" title={T.escuchar} aria-label={T.escucharTema(t.title)} onClick={() => onPlay(t.id)}><Icon name="play" size={12} /></Boton>
                <span className="ellipsis">{t.artist ? <span className="muted">{t.artist} – </span> : null}{t.title}</span>
                <span className="muted small num" title={T.energiaHoy}>PAILA {t.paila ?? '—'}</span>
                <span className="energia-marcar" role="radiogroup" aria-label={T.energiaDe(t.title)}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                    <button key={v} role="radio" aria-checked={m === v} className={`chip${m === v ? ' on' : ''}`} onClick={() => void mark(t.id, m === v ? null : v)} title={m === v ? T.desmarcar : T.energiaV(v)}>{v}</button>
                  ))}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <h4 style={{ marginTop: 20 }}>{T.estilo} <Info tip={T.modelo} /></h4>
      {!model ? null : model.ready ? (
        <p className="small"><Rico texto={T.listoModelo(model.heard, model.pending)} partes={{ quitar: <Boton size="sm" variant="ghost" onClick={() => void window.paila.soundStyleRemove().then(setModel)}>{T.quitar}</Boton> }} /></p>
      ) : (
        <>
          <p className="small">{T.sinModelo(fmtMb(model.bytes))}</p>
          {model.missing && !model.toDownload &&<p className="muted small">{model.missing}</p>}
          <Boton size="sm" onClick={() => void download()}>{T.bajar(fmtMb(model.bytes))}</Boton>
          {modelErr && <Aviso tone="error">{modelErr}</Aviso>}
        </>
      )}
    </div>
  )
}
