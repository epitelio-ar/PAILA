// Pantalla Bandeja: lo que llega a la carpeta vigilada (o arrastrás a la ventana), emparejado con tus temas y verificado.
// La vigilancia corre en el proceso principal; acá se ve el resultado y se compara a oído. Las copias mejores se proponen solo en Sonido
// de un vistazo y en la barra de arriba (el autor, 13/11): acá hay un botón que lleva ahí, y "Apartar" para lo que no sirve.
import logo from './assets/logo.png'
import { Icon } from './icons'
import { useCallback, useEffect, useState } from 'react'
import type { InboxDecision, InboxItem, InboxResult, InboxWatchState } from '@paila/shared/types'
import { bytes, n } from './format'
import { JobPanel, useJob } from './jobs'
import { toast } from './toast'
import { InboxAddModal, InboxPlanModal } from './InboxPlan'
import { Resultado, type ResultadoTanda } from './Confirmar'
import { Aviso, Boton, Info, Nota, Pildora, Cabecera, PantallaVacia, Rico } from '@paila/diseno'
import { fechaHora } from '@paila/shared/idioma'
import { T } from './Inbox.textos'
import { NapiaArriba } from './NapiaBanda'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const fmt = (x: { ext: string; kbps: number | null }) => `${x.ext.toUpperCase()}${x.kbps ? ` ${x.kbps} kbps` : ''}`
const base = (rel: string) => rel.split('/').pop() ?? rel
const Grade = ({ g }: { g: string | null }) => <Nota grade={g} />

const SECTIONS: { key: InboxDecision[]; title: string; help: string }[] = [
  { key: ['reemplazar'], title: T.secReemplazar, help: T.secReemplazarH(T.huella) },
  { key: ['falta'], title: T.secFalta, help: T.secFaltaH },
  { key: ['mirar'], title: T.secMirar, help: T.secMirarH },
  { key: ['no-sirve'], title: T.secNoSirve, help: T.secNoSirveH },
  { key: ['sin-pareja', 'error'], title: T.secSinPareja, help: T.secSinParejaH },
]

const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
/** ¿El archivo está en esa carpeta (o en una de adentro)? */
const dentroDe = (file: string, folder: string) => norm(file).startsWith(norm(folder) + '/')
const ultimo = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

/**
 * Bandeja: la carpeta vigilada y lo arrastrado a la ventana. PAILA no descarga música. `onSonido`: ir a Sonido de un vistazo.
 * `soloDe`: "Ver en PAILA" desde NAPIA: se muestra solo lo que llegó a esa carpeta (con "Ver todo" para volver). */
