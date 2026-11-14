// Pantalla "Tracklist de sets" (MASTERPLAN-3, punto 5): elegir un set, un enganchado o un recital, escucharlo y ver qué
// temas suenan y desde qué minuto; corregir a mano (quitar, confirmar, escribir), escuchar cada entrada y sacarlo como
// texto, .cue o CSV, al comentario del tag (por Cambios pendientes) o como cue points para Rekordbox.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetCandidate, SetTracklist, TrackInSet, TracklistFormat } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Casilla, Icon, Info, PantallaVacia, Pildora, Rico, type TonoPildora } from '@paila/diseno'
import { textos, num, plural, fechaHora } from '@paila/shared/idioma'
import { JobPanel, useJob } from './jobs'
import { toast } from './toast'

const T = textos({
  intro: {
    es: 'Elegí un archivo largo (un set de DJ, un enganchado, un recital): PAILA lo escucha entero y lo compara con tu biblioteca por cómo suena, como hace con los duplicados. Dice qué temas suenan y desde qué minuto. No cambia nada del archivo.',
    en: 'Pick a long file (a DJ set, a mix, a concert): PAILA listens to the whole thing and compares it with your library by how it sounds, like it does with duplicates. It tells you which tracks play and from which minute. It changes nothing in the file.',
  },
  seguridad: {
    es: 'Alta: varias partes del set suenan igual que el tema. Media: menos partes, o lo encontró escuchando el set más rápido o más lento. Baja (dudoso): una sola parte; escuchalo y confirmalo: si no, no sale en el tracklist.',
    en: 'High: several parts of the set sound the same as the track. Medium: fewer parts, or it found the track by listening to the set faster or slower. Low (doubtful): just one part; listen to it and confirm it: if not, it won\'t appear in the tracklist.',
  },
  velocidad: {
    es: 'A qué velocidad sonaba el tema en el set: +4 % es un 4 % más rápido que el original. Los DJs aceleran o frenan los temas para que vayan al mismo ritmo.',
    en: 'The speed the track played at in the set: +4 % means 4 % faster than the original. DJs speed up or slow down tracks so they run at the same pace.',
  },
  velocidades: {
    es: 'Un tema acelerado "como un disco" (sin master tempo, que cambia también la nota) no se reconoce a la primera. Con esto PAILA vuelve a escuchar los tramos sin reconocer a otras velocidades, hasta un 8 % más rápido o más lento. Tarda un poco más.',
    en: 'A track sped up "like a record" (without master tempo, which also changes the pitch) isn\'t recognized on the first try. With this, PAILA listens again to the unrecognized parts at other speeds, up to 8 % faster or slower. It takes a bit longer.',
  },
  internet: {
    es: 'Lo que no está en tu biblioteca se busca en AcoustID (una base abierta de huellas de sonido) y, si lo prendiste en Configuración, en el reconocedor (manda 15 s de audio cada 4 minutos sin reconocer).',
    en: 'What isn\'t in your library is looked up in AcoustID (an open database of sound fingerprints) and, if you turned it on in Settings, in the recognizer (it sends 15 s of audio for every 4 unrecognized minutes).',
  },
  carpeta: {
    es: 'PAILA también escucha enteros los temas de la carpeta del set: si guardaste ahí lo que tocaste, los reconoce aunque los hayas puesto desde la mitad.',
    en: 'PAILA also listens in full to the tracks in the set\'s folder: if you saved there what you played, it recognizes them even if you started them from the middle.',
  },
  tag: {
    es: 'Guarda el tracklist en el comentario del tag del set (Rekordbox y muchos reproductores lo muestran). Va a Cambios pendientes: ves el antes y el después, y se puede deshacer.',
    en: 'Saves the tracklist in the comment tag of the set (Rekordbox and many players show it). It goes to Pending changes: you see the before and after, and it can be undone.',
  },
  cues: {
    es: 'Marca en el set dónde entra cada tema, con su nombre (memory cues). Salen en el rekordbox.xml que exporta PAILA desde "Programas de DJ".',
    en: 'Marks in the set where each track comes in, with its name (memory cues). They come out in the rekordbox.xml that PAILA exports from "DJ software".',
  },
  cue: {
    es: 'Una hoja .cue hace que reproductores como foobar2000 o VLC muestren el set dividido en sus temas.',
    en: 'A .cue sheet makes players like foobar2000 or VLC show the set split into its tracks.',
  },
  // de dónde salió cada tema y qué tan seguro está
  biblioteca: { es: 'Tu biblioteca', en: 'Your library' },
  acoustid: { es: 'AcoustID', en: 'AcoustID' },
  audd: { es: 'Reconocedor', en: 'Recognizer' },
  mano: { es: 'A mano', en: 'By hand' },
  alta: { es: 'alta', en: 'high' },
  media: { es: 'media', en: 'medium' },
  baja: { es: 'baja', en: 'low' },
  confirmado: { es: 'confirmado', en: 'confirmed' },
  dudoso: { es: 'dudoso', en: 'doubtful' },
  pctSufijo: { es: ' %', en: '%' },
  // pantalla
  titulo: { es: 'Tracklist de sets', en: 'Set tracklists' },
  sinSets: { es: 'No encontré sets en tu biblioteca', en: 'No sets found in your library' },
  sinSetsTexto: {
    es: 'Acá aparecen los archivos largos que son un set, un enganchado o un recital: los de más de 40 minutos, y los de más de 15 que dicen "set", "enganchado", "mix", "en vivo" o "recital" en el nombre.',
    en: 'Long files that are a set, a mix or a concert show up here: those over 40 minutes, and those over 15 minutes with "set", "enganchado", "mix", "live" or "recital" in the name.',
  },
  opcion: {
    es: (nombre: string, min: number, found: number | null) => `${nombre} · ${min} min${found != null ? ` · ${found} temas` : ''}`,
    en: (nombre: string, min: number, found: number | null) => `${nombre} · ${min} min${found != null ? ` · ${found} ${plural(found, 'track', 'tracks')}` : ''}`,
  },
  otrasVelocidades: { es: 'Probar otras velocidades', en: 'Try other speeds' },
  otrasVelocidadesDetalle: { es: 'Para temas acelerados como un disco (tarda más)', en: 'For tracks sped up like a record (takes longer)' },
  buscarInternet: { es: 'Buscar por internet lo que falta', en: 'Look up the missing ones on the internet' },
  acoustidDetalle: {
    es: (audd: boolean) => `AcoustID${audd ? ' y el reconocedor' : ''}`,
    en: (audd: boolean) => `AcoustID${audd ? ' and the recognizer' : ''}`,
  },
  necesitaClave: { es: 'Necesita la clave de AcoustID (Configuración → Internet)', en: 'Needs the AcoustID key (Settings → Internet)' },
  escucharDeNuevo: { es: 'Volver a escuchar el set', en: 'Listen to the set again' },
  escucharSet: { es: 'Escuchar el set', en: 'Listen to the set' },
  unaHora: { es: 'Una hora de set tarda uno o dos minutos.', en: 'An hour of set takes one or two minutes.' },
  resumen: {
    es: (k: number, reloj: string) => `**${k}** ${plural(k, 'tema', 'temas')} en ${reloj} de set`,
    en: (k: number, reloj: string) => `**${k}** ${plural(k, 'track', 'tracks')} in a ${reloj} set`,
  },
  dudosos: { es: ' · {n} dudosos para escuchar', en: ' · {n} doubtful to listen to' },
  tramos: {
    es: (k: number) => ` · ${k} ${plural(k, 'tramo', 'tramos')} sin reconocer`,
    en: (k: number) => ` · ${k} unrecognized ${plural(k, 'stretch', 'stretches')}`,
  },
  escuchadoEl: {
    es: (cuando: string, seg: number | null) => ` · escuchado el ${cuando}${seg != null ? ` en ${num(seg)} s` : ''}`,
    en: (cuando: string, seg: number | null) => ` · listened to on ${cuando}${seg != null ? ` in ${num(seg)} s` : ''}`,
  },
  colEntra: { es: 'Entra', en: 'Starts' },
  colTema: { es: 'Tema', en: 'Track' },
  colDeDonde: { es: 'De dónde', en: 'Source' },
  colSeguridad: { es: 'Seguridad', en: 'Confidence' },
  colVel: { es: 'Vel.', en: 'Speed' },
  artista: { es: 'Artista', en: 'Artist' },
  tituloCampo: { es: 'Título', en: 'Title' },
  sinReconocer: { es: (hasta: string) => `Sin reconocer, hasta ${hasta}`, en: (hasta: string) => `Not recognized, until ${hasta}` },
  escucharDesdeAca: { es: 'Escuchar el set desde acá', en: 'Play the set from here' },
  guardar: { es: 'Guardar', en: 'Save' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  escribir: { es: 'Escribir', en: 'Type it in' },
  esEste: { es: 'Es este', en: 'This is it' },
  volverAPonerlo: { es: 'Volver a ponerlo', en: 'Put it back' },
  noEsEste: { es: 'No es este', en: 'Not this one' },
  sumarloTitle: { es: 'Sumarlo a la lista «Faltan o suenan mal»', en: 'Add it to the "Missing or low quality" list' },
  sumado: { es: 'Sumado a la lista «Faltan o suenan mal»', en: 'Added to the "Missing or low quality" list' },
  meFalta: { es: 'Me falta', en: 'I\'m missing it' },
  sacar: { es: 'Sacar el tracklist', en: 'Get the tracklist out' },
  copiar: { es: 'Copiar', en: 'Copy' },
  guardarComo: { es: (f: string) => `Guardar .${f}`, en: (f: string) => `Save .${f}` },
  copiado: { es: 'Tracklist copiado', en: 'Tracklist copied' },
  guardado: { es: 'Tracklist guardado', en: 'Tracklist saved' },
  ponerEnTag: { es: 'Poner en el tag del set', en: 'Put it in the set\'s tag' },
  vaAPendientes: { es: 'Va a Cambios pendientes: revisalo y aplicalo', en: 'It goes to Pending changes: review it and apply it' },
  rehacerCues: { es: (k: number) => `Rehacer los ${k} cue points`, en: (k: number) => `Redo the ${k} cue points` },
  cuesParaRb: { es: 'Cue points para Rekordbox', en: 'Cue points for Rekordbox' },
  cuesGuardados: { es: 'Cue points guardados para Rekordbox', en: 'Cue points saved for Rekordbox' },
  cuesSacados: { es: 'Cue points sacados', en: 'Cue points removed' },
  sacarCues: { es: 'Sacar los cue points', en: 'Remove the cue points' },
})

const where = (s: string): string => (T as unknown as Record<string, string>)[s] ?? s
const TONE: Record<TrackInSet['confidence'], TonoPildora> = { alta: 'ok', media: 'info', baja: 'atencion' }
const clock = (s: number) => { const t = Math.max(0, Math.round(s)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}` }
const pct = (r: number) => (Math.abs(r - 1) < 0.015 ? '' : `${r > 1 ? '+' : ''}${Math.round((r - 1) * 100)}${T.pctSufijo}`)
const GRID = { display: 'grid', gridTemplateColumns: '64px 1fr 110px 92px 58px 210px', gap: 8, alignItems: 'center' } as const

export default function Tracklist({ onStaged }: { onStaged: () => void }) {
  const [sets, setSets] = useState<SetCandidate[] | null>(null)
  const [id, setId] = useState<number | null>(null)
  const [t, setT] = useState<SetTracklist | null>(null)
  const [speeds, setSpeeds] = useState(true)
  const [internet, setInternet] = useState(false)
  const [can, setCan] = useState<{ acoustid: boolean; audd: boolean }>({ acoustid: false, audd: false })
  const [writing, setWriting] = useState<number | null>(null)
  const [form, setForm] = useState({ artist: '', title: '' })
  const [playing, setPlaying] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const job = useJob('tracklist')

  const loadSets = useCallback(() => window.paila.tracklistSets().then((s) => { setSets(s); setId((cur) => cur ?? s.find((x) => x.madeAt)?.fileId ?? s[0]?.fileId ?? null) }), [])
  useEffect(() => { void loadSets(); void window.paila.tracklistInternet().then(setCan) }, [loadSets])
  useEffect(() => { setT(null); setWriting(null); stop(); if (id != null) void window.paila.tracklistGet(id).then(setT) }, [id])
  // al terminar de escuchar, se trae el tracklist nuevo
  useEffect(() => { if (job && !job.running && id != null) { void window.paila.tracklistGet(id).then(setT); void loadSets() } }, [job?.running, job?.finishedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const listen = () => { if (id != null) window.paila.tracklistListen(id, { speeds, internet: internet && can.acoustid }).catch((e) => toast((e as Error).message, 'error')) }
  const save = async (entries: TrackInSet[]) => { if (id != null) setT(await window.paila.tracklistEdit(id, entries)) }
  const patch = (i: number, p: Partial<TrackInSet>) => t && void save(t.entries.map((e, j) => (j === i ? { ...e, ...p } : e)))
  const write = (i: number) => {
    if (!t || (!form.artist.trim() && !form.title.trim())) return
    void save(t.entries.map((e, j) => (j === i ? { ...e, source: 'mano', fileId: null, artist: form.artist, title: form.title, confidence: 'alta', hidden: false } : e)))
    setWriting(null)
  }
  function stop() { audio.current?.pause(); setPlaying(null) }
  const play = async (i: number, at: number) => {
    const a = audio.current
    if (!a || id == null) return
    if (playing === i) return stop()
    if (!a.src) a.src = await window.paila.audioUrl(id)
    a.currentTime = at
    await a.play().catch(() => {})
    setPlaying(i)
  }
  const out = (what: string, p: Promise<unknown>) => p.then((r) => { if (r != null) toast(what, 'ok') }).catch((e) => toast((e as Error).message, 'error'))

  if (sets && !sets.length) return <div className="page"><PantallaVacia titulo={T.sinSets}>{T.sinSetsTexto}</PantallaVacia></div>
  const cur = sets?.find((s) => s.fileId === id)
  const shown = t?.entries.filter((e) => e.source && !e.hidden && (e.confidence !== 'baja' || e.confirmed || e.source === 'mano')).length ?? 0
  const doubtful = t?.entries.filter((e) => e.source && !e.hidden && e.confidence === 'baja' && !e.confirmed && e.source !== 'mano').length ?? 0
  const gaps = t?.entries.filter((e) => !e.source).length ?? 0

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} info={T.intro} />
      {!sets ? <div className="spinner" /> : (
        <div className="row">
          <select value={id ?? ''} onChange={(e) => setId(Number(e.target.value))} style={{ maxWidth: 520 }}>
            {sets.map((s) => <option key={s.fileId} value={s.fileId}>{T.opcion(s.rel.split('/').pop() ?? '', s.minutes, s.madeAt ? s.found : null)}</option>)}
          </select>
          {cur && <span className="muted small ellipsis" title={cur.rel}>{cur.why}</span>}
        </div>
      )}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Casilla checked={speeds} onChange={setSpeeds} label={T.otrasVelocidades} detail={T.otrasVelocidadesDetalle} info={T.velocidades} />
        <Casilla checked={internet && can.acoustid} disabled={!can.acoustid} onChange={setInternet} label={T.buscarInternet}
          detail={can.acoustid ? T.acoustidDetalle(can.audd) : T.necesitaClave} info={T.internet} />
      </div>
      <div className="row">
        <Boton disabled={id == null || !!job?.running} onClick={listen}>{t ? T.escucharDeNuevo : T.escucharSet}</Boton>
        <span className="muted small">{T.unaHora} <Info tip={T.carpeta} /></span>
      </div>
      {job && (job.running || !t) && <JobPanel job={job} unit="%" />}
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      {t && (
        <>
          <p className="small">
            <Rico texto={T.resumen(shown, clock(t.seconds))} />{doubtful ? <Rico texto={T.dudosos} partes={{ n: <b className="doubt">{doubtful}</b> }} /> : null}
            {gaps ? T.tramos(gaps) : null}
            <span className="muted">{T.escuchadoEl(fechaHora(t.madeAt, { dateStyle: 'short', timeStyle: 'short' }), t.took ? Math.round(t.took.read + t.took.search + t.took.internet) : null)}</span>
          </p>
          {t.internet?.note && <Aviso tone="info">{t.internet.note}</Aviso>}
          <div className="box">
            <div className="box-head" style={GRID}>
              <span>{T.colEntra}</span><span>{T.colTema}</span><span>{T.colDeDonde}</span><span>{T.colSeguridad} <Info tip={T.seguridad} /></span><span>{T.colVel} <Info tip={T.velocidad} /></span><span />
            </div>
            {t.entries.map((e, i) => (
              <div key={`${e.start}-${i}`} className={`box-row${e.hidden ? ' muted' : ''}`} style={{ ...GRID, cursor: 'default' }}>
                <span className="num">{clock(e.start)}</span>
                {writing === i ? (
                  <span className="row" style={{ gap: 4 }}>
                    <input placeholder={T.artista} value={form.artist} onChange={(x) => setForm({ ...form, artist: x.target.value })} />
                    <input placeholder={T.tituloCampo} value={form.title} onChange={(x) => setForm({ ...form, title: x.target.value })} onKeyDown={(x) => { if (x.key === 'Enter') write(i) }} />
                  </span>
                ) : e.source ? (
                  <span className="ellipsis" title={e.rel ?? undefined} style={e.hidden ? { textDecoration: 'line-through' } : undefined}>
                    {e.artist ? <span className="muted">{e.artist} – </span> : null}{e.title}
                  </span>
                ) : <span className="muted">{T.sinReconocer(clock(e.until))}</span>}
                <span>{e.source ? <Pildora tone={e.source === 'biblioteca' ? 'acento' : 'info'}>{where(e.source)}</Pildora> : null}</span>
                <span>{e.source && e.source !== 'mano' ? <Pildora tone={TONE[e.confidence]}>{e.confidence === 'baja' ? (e.confirmed ? T.confirmado : T.dudoso) : where(e.confidence)}</Pildora> : null}</span>
                <span className="num small">{pct(e.rate)}</span>
                <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <Boton size="sm" variant="ghost" title={T.escucharDesdeAca} onClick={() => void play(i, e.start)}><Icon name={playing === i ? 'pause' : 'play'} size={14} /></Boton>
                  {writing === i ? <><Boton size="sm" onClick={() => write(i)}>{T.guardar}</Boton><Boton size="sm" variant="ghost" onClick={() => setWriting(null)}>{T.cancelar}</Boton></>
                    : !e.source || e.hidden ? <Boton size="sm" variant="ghost" onClick={() => { setForm({ artist: e.artist ?? '', title: e.title ?? '' }); setWriting(i) }}>{T.escribir}</Boton> : null}
                  {e.source && e.confidence === 'baja' && !e.confirmed && !e.hidden && e.source !== 'mano' && <Boton size="sm" variant="ghost" onClick={() => patch(i, { confirmed: true })}>{T.esEste}</Boton>}
                  {e.source && writing !== i && <Boton size="sm" variant="ghost" onClick={() => patch(i, { hidden: !e.hidden })}>{e.hidden ? T.volverAPonerlo : T.noEsEste}</Boton>}
                  {(e.source === 'acoustid' || e.source === 'audd') && e.artist && e.title && <Boton size="sm" variant="ghost" title={T.sumarloTitle} onClick={() => out(T.sumado, window.paila.addMissingWanted(e.artist!, e.title!, null))}>{T.meFalta}</Boton>}
                </span>
              </div>
            ))}
          </div>
          <h4>{T.sacar}</h4>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Boton disabled={!shown} onClick={() => out(T.copiado, window.paila.tracklistCopy(t.fileId))}>{T.copiar}</Boton>
            {(['txt', 'cue', 'csv'] as TracklistFormat[]).map((f) => <Boton key={f} variant="ghost" disabled={!shown} onClick={() => out(T.guardado, window.paila.tracklistSave(t.fileId, f))}>{T.guardarComo(f)}</Boton>)}
            <Info tip={T.cue} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Boton variant="ghost" disabled={!shown} onClick={() => out(T.vaAPendientes, window.paila.tracklistStageTag(t.fileId).then((n) => { onStaged(); return n }))}>{T.ponerEnTag}</Boton>
            <Info tip={T.tag} />
            <Boton variant="ghost" disabled={!shown} onClick={() => out(T.cuesGuardados, window.paila.tracklistCues(t.fileId, true).then((n) => { void window.paila.tracklistGet(t.fileId).then(setT); return n }))}>
              {t.cues ? T.rehacerCues(t.cues) : T.cuesParaRb}
            </Boton>
            {!!t.cues && <Boton variant="ghost" onClick={() => out(T.cuesSacados, window.paila.tracklistCues(t.fileId, false).then((n) => { void window.paila.tracklistGet(t.fileId).then(setT); return n }))}>{T.sacarCues}</Boton>}
            <Info tip={T.cues} />
          </div>
        </>
      )}
    </div>
  )
}
