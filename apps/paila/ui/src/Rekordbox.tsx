// Pantalla Programas de DJ (antes "Rekordbox y cabina"): compatibilidad con los equipos, convertir, traer tus playlists del rekordbox.xml o de un pendrive
// (TraerRekordbox.tsx), traer lo de Rekordbox y Serato, grilla y cues (RekordboxPro.tsx) y exportar a Rekordbox, Traktor, Serato o
// VirtualDJ (lo de los otros tres en ExportarDj.tsx).
import { useEffect, useMemo, useState } from 'react'
import type { CompatReport, DeviceProfile, DjExportResult, DjTarget, PlaylistNode, RekordboxResult, Unreadable } from '@paila/shared/types'
import { bytes, n } from './format'
import { JobPanel, useJob } from './jobs'
import { Aviso, Boton, Info, Cabecera, Pestanas, Rico } from '@paila/diseno'
import { tr } from '@paila/shared/idioma'
import { T } from './Rekordbox.textos'
import { GridSection, ImportSection, TIPS } from './RekordboxPro'
import { TraerSection } from './TraerRekordbox'
import type { PageKey } from './nav'
import { APPS, DjGuide, DjPlace, DjResult, TIP_DENTRO, NOT_READ, type ExportApp } from './ExportarDj'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** Programas de DJ: compatibilidad con tu equipo, exportar rekordbox.xml y la guía paso a paso. */
export default function Rekordbox({ playlists, onPlaylistsChanged, onGo, onStaged, openXml }: { playlists: PlaylistNode[]; onPlaylistsChanged: () => void; onGo: (p: PageKey) => void; /** algo quedó en Cambios pendientes */ onStaged?: () => void; /** un rekordbox.xml soltado en la ventana */ openXml?: { path: string; at: number } | null }) {
  const [app, setApp] = useState<ExportApp>('rekordbox')
  const [djRes, setDjRes] = useState<DjExportResult | null>(null)
  const [intoFiles, setIntoFiles] = useState(true)
  const [devices, setDevices] = useState<DeviceProfile[]>([])
  const [device, setDevice] = useState('cdj-nxs2')
  const [compat, setCompat] = useState<CompatReport | null>(null)
  const [scope, setScope] = useState<'todo' | 'playlists'>('todo')
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [res, setRes] = useState<RekordboxResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [withGrid, setWithGrid] = useState(true)
  const [suggested, setSuggested] = useState(false) // opcionales y apagados: son aproximados (decisión del 22/10)
  const [moving, setMoving] = useState(true) // PAILA está segura de su grilla donde el tempo se mueve: se ofrece usarla, ya tildada
  const [msg, setMsg] = useState<string | null>(null)

  const [unread, setUnread] = useState<Unreadable[] | null>(null)
  const [target, setTarget] = useState<DjTarget>('mp3')
  const [convRes, setConvRes] = useState<ResultadoTanda | null>(null)
  const convJob = useJob('djconvert')

  useEffect(() => { window.paila.rekordboxDevices().then(setDevices) }, [])
  // la lista se vuelve a pedir cuando termina una conversión
  useEffect(() => { if (!convJob?.running) window.paila.djUnreadable().then(setUnread).catch(() => setUnread([])) }, [convJob?.running])
  useEffect(() => { setCompat(null); window.paila.rekordboxCompat(device).then(setCompat).catch((e) => setMsg(clean(e))) }, [device])

  const dev = devices.find((d) => d.id === device)
  const grouped = useMemo(() => {
    const m = new Map<string, number>()
    // los de frecuencia de muestreo alta (88, 96, 192 kHz…) van juntos en un solo renglón
    const key = (i: CompatReport['issues'][number]) => (i.maxKhz != null ? T.altoKhz(String(i.maxKhz)) : i.reason)
    for (const i of compat?.issues ?? []) m.set(key(i), (m.get(key(i)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [compat])
  const lists = playlists.filter((p) => p.kind !== 'folder')

  const exportXml = async () => {
    setBusy(true); setMsg(null); setRes(null); setDjRes(null)
    const opts = { grid: withGrid, suggestedCues: suggested, pailaWhenMoving: withGrid && moving }
    const ids = scope === 'playlists' ? [...chosen] : []
    try {
      if (app === 'rekordbox') { const r = await window.paila.rekordboxExport(scope, ids, opts); if (r) setRes(r) }
      else {
        const r = await window.paila.djExport(app, scope, ids, { ...opts, intoFiles: app === 'serato' && intoFiles })
        if (r) { setDjRes(r); if (r.staged) onStaged?.() }
      }
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const byFormat = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of unread ?? []) { const k = u.lossless ? T.wmaSinPerdida : u.ext === 'wma' || u.ext === 'asf' ? 'WMA' : u.codec === 'opus' ? 'Opus' : 'OGG'; m.set(k, (m.get(k) ?? 0) + 1) } // idioma-ok
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [unread])
  const convert = async () => {
    setMsg(null); setConvRes(null)
    try { const r = await window.paila.djConvert(target); setConvRes({ hechos: T.convertidos(r.converted), fallados: r.failed, deshacer: 'historial' }); onPlaylistsChanged() } catch (e) { setMsg(clean(e)) }
  }

  const makePlaylist = async () => {
    try {
      const k = await window.paila.rekordboxCompatPlaylist(device)
      setMsg(T.listoPlaylist(k))
      onPlaylistsChanged()
    } catch (e) { setMsg(clean(e)) }
  }

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={tr({ es: 'Programas de DJ', en: 'DJ software' })} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />

      {msg && <Aviso>{msg}</Aviso>}

      <h4>{T.h6}</h4>
      <Pestanas label={T.programa} items={APPS} value={app} onChange={(k) => { setApp(k); setRes(null); setDjRes(null) }} />
      {app !== 'rekordbox' && <DjPlace app={app} />}
      <div className="rep-opts">
        <label><input type="radio" checked={scope === 'todo'} onChange={() => setScope('todo')} /> {T.todoMiMusica}</label>
        <label><input type="radio" checked={scope === 'playlists'} onChange={() => setScope('playlists')} /> {T.soloPlaylists}</label>
      </div>
      {scope === 'playlists' && (
        <div className="listbox" style={{ maxHeight: 180, marginBottom: 10 }}>
          {lists.map((p) => (
            <label key={p.id} className="listbox-row"><span><input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => setChosen((s) => { const t = new Set(s); e.target.checked ? t.add(p.id) : t.delete(p.id); return t })} /> {p.name}</span><span className="muted">{p.count}</span></label>
          ))}
          {!lists.length && <div className="muted small listbox-row">{T.sinPlaylists}</div>}
        </div>
      )}
      <div className="rep-opts">
        <label><input type="checkbox" checked={withGrid} onChange={(e) => setWithGrid(e.target.checked)} /> <Rico texto={T.conGrilla} partes={{ info: <Info tip={TIPS.grilla} /> }} /></label>
        {withGrid && <label style={{ marginLeft: 22 }}><input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} /> <Rico texto={T.grillaVariable} partes={{ info: <Info tip={TIPS.variable} />, extra: app === 'traktor' || app === 'virtualdj' || app === 'engine' ? T.unSoloBpm : '' }} /></label>}
        <label><input type="checkbox" checked={suggested} onChange={(e) => setSuggested(e.target.checked)} /> <Rico texto={T.cuesSugeridos} partes={{ cue: <Info tip={TIPS.cue} />, memory: <Info tip={TIPS.memory} /> }} /></label>
        {app === 'serato' && <label><input type="checkbox" checked={intoFiles} onChange={(e) => setIntoFiles(e.target.checked)} /> <Rico texto={T.dentroDeArchivos} partes={{ info: <Info tip={TIP_DENTRO.tip} /> }} /></label>}
      </div>
      <div className="row">
        <ConfirmarBoton disabled={busy || (scope === 'playlists' && !chosen.size)} onSi={exportXml} deshacer="copias" pregunta={T.exportarPreg(APPS.find((a) => a.key === app)?.label ?? '', scope === 'todo')}>{busy ? T.exportando : app === 'rekordbox' ? T.exportarRb : app === 'traktor' ? T.exportarTraktor : app === 'serato' ? T.exportarSerato : app === 'engine' ? T.exportarEngine : T.exportarVdj}</ConfirmarBoton>
        <span className="muted small">{T.inteligentes} {NOT_READ[app]}</span>
      </div>
      {djRes && <DjResult r={djRes} />}
      {res && <Resultado r={{ hechos: T.seGuardo(res.file, res.tracks, res.playlists, res.grids, res.cues), fallados: res.skipped.map((s) => ({ rel: s.rel, error: s.reason })), deshacer: 'copias' }} />}

      <h4>{T.h7(APPS.find((a) => a.key === app)?.label ?? '')}</h4>
      {app !== 'rekordbox' ? <DjGuide app={app} /> : (<>
      <ol className="guide">
        <li><Rico texto={T.g1} /></li>
        <li><Rico texto={T.g2} partes={{ xml: <code>rekordbox.xml</code> }} /></li>
        <li><Rico texto={T.g3} /></li>
        <li><Rico texto={T.g4} /></li>
        <li>{T.g5}</li>
        <li>{T.g6}</li>
        <li>{T.g7}</li>
      </ol>
      <p className="muted small"><Rico texto={T.avisoMover} /></p>
      </>)}

      <h4>{T.h1}</h4>
      <div className="row">
        <select value={device} onChange={(e) => setDevice(e.target.value)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
        <span className="muted small">{dev?.note} {T.orientativo}</span>
      </div>
      {compat && (
        <div className="callout">
          <Rico texto={T.sonaran} partes={{ ok: <b>{n(compat.ok)}</b>, mal: <b className={compat.issues.length ? 'doubt' : ''}>{n(compat.issues.length)}</b> }} />
          {grouped.map(([reason, c]) => <div key={reason} className="small">{T.renglon(c, reason)}</div>)}
          {compat.issues.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <Boton variant="ghost" size="sm" onClick={makePlaylist}>{T.crearPlaylist(compat.issues.length)}</Boton>
              <span className="muted small">{T.despuesPendrive}</span>
            </div>
          )}
        </div>
      )}

      <h4>{T.h2}</h4>
      {!unread ? <div className="spinner" /> : !unread.length && !convJob ? <p className="muted small">{T.ninguno}</p> : (
        <div className="box">
          {unread.length > 0 && <div className="box-head"><b>{T.nTemas(unread.length)}</b><span className="muted small"> {byFormat.map(([k, c]) => `${n(c)} ${k}`).join(' · ')} · {bytes(unread.reduce((s, u) => s + u.size, 0))}</span></div>}
          <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
          {unread.length > 0 && (<>
            <p className="muted small">
              <Rico texto={T.convIntro} />
              {unread.some((u) => u.lossless) && <Rico texto={T.convWma} />}
            </p>
            <div className="rep-opts">
              <label><input type="radio" checked={target === 'mp3'} onChange={() => setTarget('mp3')} /> <Rico texto={T.mp3} /></label>
              <label><input type="radio" checked={target === 'flac'} onChange={() => setTarget('flac')} /> <Rico texto={T.flac} /></label>
            </div>
            <p className="muted small">{T.convNota}</p>
          </>)}
          {convJob && <JobPanel job={convJob} unit={T.unidad} onDismiss={() => window.paila.dismissJob('djconvert')}>{convJob.running && <Boton variant="ghost" size="sm" disabled={convJob.cancelling} onClick={() => window.paila.cancelJob('djconvert')}>{T.cancelar}</Boton>}</JobPanel>}
          {convJob?.running || !unread.length ? null : (
            <div><ConfirmarBoton onSi={convert} deshacer="historial" pregunta={T.convertirPreg(unread.length, target === 'mp3' ? 'MP3 320' : 'FLAC')} aviso={<span className="small">{T.convertirAviso}</span>}>{T.convertir(unread.length)}</ConfirmarBoton></div>
          )}
          </div>
        </div>
      )}

      {convRes && <Resultado r={convRes} onCerrar={() => setConvRes(null)} />}

      <h4>{T.h3}</h4>
      <TraerSection onPlaylistsChanged={onPlaylistsChanged} onGo={onGo} openXml={openXml} />

      <h4>{T.h4}</h4>
      <ImportSection />

      <h4>{T.h5} <Info tip={TIPS.grilla} /></h4>
      <GridSection playlists={playlists} />

    </div>
  )
}
