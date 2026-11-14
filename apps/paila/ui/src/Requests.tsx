// Pantalla "Traer una lista": una playlist de otro lado (CSV de Spotify, .m3u o texto pegado), PAILA
// la empareja con tu biblioteca y arma la playlist en su orden; lo que falta o está en mala calidad va a la lista
// «Faltan o suenan mal». Los probables se confirman a mano. Ver core/requests.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RequestDecision, RequestDetail, RequestItem, RequestPreview, RequestState, RequestSummary, WantedFormat } from '@paila/shared/types'
import { duration, n } from './format'
import { toast } from './toast'
import type { PageKey } from './nav'
import { Nota, Boton, Info, Cabecera, Rico } from '@paila/diseno'
import { fecha } from '@paila/shared/idioma'
import { conTeclado } from './conTeclado'
import { T } from './Requests.textos'
import { linkDeSpotify } from './listaLink'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const STATES: { id: RequestState; label: string; help: string; pill: string }[] = [
  { id: 'tenes', label: T.sTenesL, pill: 'pill-green', help: T.sTenesH },
  { id: 'baja', label: T.sBajaL, pill: 'pill-amber', help: T.sBajaH },
  { id: 'revisar', label: T.sRevisarL, pill: 'pill-blue', help: T.sRevisarH },
  { id: 'falta', label: T.sFaltaL, pill: '', help: T.sFaltaH },
]
const KIND: Record<RequestItem['kind'], { label: string; help: string }> = {
  isrc: { label: T.kIsrc, help: T.kIsrcH },
  ruta: { label: T.kIsrc, help: T.kRutaH },
  archivo: { label: T.kIsrc, help: T.kArchivoH },
  huella: { label: T.kIsrc, help: T.kHuellaH },
  exacto: { label: T.kExacto, help: T.kExactoH },
  probable: { label: T.kProbable, help: T.kProbableH },
  version: { label: T.kVersion, help: T.kVersionH },
  none: { label: '', help: '' },
  llego: { label: T.kLlego, help: T.kLlegoH },
}

/** Traer una lista de otro lado: elegir o pegar → vista previa → crear la playlist. Abajo, los pedidos que ya trajiste. */
/** El link de una playlist o un disco de Spotify (PAILA no lee esa página: se baja el CSV en Chosic o Exportify). */

export default function Requests({ onGo, onOpenPlaylist, onPlaylistsChanged, openPath }: { onGo: (p: PageKey) => void; onOpenPlaylist: (id: number) => void; onPlaylistsChanged: () => void; /** una lista soltada en la ventana */ openPath?: { path: string; at: number } | null }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<RequestPreview | null>(null)
  const [detail, setDetail] = useState<RequestDetail | null>(null)
  const [past, setPast] = useState<RequestSummary[] | null>(null)
  const loadPast = useCallback(() => window.paila.requests().then(setPast).catch((e) => toast(clean(e), 'error')), [])
  useEffect(() => { void loadPast(); return window.paila.onRequestsChanged(() => { void loadPast(); if (detail) void window.paila.requestDetail(detail.id).then(setDetail) }) }, [loadPast, detail])
  const run = async (fn: () => Promise<RequestPreview | null>) => {
    setBusy(true)
    try { const p = await fn(); if (p) { setPreview(p); setDetail(null) } } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }
  useEffect(() => { if (openPath) void run(() => window.paila.previewRequestFile(openPath.path)) }, [openPath]) // eslint-disable-line react-hooks/exhaustive-deps
  const link = linkDeSpotify(text)
  if (preview) return <Review key="p" data={preview} onClose={() => setPreview(null)} onSaved={(d) => { setPreview(null); setDetail(d); onPlaylistsChanged(); void loadPast() }} onGo={onGo} onOpenPlaylist={onOpenPlaylist} />
  if (detail) return <Review key={`d${detail.id}`} data={detail} onClose={() => { setDetail(null); void loadPast() }} onSaved={(d) => { setDetail(d); onPlaylistsChanged() }} onGo={onGo} onOpenPlaylist={onOpenPlaylist} />
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      <div className="row">
        <Boton disabled={busy} onClick={() => run(() => window.paila.pickRequest())}>{T.elegirArchivo}</Boton>
        <span className="muted small"><Rico texto={T.formatos} partes={{ csv: <Info tip={T.csvTip} />, m3u: <Info tip={T.m3uTip} /> }} /></span>
      </div>
      <textarea rows={7} style={{ width: '100%', maxWidth: 720 }} placeholder={T.pegar} value={text} onChange={(e) => setText(e.target.value)} />
      {link ? (
        <div className="box" style={{ maxWidth: 720 }}>
          <div className="box-head"><b>{T.esSpotify}</b></div>
          <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
            <span className="small"><Rico texto={T.spotifyExplica} /></span>
            <div className="row">
              <Boton onClick={() => window.paila.openListSite('chosic', link)} title={T.chosicTip}>{T.abrirChosic}</Boton>
              <Boton variant="ghost" onClick={() => window.paila.openListSite('exportify', link)} title={T.exportifyTip}>Exportify</Boton>{/* idioma-ok */}
            </div>
          </div>
        </div>
      ) : <div className="row"><Boton variant="ghost" disabled={busy || !text.trim()} onClick={() => run(() => window.paila.previewRequest(text))}>{busy ? T.buscandoBib : T.verQueTengo}</Boton></div>}

      {busy && <p className="muted small">{T.buscandoCada}</p>}

      <h3>{T.trajiste}</h3>
      {past == null && <p className="muted">{T.cargando}</p>}
      {past?.length === 0 && <p className="muted">{T.ninguna}</p>}
      {!!past?.length && <div className="lista-filas">{past.map((r) => (
        <div key={r.id} className={`box ${r.undone ? 'skipped' : ''}`}>
          <div className="box-head clickable" onClick={() => window.paila.requestDetail(r.id).then((d) => d && setDetail(d))} {...conTeclado(() => { void window.paila.requestDetail(r.id).then((d) => d && setDetail(d)) })}>
            <b>{r.name}</b><span className="muted small">{T.resumen(r.source, fecha(r.createdAt), n(r.total), !!r.undone)}</span>
            {STATES.map((s) => r.counts[s.id] ? <span key={s.id} className={`pill ${s.pill}`} title={s.help}>{s.label}: {r.counts[s.id]}</span> : null)}
          </div>
        </div>
      ))}</div>}
    </div>
  )
}

