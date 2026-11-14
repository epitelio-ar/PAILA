// Paso 1, qué bajar: una lista o una tanda de varias, que NAPIA baja una detrás de otra (cada una en su carpeta). Se suman
// soltando o eligiendo un archivo (CSV de Exportify, Chosic, TuneMyMusic o Spotify; .txt; lo que exporta PAILA desde la
// Faltan o suenan mal) o pegando un texto con un "Artista - Tema" por renglón; también mientras otra está bajando. Se leen
// con el lector de listas de @paila/core, el mismo de "Traer una lista" de PAILA.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Aviso, Barra, Boton, Campo, Info, Paso, Pestanas, Pildora, ZonaSoltar, type TonoPildora } from '@paila/diseno'
import type { NapiaList, RunStatus, TandaEstado, TandaItem } from '@paila/shared/napia'
import type { ParaReintentar } from './Reintentar'
import { cant, plural, textos } from '@paila/shared/idioma'
import { TIP, mmss, n } from './textos'
import UnDisco from './UnDisco'

const T = textos({
  queBajar: { es: 'Qué bajar', en: 'What to download' },
  queBajarTanda: { es: (c: string) => `Qué bajar: una tanda de ${c} listas`, en: (c: string) => `What to download: a batch of ${c} lists` },
  sumarOtra: { es: 'Sumar otra lista a la tanda', en: 'Add another list to the batch' },
  sacarTerminadas: { es: 'Sacar las terminadas', en: 'Remove finished ones' },
  cambiarLista: { es: 'Cambiar la lista', en: 'Change the list' },
  nombreLista: { es: 'Nombre de la lista', en: 'List name' },
  tema: { es: (c: number) => plural(c, 'tema', 'temas'), en: (c: number) => plural(c, 'track', 'tracks') },
  otraBusqueda: { es: 'Otra búsqueda', en: 'Another search' },
  yMas: { es: (c: string) => `y ${c} más`, en: (c: string) => `and ${c} more` },
  renglones: {
    es: (c: number, ej: string, mas: boolean) => `${c} renglones no se entendieron y no van: ${ej}${mas ? '…' : ''}`,
    en: (c: number, ej: string, mas: boolean) => `${cant(c, 'line', 'lines')} couldn't be understood and are left out: ${ej}${mas ? '…' : ''}`,
  },
  listasTanda: { es: 'Las listas de la tanda', en: 'The lists in the batch' },
  espera: { es: 'En espera', en: 'Waiting' },
  bajando: { es: 'Bajando', en: 'Downloading' },
  terminada: { es: 'Terminada', en: 'Finished' },
  cortada: { es: 'Cortada', en: 'Stopped' },
  frenada: { es: 'Se frenó', en: 'Paused' },
  temasBuscan: {
    es: (t: string, b: string) => `${t} temas · se buscan ${b}`,
    en: (t: string, b: string) => `${t} tracks · searching for ${b}`,
  },
  otraBusquedaMin: { es: ' · otra búsqueda', en: ' · another search' },
  bajados: { es: (c: number) => plural(c, 'bajado', 'bajados'), en: () => 'downloaded' },
  yaEstaban: { es: (c: number) => plural(c, 'ya estaba', 'ya estaban'), en: () => 'already had' },
  yaEnPaila: { es: 'ya en PAILA', en: 'already in PAILA' },
  noEncontrados: { es: (c: number) => plural(c, 'no se encontró', 'no se encontraron'), en: () => 'not found' },
  noSePudieron: { es: (c: number) => plural(c, 'no se pudo bajar', 'no se pudieron bajar'), en: () => "couldn't get" },
  deN: { es: (a: string, b: string) => `${a} de ${b}`, en: (a: string, b: string) => `${a} of ${b}` },
  antes: { es: 'Que se baje antes', en: 'Download it earlier' },
  despues: { es: 'Que se baje después', en: 'Download it later' },
  moverAntes: { es: 'Mover antes', en: 'Move earlier' },
  moverDespues: { es: 'Mover después', en: 'Move later' },
  reintentar: { es: 'Reintentar…', en: 'Try again…' },
  reintentarTip: { es: 'Buscar de otra forma lo que no se encontró', en: "Search another way for what wasn't found" },
  abrirCarpeta: { es: 'Abrir la carpeta', en: 'Open folder' },
  otraVez: { es: 'Otra vez', en: 'Again' },
  otraVezTip: { es: 'La vuelve a poner en espera: lo que ya se bajó no se baja de nuevo', en: "Puts it back to waiting: what's already downloaded isn't downloaded again" },
  sacar: { es: 'Sacar', en: 'Remove' },
  sacarTip: { es: 'La saca de la tanda (lo bajado queda donde está)', en: 'Removes it from the batch (what was downloaded stays where it is)' },
  nombreCarpeta: { es: 'Es el nombre de la carpeta donde quedan sus temas', en: 'This is the name of the folder where its tracks end up' },
  sinTemas: {
    es: (nombre: string) => `No encontramos temas en "${nombre}". Fijate que tenga columnas de artista y título, o un "Artista - Tema" por renglón.`,
    en: (nombre: string) => `We didn't find any tracks in "${nombre}". Make sure it has artist and title columns, or one "Artist - Track" per line.`,
  },
  noSePudoLeer: { es: (m: string) => `No se pudo leer la lista: ${m}`, en: (m: string) => `Couldn't read the list: ${m}` },
  deDonde: { es: 'De dónde viene la lista', en: 'Where the list comes from' },
  unArchivo: { es: 'Un archivo', en: 'A file' },
  pegarTexto: { es: 'Pegar texto', en: 'Paste text' },
  unDisco: { es: 'Un disco', en: 'An album' },
  carpetaEntera: { es: (l: string, d: string, t: number) => ` · carpeta entera: ${l} de ${d}${t ? `, ${t} truchos` : ''}`, en: (l: string, d: string, t: number) => ` · whole folder: ${l} of ${d}${t ? `, ${t} fakes` : ''}` },
  noSumar: { es: 'No sumar otra', en: "Don't add another" },
  soltaAca: { es: 'Soltá acá tu lista', en: 'Drop your list here' },
  tocaElegir: { es: 'o tocá para elegirla', en: 'or click to choose it' },
  formatos: {
    es: 'CSV de Exportify, Chosic, TuneMyMusic o Spotify · un .txt con un "Artista - Tema" por renglón · lo que exporta PAILA desde la lista «Faltan o suenan mal»',
    en: 'CSV from Exportify, Chosic, TuneMyMusic or Spotify · a .txt with one "Artist - Track" per line · what PAILA exports from the "Missing or low quality" list',
  },
  placeholder: {
    es: 'Un tema por renglón, por ejemplo:\nSoda Stereo - De Música Ligera\nVirus - Wadu Wadu',
    en: 'One track per line, for example:\nSoda Stereo - De Música Ligera\nVirus - Wadu Wadu',
  },
  usarTexto: { es: 'Usar este texto', en: 'Use this text' },
})