export default function Inbox({ dropped, onClearDropped, onReplace, soloDe, onVerTodo, onSonido }: { dropped: InboxItem[]; onClearDropped: () => void; onReplace: (trackId: number, file: string) => void; soloDe?: string | null; onVerTodo?: () => void; onSonido?: () => void }) {
  const [st, setSt] = useState<InboxWatchState | null>(null)
  // la carpeta donde guarda NAPIA, si la Bandeja todavía no la vigila: se ofrece
  const [napia, setNapia] = useState<string | null>(null)
  useEffect(() => { void window.paila.napiaFolder().then(setNapia) }, [st?.folder])
  const [results, setResults] = useState<InboxResult[]>([])
  const [planning, setPlanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const job = useJob('inbox')

  const load = useCallback(async () => { try { setResults(await window.paila.inboxResults()) } catch (e) { toast(clean(e), 'error') } }, [])
  useEffect(() => { window.paila.inboxState().then(setSt); load() }, [load])
  // la vigilancia avisa cada vez que termina de revisar un archivo
  useEffect(() => window.paila.onInboxUpdate((s) => { setSt((prev) => { if (!prev || prev.processed !== s.processed) void load(); return s }) }), [load])
  useEffect(() => { if (job && !job.running) void load() }, [job, load])

  const pick = async () => { const f = await window.paila.pickInboxFolder(); if (f) { setSt(await window.paila.inboxState()); load() } }
  const ignore = async (p: string) => { await window.paila.inboxIgnore(p); setHidden((h) => new Set(h).add(p)) }
  const setAuto = async (on: boolean) => { await window.paila.setInboxAuto(on); setSt(await window.paila.inboxState()) }

  // "Ver en Sonido", "Apartar" y "Pasar a tu Música" son de toda la Bandeja: sus números no dependen de lo que se muestra
  const todos = results.filter((r) => !hidden.has(r.path))
  const shown = soloDe ? todos.filter((r) => dentroDe(r.path, soloDe)) : todos
  // la carpeta pedida desde NAPIA no está dentro de la que vigila la Bandeja: lo de ahí no se revisa
  const fuera = !!soloDe && !!st && (!st.folder || !(norm(soloDe) === norm(st.folder) || dentroDe(soloDe, st.folder)))
  const ready = todos.filter((r) => r.decision === 'reemplazar').length
  const rejects = todos.filter((r) => r.decision === 'no-sirve').length
  const fresh = todos.filter((r) => r.decision === 'falta' || r.decision === 'sin-pareja').length
  const dropShown = dropped.filter((d) => !hidden.has(d.path))

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      <NapiaArriba />
      <div className="row">
        <Boton variant="ghost" onClick={pick}>{st?.folder ? T.cambiarCarpeta : T.elegirCarpeta}</Boton>
        <span className="muted small" title={st?.folder ?? ''}>{st?.folder ?? T.sinCarpeta}</span>
        {st?.folder && <Boton variant="ghost" size="sm" onClick={async () => setSt(await window.paila.inboxRescan())}>{T.revisarAhora}</Boton>}
        {dropShown.length > 0 && <button className="link" onClick={onClearDropped}>{T.limpiarArrastrado}</button>}
      </div>
      {napia && (
        <Aviso style={{ marginTop: 'var(--sp-2)' }}>
          <Rico texto={T.avisoNapia(!!st?.folder)} partes={{ carpeta: <b>{napia}</b> }} />
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
            <Boton size="sm" onClick={async () => { if (await window.paila.useNapiaFolder()) { setSt(await window.paila.inboxState()); load() } }}>{T.vigilarNapia}</Boton>
          </div>
        </Aviso>
      )}
      {soloDe && (
        <Aviso style={{ marginTop: 'var(--sp-2)' }}>
          <Rico texto={T.soloDe} partes={{ carpeta: <b title={soloDe}>«{ultimo(soloDe)}»</b> }} />{' '}
          {fuera ? T.fuera : !shown.length ? T.nadaPorRevisar : ''}
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}><Boton size="sm" variant="ghost" onClick={onVerTodo}>{T.verTodaBandeja}</Boton></div>
        </Aviso>
      )}
      {st?.folder && (
        <p className="small muted">
          {st.watching ? <><Icon name="dot" size={12} className="ic-inline" />{T.vigilando}</> : <><Icon name="ring" size={12} className="ic-inline" />{T.sinVigilar}</>}
          {st.current ? T.revisando(st.current) : ''}{st.queue > (st.current ? 1 : 0) ? T.enEspera(n(st.queue - (st.current ? 1 : 0))) : ''}
          {st.lastFullScan ? T.ultimaRevision(fechaHora(st.lastFullScan, { hour: '2-digit', minute: '2-digit' })) : ''}
          <Info tip={T.vigilaTip} />
        </p>
      )}
      {!st?.folder && !dropShown.length && <PantallaVacia imagen={logo} titulo={T.vacioTitulo} accion={<Boton onClick={pick}>{T.elegirCarpeta}</Boton>}>{T.vacio}</PantallaVacia>}
      {st?.error && <p className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {st.error}</p>}

      {st?.folder && (
        <div className="row">
          {ready > 0 && onSonido && <Boton onClick={onSonido} title={T.verEnSonidoTip}>{T.verEnSonido(n(ready))}</Boton>}
          {rejects > 0 && <Boton variant="ghost" onClick={() => setPlanning(true)} title={T.apartarTip}>{T.apartar(n(rejects))}</Boton>}
          {fresh > 0 && <Boton variant="ghost" onClick={() => setAdding(true)} title={T.pasarTip}>{T.pasar} ({n(fresh)})</Boton>}
          <label className="small">
            <input type="checkbox" checked={!!st.auto} onChange={(e) => setAuto(e.target.checked)} />{T.autoLabel}
            <Info tip={T.autoTip(T.huella)} />
          </label>
          {st.auto && st.autoHechos > 0 && <span className="small muted">{T.autoHechos(st.autoHechos)}</span>}
        </div>
      )}
      {job && <JobPanel job={job} unit={T.unidad} onDismiss={() => window.paila.dismissJob('inbox')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('inbox')}>{T.cancelar}</Boton>}</JobPanel>}
      {res && <Resultado r={res} onCerrar={() => setRes(null)} />}

      {st?.folder && shown.length === 0 && <p className="muted">{T.sinArchivos}</p>}
      {SECTIONS.map((s) => {
        const items = shown.filter((r) => s.key.includes(r.decision))
        if (!items.length) return null
        return (
          <div key={s.title}>
            <h4>{s.title} ({n(items.length)})<Info tip={s.help} /></h4>
            <div className="bj-tabla" role="table"><Cabeza />{items.map((r) => <ResultRow key={r.path} r={r} onReplace={onReplace} onIgnore={() => ignore(r.path)} onRecheck={async () => { await window.paila.inboxRecheck(r.path); load() }} />)}</div>
          </div>
        )
      })}

      <div className="drop-zone">{T.soltar}</div>
      {dropShown.length > 0 && <h4>{T.arrastraste(n(dropShown.length))}</h4>}
      {dropShown.length > 0 && <div className="bj-tabla" role="table"><Cabeza />{dropShown.map((it) => <DroppedRow key={it.path} it={it} onReplace={onReplace} onIgnore={() => ignore(it.path)} />)}</div>}

      {planning && <InboxPlanModal onClose={() => setPlanning(false)} onDone={(r) => { setPlanning(false); setRes(r); load() }} />}
      {adding && <InboxAddModal onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setRes(r); load() }} />}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { mismo: T.kMismo, version: T.kVersion, dudoso: T.kDudoso, probable: T.kProbable }
