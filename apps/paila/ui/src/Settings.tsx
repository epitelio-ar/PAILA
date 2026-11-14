// Pantalla Configuración: claves de los servicios de internet (con botón de prueba), el diccionario de artistas propio,
// pasar a otra compu (Mudanza.tsx), actualizaciones, el Chequeo (Chequeo.tsx) y "Exportar diagnóstico" (SettingsShare.tsx).
import { Icon } from './icons'
import { useEffect, useState } from 'react'
import type { DictEntry, KeyService, KeyStatus, OnlineKeysStatus } from '@paila/shared/types'
import { toast } from './toast'
import BpmRanges from './BpmRanges'
import { Aviso, Boton, Casilla, Info, Pildora, useCabina, Cabecera, Rico } from '@paila/diseno'
import { fechaHora } from '@paila/shared/idioma'
import { T } from './Settings.textos'
import EstiloChooser from './EstiloChooser'
import IdiomaChooser from './IdiomaChooser'
import { verRecorrido } from './Recorrido'
import AudioOutput from './audioout'
import { SHORTCUTS } from './Player'
import { useProfile } from './profile'
import { IR_A, useAtajoG } from './atajos'
import { DJ_TOOLS_HELP, DJ_TOOLS_NAME } from '@paila/shared/profile'
import { DiagnosticSettings, UpdatesSettings } from './SettingsShare'
import { useAvanzado } from './avanzado'
import PasarDeCompu from './Mudanza'
import Respaldos from './Respaldos'
import Chequeo from './Chequeo'
import NotasDeUso from './NotasDeUso'
import { CONFIG_SECCIONES, irASeccion, type PageKey } from './nav'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const when = (iso: string) => fechaHora(iso, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
const ORIGIN: Record<DictEntry['origin'], () => string> = { edicion: () => T.origenEdicion, aceptado: () => T.origenAceptado, importado: () => T.origenImportado, 'a mano': () => T.origenAMano }

/** Cómo está una clave: propia, incluida en PAILA o ninguna, y cómo salió la última prueba. */
function KeyState({ k }: { k: KeyStatus }) {
  const who = k.own ? T.usasTuClave : k.builtIn ? T.claveDePaila : T.sinClave
  return (
    <span className="small">
      <span className={`pill ${k.own || k.builtIn ? 'pill-blue' : ''}`} style={{ marginLeft: 0 }}>{who}</span>
      {k.test && <span className={`pill ${k.test.ok ? 'pill-green' : 'pill-amber'}`} title={T.probadaEl(when(k.test.at))}>{k.test.ok ? <><Icon name="check" size={12} className="ic-inline" />{T.funciona}</> : <><Icon name="close" size={12} className="ic-inline" /> {k.test.msg}</>}</span>}
    </span>
  )
}

/** Una clave: los campos para pegarla, Guardar, Probar y Borrar. Lo pegado nunca se vuelve a mostrar. */
function KeyBox({ service, status, onChange }: { service: KeyService; status: KeyStatus; onChange: (s: OnlineKeysStatus) => void }) {
  const [mode, setMode] = useState<'app' | 'token'>(status.kind ?? 'app')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const can = status.own || status.builtIn
  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const v = service !== 'discogs' ? a : mode === 'token' ? { token: a } : { key: a, secret: b }
      onChange(await window.paila.onlineSetKey(service, v))
      setA(''); setB('')
      const t = await window.paila.onlineTestKey(service)
      onChange(await window.paila.onlineKeys())
      setMsg(t.ok ? T.guardadaYProbada : T.guardadaFallo(t.msg))
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true); setMsg(null)
    try { const t = await window.paila.onlineTestKey(service); onChange(await window.paila.onlineKeys()); setMsg(t.ok ? T.funcionaPunto : t.msg) } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const remove = async () => { setBusy(true); try { onChange(await window.paila.onlineSetKey(service, null)); setMsg(T.seBorro) } finally { setBusy(false) } }
  const ready = service === 'discogs' && mode === 'app' ? a.trim() && b.trim() : a.trim()
  return (
    <div className="keybox">
      <KeyState k={status} />
      {service === 'discogs' && (
        <div className="row small">
          <label><input type="radio" checked={mode === 'app'} onChange={() => setMode('app')} />{T.claveApp}</label>
          <label><input type="radio" checked={mode === 'token'} onChange={() => setMode('token')} />{T.codigoPersonal} <Info tip={T.codigoPersonalTip} /></label>
        </div>
      )}
      <div className="row">
        {/* idioma-ok */}
        <input type="password" autoComplete="off" placeholder={service === 'lastfm' ? T.phLastfm : service === 'audd' ? T.phAudd : service === 'acoustid' ? T.phAcoustid : mode === 'token' ? T.phDiscogsToken : 'Consumer Key'} value={a} onChange={(e) => setA(e.target.value)} />
        {/* idioma-ok */}
        {service === 'discogs' && mode === 'app' && <input type="password" autoComplete="off" placeholder="Consumer Secret" value={b} onChange={(e) => setB(e.target.value)} />}
        <Boton size="sm" disabled={busy || !ready} onClick={save}>{T.guardarYProbar}</Boton>
        <Boton variant="ghost" size="sm" disabled={busy || !can} onClick={test}>{busy ? T.probando : T.probar}</Boton>
        {status.own && <Boton variant="ghost" size="sm" disabled={busy} onClick={remove}>{T.borrarMiClave}</Boton>}
      </div>
      {msg && <div className="small hint">{msg}</div>}
    </div>
  )
}

