// "Traer tus playlists de Rekordbox", sección de la pantalla Programas de DJ (core/listimport.ts): desde el rekordbox.xml o
// desde un pendrive armado por Rekordbox (solo se leen). Vista previa con cada playlist, confirmar los probables, buscar por
// cómo suenan los que no aparecieron y crear las playlists en una carpeta; del pendrive, también la grilla y los cues.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ImportItem, ImportPreview, RequestDecision, RequestState } from '@paila/shared/types'
import { duration, n } from './format'
import { JobPanel, useJob } from './jobs'
import { toast } from './toast'
import type { PageKey } from './nav'
import { Aviso, Boton, Caja, Casilla, Info, Nota, Rico } from '@paila/diseno'
import { HOW, STATE_LABEL, T, TRAER_TIPS } from './TraerRekordbox.textos'
import { TIPS } from './RekordboxPro'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export { TRAER_TIPS }
const HOW_ORDER: (keyof ImportPreview['how'])[] = ['ruta', 'archivo', 'huella', 'isrc', 'exacto', 'probable', 'version', 'none']
const PILL: Record<RequestState, string> = { tenes: 'pill-green', baja: 'pill-amber', revisar: 'pill-blue', falta: '' }
const SI: RequestDecision = 'si' // idioma-ok
const NO: RequestDecision = 'no' // idioma-ok
const stateOf = (i: ImportItem, d: RequestDecision | null | undefined): RequestState =>
  !i.file || i.kind === 'none' || d === NO ? 'falta' : d === SI || ['isrc', 'ruta', 'archivo', 'huella', 'exacto', 'llego'].includes(i.kind) ? (i.file.low ? 'baja' : 'tenes') : 'revisar'
/** Cuánto tarda buscar por huella: unos 2 s por tema. */
const printMins = (k: number) => Math.max(1, Math.round((k * 2) / 60))