const VISTA = 8

interface Props {
  tanda: TandaEstado
  running: boolean
  status: RunStatus | null
  onTanda: (t: TandaEstado) => void
  onReintentar: (p: ParaReintentar) => void
}

export default function Entrada({ tanda, running, status, onTanda, onReintentar }: Props) {
  const [sumando, setSumando] = useState(false)
  const items = tanda.items
  const sumar = async (l: NapiaList) => { onTanda(await window.napia.sumarATanda(l)); setSumando(false) }

  if (!items.length) return <Paso n={1} titulo={T.queBajar} info={TIP.lista}><NuevaLista onList={sumar} /></Paso>

  const sola = items.length === 1 && items[0].estado === 'espera' && !running ? items[0] : null
  const otra = sumando
    ? <div className="sumar-otra"><NuevaLista onList={sumar} onCancel={() => setSumando(false)} /></div>
    : <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
      <Boton size="sm" variant="ghost" onClick={() => setSumando(true)}>{T.sumarOtra}</Boton><Info tip={TIP.tanda} />
      {items.some((i) => i.estado !== 'espera' && i.estado !== 'bajando') && <Boton size="sm" variant="ghost" onClick={async () => onTanda(await window.napia.limpiarTanda())}>{T.sacarTerminadas}</Boton>}
    </div>

  if (sola) {
    const list = sola.list
    return (
      <Paso n={1} hecho titulo={T.queBajar} info={TIP.lista} acciones={<Boton size="sm" variant="ghost" onClick={async () => onTanda(await window.napia.sacarDeTanda(sola.id))}>{T.cambiarLista}</Boton>}>
        <div className="row lista-cab">
          <Campo label={T.nombreLista} info={TIP.nombre}>
            <Nombre it={sola} onTanda={onTanda} style={{ width: 320 }} />
          </Campo>
          <span><b className="num">{n(list.tracks.length)}</b> {T.tema(list.tracks.length)} <Pildora>{sola.reintento ? T.otraBusqueda : list.source}</Pildora></span>
        </div>
        <div className="vista-lista">
          {list.tracks.slice(0, VISTA).map((t, i) => (
            <div key={i} className="vista-fila"><span className="num muted">{i + 1}</span><span className="ellipsis">{t.artist ? `${t.artist} - ` : ''}{t.title}</span><span className="num muted">{mmss(t.duration)}</span></div>
          ))}
          {list.tracks.length > VISTA && <div className="vista-fila muted"><span /><span>{T.yMas(n(list.tracks.length - VISTA))}</span><span /></div>}
        </div>
        {list.skipped.length > 0 && <Aviso tone="atencion" style={{ marginTop: 'var(--sp-3)' }}>{T.renglones(list.skipped.length, list.skipped.slice(0, 3).map((s) => `«${s}»`).join(', '), list.skipped.length > 3)}</Aviso>}
        {otra}
      </Paso>
    )
  }

  const enEspera = items.filter((i) => i.estado === 'espera')
  return (
    <Paso n={1} hecho titulo={items.length > 1 ? T.queBajarTanda(n(items.length)) : T.queBajar} info={TIP.tanda}>
      <div className="tanda" role="table" aria-label={T.listasTanda}>
        {items.map((it, i) => <FilaTanda key={it.id} it={it} n={i + 1} status={status} primeraEnEspera={enEspera[0]?.id === it.id} ultimaEnEspera={enEspera[enEspera.length - 1]?.id === it.id} onTanda={onTanda} onReintentar={onReintentar} />)}
      </div>
      {otra}
    </Paso>
  )
}