/** Diccionario de artistas: lista, agregar, borrar, exportar e importar. */
function Dictionary() {
  const [list, setList] = useState<DictEntry[] | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { window.paila.dictList().then(setList) }, [])
  const add = async () => { setList(await window.paila.dictSet(from, to)); setFrom(''); setTo('') }
  const exp = async () => { const m = await window.paila.dictExport(); if (m) toast(m) }
  const imp = async () => {
    try {
      const r = await window.paila.dictImport()
      if (!r) return
      setList(await window.paila.dictList())
      toast(T.seAgregaron(r.added, r.same, r.clashes.length, r.clashes.slice(0, 3).map((c) => T.choque(c.from, c.mine, c.theirs)).join(' · ')))
    } catch (e) { toast(clean(e), 'error') }
  }
  const shown = (list ?? []).filter((e) => !q || `${e.from} ${e.to}`.toLowerCase().includes(q.toLowerCase()))
  return (<>
    <p className="muted small">
      <Rico texto={T.dicIntro} />
    </p>
    <div className="row">
      <input placeholder={T.phComoAparece} value={from} onChange={(e) => setFrom(e.target.value)} />
      <span>→</span>
      <input placeholder={T.phComoDebe} value={to} onChange={(e) => setTo(e.target.value)} />
      <Boton size="sm" disabled={!from.trim() || !to.trim()} onClick={add}>{T.agregar}</Boton>
      <span className="push-right" />
      <Boton variant="ghost" size="sm" disabled={!list?.length} onClick={exp} title={T.exportarTip}>{T.exportar}</Boton>
      <Boton variant="ghost" size="sm" onClick={imp} title={T.importarTip}>{T.importar}</Boton>
    </div>
    {list && list.length === 0 && <p className="muted">{T.vacio}</p>}
    {list && list.length > 0 && (<>
      {list.length > 8 && <input type="search" placeholder={T.buscarDic} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="listbox dict-list">
        {shown.map((e) => (
          <div key={e.from} className="listbox-row dict-row">
            <span>{e.from}</span><span className="muted">→</span><b>{e.to === e.from ? <>{e.to} <span className="muted small">{T.asiEstaBien}</span></> : e.to}</b>
            <span className="muted small">{ORIGIN[e.origin]()} · {when(e.createdAt)}</span>
            <Boton variant="ghost" size="sm" onClick={async () => setList(await window.paila.dictRemove(e.from))} title={T.sacarTip}>{T.sacar}</Boton>
          </div>
        ))}
      </div>
      <div className="muted small">{T.nombres(list.length)}</div>
    </>)}
  </>)
}

