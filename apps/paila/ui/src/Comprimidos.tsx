// Pantalla "ZIP y RAR" (masterplan 3, punto 4): los comprimidos de la biblioteca con la música que tienen adentro, sin abrirlos
// enteros. Escuchar un tema (se saca solo ese), leer y analizar (tags, nota, BPM y tono, de a uno) y "Sacar al lado" con
// vista previa, Historial y deshacer; y, si todo lo de adentro ya está afuera, "Mandar el comprimido a la papelera" (con vista
// previa, Historial y restaurar). Los sample packs se ven, pero no se tocan.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArchiveEntryRow, ArchiveExtractPlan, ArchiveSummary, ArchiveTrashPlan } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Icon, Info, Nota, PantallaVacia, Pildora, Rico, Ventana } from '@paila/diseno'
import { T } from './Comprimidos.textos'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'
import { JobPanel, useJob } from './jobs'
import { bytes, duration } from './format'
import { toast } from './toast'
import { conTeclado } from './conTeclado'

const TIP = {
  get intro() { return T.tipIntro }, get leer() { return T.tipLeer }, get sacar() { return T.tipSacar }, get afuera() { return T.tipAfuera },
  get papelera() { return T.tipPapelera }, get solido() { return T.tipSolido }, get sample() { return T.tipSample }, get nota() { return T.tipNota }, get bpm() { return T.tipBpm },
}
const STATUS: Record<ArchiveSummary['status'], { label: string; tone: 'ok' | 'atencion' | 'error' | 'neutro' }> = {
  ok: { get label() { return T.sPuede }, tone: 'ok' }, clave: { get label() { return T.sClave }, tone: 'atencion' }, roto: { get label() { return T.sRoto }, tone: 'error' },
  'falta-parte': { get label() { return T.sFalta }, tone: 'atencion' }, 'sin-musica': { get label() { return T.sSinMusica }, tone: 'neutro' },
}
const GRID = { display: 'grid', gridTemplateColumns: '32px 1fr 64px 92px 64px 64px 48px 110px', gap: 8, alignItems: 'center' } as const
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export default function Comprimidos() {
  const [list, setList] = useState<ArchiveSummary[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [entries, setEntries] = useState<ArchiveEntryRow[] | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const [loadingPlay, setLoadingPlay] = useState<number | null>(null)
  const [plan, setPlan] = useState<ArchiveExtractPlan | null>(null)
  const [trashPlan, setTrashPlan] = useState<ArchiveTrashPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const [showSamples, setShowSamples] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const job = useJob('comprimidos')
  const sacando = useJob('comprimidos-sacar')

  const load = () => window.paila.archives().then(setList).catch((e) => toast(clean(e), 'error'))
  useEffect(() => { void load() }, [])
  useEffect(() => { setEntries(null); stop(); if (open != null) void window.paila.archiveEntries(open).then(setEntries) }, [open])
  // al terminar de leer, se traen los datos nuevos
  useEffect(() => { if (job && !job.running) { void load(); if (open != null) void window.paila.archiveEntries(open).then(setEntries) } }, [job?.running, job?.finishedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const music = useMemo(() => (list ?? []).filter((a) => !a.samplePack), [list])
  const samples = useMemo(() => (list ?? []).filter((a) => a.samplePack), [list])
  const readable = music.filter((a) => a.status === 'ok' && a.available && a.read < a.audio)
  const spare = music.filter((a) => a.audio && a.outside === a.audio)

  function stop() { audio.current?.pause(); setPlaying(null) }
  const play = async (e: ArchiveEntryRow) => {
    const a = audio.current
    if (!a) return
    if (playing === e.id) return stop()
    setLoadingPlay(e.id)
    try { a.src = await window.paila.archivePlay(e.id); await a.play(); setPlaying(e.id) } catch (err) { toast(clean(err), 'error') } finally { setLoadingPlay(null) }
  }
  const read = (ids: number[]) => window.paila.archiveRead(ids).catch((e) => toast(clean(e), 'error'))
  const askPlan = (id: number) => window.paila.archivePlan(id).then(setPlan).catch((e) => toast(clean(e), 'error'))
  const apply = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const r = await window.paila.archiveExtract(plan)
      setRes({ hechos: T.sacados(r.done, r.folder), fallados: r.failed, deshacer: 'historial' })
      setPlan(null); void load()
    } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }

  const askTrash = (id: number) => window.paila.archiveTrashPlan(id).then(setTrashPlan).catch((e) => toast(clean(e), 'error'))
  const applyTrash = async () => {
    if (!trashPlan) return
    setBusy(true)
    try {
      const r = await window.paila.archiveTrash(trashPlan)
      setRes({ hechos: r.done ? T.aPapelera(r.done, bytes(r.bytes)) : T.noPapelera, fallados: r.failed, deshacer: r.done ? 'papelera' : undefined })
      setTrashPlan(null); setOpen(null); void load()
    } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }

  if (list && !list.length) return <div className="page">{res && <Resultado r={res} onCerrar={() => setRes(null)} />}<PantallaVacia titulo={T.vaciaTitulo}>{T.vaciaCuerpo}</PantallaVacia></div>

  const row = (a: ArchiveSummary) => (
    <div key={a.id}>
      <div className="box-row" style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} onClick={() => setOpen(open === a.id ? null : a.id)} {...conTeclado(() => setOpen(open === a.id ? null : a.id))}>
        <Icon name="chevron" size={14} />
        <span className="ellipsis" style={{ flex: '1 1 260px', minWidth: 0 }} title={a.rel}>
          <b>{a.name}</b> <span className="muted small">{a.folder || T.carpetaPrincipal}</span>
        </span>
        <span className="small num">{a.audio ? T.temas(a.audio) : ''}{a.seconds ? ` · ${duration(a.seconds)}` : ''}</span>
        <span className="small muted num">{bytes(a.size)}</span>
        <Pildora>{a.format.toUpperCase()}{a.volumes > 1 ? T.enPartes(a.volumes) : ''}</Pildora>
        {a.samplePack ? <Pildora tone="neutro" title={a.note ?? ''}>{T.samplePack}</Pildora> : a.status !== 'ok' && <Pildora tone={STATUS[a.status].tone} title={a.note ?? ''}>{STATUS[a.status].label}</Pildora>}
        {a.solid && <Pildora tone="info" title={TIP.solido}>{T.solido}</Pildora>}
        {!!a.outside && <Pildora tone={a.outside === a.audio ? 'ok' : 'info'} title={TIP.afuera}>{a.outside === a.audio ? T.yaAfuera : T.nYaAfuera(a.outside)}</Pildora>}
        {a.extractedTo && <Pildora tone="acento" title={T.sacadoTip(a.extractedTo)}>{T.sacadoPil}</Pildora>}
        {!a.available && <Pildora tone="atencion">{T.desconectado}</Pildora>}
      </div>
      {open === a.id && (
        <div className="box-body">
          {a.note && a.status !== 'ok' && <Aviso tone={a.status === 'roto' ? 'error' : 'atencion'}>{a.note}</Aviso>}
          {a.samplePack && <Aviso tone="info">{a.note}. {TIP.sample}</Aviso>}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {!a.samplePack && a.status === 'ok' && <>
              <Boton size="sm" disabled={!a.available || !!job?.running} onClick={() => void read([a.id])}>{a.read ? T.leerFalta : T.leerAnalizar}</Boton><Info tip={TIP.leer} />
              <Boton size="sm" variant="ghost" disabled={!a.available || !!sacando?.running} onClick={() => void askPlan(a.id)}>{T.sacarAlLado}</Boton><Info tip={TIP.sacar} />
              {!!a.audio && a.outside === a.audio && <><Boton size="sm" variant="ghost" disabled={!a.available || !!sacando?.running} onClick={() => void askTrash(a.id)}>{T.mandarComprimido}</Boton><Info tip={TIP.papelera} /></>}
            </>}
            <Boton size="sm" variant="ghost" disabled={!a.available} onClick={() => void window.paila.archiveShow(a.id)}>{T.mostrar}</Boton>
            {a.extractedTo && <Boton size="sm" variant="ghost" onClick={() => void window.paila.archiveShow(a.id, a.extractedTo!)}>{T.abrirSacado}</Boton>}
          </div>
          {!entries ? <div className="spinner" /> : <Entries rows={entries} playing={playing} loading={loadingPlay} canPlay={a.available} onPlay={play} />}
        </div>
      )}
    </div>
  )

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} info={TIP.intro} />
      {!list ? <div className="spinner" /> : <>
        <p className="small">
          <Rico texto={T.resumen(music.length, music.reduce((s, a) => s + a.audio, 0)) + (spare.length ? T.resumenAbiertos(spare.length, bytes(spare.reduce((s, a) => s + a.size, 0))) : '') + (samples.length ? T.resumenSamples(samples.length) : '')} partes={{ info: <Info tip={TIP.afuera} /> }} />
        </p>
        <div className="row">
          <Boton disabled={!readable.length || !!job?.running} onClick={() => void read(readable.map((a) => a.id))}>{T.leerTodos(readable.reduce((s, a) => s + a.audio - a.read, 0))}</Boton>
          <Info tip={TIP.leer} />
        </div>
        {res && <Resultado r={res} onCerrar={() => setRes(null)} />}
        {job && (job.running || job.finishedAt) && <JobPanel job={job} unit={T.unidadTemas} />}
        {sacando?.running && <JobPanel job={sacando} unit={T.unidadArchivos} />}
        <audio ref={audio} onEnded={() => setPlaying(null)} />
        <div className="box">{music.map(row)}</div>
        {!!samples.length && <>
          <Boton variant="ghost" size="sm" onClick={() => setShowSamples(!showSamples)}>{T.verSamples(showSamples, samples.length)}</Boton> <Info tip={TIP.sample} />
          {showSamples && <div className="box">{samples.map(row)}</div>}
        </>}
      </>}
      {plan && <PlanWindow plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={() => void apply()} />}
      {trashPlan && <TrashWindow plan={trashPlan} busy={busy} onClose={() => setTrashPlan(null)} onApply={() => void applyTrash()} />}
    </div>
  )
}