/** Traer las playlists de Rekordbox: elegir de dónde → vista previa → traerlas. */
export function TraerSection({ onPlaylistsChanged, onGo, openXml }: { onPlaylistsChanged: () => void; onGo: (p: PageKey) => void; openXml?: { path: string; at: number } | null }) {
  const [drives, setDrives] = useState<{ root: string; label: string }[]>([])
  const [prev, setPrev] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [decisions, setDecisions] = useState<Record<string, RequestDecision | null>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [withDj, setWithDj] = useState(true)
  const [lowToo, setLowToo] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const job = useJob('traer-huella')

  useEffect(() => { window.paila.importPendrives().then(setDrives).catch(() => setDrives([])) }, [])

  const show = useCallback((p: ImportPreview, keepChoice = false) => {
    setPrev(p)
    if (!keepChoice) { setChosen(new Set(p.lists.filter((l) => l.total > 0).map((l) => l.key))); setDecisions({}); setOpen(null); setDone(null) }
  }, [])
  const prints = useCallback(async (token: string) => {
    try { show(await window.paila.importPrints(token), true) } catch (e) { setMsg(clean(e)) }
  }, [show])
  const pick = async (kind: 'xml' | 'pendrive', folder?: string) => {
    setBusy(folder ?? kind); setMsg(null)
    try {
      const p = await window.paila.importPick(kind, folder)
      if (!p) return
      show(p)
      // pocos sin pareja cuyo archivo está: se escuchan solos (unos segundos)
      if (p.printable > 0 && p.printable <= 30) void prints(p.token)
    } catch (e) { setMsg(clean(e)) } finally { setBusy(null) }
  }
  // un rekordbox.xml soltado en la ventana
  useEffect(() => { if (openXml) void pick('xml', openXml.path) }, [openXml?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // las cuentas, con lo que confirmaste
  useEffect(() => {
    if (!prev || !Object.keys(decisions).length) return
    window.paila.importSummary(prev.token, decisions).then((p) => setPrev(p)).catch(() => null)
  }, [decisions]) // eslint-disable-line react-hooks/exhaustive-deps

  const lists = prev?.lists ?? []
  const picked = lists.filter((l) => chosen.has(l.key) && l.total > 0)
  const totals = useMemo(() => picked.reduce((a, l) => ({ have: a.have + l.counts.tenes + l.counts.baja, get: a.get + l.counts.falta + (lowToo ? l.counts.baja : 0), low: a.low + l.counts.baja, check: a.check + l.counts.revisar, total: a.total + l.total }), { have: 0, get: 0, low: 0, check: 0, total: 0 }), [picked, lowToo])

  const create = async () => {
    if (!prev) return
    setBusy('create'); setMsg(null)
    try {
      const r = await window.paila.importCreate(prev.token, picked.map((l) => l.key), decisions, withDj && !!prev.dj?.tracks, lowToo)
      onPlaylistsChanged()
      setDone(T.listo(r.folderName, r.playlists, r.inLists, r.toGet, r.dj.grids, r.dj.cues))
      toast(T.toast(r.playlists, r.folderName))
      setPrev(null)
    } catch (e) { setMsg(clean(e)) } finally { setBusy(null) }
  }
  const probables = async () => {
    if (!prev) return
    const all: Record<string, RequestDecision | null> = { ...decisions }
    for (const l of picked) for (const i of await window.paila.importItems(prev.token, l.key)) if (i.kind === 'probable' && all[i.key] == null) all[i.key] = SI
    setDecisions(all)
  }

  return (
    <>
      <p className="muted small"><Rico texto={T.intro} /></p>
      {msg && <Aviso tone="error">{msg}</Aviso>}
      {done && <Aviso tone="ok">{done} <button className="link" onClick={() => onGo('history')}>{T.verHistorial}</button></Aviso>}
      <div className="row">
        <Boton disabled={!!busy} onClick={() => pick('xml')}>{busy === 'xml' ? T.leyendo : T.desdeXml}</Boton>
        <Info tip={TRAER_TIPS.xml} />
        <Boton variant="ghost" disabled={!!busy} onClick={() => pick('pendrive')}>{busy === 'pendrive' ? T.leyendo : T.desdePendrive}</Boton>
        {drives.map((d) => <Boton key={d.root} variant="ghost" size="sm" disabled={!!busy} onClick={() => pick('pendrive', d.root)} title={T.hayPendrive(d.label)}>{busy === d.root ? T.leyendo : T.pendriveDe(d.label)}</Boton>)}
        <Info tip={TRAER_TIPS.pendrive} />
      </div>
      {prev && (
        <div className="callout" style={{ marginTop: 'var(--sp-3)' }}>
          <div>
            <b>{prev.kind === 'xml' ? T.deTuXml : /^Pendrive/.test(prev.label) ? T.delPendrive(prev.label.replace(/^Pendrive/, '')) : T.delOtro(prev.label)}</b> — {T.resumenPrev(lists.length, prev.tracks)}
            <span className="muted small"> {prev.origin}</span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            {HOW_ORDER.filter((k) => prev.how[k]).map((k, i) => <span key={k}>{i ? ' · ' : ''}{n(prev.how[k])} {HOW[k]} <Info tip={TRAER_TIPS[k]} /></span>)}
          </div>
          {job?.running ? <JobPanel job={job} unit={T.unidad}><Boton variant="ghost" size="sm" onClick={() => window.paila.cancelJob('traer-huella')}>{T.cortar}</Boton></JobPanel>
            : prev.printable > 0 && (
              <div className="row small" style={{ marginTop: 6 }}>
                <span><Rico texto={T.imprimibles(prev.printable, printMins(prev.printable))} partes={{ info: <Info tip={TRAER_TIPS.huella} /> }} /></span>
                <Boton size="sm" variant="ghost" onClick={() => prints(prev.token)}>{T.buscarSuenan}</Boton>
              </div>
            )}
          {prev.outside.count > 0 && <div className="small muted" style={{ marginTop: 4 }}>
            <Rico texto={T.afuera(prev.outside.count, prev.outside.examples.join(', '))} partes={{ info: <Info tip={T.afueraTip} /> }} />
          </div>}
          {prev.dj && prev.dj.tracks > 0 && (
            <div style={{ marginTop: 8 }}>
              <Casilla checked={withDj} onChange={setWithDj} info={TRAER_TIPS.dj}
                label={T.recuperarDj(prev.dj.tracks)}
                detail={<Rico texto={T.detalleDj(prev.dj.grids, prev.dj.cues, prev.dj.stars, prev.dj.colours)} partes={{ grilla: <Info tip={TIPS.grilla} />, cue: <Info tip={TIPS.cue} /> }} />} />
            </div>
          )}

          {totals.low > 0 && (
            <div style={{ marginTop: 8 }}>
              <Casilla checked={lowToo} onChange={setLowToo} info={TRAER_TIPS.baja}
                label={T.sumarBaja(totals.low)}
                detail={T.sumarBajaDetalle} />
            </div>
          )}

          <div className="lista-filas">
            {lists.map((l) => {
              const empty = l.total === 0
              return (
                <Caja key={l.key} skipped={empty || !chosen.has(l.key)} head={
                  <>
                    <input type="checkbox" disabled={empty} checked={chosen.has(l.key) && !empty} aria-label={T.traerNombre(l.name)}
                      onChange={(e) => setChosen((s) => { const x = new Set(s); if (e.target.checked) x.add(l.key); else x.delete(l.key); return x })} />
                    <span className="ellipsis" style={{ flex: 1 }} title={[...l.folders, l.name].join(' / ')}>
                      {l.folders.length > 0 && <span className="muted small">{l.folders.join(' / ')} / </span>}<b>{l.name}</b>
                    </span>
                    {empty ? <span className="muted small">{T.vacia}</span> : <span className="small">
                      {T.deTotal(l.counts.tenes + l.counts.baja, l.total)}
                      {l.counts.revisar > 0 && <span className="pill pill-blue">{T.paraConfirmar(l.counts.revisar)}</span>}
                      {l.counts.falta + (lowToo ? l.counts.baja : 0) > 0 && <span className="pill">{T.paraConseguir(l.counts.falta + (lowToo ? l.counts.baja : 0))}</span>}
                    </span>}
                    {!empty && <Boton variant="ghost" size="sm" onClick={() => setOpen(open === l.key ? null : l.key)}>{open === l.key ? T.cerrar : T.verTemas}</Boton>}
                  </>
                }>
                  {open === l.key && <Items token={prev.token} listKey={l.key} decisions={decisions} onDecide={(k, d) => setDecisions((x) => ({ ...x, [k]: d }))} />}
                </Caja>
              )
            })}
          </div>
          <div className="row">
            <Boton disabled={!picked.length || busy === 'create' || !!job?.running} onClick={create}
              title={T.traerTitle}>
              {busy === 'create' ? T.trayendo : T.traer(picked.length)}
            </Boton>
            {totals.check > 0 && <Boton variant="ghost" onClick={probables} title={T.confirmarProbablesTitle}>{T.confirmarProbables}</Boton>}
            <Boton variant="ghost" onClick={() => setPrev(null)}>{T.cancelar}</Boton>
            {picked.length > 0 && <span className="small muted">{T.totales(totals.have, totals.total, totals.get, totals.check)}</span>}
          </div>
        </div>
      )}
    </>
  )
}

/** Los temas de una playlist traída, para mirarlos y confirmar los que se encontraron por nombre. */
function Items({ token, listKey, decisions, onDecide }: { token: string; listKey: string; decisions: Record<string, RequestDecision | null>; onDecide: (key: string, d: RequestDecision | null) => void }) {
  const [items, setItems] = useState<ImportItem[] | null>(null)
  useEffect(() => { window.paila.importItems(token, listKey).then(setItems).catch(() => setItems([])) }, [token, listKey])
  if (!items) return <div className="muted small box-body">{T.cargando}</div>
  return (
    <table className="req-table">
      <colgroup><col style={{ width: 44 }} /><col style={{ width: '36%' }} /><col /><col style={{ width: 190 }} /></colgroup>
      <thead><tr><th>#</th><th>{T.enRekordbox}</th><th>{T.enTuBiblioteca}</th><th /></tr></thead>
      <tbody>
        {items.map((i) => {
          const d = decisions[i.key]
          const sk = stateOf(i, d)
          return (
            <tr key={i.position} className={stateOf(i, d) === 'falta' ? 'dim' : ''}>
              <td className="muted">{i.position}</td>
              <td className="ellipsis" title={`${i.artist} — ${i.title}`}><b>{i.artist || '—'}</b> — {i.title}<span className="muted small">{i.duration ? ` · ${duration(i.duration)}` : ''}</span></td>
              <td>
                <div className="ellipsis" title={i.file?.rel}>
                  <span className={`pill ${PILL[sk]}`} style={{ marginLeft: 0 }}>{STATE_LABEL[sk]}</span>
                  {i.file && <> {i.file.grade && <Nota grade={i.file.grade} title={T.laNota} />} <span className="small">{i.file.rel.split('/').pop()}</span><span className="muted small"> · {i.file.quality}</span></>}
                </div>
                {i.kind !== 'none' && <div className="muted small ellipsis" title={i.why}>{i.why}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {/* lo exacto ya entra: solo se ofrece "No es" */}
                {i.file && (i.kind === 'probable' || i.kind === 'version' || i.kind === 'exacto') && (d == null
                  ? <>{i.kind !== 'exacto' && <><Boton size="sm" onClick={() => onDecide(i.key, SI)} title={T.esEsteTitle}>{T.esEste}</Boton> </>}<Boton variant="ghost" size="sm" onClick={() => onDecide(i.key, NO)} title={T.noEsTitle}>{T.noEs}</Boton></>
                  : <button className="link small" onClick={() => onDecide(i.key, null)}>{d === SI ? T.confirmado : T.descartado} · {T.cambiar}</button>)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
