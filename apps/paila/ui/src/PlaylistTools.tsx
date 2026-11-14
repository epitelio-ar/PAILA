// Ventanas de una playlist: exportar a pendrive o carpeta, y mejorar los temas de baja calidad.
import { Icon } from './icons'
import { useEffect, useMemo, useState } from 'react'
import type { CleanPreview, MergePreview, ExportOptions, ExportPlan, ExportResult, ImproveProposal, PlaylistNode } from '@paila/shared/types'
import { bytes, n } from './format'
import { JobPanel, useJob } from './jobs'
import { Ventana, Aviso, Boton, Info, Nota, Rico } from '@paila/diseno'
import { T } from './PlaylistTools.textos'
import { ConfirmarBoton, Resultado } from './Confirmar'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const base = (rel: string) => rel.split('/').pop() ?? rel

/** Playlist → pendrive o carpeta, para tocar sin Rekordbox. Copia (nunca mueve) y convierte lo que las CDJ no leen. */
export function ExportModal({ node, onClose }: { node: PlaylistNode; onClose: () => void }) {
  const [opts, setOpts] = useState<ExportOptions>({ dest: '', keepFlac: false, convert: true, numbered: true, subfolder: true, fat32: true })
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const job = useJob('export')
  const [res, setRes] = useState<ExportResult | null>(null)

  // Cada vez que cambia algo se recalcula el plan (es instantáneo: no copia nada todavía).
  useEffect(() => {
    if (!opts.dest) { setPlan(null); return }
    let alive = true
    window.paila.planExport(node.id, opts).then((p) => { if (alive) setPlan(p) }).catch((e) => { if (alive) setErr(clean(e)) })
    return () => { alive = false }
  }, [opts, node.id])

  const pick = async () => { const d = await window.paila.pickExportFolder(); if (d) { setErr(null); setOpts({ ...opts, dest: d }) } }
  const run = async () => {
    setBusy(true); setErr(null)
    try { setRes(await window.paila.runExport(node.id, opts)) } catch (e) { setErr(clean(e)) } finally { setBusy(false) }
  }
  const set = (patch: Partial<ExportOptions>) => setOpts({ ...opts, ...patch })
  const running = busy || !!job?.running
  const noRoom = !!plan && plan.freeBytes != null && plan.totalBytes > plan.freeBytes

  return (
    <Ventana onClose={onClose} busy={busy} className="rep-modal">
        <h2>{T.tituloExport(node.name)}</h2>
        <p className="muted small"><Rico texto={T.introExport} partes={{ archivo: <code>playlist.m3u8</code> }} /></p>

        {res ? (
          <>
            <Resultado r={{
              hechos: T.expListo(n(res.copied), n(res.converted), res.skippedExisting ? n(res.skippedExisting) : null),
              fallados: res.failed, cancelado: res.cancelled, deshacer: 'copias',
              extra: <div className="muted small">{T.expExpulsar}</div>,
            }} />
            <div className="row">
              <Boton onClick={() => window.paila.openFolder(res.folder)}>{T.abrirCarpeta}</Boton>
              <Boton variant="ghost" onClick={onClose}>{T.cerrar}</Boton>
            </div>
          </>
        ) : (<>
          <div className="row">
            <Boton variant="ghost" disabled={busy} onClick={pick}>{opts.dest ? T.cambiarDestino : T.elegirDestino}</Boton>
            <span className="muted small" title={opts.dest}>{opts.dest || T.sinDestino}</span>
          </div>
          <div className="rep-opts">
            <label title={T.keepFlacTip}><input type="checkbox" checked={opts.keepFlac} disabled={busy} onChange={(e) => set({ keepFlac: e.target.checked })} /> {T.keepFlac}</label>
            <label><input type="checkbox" checked={opts.convert} disabled={busy} onChange={(e) => set({ convert: e.target.checked })} /> {T.convertir}</label>
            <label><input type="checkbox" checked={opts.numbered} disabled={busy} onChange={(e) => set({ numbered: e.target.checked })} /> {T.numerar}</label>
            <label><input type="checkbox" checked={opts.subfolder} disabled={busy} onChange={(e) => set({ subfolder: e.target.checked })} /> {T.subcarpeta}</label>
            <label title={T.fat32Tip}><input type="checkbox" checked={opts.fat32} disabled={busy} onChange={(e) => set({ fat32: e.target.checked })} /> {T.fat32}</label>
          </div>

          {err && <p className="error">{err}</p>}
          {plan && (
            <div className="callout">
              <Rico texto={T.planCabeza(n(plan.items.length), n(plan.copyCount), n(plan.convertCount), bytes(plan.totalBytes))} />
              {plan.freeBytes != null && T.planLibre(bytes(plan.freeBytes))}
              {plan.skipped.length > 0 && <> · <span className="doubt">{T.planSaltean(plan.skipped.length, plan.skipped.slice(0, 2).map((s) => `${base(s.rel)}: ${s.reason}`).join('; '))}</span></>}
              {plan.warnings.slice(0, 4).map((w, i) => <div key={i} className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {w}</div>)}
            </div>
          )}
          {plan && plan.items.length > 0 && (
            <div className="listbox" style={{ marginTop: 10 }}>
              {plan.items.slice(0, 12).map((it) => (
                <div key={it.fileId} className="pair-row"><span className="muted" title={it.rel}>{base(it.rel)}</span><span>{it.action === 'convert' ? <Icon name="gear" size={14} className="ic-inline" /> : '→'}</span><span title={it.why ?? ''}>{it.outName}</span></div>
              ))}
              {plan.items.length > 12 && <div className="muted small pair-row">{T.ymas(n(plan.items.length - 12))}</div>}
            </div>
          )}
          {job && <JobPanel job={job} unit={T.temas} onDismiss={() => window.paila.dismissJob('export')} />}
          <div className="row">
            <ConfirmarBoton disabled={running || !plan || !plan.items.length || noRoom} onSi={run} deshacer="copias" pregunta={T.copiarPreg(plan ? n(plan.items.length) : '', opts.dest)}>{running ? T.copiando : T.copiarN(plan ? n(plan.items.length) : '')}</ConfirmarBoton>
            {job?.running && <Boton variant="ghost" disabled={job.cancelling} onClick={() => window.paila.cancelJob('export')}>{T.cancelar}</Boton>}
            {noRoom && <span className="doubt small">{T.noAlcanza}</span>}
          </div>
        </>)}
    </Ventana>
  )
}