const ESTADO: Record<TandaItem['estado'], { label: string; tone: TonoPildora }> = {
  espera: { get label() { return T.espera }, tone: 'neutro' },
  bajando: { get label() { return T.bajando }, tone: 'acento' },
  terminada: { get label() { return T.terminada }, tone: 'ok' },
  cortada: { get label() { return T.cortada }, tone: 'neutro' },
  frenada: { get label() { return T.frenada }, tone: 'error' },
}

/** Una lista de la tanda: nombre (se puede cambiar mientras espera), cuántos temas, cómo va y sus botones. */
function FilaTanda({ it, n: num, status, primeraEnEspera, ultimaEnEspera, onTanda, onReintentar }: { it: TandaItem; n: number; status: RunStatus | null; primeraEnEspera: boolean; ultimaEnEspera: boolean; onTanda: (t: TandaEstado) => void; onReintentar: (p: ParaReintentar) => void }) {
  const r = it.resumen
  const vivo = it.estado === 'bajando' && status?.tandaId === it.id ? status : null
  const c = vivo?.counts
  const hechos = c ? c.bajado + c.yaEstaba + c.noEncontrado + c.fallo + c.cancelado : 0
  const faltan = r ? r.noEncontrados + r.noSePudieron : 0
  const temas = it.aBajar != null && it.aBajar !== it.list.tracks.length ? T.temasBuscan(n(it.list.tracks.length), n(it.aBajar)) : `${n(it.list.tracks.length)} ${T.tema(it.list.tracks.length)}`
  const e = ESTADO[it.estado]
  return (
    <div className="tanda-fila" role="row">
      <span className="num muted">{num}</span>
      <span className="tanda-nombre">
        {it.estado === 'espera'
          ? <Nombre it={it} onTanda={onTanda} />
          : <b className="ellipsis" title={it.folder ?? undefined}>{it.list.name}</b>}
        <span className="muted small">
          {temas}{it.reintento ? T.otraBusquedaMin : ''}{it.carpeta ? T.carpetaEntera(n(it.carpeta.llegaron), n(it.carpeta.de), it.carpeta.truchos) : ''}
          {r && <> · {n(r.bajados)} {T.bajados(r.bajados)}{r.yaEstaban ? `, ${n(r.yaEstaban)} ${T.yaEstaban(r.yaEstaban)}` : ''}{r.yaEnPaila ? `, ${n(r.yaEnPaila)} ${T.yaEnPaila}` : ''}{r.noEncontrados ? `, ${n(r.noEncontrados)} ${T.noEncontrados(r.noEncontrados)}` : ''}{r.noSePudieron ? `, ${n(r.noSePudieron)} ${T.noSePudieron(r.noSePudieron)}` : ''}</>}
          {it.problema && <> · {it.problema}</>}
        </span>
        {vivo && <Barra value={vivo.tracks.length ? (hechos / vivo.tracks.length) * 100 : null} className="tanda-barra" />}
      </span>
      <Pildora tone={e.tone}>{vivo ? `${e.label} · ${T.deN(n(hechos), n(vivo.tracks.length))}` : e.label}</Pildora>
      <span className="tanda-acciones">
        {it.estado === 'espera' && <>
          <Boton size="sm" variant="ghost" disabled={primeraEnEspera} onClick={async () => onTanda(await window.napia.moverEnTanda(it.id, -1))} title={T.antes} aria-label={T.moverAntes}>↑</Boton>
          <Boton size="sm" variant="ghost" disabled={ultimaEnEspera} onClick={async () => onTanda(await window.napia.moverEnTanda(it.id, 1))} title={T.despues} aria-label={T.moverDespues}>↓</Boton>
        </>}
        {faltan > 0 && <Boton size="sm" variant="ghost" onClick={async () => { const h = (await window.napia.historial()).find((x) => x.tandaId === it.id); if (h) onReintentar({ nombre: it.list.name, faltan: h.faltan }) }} title={T.reintentarTip}>{T.reintentar}</Boton>}
        {it.folder && it.estado !== 'espera' && <Boton size="sm" variant="ghost" onClick={() => window.napia.openFolder(it.folder!)}>{T.abrirCarpeta}</Boton>}
        {(it.estado === 'terminada' || it.estado === 'cortada' || it.estado === 'frenada') && <Boton size="sm" variant="ghost" onClick={async () => onTanda(await window.napia.deNuevoEnTanda(it.id))} title={T.otraVezTip}>{T.otraVez}</Boton>}
        {it.estado !== 'bajando' && <Boton size="sm" variant="ghost" onClick={async () => onTanda(await window.napia.sacarDeTanda(it.id))} title={T.sacarTip}>{T.sacar}</Boton>}
      </span>
    </div>
  )
}

