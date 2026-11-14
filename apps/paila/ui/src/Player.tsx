// Reproductor de la parte de abajo: reproduce, con cola, aleatorio, repetir, seguir por lo que ves / el álbum / un solo tema,
// atajos de teclado, teclas multimedia y salida de audio elegible. La lógica de la cola está en shared/playqueue.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@paila/shared/types'
import { advance, back, clearQueue, emptyQ, enqueue, jump, nextRepeat, removeFromQueue, setItems, setRepeat, setShuffle, start, upcoming, type PlayQ } from '@paila/shared/playqueue'
import { display, duration, format } from './format'
import { GRADE_HELP } from './problems'
import { Icon } from './icons'
import { toTrack } from './hooks/useBigTable'
import PlayerQueue from './PlayerQueue'
import AudioOutput, { applySink, readSink, useAudioOutputs, DEFAULT_SINK } from './audioout'
import { Info, Nota } from '@paila/diseno'
import Escuchando from './Escuchando'
import { useProfile } from './profile'
import { camelotColor } from './camelot'
import { colorDe, iniciales } from './thumbs'
import { BP_TIP, saveBp, useBitPerfect, useMpvMotor } from './bitperfect'
import { toast } from './toast'
import { num } from '@paila/shared/idioma'
import { escribiendo } from '@paila/shared/teclas'
import { T } from './Player.textos'
import { FOLLOW_KEY, SHORTCUTS, readFollow, readVolume, type Follow, type PlayRequest } from './playerprefs'
export { SHORTCUTS, type Follow, type PlayRequest } from './playerprefs'

interface Props {
  request: PlayRequest | null
  /** El tema elegido en la tabla (la barra espaciadora lo reproduce si todavía no suena). */
  selected: number | null
  /** Pide reproducir el elegido con la lista que se está viendo. */
  onPlaySelected: () => void
  /** Pide sumar el elegido a la cola. */
  onEnqueueSelected: (where: 'next' | 'end') => void
  /** Avisa qué tema suena (para que la tabla lo tenga a mano). */
  onCurrent?: (id: number | null) => void
  /** Pantalla "Escuchando": el reproductor en grande, encima de la zona central. */
  expanded?: boolean
  onExpand?: (open: boolean) => void
  /** Abrir la ficha del tema que suena. */
  onOpenTrack?: (id: number) => void
  /** Avisa lo que viene después (para "Seguir escuchando" del Inicio). */
  onUpcoming?: (ids: number[]) => void
}