type Data = RequestPreview | RequestDetail
const isSaved = (d: Data): d is RequestDetail => 'id' in d

/** La vista previa (decisiones en memoria) o un pedido guardado (cada decisión se guarda al momento). */
function Review({ data, onClose, onSaved, onGo, onOpenPlaylist }: { data: Data; onClose: () => void; onSaved: (d: RequestDetail) => void; onGo: (p: PageKey) => void; onOpenPlaylist: (id: number) => void }) {
  const saved = isSaved(data)
  const [name, setName] = useState(data.name)
  const [items, setItems] = useState(data.items)
  const [filter, setFilter] = useState<RequestState | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATES.map((s) => [s.id, items.filter((i) => i.state === s.id).length])) as Record<RequestState, number>
    // en la vista previa, "Los dos" suma la versión pedida a lo que falta (al crear se vuelve un tema más del pedido)
    if (!saved) c.falta += items.filter((i) => i.decision === 'ambos').length // idioma-ok
    return c
  }, [items, saved])
  const probables = items.filter((i) => i.state === 'revisar' && i.kind === 'probable')

  const decide = async (i: RequestItem, d: RequestDecision | null) => {
    if (saved) {
      try { const r = await window.paila.decideRequest(i.id, d); setItems(r.items); onSaved(r) } catch (e) { toast(clean(e), 'error') }
      return
    }
    const state: RequestState = !i.file || d === 'no' ? 'falta' : d === 'si' || d === 'ambos' || (d == null && i.kind === 'exacto') ? (i.file.low ? 'baja' : 'tenes') : 'revisar' // idioma-ok
    setItems((xs) => xs.map((x) => (x.position === i.position ? { ...x, decision: d, state } : x)))
  }
  const confirmAll = () => { for (const i of probables) void decide(i, 'si') } // idioma-ok
  const create = async () => {
    setBusy(true)
    try {
      const d = await window.paila.createRequest({ name: name.trim() || data.name, source: data.source, items })
      toast(T.creada(d.playlistName ?? '', n(d.counts.tenes + d.counts.baja), d.counts.falta + d.counts.baja ? n(d.counts.falta + d.counts.baja) : ''))
      onSaved(d)
    } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }
  // traer otra vez una lista que ya está: se actualiza esa (uso real del 24/10: quedaron seis «Fiesta 2026»)
  // (también si el nombre se escribe después, con una lista pegada)
  const [existing, setExisting] = useState(!saved && 'existing' in data ? data.existing ?? null : null)
  useEffect(() => {
    if (saved) return
    const t = setTimeout(() => { window.paila.requestNamed(name).then((x) => setExisting(x ?? null)).catch(() => setExisting(null)) }, 300)
    return () => clearTimeout(t)
  }, [name, saved])
  const update = async () => {
    if (!existing) return
    setBusy(true)
    try {
      const r = await window.paila.updateRequest(existing.id, items)
      toast(T.actualizada(r.detail.playlistName ?? r.detail.name, r.added, r.found))
      onSaved(r.detail)
    } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }
  const undo = async () => {
    try { await window.paila.undoRequest((data as RequestDetail).id); toast(T.deshecha); onClose() } catch (e) { toast(clean(e), 'error') }
  }
  const exportAs = async (f: WantedFormat) => {
    try { const r = await window.paila.exportRequest((data as RequestDetail).id, f); if (r) toast(T.guardado(n(r.count))) } catch (e) { toast(clean(e), 'error') }
  }
  // solo lo de esta lista (la de "Faltan o suenan mal" junta además todo lo que suena mal de la biblioteca: 127 en vez de 23, 31/10)
  const toNapia = async () => {
    try {
      const r = await window.paila.wantedToNapia(false, (data as RequestDetail).playlistId)
      if (r) toast(T.abriendoNapia(n(r.count)) + (r.bandeja ? T.bandejaNapia(r.bandeja) : ''))
    } catch (e) { toast(clean(e), 'error') }
  }
  const shown = filter ? items.filter((i) => i.state === filter) : items
  const undone = saved && (data as RequestDetail).undone

  return (
    <div className="page">
      <div className="row"><Boton variant="ghost" size="sm" onClick={onClose}>{T.volver}</Boton></div>
      {saved ? <h2>{data.name}{undone ? T.deshecho : ''}</h2> : (
        <div className="row"><h2 style={{ margin: 0 }}>{T.nuevaPlaylist}</h2><input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 280, fontSize: 'var(--fs-lg)' }} title={T.nombreTip} /></div>
      )}
      <p className="muted small">
        {T.resumenRev(data.source, n(items.length))}{'skipped' in data && data.skipped.length ? T.filasNo(data.skipped.length) : ''}
        {'withIsrc' in data && <>{T.conIsrc(n(data.withIsrc))}<Info tip={T.isrcTip} /></>}
        {saved && (data as RequestDetail).playlistName && <>{T.playlistN}{(data as RequestDetail).playlistName}»</>}
      </p>
      <div className="cards">
        {STATES.map((s) => (
          <button key={s.id} className={`card ${counts[s.id] ? '' : 'zero'}`} disabled={!counts[s.id]} title={s.help} onClick={() => setFilter(filter === s.id ? null : s.id)} style={filter === s.id ? { borderColor: 'var(--accent)' } : undefined}>
            <div className="card-n">{n(counts[s.id])}</div><div className="card-label">{s.label}</div>
          </button>
        ))}
      </div>
      {existing && (
        <div className="box" style={{ maxWidth: 720, marginTop: 'var(--sp-3)' }}>
          <div className="box-head"><b>{T.yaTrajiste(existing.playlistName ?? existing.name)}</b></div>
          <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
            <span className="small">{T.yaTrajisteH}</span>
            <div className="row">
              <Boton disabled={busy} onClick={update} title={T.actualizarTip}>{T.actualizar(existing.playlistName ?? existing.name)}</Boton>
              <Boton variant="ghost" disabled={busy || !name.trim()} onClick={create} title={T.crearTip}>{T.crearOtra}</Boton>
            </div>
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        {/* los probables primero: la persona 1 creó la playlist, vio uno sin confirmar y la deshizo para volver a crearla (31/10); se
            pueden confirmar antes o después, y la playlist los suma igual */}
        {probables.length > 0 && !undone && <Boton variant="ghost" onClick={confirmAll} title={T.confirmarProbTip}>{T.confirmarProb(probables.length)}</Boton>}
        {!saved && !existing && <Boton disabled={busy || !name.trim()} onClick={create} title={T.crearTip}>{busy ? T.creando : T.crear(name.trim() || data.name)}</Boton>}
        {!saved && counts.falta + counts.baja > 0 && <span className="muted small">{T.vanALista(n(counts.falta + counts.baja))}</span>}
        {probables.length > 0 && !undone && <span className="muted small">{T.probablesDespues}</span>}
        {saved && !undone && <>
          {(data as RequestDetail).playlistId != null && counts.falta + counts.baja > 0 && <Boton onClick={toNapia} title={T.bajarNapiaTip}>{T.bajarNapia(n(counts.falta + counts.baja))}</Boton>}
          <Boton variant="ghost" onClick={() => exportAs('txt')} title={T.expFaltaTip}>{T.expFalta}</Boton>
          <Boton variant="ghost" onClick={() => exportAs('csv')} title={T.csvPlanilla}>.csv</Boton>
          <span className="small muted">{T.paraSockseek}<Info tip={T.sockseekInfo} />:</span>
          <Boton variant="ghost" size="sm" onClick={() => exportAs('sockseek-txt')}>.txt</Boton>
          <Boton variant="ghost" size="sm" onClick={() => exportAs('sockseek-csv')}>.csv</Boton>
          {(data as RequestDetail).playlistId != null && <Boton onClick={() => onOpenPlaylist((data as RequestDetail).playlistId!)} title={T.verPlaylistTip}>{T.verPlaylist}</Boton>}
          <Boton variant="ghost" onClick={() => onGo('wishlist')}>{T.verLista}</Boton>
          {!confirmUndo ? <Boton variant="ghost" className="push-right" onClick={() => setConfirmUndo(true)}>{T.deshacerPedido}</Boton>
            : <span className="push-right small">{T.confirmUndo}<Boton size="sm" onClick={undo}>{T.siDeshacer}</Boton> <Boton variant="ghost" size="sm" onClick={() => setConfirmUndo(false)}>{T.no}</Boton></span>}
        </>}
      </div>
      <table className="req-table">
        <colgroup><col style={{ width: 44 }} /><col style={{ width: '36%' }} /><col /><col style={{ width: 300 }} /></colgroup>
        <thead><tr><th>#</th><th>{T.colPedido}</th><th>{T.colBib}</th><th /></tr></thead>
        <tbody>
          {shown.map((i) => {
            const st = STATES.find((s) => s.id === i.state)!
            return (
              <tr key={`${i.position}-${i.id}`} className={i.state === 'falta' ? 'dim' : ''}>
                <td className="muted">{i.position}</td>
                <td className="ellipsis" title={`${i.artist} — ${i.title}`}><b>{i.artist || '—'}</b> — {i.title}<span className="muted small">{i.duration ? ` · ${duration(i.duration)}` : ''}</span></td>
                <td>
                  {/* un renglón con lo que hay y otro con el porqué, cortados con "…": el texto entero, al pasar el mouse */}
                  <div className="ellipsis" title={i.file?.rel}>
                  <span className={`pill ${st.pill}`} title={st.help} style={{ marginLeft: 0 }}>{st.label}</span>
                  {KIND[i.kind].label && i.file && <span className="pill" title={KIND[i.kind].help}>{KIND[i.kind].label}</span>}
                  {i.file && <> {i.file.grade && <Nota grade={i.file.grade} title={T.notaTip} />} <span className="small" title={i.file.rel}>{i.file.rel.split('/').pop()}</span><span className="muted small"> · {i.file.quality}{i.file.duration ? ` · ${duration(i.file.duration)}` : ''}</span></>}
                  </div>
                  {(i.kind !== 'none' || i.state !== 'falta' || i.versionOf != null) && <div className="muted small ellipsis" title={i.why}>{i.why}{i.copies ? T.tenesCopias(i.copies) : ''}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {/* lo exacto ya entró: solo se ofrece "No es", por si se llama igual pero es otro tema. Otra versión: también "Los dos"
                      (la tuya entra y la pedida va a la lista «Faltan o suenan mal»); si la tuya es mala, "Es este" dice que se busca una mejor */}
                  {!undone && i.file && (i.kind === 'probable' || i.kind === 'version' || i.kind === 'exacto') && (i.decision == null // idioma-ok
                    ? <>{i.kind !== 'exacto' && <><Boton size="sm" onClick={() => decide(i, 'si')} title={i.file.low ? T.buscarMejorTip : T.esEsteTip}>{i.file.low ? T.buscarMejor : T.esEste}</Boton> </>}
                        {i.kind === 'version' && <><Boton variant="ghost" size="sm" onClick={() => decide(i, 'ambos')} title={T.losDosTip}>{T.losDos}</Boton> </>}
                        <Boton variant="ghost" size="sm" onClick={() => decide(i, 'no')} title={T.noEsTip}>{T.noEs}</Boton>{/* idioma-ok */}</>
                    : <button className="link small" onClick={() => decide(i, null)} title={T.dejarSinDecidir}>{i.decision === 'si' ? T.confirmado : i.decision === 'ambos' ? T.losDos : T.descartado}{T.cambiar}</button>)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