function TrashWindow({ plan, busy, onClose, onApply }: { plan: ArchiveTrashPlan; busy: boolean; onClose: () => void; onApply: () => void }) {
  return (
    <Ventana onClose={onClose} busy={busy}>
      <h3>{T.tTitulo(plan.archiveRel.split('/').pop() ?? '')}</h3>
      <p className="small"><Rico texto={T.tTexto(plan.audio, plan.files.length, bytes(plan.bytes))} /></p>
      <div className="box" style={{ maxHeight: 200, overflow: 'auto' }}>
        {plan.files.map((f) => <div key={f.rel} className="box-row small" style={{ cursor: 'default', display: 'flex', gap: 8, justifyContent: 'space-between' }} title={f.rel}><span className="ellipsis" style={{ minWidth: 0 }}>{f.rel}</span><span className="muted num">{bytes(f.size)}</span></div>)}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Boton variant="ghost" disabled={busy} onClick={onClose}>{T.cerrar}</Boton>
        <ConfirmarBoton disabled={busy} onSi={onApply} deshacer="papelera" pregunta={T.papeleraPreg(plan.files.length)}>{busy ? T.mandando : T.mandarPapelera}</ConfirmarBoton>
      </div>
    </Ventana>
  )
}

function Entries({ rows, playing, loading, canPlay, onPlay }: { rows: ArchiveEntryRow[]; playing: number | null; loading: number | null; canPlay: boolean; onPlay: (e: ArchiveEntryRow) => void }) {
  const audio = rows.filter((r) => r.audio), other = rows.filter((r) => !r.audio)
  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="box-head" style={GRID}><span /><span>{T.cTema}</span><span>{T.cDuracion}</span><span>{T.cFormato}</span><span>{T.cNota} <Info tip={TIP.nota} /></span><span>BPM <Info tip={TIP.bpm} /></span><span>{T.cTono}</span><span /></div>
      {audio.map((e) => (
        <div key={e.id} className="box-row" style={{ ...GRID, cursor: 'default' }}>
          <Boton size="sm" variant="ghost" disabled={!canPlay || !!e.blocked} loading={loading === e.id} title={e.blocked ?? T.escuchar} onClick={() => onPlay(e)}><Icon name={playing === e.id ? 'pause' : 'play'} size={14} /></Boton>
          <span className="ellipsis" title={`${e.folder ? e.folder + '/' : ''}${e.name}`}>
            {e.artist || e.title ? <>{e.artist && <span className="muted">{e.artist} – </span>}{e.title ?? e.name}</> : e.name}
            {e.error && <span className="small" style={{ color: 'var(--error, #c33)' }}> · {e.error}</span>}
          </span>
          <span className="num small">{e.duration ? duration(e.duration) : ''}</span>
          <span className="small">{e.codec ? `${(e.codec.startsWith('pcm') ? 'wav' : e.codec).toUpperCase()}${e.kbps ? ` ${e.kbps}` : ''}` : e.name.split('.').pop()?.toUpperCase()}</span>
          <span>{e.grade ? <Nota grade={e.grade} title={[e.gradeIs, ...e.gradeWhy].filter(Boolean).join('\n')} /> : <span className="muted small">–</span>}</span>
          <span className="num small">{e.bpm ? Math.round(e.bpm) : ''}</span>
          <span className="small">{e.key ?? ''}</span>
          <span>{e.blocked ? <Pildora tone="atencion" title={e.blocked}>{T.noSeAbre}</Pildora> : e.outside ? <Pildora tone="ok" title={TIP.afuera}>{T.yaAfueraCorto}</Pildora> : null}</span>
        </div>
      ))}
      {!!other.length && <div className="box-row muted small" style={{ cursor: 'default' }}>{T.ademas}{other.slice(0, 8).map((o) => o.name).join(', ')}{other.length > 8 ? T.yMas(other.length - 8) : ''}</div>}
    </div>
  )
}

