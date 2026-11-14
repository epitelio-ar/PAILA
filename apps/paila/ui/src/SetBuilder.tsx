// Pantalla "Armar un set" (Fase F, sección Para DJs): la curva de energía de una playlist, cómo pega cada tema con el
// siguiente (tono Camelot, BPM y energía) y qué tema poner después de uno, con la explicación de cada sugerencia. La pestaña
// "Tu energía" (EnergiaMarcas.tsx) ajusta la energía a tu oído.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { NextSuggestion, PlaylistNode, SetCurve, SetTransition } from '@paila/shared/types'
import { Boton, Cabecera, Columnas, Info, PantallaVacia, Pestanas, Pildora, Rico, type TonoPildora } from '@paila/diseno'
import { textos, num, plural } from '@paila/shared/idioma'
import EnergiaMarcas from './EnergiaMarcas'
import { conTeclado } from './conTeclado'

const T = textos({
  camelot: {
    es: 'La rueda Camelot ordena los tonos para mezclar: el mismo número y letra (8A) es el mismo tono; ±1 (7A, 9A) es un vecino que pega bien; cambiar la letra (8A ↔ 8B) es el relativo, con las mismas notas.',
    en: 'The Camelot wheel orders keys for mixing: the same number and letter (8A) is the same key; ±1 (7A, 9A) is a neighbor that mixes well; changing the letter (8A ↔ 8B) is the relative key, with the same notes.',
  },
  energia: {
    es: 'Energía de 1 a 10, estimada por PAILA con el volumen, cuánto invita a bailar, el tempo y, si bajaste el modelo de estilos, si suena agresivo o tranqui. Es orientativa: sirve para ver si el set sube, baja o se queda. En la pestaña "Tu energía" la ajustás a tu oído.',
    en: 'Energy from 1 to 10, estimated by PAILA from the loudness, how danceable it is, the tempo and, if you downloaded the styles model, whether it sounds aggressive or chill. It is only a guide: it helps you see if the set goes up, goes down or stays level. In the "Your energy" tab you adjust it to your ear.',
  },
  bpm: {
    es: 'BPM: golpes por minuto. Hasta un 2–3 % de diferencia se acomoda sin que se note; más que eso cambia el tono si no usás "master tempo".',
    en: 'BPM: beats per minute. Up to a 2–3 % difference can be matched without anyone noticing; more than that changes the pitch unless you use "master tempo".',
  },
  pase: {
    es: 'Qué tan bien pega un tema con el que sigue, de 0 a 100: suma el tono (lo que más pesa), el BPM y el salto de energía.',
    en: 'How well a track fits the one that follows, from 0 to 100: it adds up the key (which weighs the most), the BPM and the energy jump.',
  },
  igual: { es: 'mismo tono', en: 'same key' },
  vecino: { es: 'vecino', en: 'neighbor' },
  relativo: { es: 'relativo', en: 'relative' },
  diagonal: { es: 'diagonal', en: 'diagonal' },
  choca: { es: 'choca', en: 'clashes' },
  sinDato: { es: 'sin dato', en: 'no data' },
  sinTonoCorto: { es: 'sin tono', en: 'no key' },
  pctSufijo: { es: ' %', en: '%' },
  armar: { es: 'Armar un set', en: 'Build a set' },
  tabSet: { es: 'El set', en: 'The set' },
  tabEnergia: { es: 'Tu energía', en: 'Your energy' },
  sinPlaylists: { es: 'Todavía no hay playlists', en: 'No playlists yet' },
  sinPlaylistsTexto: {
    es: 'Armá una playlist con los temas de tu set y volvé acá para ver cómo pegan entre sí.',
    en: 'Build a playlist with the tracks of your set and come back to see how they fit together.',
  },
  info: {
    es: 'Elegí una playlist: PAILA muestra la curva de energía y cómo pega cada tema con el siguiente. Tocá un tema para ver qué conviene poner después.',
    en: 'Pick a playlist: PAILA shows the energy curve and how each track fits the next one. Tap a track to see what is best to play after it.',
  },
  detalleCurva: {
    es: (i: number, quien: string, titulo: string, e: number | string) => `${i}. ${quien}${titulo}: energía ${e}`,
    en: (i: number, quien: string, titulo: string, e: number | string) => `${i}. ${quien}${titulo}: energy ${e}`,
  },
  pases: { es: (avg: number) => `Pases: promedio **${avg}**/100 {info}`, en: (avg: number) => `Transitions: average **${avg}**/100 {info}` },
  flojos: { es: '{n} flojos', en: '{n} weak' },
  sinTono: {
    es: (a: number, b: number) => `${a} de ${b} temas todavía no tienen tono: el análisis no los midió (pantalla Análisis). Sin tono, el pase se calcula solo con el BPM y la energía.`,
    en: (a: number, b: number) => `${a} of ${b} ${plural(b, 'track doesn\'t', 'tracks don\'t')} have a key yet: the analysis hasn't measured ${a === 1 ? 'it' : 'them'} (Analysis screen). Without a key, the transition is calculated from the BPM and energy only.`,
  },
  curva: { es: 'Curva de energía', en: 'Energy curve' },
  curvaTitulo: { es: 'Energía de cada tema, en el orden de la playlist', en: 'Energy of each track, in playlist order' },
  colTema: { es: 'Tema', en: 'Track' },
  colTono: { es: 'Tono', en: 'Key' },
  colEnergia: { es: 'Energía', en: 'Energy' },
  colPase: { es: 'Pase al siguiente', en: 'Transition to next' },
  tocaVer: { es: 'Tocá para ver qué poner después', en: 'Tap to see what to play next' },
  pildoraTitulo: {
    es: (tono: string, bpm: string, e: string) => `Tono: ${tono} · BPM ${bpm} · energía ${e}`,
    en: (tono: string, bpm: string, e: string) => `Key: ${tono} · BPM ${bpm} · energy ${e}`,
  },
  ultimo: { es: 'último', en: 'last' },
  despues: { es: (titulo: string) => `¿Qué va después de «${titulo}»?`, en: (titulo: string) => `What goes after "${titulo}"?` },
  bajar: { es: 'Bajar la energía', en: 'Lower the energy' },
  mantener: { es: 'Mantener la energía', en: 'Keep the energy' },
  subir: { es: 'Subir la energía', en: 'Raise the energy' },
  buscaEn: { es: 'Busca en toda tu Música; primero los de esta playlist.', en: 'It searches all your Music; the ones in this playlist come first.' },
  nadaParaSugerir: {
    es: 'No hay temas con BPM y tono para sugerir (hace falta que el análisis haya pasado).',
    en: 'There are no tracks with BPM and key to suggest (the analysis needs to have run first).',
  },
  enEstaPlaylist: { es: 'en esta playlist', en: 'in this playlist' },
})