export default function Settings({ onGo }: { onGo: (p: PageKey) => void }) {
  const [st, setSt] = useState<OnlineKeysStatus | null>(null)
  const profile = useProfile()
  const [cabina, setCabina] = useCabina()
  const [atajoG, setAtajoG] = useAtajoG()
  const [avanzado, setAvanzado] = useAvanzado()
  useEffect(() => { window.paila.onlineKeys().then(setSt) }, [])
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      {/* índice: la página es larga (diez secciones) y cosas como Idioma o Pasar a otra compu quedaban al fondo */}
      <nav className="cfg-indice" aria-label={T.indice}>
        {CONFIG_SECCIONES.filter((x) => !x.soloDj || profile.djTools).map((x) => <button key={x.id} type="button" className="link" title={x.help} onClick={() => irASeccion(x.id)}>{x.label}</button>)}
      </nav>

      <h4 id="cfg-dj">{DJ_TOOLS_NAME}</h4>
      <Casilla checked={profile.djTools} onChange={(on) => { void profile.setDjTools(on) }} label={T.prenderHerramientas}
        detail={T.prenderDetalle}
        info={DJ_TOOLS_HELP} />
      <Aviso>{T.prenderAviso}</Aviso>

      <h4 id="cfg-pantalla">{T.pantalla}</h4>
      <div className="rotulo" style={{ margin: '4px 0 6px' }}>{T.estilo} <Info tip={T.estiloTip} /></div>
      <EstiloChooser />
      <IdiomaChooser />
      <div className="row" style={{ margin: '8px 0 12px' }}><Boton variant="ghost" size="sm" onClick={verRecorrido}>{T.verRecorrido}</Boton><span className="muted small">{T.recorridoDetalle}</span></div>
      <Casilla checked={cabina} onChange={setCabina} label={T.cabina} detail={T.cabinaDetalle}
        info={T.cabinaTip} />
      <Casilla checked={atajoG} onChange={setAtajoG} label={T.atajoG}
        detail={T.atajoGDetalle(IR_A.slice(0, 4).map((x) => `${x.tecla} ${x.nombre}`).join(', '))}
        info={T.atajoGTip} />

      <Casilla checked={avanzado} onChange={setAvanzado} label={T.avanzado} detail={T.avanzadoDetalle}
        info={T.avanzadoTip} />

      <h4 id="cfg-reproductor">{T.reproductor} <Info tip={`${T.atajosReproductor}\n${SHORTCUTS}`} /></h4>
      <AudioOutput />

      <div id="cfg-respaldos" className="cfg-ancla" />
      <Respaldos />

      <h4 id="cfg-internet">{T.servicios} <Info tip={T.serviciosTip} /></h4>
      <p className="muted small">
        <Rico texto={T.clavesIntro} partes={{ noCifra: st && !st.secure ? T.noCifra : '' }} />
      </p>
      {st && (<>
        <div className="box">
          <div className="box-head"><b>MusicBrainz</b><Pildora tone="ok">{T.sinClaveP}</Pildora></div>
          <div className="choice-body keybox small muted">{T.mbDetalle}</div>
        </div>
        <div className="box">
          <div className="box-head"><b>Deezer</b><Pildora tone="ok">{T.sinClaveP}</Pildora></div>
          <label className="choice small"><input type="checkbox" checked={st.deezer} onChange={async (e) => setSt(await window.paila.onlineSetDeezer(e.target.checked))} />
            <span className="choice-body">{T.deezerDetalle}</span></label>
        </div>
        <div className="box">
          <div className="box-head"><b>Discogs</b><Info tip={T.discogsTip} /></div>
          <KeyBox service="discogs" status={st.discogs} onChange={setSt} />
        </div>
        <div className="box">
          <div className="box-head"><b>AudD</b><Pildora>{T.opcional}</Pildora><Info tip={T.auddTip} /></div>
          <label className="choice small"><input type="checkbox" checked={st.auddOn} onChange={async (e) => setSt(await window.paila.onlineSetAudd(e.target.checked))} />
            <span className="choice-body"><Rico texto={T.auddDetalle} /></span></label>
          {st.auddOn && <KeyBox service="audd" status={st.audd} onChange={setSt} />}
        </div>
        <div className="box">
          <div className="box-head"><b>AcoustID</b><Info tip={T.acoustidTip} /></div>
          <KeyBox service="acoustid" status={st.acoustid} onChange={setSt} />
        </div>
        <div className="box">
          <div className="box-head"><b>Last.fm</b><Pildora>{T.opcional}</Pildora><Info tip={T.lastfmTip} /></div>
          <div className="choice-body keybox small muted">{T.lastfmDetalle}</div>
          <KeyBox service="lastfm" status={st.lastfm} onChange={setSt} />
        </div>
      </>)}

      <h4 id="cfg-diccionario">{T.dicTitulo} <Info tip={T.dicTip} /></h4>
      <Dictionary />

      {profile.djTools && (<>
        <h4 id="cfg-bpm">{T.bpmTitulo} <Pildora>{T.paraDjs}</Pildora> <Info tip={T.bpmTip} /></h4>
        <BpmRanges />
      </>)}

      <div id="cfg-mudanza" className="cfg-ancla" />
      <PasarDeCompu />
      <div id="cfg-actualizaciones" className="cfg-ancla" />
      <UpdatesSettings />
      <div id="cfg-chequeo" className="cfg-ancla" />
      <Chequeo onGo={onGo} />
      <div id="cfg-notas" className="cfg-ancla" />
      {avanzado && <NotasDeUso />}
      <div id="cfg-diagnostico" className="cfg-ancla" />
      <DiagnosticSettings />
    </div>
  )
}