export default function Player({ request, selected, onPlaySelected, onEnqueueSelected, onCurrent, expanded, onExpand, onOpenTrack, onUpcoming }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [q, setQ] = useState<PlayQ>(emptyQ)
  const qRef = useRef(q); qRef.current = q
  const [info, setInfo] = useState<Map<number, Track>>(new Map())
  const [follow, setFollowState] = useState<Follow>(readFollow)
  const source = useRef<{ ids: number[]; label: string }>({ ids: [], label: '' })
  const [label, setLabel] = useState('')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [total, setTotal] = useState(0)
  const [volume, setVolume] = useState(readVolume)
  const [muted, setMuted] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [cover, setCover] = useState<string | null>(null)
  const [onda, setOnda] = useState<string | null>(null)
  const forDj = useProfile().djTools
  const [panel, setPanel] = useState<'cola' | 'salida' | null>(null)
  const { current: sink, missing: sinkMissing, outputs } = useAudioOutputs()
  // salida "bit perfect" (bitperfect.tsx): con ella prendida, los mismos controles manejan mpv en vez del <audio>
  const bp = useBitPerfect()
  const bpRef = useRef(bp); bpRef.current = bp
  const [fmt, setFmt] = useState<string | null>(null)
  const timeRef = useRef(0); timeRef.current = time
  const goNextRef = useRef<(manual: boolean) => void>(() => {})
  // mpv cuenta solo con bit perfect prendido (como el <audio> solo apagado): un aviso tardío vaciaba la barra (la persona 1, 31/10)
  const siBp = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (bpRef.current.active) f(...a) }, mpv = useMpvMotor({
    play: siBp(() => setPlaying(true)), pause: siBp(() => setPlaying(false)), ended: siBp(() => goNextRef.current(false)), time: siBp(setTime), playing: siBp(() => setState('idle')), error: siBp(() => setState('error')),
    duration: siBp((d: number) => { if (Number.isFinite(d)) setTotal(d) }), format: setFmt,
    lost: (m) => { toast(m, 'error'); saveBp({ on: false, device: bpRef.current.device }) },
  })
  /** Lo que suena ahora: mpv o el <audio> (los dos se manejan igual). */
  const motor = () => (bpRef.current.active ? mpv : audio.current)

  const track = q.current != null ? info.get(q.current) ?? null : null

  // los datos de los temas que se ven en el reproductor y en la cola (se piden de a tandas)
  const infoRef = useRef(info); infoRef.current = info
  const ensure = useCallback(async (ids: number[]) => {
    const want = [...new Set(ids)].filter((id) => !infoRef.current.has(id))
    if (!want.length) return
    const rows = await window.paila.playerTracks(want)
    setInfo((prev) => { const next = new Map(prev); for (const r of rows) { const t = toTrack(r); next.set(t.id, t) } return next })
  }, [])

  /** La lista de la que sigue, según "seguir con" (lo que veo, el álbum o solo este tema). */
  const itemsFor = useCallback(async (mode: Follow, id: number, ids: number[]) => (
    mode === 'tema' ? [id] : mode === 'album' ? await window.paila.playerAlbum(id) : (ids.length ? ids : [id])
  ), [])

  // pedidos de la tabla: sonar ya o sumar a la cola
  const lastReq = useRef(0)
  useEffect(() => {
    if (!request || request.at === lastReq.current) return
    lastReq.current = request.at
    void (async () => {
      if (request.kind === 'play') {
        source.current = { ids: request.ids ?? [], label: request.label ?? '' }
        setLabel(request.label ?? '')
        const items = await itemsFor(readFollow(), request.id, request.ids ?? [])
        setQ((p) => start(p, items, request.id))
      } else {
        // si no suena nada, el tema pedido suena ya; si no, se suma a la cola
        setQ((p) => (p.current == null ? start(p, [request.id], request.id) : enqueue(p, [request.id], request.kind as 'next' | 'end')))
        if (qRef.current.current != null) { setPanel('cola'); void ensure([request.id]) }
      }
    })()
  }, [request, itemsFor, ensure])

  const setFollow = async (mode: Follow) => {
    setFollowState(mode)
    try { localStorage.setItem(FOLLOW_KEY, mode) } catch { /* sin almacenamiento */ }
    const id = qRef.current.current
    if (id == null) return
    const items = await itemsFor(mode, id, source.current.ids)
    setQ((p) => setItems(p, items))
  }

  // lo que suena: cargar el archivo al cambiar de tema
  const currentId = q.current
  useEffect(() => { onCurrent?.(currentId) }, [currentId, onCurrent])
  useEffect(() => { onUpcoming?.(q.current == null ? [] : upcoming(q, 5)) }, [q, onUpcoming])
  useEffect(() => {
    const a = audio.current
    if (!a || currentId == null) return
    let cancelled = false
    setState('loading'); setTime(0); setTotal(infoRef.current.get(currentId)?.duration || 0); setFmt(null)
    void ensure([currentId])
    if (bpRef.current.active) mpv.load(currentId, bpRef.current.device!)
    else window.paila.audioUrl(currentId).then((url) => {
      if (cancelled) return
      a.src = url
      a.play().catch(() => {})
    })
    setCover(null); setOnda(null)
    window.paila.getCover(currentId).then((x) => { if (!cancelled) setCover(x) })
    // la forma de onda se arma la primera vez (unos segundos) y después queda guardada
    window.paila.waveform(currentId).then((x) => { if (!cancelled) setOnda(x) }, () => {})
    return () => { cancelled = true }
  }, [currentId, ensure, mpv])

  // prender o apagar "bit perfect" mientras suena: sigue en el mismo lugar, por la otra salida
  const bpKey = bp.active ? bp.device : null
  const lastBp = useRef(bpKey)
  useEffect(() => {
    if (lastBp.current === bpKey) return
    lastBp.current = bpKey
    const a = audio.current, id = qRef.current.current, at = timeRef.current
    if (!a) return
    if (bpKey) { a.pause(); a.removeAttribute('src'); a.load(); if (id != null) mpv.load(id, bpKey, at) }
    else {
      mpv.release(); setFmt(null)
      if (id != null) void window.paila.audioUrl(id).then((url) => { a.src = url; a.currentTime = at; void a.play().catch(() => {}) })
    }
  }, [bpKey, mpv])

  // los que vienen en la cola y en la lista: se piden para poder mostrarlos
  useEffect(() => { void ensure([...q.upNext, ...q.items.slice(Math.max(0, q.items.indexOf(q.current ?? -1)) + 1, Math.max(0, q.items.indexOf(q.current ?? -1)) + 21)]) }, [q.upNext, q.items, q.current, ensure])

  // volumen y silencio
  useEffect(() => {
    if (audio.current) { audio.current.volume = volume; audio.current.muted = muted }
    try { localStorage.setItem('paila.volume', String(volume)) } catch { /* no importa */ }
  }, [volume, muted])

  // salida de audio elegida (si ya no está conectada, suena por la de Windows)
  useEffect(() => { const a = audio.current; if (a) void applySink(a, sinkMissing ? DEFAULT_SINK : sink || readSink()) }, [sink, sinkMissing, outputs])

  const goNext = useCallback((manual: boolean) => {
    const r = advance(qRef.current, manual)
    if (r.id == null) { setPlaying(false); motor()?.pause(); return }
    setQ(r.q)
    // repetir un tema (mpv ya lo soltó al terminar: se vuelve a cargar)
    if (r.q === qRef.current || r.id === qRef.current.current) { if (bpRef.current.active) mpv.load(r.id, bpRef.current.device!); else { const a = audio.current; if (a) { a.currentTime = 0; void a.play().catch(() => {}) } } }
  }, [mpv])
  goNextRef.current = goNext
  const goBack = useCallback(() => {
    const a = motor()
    if (a && a.currentTime > 3) { a.currentTime = 0; return }
    const r = back(qRef.current)
    if (r.id == null) { if (a) a.currentTime = 0; return }
    setQ(r.q)
  }, [])
  const toggle = useCallback(() => {
    const a = motor()
    if (!a || qRef.current.current == null) { if (selected) onPlaySelected(); return }
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }, [selected, onPlaySelected])
  const seekBy = (s: number) => { const a = motor(); if (a) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + s)) }

  // si un archivo no se puede reproducir, se avisa y pasa al que sigue
  useEffect(() => {
    if (state !== 'error') return
    const t = setTimeout(() => goNext(true), 1800)
    return () => clearTimeout(t)
  }, [state, goNext])

  // teclas multimedia de la compu (siguiente, anterior, play/pausa) y el cartel del sistema
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    if (track) { const d = display(track); ms.metadata = new MediaMetadata({ title: d.title, artist: d.artist, album: track.album ?? '' }) }
    ms.setActionHandler('play', () => { void motor()?.play() })
    ms.setActionHandler('pause', () => motor()?.pause())
    ms.setActionHandler('nexttrack', () => goNext(true))
    ms.setActionHandler('previoustrack', goBack)
    return () => { for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) ms.setActionHandler(a, null) }
  }, [track, goNext, goBack])

  // atajos de teclado (no se activan mientras se escribe en un campo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (escribiendo(e.target)) return
      const ctrl = e.ctrlKey || e.metaKey
      const plain = !ctrl && !e.altKey
      const k = e.key
      const act = (fn: () => void) => { e.preventDefault(); fn() }
      if (e.code === 'Space' && !ctrl && !e.altKey) { act(() => { if (selected && selected !== qRef.current.current) onPlaySelected(); else toggle() }); return }
      if (ctrl && !e.shiftKey && k === 'ArrowRight') return act(() => goNext(true))
      if (ctrl && !e.shiftKey && k === 'ArrowLeft') return act(goBack)
      if (ctrl && k === 'ArrowUp') return act(() => setVolume((v) => Math.min(1, +(v + 0.05).toFixed(2))))
      if (ctrl && k === 'ArrowDown') return act(() => setVolume((v) => Math.max(0, +(v - 0.05).toFixed(2))))
      if (e.shiftKey && !ctrl && k === 'ArrowRight') return act(() => seekBy(10))
      if (e.shiftKey && !ctrl && k === 'ArrowLeft') return act(() => seekBy(-10))
      if (!plain && !(e.shiftKey && !ctrl && !e.altKey)) return
      const low = k.toLowerCase()
      if (low === 's' && !e.shiftKey) act(() => setQ((p) => setShuffle(p, !p.shuffle)))
      else if (low === 'r' && !e.shiftKey) act(() => setQ((p) => setRepeat(p, nextRepeat(p.repeat))))
      else if (low === 'm' && !e.shiftKey) act(() => setMuted((m) => !m))
      else if (low === 'q' && !e.shiftKey) act(() => setPanel((p) => (p === 'cola' ? null : 'cola')))
      else if (low === 'e') act(() => onEnqueueSelected(e.shiftKey ? 'next' : 'end'))
    }
    // Esc vuelve de "Escuchando" (salvo que haya una ventana abierta encima)
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && expanded && !document.querySelector('.modal')) onExpand?.(false) }
    window.addEventListener('keydown', onEsc)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onEsc) }
  }, [selected, toggle, goNext, goBack, onPlaySelected, onEnqueueSelected, expanded, onExpand])

  const d = track && display(track), idle = currentId == null
  const frac = total ? Math.min(1, time / total) : 0
  const inflado = !!track && track.kbps != null && track.effKbps != null && track.effKbps < track.kbps * 0.85
  const desde = label ? T.desde(label) : ''

  /** La forma de onda es la barra de avance: lo que ya sonó en color, el resto gris; se toca o se arrastra para moverse. */
  const ondaBar = (grande: boolean) => (
    <div className={`onda${grande ? ' onda-grande' : ''}${onda ? '' : ' sin-onda'}`} style={{ '--avance': `${frac * 100}%`, ...(onda ? { '--onda': `url(${onda})` } : {}) } as React.CSSProperties}>
      <div className="onda-fondo" /><div className="onda-hecho" />{!idle && <div className="onda-cabezal" />}
      <input
        className="onda-input" type="range" min={0} max={total || 0} step={0.1} value={Math.min(time, total || 0)} disabled={idle} aria-label={T.avance}
        onChange={(e) => { const a = motor(); if (a) a.currentTime = Number(e.target.value) }}
      />
    </div>
  )
  const calidad = track?.grade && (
    <span className="pil" title={`${track.isLabel || ''}. ${GRADE_HELP[track.grade]}`}>
      <Nota grade={track.grade} /> {inflado ? <>{T.suenaComo(Math.round(track.effKbps!))}</> : <span className={`fmt fmt-${format(track).toLowerCase()}`}>{format(track)}</span>}
    </span>
  )
  const pulso = forDj && track && track.bpm != null && (
    <span className="pil num" title={T.pulso}>
      {num(track.bpm, { maximumFractionDigits: 1 })}{track.camelot && <> · <b style={{ color: camelotColor(track.camelot) ?? undefined }}>{track.camelot}</b></>}
    </span>
  )
  const botones = (grande: boolean) => {
    const s = grande ? 22 : 15
    return (
      <div className={`player-ctl${grande ? ' esc-ctl' : ''}`}>
        <button className={`pbtn ${q.shuffle ? 'on' : ''}`} onClick={() => setQ((p) => setShuffle(p, !p.shuffle))} title={T.aleatorio(q.shuffle)} aria-pressed={q.shuffle}><Icon name="shuffle" size={s} /></button>
        <button className="pbtn" onClick={goBack} disabled={idle} title={T.anterior}><Icon name="prev" size={s} /></button>
        <button className="play" onClick={toggle} disabled={idle && !selected} title={T.playPausa}><Icon name={playing ? 'pause' : 'play'} size={s} /></button>
        <button className="pbtn" onClick={() => goNext(true)} disabled={idle} title={T.siguiente}><Icon name="next" size={s} /></button>
        <button className={`pbtn ${q.repeat !== 'off' ? 'on' : ''}`} onClick={() => setQ((p) => setRepeat(p, nextRepeat(p.repeat)))} title={T.repetir(q.repeat)} aria-pressed={q.repeat !== 'off'}>
          <Icon name="repeat" size={s} />{q.repeat === 'one' && <span className="pbtn-one">1</span>}
        </button>
      </div>
    )
  }
  // con "bit perfect" el volumen no se toca: se maneja desde el equipo
  const volumen = bp.active ? <span className="pil" title={`${fmt ?? T.bpPrendida}\n\n${BP_TIP}`}><Icon name="headphones" size={12} /> {T.bpVolumen}</span> : (
    <>
      <button className={`pbtn ${muted ? 'on' : ''}`} onClick={() => setMuted((m) => !m)} title={muted ? T.quitarSilencio : T.silenciar}><Icon name="speaker" size={15} /></button>
      <input className="volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false) }} aria-label={T.volumen} />
    </>
  )
  const tocable = track ? !expanded : idle && selected != null, tocar = () => { if (!tocable) return; if (track) onExpand?.(true); else onPlaySelected() }
  const cola = (inline: boolean) => (
    <PlayerQueue inline={inline} q={q} info={info} follow={follow} label={label} onFollow={setFollow} onClose={() => setPanel(null)} onOpenTrack={(id) => { setPanel(null); onOpenTrack?.(id) }}
      onJump={(id) => setQ((p) => jump(p, id))} onRemove={(i) => setQ((p) => removeFromQueue(p, i))} onClear={() => setQ((p) => clearQueue(p))} />
  )

  return (
    <div className="player">
      <audio
        ref={audio}
        // con "bit perfect" prendido suena mpv: lo que avise este <audio> (apagado) no cuenta
        onPlay={() => !bp.active && setPlaying(true)}
        onPause={() => !bp.active && setPlaying(false)}
        onEnded={() => !bp.active && goNext(false)}
        onTimeUpdate={(e) => !bp.active && setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { if (!bp.active && Number.isFinite(e.currentTarget.duration)) setTotal(e.currentTarget.duration) }}
        onPlaying={() => !bp.active && setState('idle')}
        onError={() => !bp.active && setState('error')}
      />
      {/* tocar lo que suena abre Escuchando (el autor, 28/10); ya ahí no hace nada ni lo parece (la persona 2 entraba y salía 15 veces, 01/11) */}
      <div className={`player-tema${tocable ? ' abre' : ''}`} role={tocable ? 'button' : undefined} tabIndex={tocable ? 0 : undefined} title={track ? (tocable ? T.grande : undefined) : tocable ? T.escucharElegido : undefined}
        onClick={() => tocar()} onKeyDown={(e) => { if (tocable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tocar() } }}>
        {track && cover ? <img className="player-cover" src={cover} alt="" />
          : d ? <div className="player-cover sin" style={{ background: colorDe(d.artist || d.title) }}>{iniciales(d.artist || d.title)}</div>
          : <div className="player-cover vacia" />}
        <div className="player-info">
          {d && track ? <><b title={d.title}>{d.title}</b><span className="muted" title={d.artist}>{d.artist}{desde}</span></>
            : idle ? <span className="muted">{T.elegi}</span> : <span className="muted">{T.cargando}</span>}
          {state === 'loading' && track && <span className="muted small">{T.cargando}</span>}
          {state === 'error' && <span className="error small">{T.noSePudo}</span>}
        </div>
      </div>
      {/* con Escuchando abierto, los controles, la línea de tiempo, la calidad y el volumen ya están en grande: acá no se repiten (el autor, 01/11) */}
      <div className="player-centro">{!expanded && <>{botones(false)}
        <div className="player-linea"><span className="time num">{duration(time) || '0:00'}</span>{ondaBar(false)}<span className="time num">{duration(total) || '0:00'}</span></div></>}
      </div>
      <div className="player-der">
        {!expanded && <>{calidad}{pulso}{volumen}</>}
        <button className={`pbtn ${panel === 'salida' ? 'on' : ''}`} onClick={() => setPanel((p) => (p === 'salida' ? null : 'salida'))} title={T.salida} aria-label={T.salida}><Icon name="headphones" size={15} /></button>
        {!expanded && <button className={`pbtn ${panel === 'cola' ? 'on' : ''}`} onClick={() => setPanel((p) => (p === 'cola' ? null : 'cola'))} title={T.cola} aria-label={T.colaAria}>
          <Icon name="queue" size={15} />{q.upNext.length > 0 && <span className="pbtn-n num">{q.upNext.length}</span>}
        </button>}
        <button className={`pbtn ${expanded ? 'on' : ''}`} onClick={() => onExpand?.(!expanded)} title={expanded ? T.volver : T.grande} aria-label={T.escuchando} aria-pressed={!!expanded}><Icon name="expand" size={15} /></button>
        <Info tip={`${T.atajos}\n${SHORTCUTS}`} />
      </div>

      {panel === 'cola' && !expanded && cola(false)}
      {panel === 'salida' && (
        <div className="player-pop" role="dialog" aria-label={T.salida}>
          <button className="close" onClick={() => setPanel(null)} title={T.cerrar}><Icon name="close" size={14} /></button>
          <AudioOutput />
        </div>
      )}

      {expanded && <Escuchando track={track} cover={cover} desde={desde} time={time} total={total} calidad={calidad} pulso={pulso}
        onda={ondaBar(true)} botones={botones(true)} volumen={volumen} cola={cola(true)} onOpenTrack={onOpenTrack} />}
    </div>
  )
}