/** "Mejorar esta playlist": cambia cada tema por una versión mejor que ya está en la biblioteca. */
export function ImproveModal({ node, onClose, onDone }: { node: PlaylistNode; onClose: () => void; onDone: () => void }) {
  const [props, setProps] = useState<ImproveProposal[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)
  const [batch, setBatch] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.paila.proposeImprovements(node.id).then((p) => { setProps(p); setPicked(new Set(p.map((x) => x.currentId))) }).catch((e) => setMsg(clean(e)))
  }, [node.id])

  const chosen = useMemo(() => (props ?? []).filter((p) => picked.has(p.currentId)), [props, picked])
  const apply = async () => {
    setBusy(true)
    try {
      const r = await window.paila.applyImprovements(chosen.map((p) => ({ playlistId: p.playlistId, currentId: p.currentId, betterId: p.betterId })))
      setMsg(T.mejoradas(n(r.swaps)))
      setBatch(r.batchId); setProps([]); onDone()
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const undo = async () => {
    if (batch == null) return
    setBusy(true)
    try { const k = await window.paila.undoImprovements(batch); setMsg(T.mejoradasUndo(n(k))); setBatch(null); onDone() } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }

  return (
    <Ventana onClose={onClose} className="rep-modal">
        <h2>{T.tituloMejorar(node.name)}</h2>
        <p className="muted small">{T.introMejorar}</p>
        {msg && <Aviso>{msg}</Aviso>}
        {!props && !msg && <div className="row"><div className="spinner" /> <span className="muted">{T.buscandoMejores}</span></div>}
        {props && props.length === 0 && !msg && <p className="muted">{T.sinMejores}</p>}
        {props && props.length > 0 && (<>
          <div className="actionrow">
            <Boton disabled={busy || !chosen.length} onClick={apply}>{T.cambiarN(n(chosen.length))}</Boton>
            <span className="muted small">{T.seDeshace}</span>
          </div>
          <div className="box-list" style={{ maxHeight: 380, overflow: 'auto' }}>
            {props.map((p) => (
              <label key={p.currentId} className="box choice">
                <input type="checkbox" checked={picked.has(p.currentId)} onChange={(e) => setPicked((s) => { const t = new Set(s); e.target.checked ? t.add(p.currentId) : t.delete(p.currentId); return t })} />
                <div className="choice-body">
                  <div className="small"><Nota grade={p.current.grade} /> {base(p.current.rel)} <span className="muted">({p.current.ext.toUpperCase()}{p.current.kbps ? ` ${p.current.kbps} kbps` : ''})</span></div>
                  <div className="small">→ <Nota grade={p.better.grade} /> <b>{base(p.better.rel)}</b> <span className="muted">({p.better.ext.toUpperCase()}{p.better.kbps ? ` ${p.better.kbps} kbps` : ''}) · {p.reason}</span></div>
                  <div className="muted small" title={p.better.rel}>{p.better.rel}</div>
                </div>
              </label>
            ))}
          </div>
        </>)}
        {batch != null && <div className="row"><Boton variant="ghost" disabled={busy} onClick={undo}>{T.deshacerEstos}</Boton></div>}
    </Ventana>
  )
}

const detalle = (i: { ext: string; kbps: number | null }) => `${i.ext.toUpperCase()}${i.kbps ? ` ${i.kbps} kbps` : ''}`

/** "Limpiar esta playlist": muestra antes qué saca (el mismo tema en otra calidad y los desaparecidos hace rato). */
export function CleanModal({ node, onClose, onDone }: { node: PlaylistNode; onClose: () => void; onDone: () => void }) {
  const [prev, setPrev] = useState<CleanPreview | null>(null)
  const [withMissing, setWithMissing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [batch, setBatch] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { window.paila.previewCleanPlaylist(node.id).then(setPrev).catch((e) => setMsg(clean(e))) }, [node.id])
  const dups = prev ? prev.groups.flatMap((g) => g.drop) : []
  const todo = [...dups, ...(withMissing && prev ? prev.missing : [])]
  const apply = async () => {
    setBusy(true)
    try {
      const r = await window.paila.cleanPlaylist(node.id, todo.map((t) => t.id))
      setMsg(T.limpiada(n(r.removed)))
      setBatch(r.batchId != null); setPrev(null); onDone()
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const undo = async () => {
    setBusy(true)
    try {
      const last = (await window.paila.history()).find((h) => h.kind === 'listas' && !h.undone)
      if (last) await window.paila.historyUndo('listas', last.id)
      setMsg(T.limpiadaUndo); setBatch(false); onDone()
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  return (
    <Ventana onClose={onClose} className="rep-modal">
      <h2>{T.tituloLimpiar(node.name)}</h2>
      <p className="muted small">{T.introLimpiar1}<Info tip={T.repetidoTip} />{T.introLimpiar2}<Info tip={T.desaparecidoTip} />{T.introLimpiar3}</p>
      {msg && <Aviso>{msg}</Aviso>}
      {!prev && !msg && <div className="row"><div className="spinner" /> <span className="muted">{T.buscandoRepetidos}</span></div>}
      {prev && !dups.length && !prev.missing.length && <p className="muted">{T.nadaLimpiar}</p>}
      {prev && dups.length > 0 && (<>
        <h3 className="small">{T.repetidosTitulo(n(dups.length))}</h3>
        <div className="box-list" style={{ maxHeight: 260, overflow: 'auto' }}>
          {prev.groups.map((g) => (
            <div key={g.keep.id} className="box">
              <div className="small">{T.queda} <Nota grade={g.keep.grade} /> <b>{base(g.keep.rel)}</b> <span className="muted">({detalle(g.keep)})</span></div>
              {g.drop.map((d) => <div key={d.id} className="small muted">{T.seSaca} <Nota grade={d.grade} /> {base(d.rel)} ({detalle(d)})</div>)}
            </div>
          ))}
        </div>
      </>)}
      {prev && prev.missing.length > 0 && (<>
        <h3 className="small">{T.desaparecidosTitulo(n(prev.missing.length))}</h3>
        <label className="small row"><input type="checkbox" checked={withMissing} onChange={(e) => setWithMissing(e.target.checked)} /> {T.tambienSacar(n(prev.missing.length))}</label>
        <div className="muted small" style={{ maxHeight: 120, overflow: 'auto' }}>{prev.missing.map((m) => <div key={m.id} title={m.rel}>{base(m.rel)}</div>)}</div>
      </>)}
      {prev && todo.length > 0 && <div className="actionrow"><Boton disabled={busy} onClick={apply}>{T.sacarN(n(todo.length))}</Boton><span className="muted small">{T.seDeshace}</span></div>}
      {batch && <div className="row"><Boton variant="ghost" disabled={busy} onClick={undo}>{T.deshacer}</Boton></div>}
    </Ventana>
  )
}

/** "Fusionar playlists": elegir otras playlists y armar una nueva sin repetidos. */
export function MergeModal({ node, all, onClose, onDone }: { node: PlaylistNode; all: PlaylistNode[]; onClose: () => void; onDone: (newId: number) => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set([node.id]))
  const [name, setName] = useState(T.nombreFusionada(node.name))
  const [remove, setRemove] = useState(false)
  const [prev, setPrev] = useState<MergePreview | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = useMemo(() => [...picked], [picked])
  const options = all.filter((p) => p.kind !== 'folder')
  useEffect(() => {
    if (ids.length < 2) { setPrev(null); return }
    let vivo = true
    window.paila.previewMergePlaylists(ids).then((p) => { if (vivo) setPrev(p) }).catch((e) => setMsg(clean(e)))
    return () => { vivo = false }
  }, [ids])
  const go = async () => {
    setBusy(true)
    try { const r = await window.paila.mergePlaylists(ids, name.trim(), remove); setDone(r.id); setMsg(T.fusionada(name.trim(), n(r.added))); onDone(r.id) } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  return (
    <Ventana onClose={onClose} className="rep-modal">
      <h2>{T.tituloFusionar}</h2>
      <p className="muted small">{T.introFusionar1}<Info tip={T.repetidoTip} />{T.introFusionar2}</p>
      {msg && <Aviso>{msg}</Aviso>}
      {done == null && (<>
        <div className="box-list" style={{ maxHeight: 220, overflow: 'auto' }}>
          {options.map((p) => (
            <label key={p.id} className="box choice">
              <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const t = new Set(s); e.target.checked ? t.add(p.id) : t.delete(p.id); return t })} />
              <div className="choice-body small">{p.name} <span className="muted">· {T.cuentaTemas(n(p.count))}{p.kind === 'smart' ? T.inteligente : ''}</span></div>
            </label>
          ))}
        </div>
        <label className="small">{T.nombreNueva} <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="small row"><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> {T.sacarOriginales}<Info tip={T.sacarOriginalesTip} /></label>
        {ids.length < 2 && <p className="muted small">{T.alMenosDos}</p>}
        {prev && (
          <Aviso>
            {T.fusionResumen(n(prev.total), n(prev.unique))}{prev.sameFile > 0 && T.fusionMasDeUna(n(prev.sameFile))}{prev.otherQuality > 0 && T.fusionOtraCalidad(n(prev.otherQuality))}
            {prev.examples.map((e) => <div key={e.drop.id} className="small muted">{T.fusionEjemplo(base(e.drop.rel), detalle(e.drop), base(e.keep.rel), detalle(e.keep))}</div>)}
          </Aviso>
        )}
        <div className="actionrow"><Boton disabled={busy || ids.length < 2 || !name.trim()} onClick={go}>{T.fusionar}</Boton></div>
      </>)}
    </Ventana>
  )
}