function PlanWindow({ plan, busy, onClose, onApply }: { plan: ArchiveExtractPlan; busy: boolean; onClose: () => void; onApply: () => void }) {
  const audio = plan.items.filter((i) => i.audio).length
  const short = plan.free != null && plan.bytes * 1.05 + 50e6 > plan.free
  return (
    <Ventana onClose={onClose} busy={busy}>
      <h3>{T.pTitulo(plan.archiveRel.split('/').pop() ?? '')}</h3>
      <p className="small"><Rico texto={T.pTexto(audio, plan.items.length - audio, bytes(plan.bytes), plan.folderExists)} partes={{ carpeta: <b>{plan.folderRel}</b> }} /></p>
      {short && <Aviso tone="error">{T.sinLugar(bytes(plan.bytes), bytes(plan.free!))}</Aviso>}
      <div className="box" style={{ maxHeight: 260, overflow: 'auto' }}>
        {plan.items.map((i) => <div key={i.idx} className="box-row small ellipsis" style={{ cursor: 'default' }} title={i.name}>{i.rel}</div>)}
      </div>
      {!!plan.skipped.length && <Aviso tone="atencion">{T.noVan(plan.skipped.length, plan.skipped.slice(0, 5).map((s) => `${s.name.split('/').pop()} (${s.why})`).join(', '), plan.skipped.length > 5)}</Aviso>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Boton variant="ghost" disabled={busy} onClick={onClose}>{T.cerrar}</Boton>
        <ConfirmarBoton disabled={!plan.items.length || short || busy} onSi={onApply} deshacer="historial" pregunta={T.sacarPreg(plan.items.length)}>{busy ? T.sacando : T.sacarN(plan.items.length)}</ConfirmarBoton>
      </div>
    </Ventana>
  )
}