const tone = (t: SetTransition): TonoPildora => (t.score >= 75 ? 'ok' : t.score >= 50 ? 'info' : t.score >= 30 ? 'atencion' : 'error')
const keyWord = (k: NonNullable<SetTransition['key']>): string => T[k === 'igual' ? 'igual' : k === 'vecino' ? 'vecino' : k === 'relativo' ? 'relativo' : k === 'diagonal' ? 'diagonal' : 'choca']
const pct = (x: number | null) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x)}${T.pctSufijo}`)

export default function SetBuilder({ playlists, onPlay, onChanged }: { playlists: PlaylistNode[]; onPlay: (id: number) => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'set' | 'energia'>('set')
  const tabs = <Pestanas label={T.armar} value={tab} onChange={setTab} items={[{ key: 'set', label: T.tabSet }, { key: 'energia', label: T.tabEnergia }]} />
  if (tab === 'energia') return <div className="page"><Cabecera nivel={2} titulo={T.armar} />{tabs}<EnergiaMarcas onPlay={onPlay} onChanged={onChanged} /></div>
  return <SetCurvePage playlists={playlists} tabs={tabs} />
}

function SetCurvePage({ playlists, tabs }: { playlists: PlaylistNode[]; tabs: ReactNode }) {
  const lists = playlists.filter((p) => p.kind !== 'folder' && p.count > 1)
  const [plId, setPlId] = useState<number | null>(lists[0]?.id ?? null)
  const [curve, setCurve] = useState<SetCurve | null>(null)
  const [from, setFrom] = useState<number | null>(null)
  const [energy, setEnergy] = useState(0)
  const [next, setNext] = useState<NextSuggestion[] | null>(null)

  useEffect(() => { setCurve(null); setFrom(null); if (plId != null) window.paila.setCurve(plId).then(setCurve).catch(() => setCurve({ tracks: [], transitions: [] })) }, [plId])
  useEffect(() => { setNext(null); if (from != null) window.paila.setNext(from, plId, energy).then(setNext).catch(() => setNext([])) }, [from, energy, plId])

  const datos = useMemo(() => (curve?.tracks ?? []).map((t, i) => ({ label: String(i + 1), valor: t.energy ?? 0, detalle: T.detalleCurva(i + 1, t.artist ? `${t.artist} – ` : '', t.title, t.energy ?? '?') })), [curve])
  const avg = curve?.transitions.length ? Math.round(curve.transitions.reduce((s, t) => s + t.score, 0) / curve.transitions.length) : null
  const weak = curve?.transitions.filter((t) => t.score < 40).length ?? 0
  const noKey = curve?.tracks.filter((t) => !t.camelot).length ?? 0

  if (!lists.length) return <div className="page">{tabs}<PantallaVacia titulo={T.sinPlaylists}>{T.sinPlaylistsTexto}</PantallaVacia></div>
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.armar} info={T.info} />
      {tabs}
      <div className="row">
        <select value={plId ?? ''} onChange={(e) => setPlId(Number(e.target.value))}>{lists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.count})</option>)}</select>
        {avg != null && <span className="small"><Rico texto={T.pases(avg)} partes={{ info: <Info tip={T.pase} /> }} />{weak ? <> · <Rico texto={T.flojos} partes={{ n: <b className="doubt">{weak}</b> }} /></> : null}</span>}
      </div>
      {!curve ? <div className="spinner" /> : (
        <>
          {noKey > 0 && <p className="muted small">{T.sinTono(noKey, curve.tracks.length)}</p>}
          <h4>{T.curva} <Info tip={T.energia} /></h4>
          <Columnas datos={datos} alto={120} titulo={T.curvaTitulo} />
          <div className="box" style={{ marginTop: 12 }}>
            <div className="box-head" style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px 56px 62px 190px', gap: 8 }}>
              <span>#</span><span>{T.colTema}</span><span>BPM <Info tip={T.bpm} /></span><span>{T.colTono} <Info tip={T.camelot} /></span><span>{T.colEnergia}</span><span>{T.colPase}</span>
            </div>
            {curve.tracks.map((t, i) => {
              const tr = curve.transitions[i]
              return (
                <div key={`${t.id}-${i}`} className={`box-row${from === t.id ? ' selected' : ''}`} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px 56px 62px 190px', gap: 8, cursor: 'pointer' }} onClick={() => setFrom(t.id)} {...conTeclado(() => setFrom(t.id))} title={T.tocaVer}>
                  <span className="muted num">{i + 1}</span>
                  <span className="ellipsis">{t.artist ? <span className="muted">{t.artist} – </span> : null}{t.title}</span>
                  <span className="num">{t.bpm ? num(t.bpm) : '—'}</span>
                  <span className="num">{t.camelot ?? '—'}</span>
                  <span className="num">{t.energy ?? '—'}</span>
                  <span>{tr ? <Pildora tone={tone(tr)} title={T.pildoraTitulo(tr.key ? keyWord(tr.key) : T.sinDato, pct(tr.bpmPct), tr.energyJump == null ? '—' : tr.energyJump > 0 ? `+${tr.energyJump}` : String(tr.energyJump))}>{tr.score} · {tr.key ? keyWord(tr.key) : T.sinTonoCorto}, {pct(tr.bpmPct)}</Pildora> : <span className="muted small">{T.ultimo}</span>}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {from != null && (
        <>
          <h4>{T.despues(curve?.tracks.find((t) => t.id === from)?.title ?? '')}</h4>
          <div className="row">
            {([[-1, T.bajar], [0, T.mantener], [1, T.subir]] as const).map(([v, l]) => <Boton key={v} size="sm" variant={energy === v ? undefined : 'ghost'} onClick={() => setEnergy(v)}>{l}</Boton>)}
            <span className="muted small">{T.buscaEn}</span>
          </div>
          {!next ? <div className="spinner" /> : !next.length ? <p className="muted small">{T.nadaParaSugerir}</p> : (
            <div className="box">
              {next.map((s) => (
                <div key={s.track.id} className="box-row" style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 8, cursor: 'default' }}>
                  <Pildora tone={tone(s.transition)}>{s.transition.score}</Pildora>
                  <span className="ellipsis">{s.track.artist ? <span className="muted">{s.track.artist} – </span> : null}{s.track.title}<div className="muted small">{s.why}</div></span>
                  <span>{s.inPlaylist && <Pildora tone="acento">{T.enEstaPlaylist}</Pildora>}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
