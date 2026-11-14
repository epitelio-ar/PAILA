// Paso 3, bajar: avisos antes de arrancar (SoulseekQt abierto), el botón (una lista o la tanda entera), el avance de la tanda
// (lista por lista y el total) y el de la lista que está bajando, tema por tema; cortar todo o saltear la lista actual; y al terminar: cuánto bajó, lo que no se encontró y lo que se encontró pero no se pudo bajar (aparte: no es lo
// mismo; se pueden reintentar con otra búsqueda), y "Abrir PAILA". Solo se festeja si bajó algo; con 0, un aviso con el motivo. La conexión (el puerto) no se
// muestra en el camino normal: NAPIA la arregla sola; el cuadro aparece si nadie pudo mandarte nada, o en "Ver el detalle".
// La calidad real (Calidad.tsx): cada tema bajado muestra su nota; lo trucho, por qué y si llegó otra copia; arriba, cuántos se
// descartaron y reemplazaron. Lo que solo llegó trucho va con lo que no se bajó.
import logo from './assets/logo.png'
import { useRef, useState } from 'react'
import { Aviso, Barra, Boton, Caja, Cifra, FilaEstado, Info, Paso, Pestanas, Festejo } from '@paila/diseno'
import type { Destino, FirewallDiag, PuertoInfo, RunStatus, SockseekInfo, TandaEstado, TrackProgress } from '@paila/shared/napia'
import type { ParaReintentar } from './Reintentar'
import { num } from '@paila/shared/idioma'
import { ESTADO, TIP, n } from './textos'
import Puerto from './Puerto'
import { T } from './Bajada.textos'
import { ResumenCalidad, TC, filaCalidad } from './Calidad'
import { useSeguirAvance } from './seguirAvance'
import { espacioTanda } from './espacio'

type Filtro = 'todos' | 'curso' | 'faltan' | 'listos'
/** Llegó, pero solo en calidad falsa (o no apareció una copia mejor que la tuya): va con lo que no se bajó. */
const falsa = (t: TrackProgress) => t.calidad?.estado === 'soloFalsa' || t.calidad?.estado === 'sinMejor'
/** Todavía no se sabe si sirve: se está revisando, llegó trucho y espera otra fuente, o la está bajando. */
const enRevision = (t: TrackProgress) => t.calidad?.estado === 'revisando' || t.calidad?.estado === 'trucho' || t.calidad?.estado === 'otraFuente'
const FILTRO: Record<Filtro, ((t: TrackProgress) => boolean) | null> = {
  todos: null,
  curso: (t) => t.state === 'buscando' || t.state === 'bajando' || enRevision(t),
  faltan: (t) => t.state === 'noEncontrado' || t.state === 'fallo' || falsa(t),
  listos: (t) => (t.state === 'bajado' || t.state === 'yaEstaba') && !falsa(t) && !enRevision(t),
}
const MAX_FILAS = 400
/** Una fila en curso: la que la lista sigue sola. */
const enCurso = (t: TrackProgress) => t.state === 'buscando' || t.state === 'bajando' || enRevision(t)
/** Cómo se lleva un tema que no se bajó a «Buscar de otra forma». */
const faltaDe = (t: TrackProgress): Pick<ParaReintentar['faltan'][number], 'estado' | 'detalle'> => t.calidad?.estado === 'sinMejor'
  ? { estado: 'sinMejor', detalle: TC.sinMejorSub(t.calidad.tuya?.que ?? t.calidad.tuya?.nota ?? '') }
  : falsa(t) ? { estado: 'soloFalsa', detalle: TC.soloFalsaSub } : { estado: t.state as 'noEncontrado' | 'fallo', detalle: t.detail }

interface Props {
  tanda: TandaEstado
  ready: boolean
  info: SockseekInfo | null
  status: RunStatus | null
  onStatus: (s: RunStatus) => void
  onOpenPaila: () => void
  /** Abre la Bandeja de PAILA mostrando lo que llegó a esa carpeta. */
  onVerEnPaila: (folder: string) => void
  onReintentar: (p: ParaReintentar) => void
  onHistorial: () => void
  onRefresh: () => void
  /** El puerto según la última prueba (antes de bajar). */
  puerto: PuertoInfo | null
  onProbarPuerto: () => void
  /** Cambió el firewall (después de Arreglarlo). */
  onFirewall: (f: FirewallDiag | null) => void
  /** Dónde queda lo bajado (hay que confirmarla la primera vez). */
  destino: Destino | null
}