/** El nombre de una lista en espera (es el de su carpeta). Se escribe acá y le llega a la tanda un momento después. */
function Nombre({ it, onTanda, style }: { it: TandaItem; onTanda: (t: TandaEstado) => void; style?: CSSProperties }) {
  const [v, setV] = useState(it.list.name)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editando = useRef(false)
  useEffect(() => { if (!editando.current) setV(it.list.name) }, [it.list.name])
  const guardar = (x: string) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void window.napia.renombrarEnTanda(it.id, x).then(onTanda) }, 300) }
  return <input value={v} aria-label={T.nombreLista} title={T.nombreCarpeta} style={style}
    onFocus={() => { editando.current = true }} onBlur={() => { editando.current = false }} onChange={(e) => { setV(e.target.value); guardar(e.target.value) }} />
}

/** Elegir o soltar una lista, o pegar un texto. */
function NuevaLista({ onList, onCancel }: { onList: (l: NapiaList) => void; onCancel?: () => void }) {
  const [tab, setTab] = useState<'archivo' | 'texto' | 'disco'>('archivo')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const take = (l: NapiaList | null) => {
    if (!l) return
    if (!l.tracks.length) { setError(T.sinTemas(l.name)); return }
    setError(null); onList(l)
  }
  // el nombre de la lista pegada es el de su carpeta: se escribe siempre igual, en cualquier idioma
  // idioma-ok
  const nombrePegada = () => `Lista pegada ${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}`
  const open = async (path?: string) => { try { take(await window.napia.openList(path)) } catch (e) { setError(T.noSePudoLeer((e as Error).message)) } }
  return (
    <>
      <div className="row">
        <Pestanas label={T.deDonde} value={tab} onChange={setTab} items={[{ key: 'archivo', label: T.unArchivo }, { key: 'texto', label: T.pegarTexto }, { key: 'disco', label: T.unDisco }]} />
        {onCancel && <button className="link push-right" onClick={onCancel}>{T.noSumar}</button>}
      </div>
      {tab === 'disco' ? <UnDisco onList={take} /> : tab === 'archivo' ? (
        <ZonaSoltar onElegir={() => void open()} onSoltar={(f) => void open(window.napia.pathForFile(f))}>
          <b>{T.soltaAca}</b>
          <span className="small">{T.tocaElegir}</span>
          <span className="small muted">{T.formatos}</span>
        </ZonaSoltar>
      ) : (
        <>
          <textarea className="pegar" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={T.placeholder} />
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
            <Boton disabled={!text.trim()} onClick={async () => { take(await window.napia.parseText(text, nombrePegada())); setText('') }}>{T.usarTexto}</Boton>
          </div>
        </>
      )}
      {error && <Aviso tone="error" style={{ marginTop: 'var(--sp-3)' }}>{error}</Aviso>}
    </>
  )
}
