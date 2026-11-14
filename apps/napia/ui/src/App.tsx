// La pantalla de NAPIA: cabecera con "Abrir PAILA", lo que falta para usar sockseek y dos vistas: Bajar (el recorrido en
// tres pasos: qué bajar → dónde y cómo → bajar) e Historial (lo que ya se bajó). "Qué bajar" es una tanda: una o varias
// listas que NAPIA baja una detrás de otra (la tanda vive en el proceso principal: sigue aunque la pantalla se recargue).
// El permiso de Windows (el firewall) se mira apenas aparece sockseek, sin esperar la cuenta: si algo está mal, va arriba.
import { useCallback, useEffect, useState } from 'react'
import { Boton, Info, Pestanas, Pildora } from '@paila/diseno'
import type { Destino, EntradaHistorial, FirewallDiag, IndexSummary, YaTenes, NapiaOptions, PuertoInfo, RunStatus, SockseekInfo, TandaEstado } from '@paila/shared/napia'
import logo from './assets/logo.png'
import Preparar from './Preparar'
import Firewall from './Firewall'
import { firewallMal } from '@paila/shared/firewall'
import Entrada from './Entrada'
import Opciones from './Opciones'
import Bajada from './Bajada'
import Historial from './Historial'
import Anotar from './Anotar'
import Reintentar, { type ParaReintentar } from './Reintentar'
import { textos } from '@paila/shared/idioma'
import { TIP, n } from './textos'

const T = textos({
  yaAbierto: { es: 'PAILA ya está abierto: mirá su Bandeja.', en: "PAILA is already open: check its Inbox." },
  noEsta: { es: 'No encontramos PAILA en esta compu.', en: "We couldn't find PAILA on this computer." },
  abriendo: { es: 'Abriendo PAILA…', en: 'Opening PAILA…' },
  abriendoBandeja: { es: 'Abriendo la Bandeja de PAILA…', en: "Opening PAILA's Inbox…" },
  panel: { es: 'Panel de control para sockseek', en: 'Control panel for sockseek' },
  conFreno: { es: ' · con freno (versión modificada)', en: ' · with brake (modified version)' },
  abrirPaila: { es: 'Abrir PAILA', en: 'Open PAILA' },
  abrirPailaTip: { es: 'Abre PAILA: su Bandeja revisa lo que baja sockseek', en: 'Opens PAILA: its Inbox checks what sockseek downloads' },
  queVer: { es: 'Qué ver', en: 'What to show' },
  bajando: { es: 'Bajando', en: 'Downloading' },
  bajar: { es: 'Bajar', en: 'Download' },
  enEspera: { es: (c: string) => `${c} en espera`, en: (c: string) => `${c} waiting` },
  historial: { es: 'Historial', en: 'History' },
})