const gb = (b: number) => `${num(b / 1e9, { maximumFractionDigits: b < 1e10 ? 1 : 0 })} GB`
const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
const vigila = (bandeja: string | null | undefined, folder: string | null | undefined) => !!bandeja && !!folder && (norm(folder) === norm(bandeja) || norm(folder).startsWith(norm(bandeja) + '/'))

export default function Bajada({ tanda, ready, info, status, onStatus, onOpenPaila, onVerEnPaila, onRefresh, puerto, onProbarPuerto, onFirewall, destino, onReintentar, onHistorial }: Props) {
  const confirmado = !!destino?.confirmado
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [detalle, setDetalle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const running = !!status?.running
  const shown = !!status && (running || !!status.finished) && status.tracks.length + (status.problem ? 1 : 0) > 0
  const items = tanda.items
  const list = items.length ? items : null
  const espera = items.filter((i) => i.estado === 'espera')
  const terminadas = items.filter((i) => i.estado !== 'espera' && i.estado !== 'bajando')
  // cuántos temas se van a buscar: sin lo que ya está en PAILA (null: todavía no se sabe)
  const aBajar = espera.reduce((s, i) => s + (i.aBajar ?? i.list.tracks.length), 0)
  const start = async () => {
    if (!items.length) return
    setError(null); setSaved(null); setFiltro('todos'); onRefresh()
    try {
      // sin nada en espera: vuelve a bajar las que ya terminaron (lo ya bajado se saltea)
      if (!espera.length) for (const i of terminadas) await window.napia.deNuevoEnTanda(i.id)
      onStatus(await window.napia.start())
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }

  const c = status?.counts
  const q = status?.calidad ?? null
  const total = status?.tracks.length ?? 0
  const terminados = c ? c.bajado + c.yaEstaba + c.noEncontrado + c.fallo + c.cancelado : 0
  const tracks = status?.tracks ?? []
  const bajados = tracks.filter((t) => t.state === 'bajado' && !falsa(t) && !enRevision(t)).length
  const faltanTemas = tracks.filter(FILTRO.faltan!)
  const faltan = faltanTemas.length
  const conseguidos = c ? bajados + c.yaEstaba : 0
  const filas = tracks.filter((t) => !FILTRO[filtro] || FILTRO[filtro]!(t))
  // la lista sigue sola el avance (lo ya bajado arriba); si subís a mirar algo, no te arrastra hasta que vuelvas a bajar o toques "Seguir"
  const cajaRef = useRef<HTMLDivElement>(null)
  const primeraEnCurso = filas.slice(0, MAX_FILAS).findIndex(enCurso)
  const { sigue, seguir } = useSeguirAvance(cajaRef, primeraEnCurso, filas.length, running)
  const fin = status?.finished
  const terminoBien = !!fin && !fin.cancelled && !status?.problem
  // no se conectó con nadie o el router se trabó: no se festeja ni se dice "cortes normales"
  const sinConexion = status?.problem?.kind === 'noConecta' || status?.problem?.kind === 'routerTrabado'
  // el puerto de esta corrida (con la prueba desde afuera) o, antes de bajar, el de la última prueba
  const p = status?.puerto ?? (running ? null : puerto)
  const guardar = faltan > 0 && <Boton variant="ghost" onClick={async () => setSaved(await window.napia.saveMissing())}>{T.guardarFaltan(n(faltan))}</Boton>
  const reintentar = (ts = faltanTemas) => status && onReintentar({ nombre: status.listName ?? '', faltan: ts.map((t) => ({ artist: t.artist, title: t.title, ...faltaDe(t) })) })
  // cada fila tiene algo para hacer (la persona 2, 01/11: tocó 55 veces filas que no hacían nada): tu copia, buscarlo de otra forma o verlo en PAILA
  const accionDe = (t: TrackProgress) => t.calidad?.tuya && t.calidad.estado !== 'reemplazado'
    ? <Boton size="sm" variant="ghost" onClick={() => void window.napia.verEnPaila('', `${t.artist} ${t.title}`)} title={T.verTuyaTip}>{T.verTuya}</Boton>
    : !running && FILTRO.faltan!(t) ? <Boton size="sm" variant="ghost" onClick={() => reintentar([t])} title={T.otraBusquedaTip}>{T.otraFormaUno}</Boton>
      : (t.state === 'bajado' || t.calidad?.estado === 'reemplazado') && status?.folder ? <Boton size="sm" variant="ghost" onClick={() => void window.napia.verEnPaila(status.folder!)} title={T.verBajadoTip}>{T.verBajado}</Boton> : null
  const otraBusqueda = faltan > 0 && !running && status && <Boton variant="ghost" onClick={() => reintentar()} title={T.otraBusquedaTip}>{T.otraBusqueda(n(faltan))}</Boton>
  // "Buscar de otra forma" dentro de la lista: arriba de los temas, apenas alguno no llega (también mientras baja: entra a la tanda)
  const barraFaltan = faltan > 0 && (filtro === 'todos' || filtro === 'faltan') && (
    <div className="faltan-barra">
      <span className="small">{T.faltanBarra(faltan, n(faltan))}{running ? T.faltanMientras : ''}<Info tip={TIP.reintento} /></span>
      <Boton size="sm" variant="ghost" onClick={() => reintentar()} title={T.otraBusquedaTip}>{T.otraBusquedaCorto}</Boton>
    </div>
  )
  // la tanda: varias listas o una que ya pasó. El total suma lo terminado, lo que está bajando y lo que espera
  const enTanda = items.length > 1
  const vivo = status?.running ? status : null
  const tot = items.reduce((a, i) => {
    if (i.estado === 'espera') return { hechos: a.hechos, total: a.total + (i.aBajar ?? i.list.tracks.length) }
    if (i.estado === 'bajando' && vivo?.tandaId === i.id) return { hechos: a.hechos + terminados, total: a.total + total }
    const r = i.resumen
    return r ? { hechos: a.hechos + r.total - r.sinTerminar, total: a.total + r.total } : a
  }, { hechos: 0, total: 0 })
  const nLista = items.findIndex((i) => i.estado === 'bajando') + 1
  const tandaTermino = enTanda && !running && !espera.length && terminadas.length === items.length
  const bajadosTanda = terminadas.reduce((s, i) => s + (i.resumen?.bajados ?? 0), 0)
  const nada = espera.length > 0 && aBajar === 0
  // si la tanda no entra en el disco de la carpeta elegida, se avisa antes de arrancar
  const espacio = espacioTanda(aBajar, destino?.disco?.libre)
  const botonBajar = tanda.frenada && espera.length && terminadas.length ? T.seguirTanda(n(espera.length), espera.length)
    : espera.length > 1 ? T.bajarTanda(n(espera.length), n(aBajar))
      : espera.length === 1 ? T.bajarCon(n(aBajar))
        : terminadas.length > 1 ? T.volverListas : T.volverLista

  return (
    <Paso n={3} titulo={T.titulo} apagado={!list} hecho={terminoBien && shown && conseguidos > 0}>
      {info?.exe && !info.freno && !running && <Aviso tone="atencion" style={{ marginBottom: 'var(--sp-3)' }}>{T.sinFreno}<Info tip={TIP.freno} />{T.sinFrenoResto}</Aviso>}
      {info?.soulseekQtOpen && !running && <Aviso tone="atencion" style={{ marginBottom: 'var(--sp-3)' }}>{T.soulseekQt}</Aviso>}
      <div className="row">
        {running
          ? <>
            <Boton variant="danger" size="lg" onClick={async () => onStatus(await window.napia.cancel())} title={espera.length ? T.cortarTip : T.pararTip}>{espera.length ? T.cortarTodo : T.cortar}</Boton>
            {espera.length > 0 && <Boton variant="ghost" onClick={async () => onStatus(await window.napia.cancel(true))} title={T.saltearTip}>{T.saltear}</Boton>}
          </>
          : <Boton size="lg" disabled={!list || !ready || !confirmado || nada} onClick={start}>{botonBajar}</Boton>}
        {!list && <span className="muted">{T.primeroElegi}</span>}
        {list && !ready && !running && <span className="muted">{T.faltaPreparar}</span>}
        {list && ready && nada && !running && <span className="muted">{T.yaEstanTodos(espera.length > 1)}</span>}
        {list && ready && !confirmado && !running && <span className="muted">{T.faltaConfirmar}</span>}
        {running && <span><b>{T.esnifando}</b> <span className="muted">{T.minimizar}</span></span>}
      </div>
      {!running && espacio.noEntra && destino?.disco && <Aviso tone="atencion" style={{ marginTop: 'var(--sp-3)' }}>{T.noEntra(gb(espacio.ocupa), gb(destino.disco.libre!), destino.disco.raiz)}</Aviso>}
      {error && <Aviso tone="error" style={{ marginTop: 'var(--sp-3)' }}>{T.noArranco}{error}</Aviso>}
      {tanda.frenada && !running && espera.length > 0 && <Aviso tone="atencion" style={{ marginTop: 'var(--sp-3)' }}>{T.tandaFrenada(tanda.frenada.motivo, espera.length)}</Aviso>}

      {enTanda && tot.total > 0 && (running || terminadas.length > 0) && (
        <div className="tanda-total">
          <div className="avance-cab">
            <Barra big value={(tot.hechos / tot.total) * 100} tone={tandaTermino && bajadosTanda > 0 ? 'ok' : 'acento'} />
            <span className="num muted">{T.enTotal(n(tot.hechos), n(tot.total))}</span>
          </div>
          <span className="muted small">{running && nLista ? T.tandaVa(n(nLista), n(items.length)) : T.tandaTerminadas(n(terminadas.length), n(items.length))}{T.abajoDetalle(running)}{status?.listName ? <> («{status.listName}»)</> : ''}.</span>
          {tandaTermino && (
            <Festejo imagen={logo} titulo={T.festejoTanda(bajadosTanda, n(items.length))}
              acciones={<><Boton onClick={onOpenPaila}>{T.abrirPaila}</Boton><Boton variant="ghost" onClick={onHistorial}>{T.verHistorial}</Boton></>}>
              {T.cadaCarpeta}
            </Festejo>
          )}
        </div>
      )}

      {status?.problem && <Aviso tone="error" style={{ marginTop: 'var(--sp-3)' }}>{status.problem.text}{(status.problem.kind === 'sinCuenta' || status.problem.kind === 'claveMal') && <> <button className="link" onClick={() => window.napia.openConfig()}>{T.abrirConfig}</button></>}</Aviso>}
      {list && ready && status?.problem?.kind === 'noConecta' && <div style={{ marginTop: 'var(--sp-3)' }}><Puerto puerto={p} urgente onProbar={running ? undefined : onProbarPuerto} onFirewall={onFirewall} /></div>}

      {shown && c && (
        <>
          <div className="avance-cab">
            <Barra big value={total ? (terminados / total) * 100 : null} tone={fin && !fin.cancelled && conseguidos > 0 ? 'ok' : 'acento'} />
            <span className="num muted">{T.de(n(terminados), n(total))}</span>
          </div>
          <div className="cifras">
            <Cifra valor={n(bajados)} label={T.bajados} tone="ok" />
            <Cifra valor={n(c.yaEstaba)} label={T.yaEstaban} tone="info" info={T.yaEstabanInfo} />
            <Cifra valor={n(c.noEncontrado)} label={T.noSeEncontraron} tone={c.noEncontrado ? 'atencion' : 'neutro'} info={TIP.noEncontrado} />
            <Cifra valor={n(c.fallo)} label={T.noSePudieron} tone={c.fallo ? 'error' : 'neutro'} info={TIP.noSePudo} />
            <Cifra valor={n(c.espera + c.buscando + c.bajando)} label={running ? T.porBajar : T.sinTerminar} />
            {!!q?.descartados && <Cifra valor={n(q.descartados)} label={tracks.some((t) => t.calidad?.tuya) ? TC.cifraConTuyas : TC.cifra} tone="atencion" info={TC.tip} />}
          </div>
          {q && <ResumenCalidad cuenta={q} />}
          {status.peerErrors > 0 && !sinConexion && <p className="muted small">{T.cortesNormales(n(status.peerErrors))}<Info tip={TIP.cortes} /></p>}

          {terminoBien && conseguidos > 0 && !tandaTermino && (
            <Festejo imagen={logo} titulo={T.festejo(bajados, c.yaEstaba)}
              acciones={<>
                <Boton onClick={onOpenPaila}>{T.abrirPaila}</Boton>
                {status.folder && <Boton variant="ghost" onClick={() => window.napia.openFolder(status.folder!)}>{T.abrirCarpeta}</Boton>}
                {status.folder && <Boton variant="ghost" onClick={() => onVerEnPaila(status.folder!)} title={T.verEnPailaTip}>{T.verEnPaila}</Boton>}
                {otraBusqueda}
                {guardar}
              </>}>
              {status.folder && <span>{T.quedaronEn}<b>{status.folder}</b>. </span>}
              {vigila(destino?.bandeja, status.folder)
                ? <span>{T.laBandeja}<Info tip={TIP.bandeja} />{T.loRevisa}</span>
                : <span>{T.abriPaila}<Info tip={TIP.bandeja} />{T.teOfrece}</span>}
              {saved && <div className="small">{T.guardada(saved)}</div>}
            </Festejo>
          )}
          {fin && !fin.cancelled && conseguidos === 0 && !sinConexion && (
            <Aviso tone="atencion" style={{ marginTop: 'var(--sp-3)' }}>
              <b>{T.noBajoNada}</b>{' '}
              {c.fallo ? (c.fallo === 1 ? T.encontro1 : T.encontroVarios(n(c.fallo))) + T.motivoCadaUno : c.noEncontrado ? T.noEncontroNinguno : T.miraDetalle}
              {(guardar || otraBusqueda) && <div className="row" style={{ marginTop: 'var(--sp-2)' }}>{otraBusqueda}{guardar}</div>}
              {saved && <div className="small">{T.guardada(saved)}</div>}
            </Aviso>
          )}
          {fin?.cancelled && <Aviso style={{ marginTop: 'var(--sp-3)' }}>{T.cortasteBajada}</Aviso>}

          <Pestanas label={T.queTemasVer} value={filtro} onChange={setFiltro} items={[
            { key: 'todos', label: T.todos, count: n(total) },
            { key: 'curso', label: T.enCurso, count: n(tracks.filter(FILTRO.curso!).length) },
            { key: 'faltan', label: T.noSeBajaron, count: n(faltan) },
            { key: 'listos', label: T.bajadosTab, count: n(conseguidos) },
          ]} />
          {running && !sigue && <div className="row" style={{ justifyContent: 'flex-end', margin: 'var(--sp-1) 0' }}><Boton variant="ghost" size="sm" onClick={seguir} title={T.seguirTip}>{T.seguir}</Boton></div>}
          {barraFaltan}
          <div ref={cajaRef}><Caja className="filas">
            {filas.slice(0, MAX_FILAS).map((t, i) => {
              const k = filaCalidad(t)
              return <FilaEstado key={i} tone={k?.tone ?? ESTADO[t.state].tone} estado={k?.label ?? ESTADO[t.state].label} activo={k?.activo || t.state === 'buscando' || t.state === 'bajando'}
                titulo={t.artist ? `${t.artist} - ${t.title}` : t.title} sub={t.detail ?? (k?.sub || t.format) ?? undefined} avance={t.state === 'bajando' ? t.percent : null}
                accion={accionDe(t)} />
            })}
            {!filas.length && <div className="muted small" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>{T.nadaParaMostrar}</div>}
            {filas.length > MAX_FILAS && <div className="muted small" style={{ padding: 'var(--sp-2) var(--sp-4)' }}>{T.ymas(n(filas.length - MAX_FILAS))}</div>}
          </Caja></div>
        </>
      )}

      {list && ready && (
        <div className="detalle">
          <button className="link" onClick={() => setDetalle(!detalle)}>{detalle ? T.ocultarDetalle : status?.log.length ? T.verDetalle : T.verConexion}</button>
          {detalle && status?.problem?.kind !== 'noConecta' && <div style={{ marginTop: 'var(--sp-2)' }}><Puerto puerto={p} onProbar={running ? undefined : onProbarPuerto} onFirewall={onFirewall} /></div>}
          {detalle && !!status?.log.length && <pre className="registro">{status.log.join('\n')}</pre>}
        </div>
      )}
    </Paso>
  )
}