const KIND_HELP: Record<string, string> = { mismo: T.kMismoH(T.huella), version: T.kVersionH, dudoso: T.kDudosoH, probable: T.kProbableH }

/** Encabezado de la tabla de la Bandeja (una fila por archivo: qué llegó · qué tenés · acciones). */
function Cabeza() {
  return <div className="bj-fila bj-cab" role="row"><span>{T.colLlego}</span><span>{T.colBiblioteca}</span><span /></div>
}

function ResultRow({ r, onReplace, onIgnore, onRecheck }: { r: InboxResult; onReplace: (id: number, file: string) => void; onIgnore: () => void; onRecheck: () => void }) {
  const m = r.match
  return (
    <div className="bj-fila" role="row">
      <span className="bj-col" title={r.path}>
        <b className="ellipsis">{r.name}</b>
        <span className="ellipsis muted small">{fmt(r)} · {bytes(r.size)}{r.artist ? ` · ${r.artist}` : ''}{r.title ? ` — ${r.title}` : ''}</span>
      </span>
      <span className="bj-col">
        {m && (
          <span className="ellipsis small" title={m.rel}>
            <Pildora>{KIND_LABEL[m.kind]}</Pildora><span className="info" title={KIND_HELP[m.kind]}>ⓘ</span>{' '}
            «{base(m.rel)}» <span className="muted">({fmt(m)})</span> <Grade g={m.grade} />
            {r.check && <> → <Grade g={r.check.newGrade} /> <span className="muted">({r.check.newLabel})</span></>}
            {r.check?.warnings.map((w) => <span key={w} className="pill pill-amber" title={w}>{T.otroMaster}</span>)}
          </span>
        )}
        <span className="ellipsis muted small" title={r.why}>{r.why}</span>
      </span>
      <span className="bj-acciones">
        {m && r.decision !== 'no-sirve' && <Boton size="sm" onClick={() => onReplace(m.fileId, r.path)} title={T.compararTip}>{T.comparar}</Boton>}
        {r.decision === 'error' && <Boton variant="ghost" size="sm" onClick={onRecheck}>{T.probarDeNuevo}</Boton>}
        <Boton variant="ghost" size="sm" onClick={() => window.paila.inboxReveal(r.path)} title={T.mostrarTip}>{T.mostrar}</Boton>
        {r.decision !== 'reemplazar' && <Boton variant="ghost" size="sm" onClick={onIgnore} title={T.ignorarTip}>{T.ignorar}</Boton>}
      </span>
    </div>
  )
}

/** Lo arrastrado a la ventana: el vistazo rápido de siempre (sin verificar la calidad). */
function DroppedRow({ it, onReplace, onIgnore }: { it: InboxItem; onReplace: (id: number, file: string) => void; onIgnore: () => void }) {
  return (
    <div className="bj-fila" role="row">
      <span className="bj-col" title={it.path}>
        <b className="ellipsis">{it.name}</b>
        <span className="ellipsis muted small">{fmt(it)} · {bytes(it.size)}{it.artist ? ` · ${it.artist}` : ''}{it.title ? ` — ${it.title}` : ''}</span>
      </span>
      {it.match ? (
        <span className="bj-col">
          <span className="ellipsis small" title={it.match.rel}>
            {T.parece}«{base(it.match.rel)}» <span className="muted">({fmt(it.match)})</span> <Grade g={it.match.grade} />
            {it.looksBetter === true && <b className="pill pill-green">{T.parecerMejora}</b>}
            {it.looksBetter === false && <Pildora tone="atencion">{T.noMejor}</Pildora>}
          </span>
          <span className="ellipsis muted small">{T.emparejado}{it.match.by === 'tags' ? T.porTags : it.match.by === 'sonido' ? T.porSonido : T.porNombre}{it.match.by === 'sonido' && <Info tip={T.huella} />}</span>
        </span>
      ) : <span className="bj-col muted small">{it.note ?? T.sinParecido}</span>}
      <span className="bj-acciones">
        {it.match && <Boton size="sm" onClick={() => onReplace(it.match!.fileId, it.path)}>{T.compararReemplazar}</Boton>}
        <Boton variant="ghost" size="sm" onClick={onIgnore} title={T.ignorarTip}>{T.ignorar}</Boton>
      </span>
    </div>
  )
}
