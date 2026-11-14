// Ficha de un tema (panel de la derecha): la tapa como figurita, los datos en grande, la calidad real con el espectrograma
// anotado (dónde se corta el sonido), BPM y tono, tags editables y botones para reproducir o reemplazar.
import { useEffect, useState } from 'react'
import { KINDS, type AnalysisDetail, type Combina, type TrackExtras, type EditableField, type PendingChange, type Track } from '@paila/shared/types'
import { bytes, display, duration, fileName, folder, format, sampleRate } from './format'
import { SPECTRO_LONG_SECONDS } from '@paila/shared/trackinfo'
import { GRADE_HELP } from './problems'
import { Icon } from './icons'
import { Nota, Aviso, Boton, Info, Rico } from '@paila/diseno'
import { camelotColor } from './camelot'
import { useProfile } from './profile'
import { colorDe, iniciales } from './thumbs'
import { selloDe } from './sellos'
import { bpmShown } from './tempo'
import { num } from '@paila/shared/idioma'
import { T } from './Detail.textos'
import { buscarEnBiblioteca } from './buscarEn'

const dec = (x: number, d = 1) => num(x, { maximumFractionDigits: d })

/** Hasta dónde llega el sonido en un MP3 de verdad de esos kbps (aprox., encoder LAME): la referencia del espectrograma. */
const CORTE_ESPERADO: [number, number][] = [[96, 15000], [128, 16000], [160, 17000], [192, 19000], [256, 19500], [320, 20000]]
const corteEsperado = (kbps: number) => [...CORTE_ESPERADO].reverse().find(([k]) => kbps >= k)?.[1] ?? null

/** Espectrograma con la escala de kHz y la línea donde se corta el sonido; si el archivo dice más de lo que suena, también
 *  hasta dónde llegaría uno de verdad. */
function Espectro({ src, t, a }: { src: string; t: Track; a: AnalysisDetail | null }) {
  const nyq = (t.sampleRate || 44100) / 2
  const y = (hz: number) => `${Math.max(0, Math.min(100, (1 - hz / nyq) * 100))}%`
  const lossy = !['flac', 'wav', 'aiff', 'aif', 'alac'].includes(t.ext.toLowerCase())
  const inflado = a?.effKbps != null && t.kbps != null && a.effKbps < t.kbps * 0.85
  const esperado = lossy && inflado && t.kbps ? corteEsperado(t.kbps) : null
  const marcas = [5000, 10000, 15000, 20000].filter((hz) => hz < nyq)
  return (
    <div className="espectro">
      <img src={src} alt={T.espectrograma} />
      <div className="espectro-khz">{marcas.map((hz) => <span key={hz} style={{ top: y(hz) }}>{hz / 1000}</span>)}<span className="u">kHz</span></div>
      {esperado != null && a?.cutoff != null && esperado > a.cutoff && (
        <div className="espectro-linea ref" style={{ top: y(esperado) }}><span>{T.refVerdad(t.kbps!, dec(esperado / 1000))}</span></div>
      )}
      {a?.cutoff != null && (
        <div className={`espectro-linea${inflado ? ' mal' : ''}`} style={{ top: y(a.cutoff) }}>
          <span>{inflado ? T.seCorta(dec(a.cutoff / 1000), Math.round(a.effKbps!)) : T.llegaHasta(dec(a.cutoff / 1000))}</span>
        </div>
      )}
    </div>
  )
}

/** Etiqueta con explicación al pasar el mouse. */
const Term = ({ label, help }: { label: string; help: string }) => <span title={help}>{label} <span className="info">ⓘ</span></span>

const EDITABLE: [EditableField, string, keyof Track][] = [
  ['artist', T.artista, 'artist'], ['albumArtist', T.artistaAlbum, 'albumArtist'], ['title', T.titulo, 'title'], ['album', T.album, 'album'],
  ['track', T.nTema, 'track'], ['year', T.anio, 'year'], ['genre', T.genero, 'genre'],
]

/** Botón "Vaciar campo": deja el tag vacío como cambio pendiente (para los datos que se inventaron, como un álbum mal puesto). */
export function ClearField({ label, onClear, count }: { label: string; onClear: () => void; count?: number }) {
  return <button className="tag-clear" onClick={onClear} aria-label={T.vaciar(label)}
    title={T.vaciarTitulo(label, count ?? 0)}><Icon name="close" size={14} /></button>
}