export default function App() {
  const [info, setInfo] = useState<SockseekInfo | null>(null)
  const [tanda, setTanda] = useState<TandaEstado>({ items: [], frenada: null })
  const [destino, setDestino] = useState<Destino | null>(null)
  const [options, setOptions] = useState<NapiaOptions | null>(null)
  const [previous, setPrevious] = useState<IndexSummary | null>(null)
  const [yaTenes, setYaTenes] = useState<YaTenes | null>(null)
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [paila, setPaila] = useState<string | null>(null)
  const [puerto, setPuerto] = useState<PuertoInfo | null>(null)
  const [firewall, setFirewall] = useState<FirewallDiag | null>(null)
  // se apretó Arreglarlo: el cuadro queda (con cómo salió) aunque ya esté bien
  const [arreglado, setArreglado] = useState(false)
  const [vista, setVista] = useState<'bajar' | 'historial'>('bajar')
  const [historial, setHistorial] = useState<EntradaHistorial[]>([])
  const [reintentar, setReintentar] = useState<ParaReintentar | null>(null)

  const refresh = useCallback(() => { void window.napia.info().then(setInfo); void window.napia.destino().then(setDestino) }, [])
  const cargarHistorial = useCallback(() => { void window.napia.historial().then(setHistorial) }, [])
  useEffect(() => {
    refresh()
    cargarHistorial()
    void window.napia.options().then(setOptions)
    void window.napia.status().then(setStatus)
    void window.napia.tanda().then(setTanda)
    // la lista con la que se abrió NAPIA (por ejemplo desde PAILA) entra a la tanda, si no estaba ya
    void window.napia.initialList().then(async (l) => { if (l) { const t = await window.napia.tanda(); if (!t.items.some((i) => i.list.name === l.name)) setTanda(await window.napia.sumarATanda(l)) } })
    const offStatus = window.napia.onStatus(setStatus)
    const offTanda = window.napia.onTanda((t) => { setTanda(t); cargarHistorial() })
    const onFocus = () => refresh()
    const onList = (e: Event) => { void window.napia.openList((e as CustomEvent<string>).detail).then(async (l) => { if (l) setTanda(await window.napia.sumarATanda(l)) }) }
    window.addEventListener('focus', onFocus)
    window.addEventListener('napia:list', onList)
    return () => { offStatus(); offTanda(); window.removeEventListener('focus', onFocus); window.removeEventListener('napia:list', onList) }
  }, [refresh, cargarHistorial])

  const running = !!status?.running
  const espera = tanda.items.filter((i) => i.estado === 'espera')
  // con una sola lista en espera se muestra todo de ella (lo que ya tenés, si ya se bajó antes); con varias, cada fila lo dice
  const sola = !running && tanda.items.length === 1 && espera.length === 1 ? espera[0].list : null
  const listName = sola?.name ?? ''
  useEffect(() => { if (listName) void window.napia.previous(listName).then(setPrevious); else setPrevious(null) }, [listName, destino?.folder, status?.finished])
  useEffect(() => {
    let vivo = true
    if (sola && options?.saltearTenes) void window.napia.yaTenes(sola).then((y) => { if (vivo) setYaTenes(y) }); else setYaTenes(null)
    return () => { vivo = false }
  }, [sola, options?.saltearTenes])

  const ready = !!info?.exe && info.hasUser && info.hasPass
  // con sockseek listo, una vez: ¿el router abre el puerto? (tarda unos segundos; se ve "Probando…")
  const probarPuerto = useCallback(() => {
    setPuerto((p) => (p ? { ...p, probando: true } : p))
    void window.napia.puerto(true).then(setPuerto)
  }, [])
  useEffect(() => { if (ready) probarPuerto() }, [ready, probarPuerto])
  // el firewall solo necesita sockseek; lo que trae la prueba del puerto (o una bajada) lo pone al día
  const exe = info?.exe ?? null
  useEffect(() => { if (exe) void window.napia.firewall().then(setFirewall) }, [exe])
  const fwVisto = status?.puerto?.firewall ?? puerto?.firewall
  useEffect(() => { if (fwVisto) setFirewall(fwVisto) }, [fwVisto])
  const onFirewall = useCallback((f: FirewallDiag | null) => {
    setFirewall(f); setArreglado(true)
    setPuerto((p) => (p ? { ...p, firewall: f } : p))
    setStatus((s) => (s?.puerto ? { ...s, puerto: { ...s.puerto, firewall: f } } : s))
  }, [])
  const openPaila = async () => {
    const r = await window.napia.openPaila()
    setPaila(r === 'yaAbierto' ? T.yaAbierto : r === 'noEsta' ? T.noEsta : T.abriendo)
    setTimeout(() => setPaila(null), 5000)
  }
  const verEnPaila = async (folder: string) => {
    const r = await window.napia.verEnPaila(folder)
    setPaila(r === 'noEsta' ? T.noEsta : T.abriendoBandeja)
    setTimeout(() => setPaila(null), 5000)
  }

  return (
    <div className="napia">
      <header className="napia-cab">
        <img src={logo} alt="" />
        <div>
          <h1>NAPIA</h1>
          <span className="muted">{T.panel}<Info tip={TIP.sockseek} /></span>
        </div>
        <div className="push-right row">
          {info?.exe && <Pildora tone="acento" title={info.exe}>sockseek {info.version ?? ''}{info.freno ? T.conFreno : ''}</Pildora>}
          {info?.freno && <Info tip={TIP.modificada} />}
          {paila && <span className="muted small">{paila}</span>}
          <Anotar vista={vista} />
          <Boton variant="ghost" onClick={openPaila} title={T.abrirPailaTip}>{T.abrirPaila}</Boton>
        </div>
      </header>

      {/* en historieta los pasos van en dos columnas: con una tanda de varias listas, el paso 1 va a todo el ancho */}
      <main className={`napia-main${vista === 'historial' ? ' vista-historial' : tanda.items.length > 1 ? ' con-tanda' : ''}`}>
        <div className="napia-arriba">
          <Preparar info={info} onChange={setInfo} onRefresh={refresh} />
          {firewall && exe && (firewallMal(firewall) || arreglado) && <Firewall firewall={firewall} onCambio={onFirewall} />}
          <Pestanas label={T.queVer} value={vista} onChange={setVista} items={[
            { key: 'bajar', label: running ? T.bajando : T.bajar, count: espera.length > 1 ? T.enEspera(n(espera.length)) : undefined },
            { key: 'historial', label: T.historial, count: historial.length ? n(historial.length) : undefined },
          ]} />
        </div>
        {vista === 'bajar' ? (
          <>
            <Entrada tanda={tanda} running={running} status={status} onTanda={setTanda} onReintentar={setReintentar} />
            <Opciones destino={destino} onDestino={setDestino} options={options} onOptions={(o) => { setOptions(o); void window.napia.setOptions(o) }} previous={previous} yaTenes={yaTenes} disabled={running} apagado={!tanda.items.length} />
            <Bajada tanda={tanda} ready={ready} info={info} status={status} onStatus={setStatus} onOpenPaila={openPaila} onVerEnPaila={verEnPaila} onRefresh={refresh} puerto={puerto} onProbarPuerto={probarPuerto} onFirewall={onFirewall} destino={destino}
              onReintentar={setReintentar} onHistorial={() => setVista('historial')} />
          </>
        ) : (
          <Historial items={historial} onCambio={setHistorial} onVerEnPaila={verEnPaila} onReintentar={setReintentar} />
        )}
      </main>
      {reintentar && <Reintentar para={reintentar} running={running} onClose={() => setReintentar(null)}
        onListo={(t) => { setTanda(t); setReintentar(null); setVista('bajar') }} />}
    </div>
  )
}