/** Campo de tag editable: al salir (o con Enter) queda como cambio pendiente; no se escribe nada hasta Aplicar. */
function TagInput({ t, field, label, current, change, onStage }: {
  t: Track; field: EditableField; label: string; current: string | null; change?: PendingChange; onStage: (f: EditableField, v: string | null) => void
}) {
  const shown = change ? change.after ?? '' : current ?? ''
  const commit = (v: string) => { if (v.trim() !== (shown ?? '').trim()) onStage(field, v.trim() === '' ? null : v.trim()) }
  return (
    <div className={`tag-row ${change ? 'changed' : ''}`}>
      <label>{label}</label>
      <input id={`tag-${field}`} key={`${t.id}-${field}-${shown}`} defaultValue={shown} placeholder="—"
        onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      {shown ? <ClearField label={label} onClear={() => onStage(field, null)} /> : <span />}
      {change && <div className="small muted">{T.antes} {change.before || T.vacio} <button className="link" onClick={() => onStage(field, change.before)}>{T.volver}</button></div>}
    </div>
  )
}

export default function Detail({ t, onPlay, onQueue, onReplace, pending, onStage, onCoverStaged, grande, onGrande }: {
  /** La ficha en grande (pantalla entera) en vez del panel de la derecha. */
  grande?: boolean
  /** Abrir esta ficha en grande (desde el panel). */
  onGrande?: () => void
  t: Track; onPlay: (id: number) => void; onQueue: (where: 'next' | 'end') => void; onReplace: () => void; pending: PendingChange[]; onCoverStaged: () => void; onStage: (field: EditableField, value: string | null) => void }) {
  const d = display(t)
  const sello = selloDe(t)
  const [a, setA] = useState<AnalysisDetail | null>(null)
  const [extras, setExtras] = useState<TrackExtras | null>(null)
  // "Combinan para pasar después": para quien es DJ o produce (el perfil muestra BPM y tono)
  const forDj = useProfile().djTools
  const [combina, setCombina] = useState<Combina[] | null>(null)
  useEffect(() => {
    let alive = true
    setCombina(null)
    if (forDj && t.camelot && t.bpm) window.paila.combinan(t.id).then((x) => { if (alive) setCombina(x) }, () => {})
    return () => { alive = false }
  }, [t.id, t.camelot, t.bpm, forDj])
  const [cover, setCover] = useState<string | null>(null)
  const coverPending = pending.find((c) => c.field === 'cover')
  const [spectro, setSpectro] = useState<string | null | 'loading'>(null)

  useEffect(() => {
    let alive = true
    window.paila.getAnalysis(t.id).then((x) => { if (alive) setA(x) })
    return () => { alive = false }
  }, [t.id, t.grade, t.bpm])
  useEffect(() => {
    let alive = true
    setExtras(null)
    window.paila.trackExtras(t.id).then((x) => { if (alive) setExtras(x) })
    return () => { alive = false }
  }, [t.id, t.title, t.artist])

  useEffect(() => {
    let alive = true
    setCover(null)
    if (!t.missing) window.paila.getCover(t.id).then((x) => { if (alive) setCover(x) })
    return () => { alive = false }
  }, [t.id, t.size, t.missing])

  useEffect(() => {
    let alive = true
    setSpectro(t.missing ? null : 'loading')
    if (!t.missing) window.paila.spectrogram(t.id).then((x) => { if (alive) setSpectro(x) })
    return () => { alive = false }
  }, [t.id, t.missing])

  const rows: [string, React.ReactNode, boolean?][] = [ // el tercero: solo se muestra si hay dato
    [T.formato, `${format(t)}${t.codec && t.codec !== t.ext ? ` (${t.codec})` : ''}`],
    [T.bitrate, t.kbps ? `${t.kbps} kbps` : null], [T.muestreo, sampleRate(t)],
    [T.canales, t.channels === 1 ? T.mono : t.channels === 2 ? T.estereoCanales : t.channels], [T.duracion, duration(t.duration)],
    [T.tamanio, bytes(t.size)], [T.coleccion, KINDS[t.kind].label],
    [T.pais, extras?.country ? <>{extras.country} <Info tip={T.paisTip} /></> : null, true],
    [T.vinilo, extras?.vinyl ? <>{T.viniloSi(extras.vinyl.side ?? null)} <Info tip={T.viniloTip} /></> : null, true],
  ]

  return (
    <div className={`detail-body${grande ? ' ficha-grande' : ''}`}>
      <header className="ficha-cab">
        <div className="figu ficha-figu">
          <div className="figu-img" style={{ background: cover ? `center / cover url(${cover})` : colorDe(d.artist || d.title) }}>{cover ? null : iniciales(d.artist || d.title)}</div>
          <div className="figu-plaq"><small>{T.numero}{t.id}</small><b>{d.title}</b></div>
          {sello?.tono === 'mal' && <span className="ficha-sello solo-historieta" title={sello.ayuda}>{T.trucho}</span>}
          {t.grade && <span className="ficha-nota"><Nota grade={t.grade} big title={`${a?.isLabel ?? ''}. ${GRADE_HELP[t.grade]}`} /></span>}
        </div>
        {/* lo que se ve tocable hace algo (la persona 2, 01/11): el título lo hace sonar; el artista y el disco, la biblioteca con esa búsqueda */}
        <button type="button" className={`tocable titulo ficha-titulo${d.title.length > 34 ? ' largo' : ''}`} title={`${d.title}
${T.tocarTitulo}`} disabled={!!t.missing} onClick={() => onPlay(t.id)}>{d.title}</button>
        <div className="ficha-artista">{d.artist && <button type="button" className="tocable" title={T.delArtista(d.artist)} onClick={() => buscarEnBiblioteca(d.artist)}>{d.artist}</button>}</div>
        {(t.album || t.year) && <div className="muted small">{t.album && <button type="button" className="tocable" title={T.delDisco(t.album)} onClick={() => buscarEnBiblioteca(t.album!)}>{t.album}</button>}{t.album && t.year ? ' · ' : ''}{t.year}</div>}
        <div className="ficha-botones">
          <Boton disabled={!!t.missing} title={t.missing ? T.noPlay : undefined} onClick={() => onPlay(t.id)}><Icon name="play" size={14} /> {T.reproducir}</Boton>
          <Boton variant="ghost" size="sm" disabled={!!t.missing} onClick={() => onQueue('next')} title={T.aContinuacionTip}>{T.aContinuacion}</Boton>
          <Boton variant="ghost" size="sm" disabled={!!t.missing} onClick={() => onQueue('end')} title={T.aLaColaTip}>{T.aLaCola}</Boton>
          {onGrande && <Boton variant="ghost" size="sm" onClick={onGrande} title={T.enGrandeTip}><Icon name="expand" size={13} /> {T.enGrande}</Boton>}
        </div>
        <div className="lecturas">
          <div><span className="rotulo">{T.calidadReal}</span><b className="num">{a?.effKbps != null && t.kbps != null && a.effKbps < t.kbps * 0.85 ? <><span className="muted">{t.kbps} →</span> <span className="kbps-real">~{Math.round(a.effKbps)}</span></> : <span className={`fmt fmt-${format(t).toLowerCase()}`}>{format(t)}{t.kbps ? ` ${t.kbps}` : ''}</span>}</b></div>
          {t.bpm != null && <div><span className="rotulo">BPM</span><b className="num" title={bpmShown(t)!.title ?? undefined}>{t.tempo ? bpmShown(t)!.text : dec(t.bpm)}</b></div>}
          {t.camelot && <div><span className="rotulo">{T.tono}</span><b><span className="camelot" style={{ background: camelotColor(t.camelot) ?? undefined }}>{t.camelot}</span></b></div>}
          {t.energy != null && <div><span className="rotulo">{T.energia}</span><b className="energia">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < t.energy! ? (i >= 7 ? 'on alta' : 'on') : ''} />)}</b></div>}
          <div><span className="rotulo">{T.duracion}</span><b className="num">{duration(t.duration)}</b></div>
          {a?.lufs != null && <div><span className="rotulo">{T.volumen}</span><b className="num">{dec(a.lufs)} <small className="muted">LUFS</small></b></div>}
        </div>
      </header>
      {forDj && combina && combina.length > 0 && (
        <section className="combinan">
          <h4>{T.combinan} <small className="muted">{T.combinanSub}</small> <Info tip={T.combinanTip} /></h4>
          {combina.map((x) => (
            <div key={x.id} className="combina" onDoubleClick={() => onPlay(x.id)} title={T.dobleClic}>
              <span className="combina-tema"><b>{x.title}</b> <span className="muted">· {x.artist}</span></span>
              <span className="num">{x.bpm != null ? dec(x.bpm) : ''}</span>
              {x.camelot && <span className="camelot" style={{ background: camelotColor(x.camelot) ?? undefined }}>{x.camelot}</span>}
              <Nota grade={x.grade} />
            </div>
          ))}
        </section>
      )}
      {d.fromName && <Aviso>{T.sinTags}</Aviso>}
      {t.missing && <Aviso><Icon name="alert" size={13} className="ic-inline" /> <Rico texto={T.desaparecido} partes={{ rel: <code>{t.rel}</code> }} /></Aviso>}
      {t.error && <p className="error">{T.noLeer} {t.error}</p>}

      {a?.grade && (
        <section className="verdict">
          <div className="verdict-row"><span className="muted">{T.diceSer}</span><div>{a.says}</div></div>
          <div className="verdict-arrow"><Icon name="down" size={14} /></div>
          <div className="verdict-row">
            <span className="muted">{T.esReal}</span>
            <div className="verdict-is"><Nota grade={a.grade} big title={GRADE_HELP[a.grade]} /> <b>{a.isLabel}</b></div>
          </div>
          <div className="muted small">{T.porQue}</div>
          <ul>{a.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <div className="small muted">
            <Term label={T.seguridad(a.confidence ?? '')} help={T.seguridadTip} />
          </div>
        </section>
      )}
      {a?.error && <p className="error small">{T.noAnalizar} {a.error}</p>}
      {!a && !t.error && <p className="muted small">{T.sinAnalizar}</p>}

      {(spectro || a?.spectrum?.length) && (
        <section>
          <h4><Term label={T.espectrograma} help={T.espectroTip} /></h4>
          {spectro === 'loading' ? <div className="spectro-wait muted small">{T.generando}</div>
            : spectro ? <><Espectro src={spectro} t={t} a={a} />{(t.duration ?? 0) >= SPECTRO_LONG_SECONDS && <div className="muted small">{T.temaLargo}</div>}</>
            : <div className="muted small">{t.missing ? T.sinEspecArchivo : T.sinEspec}</div>}
        </section>
      )}

      {a && (a.bpm != null || a.camelot) && (
        <section>
          <h4>{T.dj}</h4>
          <dl>
            <div><dt><Term label="BPM" help={T.bpmTip} /></dt><dd>
              {a.bpm != null ? dec(a.bpm) : '—'}
              {a.flags.includes('bpm_doubtful') && <div className="warn-inline small">{T.bpmDudoso(a.bpmFast ? dec(a.bpmFast) : null)}</div>}
              {a.bpmSource === 'nombre' && <span className="muted small"> {T.delNombre}</span>}
              {a.flags.includes('bpm_ok') && !a.flags.includes('bpm_doubtful') && <span className="muted small"> <Icon name="check" size={12} className="ic-inline" /> {T.confirmado}</span>}
            </dd></div>
            <div><dt><Term label={T.tono} help={T.tonoTip} /></dt>
              <dd>{a.camelot ? <><b>{a.camelot}</b> <span className="muted">({a.musicKey})</span></> : a.musicKey || '—'}
                {a.flags.includes('key_ok') && <span className="muted small"> <Icon name="check" size={12} className="ic-inline" /> {T.confirmado}</span>}
                {a.flags.includes('key_doubtful') && <div className="warn-inline small">{T.tonoDudoso}</div>}</dd></div>
            {a.bpmSource !== 'nombre' && <div><dt><Term label={T.pasada} help={T.pasadaTip} /></dt>
              <dd>{a.flags.includes('dj_precise') ? T.hecha : <span className="muted">{T.pendiente}</span>}</dd></div>}
            {a.energy != null && <div><dt><Term label={T.energia} help={T.energiaTip} /></dt><dd>{a.energy}/10</dd></div>}
          </dl>
        </section>
      )}

      {a?.grade && (
        <section>
          <h4>{T.sonido}</h4>
          <dl>
            {a.lufs != null && <div><dt><Term label={T.volumen} help={T.volumenTip} /></dt><dd>{dec(a.lufs)} LUFS</dd></div>}
            {a.lra != null && <div><dt><Term label={T.dinamica} help={T.dinamicaTip} /></dt><dd>{dec(a.lra)} LU</dd></div>}
            {a.truePeak != null && <div><dt><Term label={T.pico} help={T.picoTip} /></dt><dd>{dec(a.truePeak)} dBTP</dd></div>}
            {a.stereoCorr != null && <div><dt><Term label={T.estereo} help={T.estereoTip} /></dt><dd>{dec(a.stereoCorr, 2)}</dd></div>}
            {(a.silenceStart != null || a.silenceEnd != null) && <div><dt><Term label={T.silencio} help={T.silencioTip} /></dt>
              <dd style={a.flags.includes('silence_start') || a.flags.includes('silence_end') ? { color: 'var(--warn)' } : undefined}>{T.silencioVal(dec(a.silenceStart ?? 0), a.silenceEnd != null ? `${dec(a.silenceEnd)} s` : '—')}</dd></div>}
            {a.soundStyle && <div><dt><Term label={T.sunaA} help={T.sunaATip} /></dt>
              <dd>{a.soundStyle.style} <span className="muted">({a.soundStyle.genre})</span>
                {(t.genre ?? '').toLowerCase() !== a.soundStyle.style.toLowerCase() && <> <Boton size="sm" variant="ghost" onClick={() => onStage('genre', a.soundStyle!.style)}>{T.usarGenero}</Boton></>}</dd></div>}
            {a.encoder && <div><dt>{/* idioma-ok */}Encoder</dt><dd>{a.encoder}{a.vbrMethod ? ` · ${a.vbrMethod}` : ''}</dd></div>}
          </dl>
          {a.sound.map((s, i) => <p key={i} className="hint">{s}</p>)}
        </section>
      )}

      <section>
        <h4><Term label={T.tags} help={T.tagsTip} /></h4>
        {['wma', 'wmv', 'asf'].includes(t.ext) && <Aviso>{T.wma}</Aviso>}
        <div className="cover-row">
          <div className="cover-btns">
            <Boton variant="ghost" size="sm" disabled={['wma', 'wmv', 'asf'].includes(t.ext)} onClick={() => window.paila.setCover([t.id], 'pick').then(onCoverStaged)}>{cover ? T.cambiarTapa : T.agregarTapa}</Boton>
            {cover && <Boton variant="ghost" size="sm" onClick={() => window.paila.setCover([t.id], 'remove').then(onCoverStaged)}>{T.quitarTapa}</Boton>}
            {coverPending && <span className="small muted">{T.pendienteTapa} {coverPending.after}</span>}
          </div>
        </div>
        {EDITABLE.map(([f, label, key]) => (
          <TagInput key={f} t={t} field={f} label={label} current={t[key] as string | null} change={pending.find((c) => c.field === f)} onStage={onStage} />
        ))}
      </section>

      <section>
        <h4>{T.archivo}</h4>
        <dl>
          {rows.filter(([, v, solo]) => !solo || v).map(([k, v]) => (
            <div key={k} className={v ? '' : 'missing'}><dt>{k}</dt><dd>{v || '—'}</dd></div>
          ))}
        </dl>
        <div className="path-box">
          <div className="small">{fileName(t)}</div>
          <div className="small muted">{folder(t)}</div>
        </div>
        <Boton variant="ghost" onClick={() => window.paila.reveal(t.id)}>{T.mostrar}</Boton>
        {t.kind !== 'produccion' && <Boton variant="ghost" onClick={onReplace} title={T.reemplazarTip}>{T.reemplazar}</Boton>}
        {t.kind !== 'produccion' && <Boton variant="ghost" onClick={() => void window.paila.mejorarConNapia([t.id])} title={T.mejorarNapiaTip}>{T.mejorarNapia}</Boton>}
      </section>
    </div>
  )
}
