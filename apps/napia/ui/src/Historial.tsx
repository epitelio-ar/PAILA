// Historial de NAPIA: cada lista que se bajó (la más nueva arriba), cuándo, cuántos temas llegaron, cuántos no se encontraron,
// cuántos llegaron truchos (calidad falsa) y se reemplazaron por otra fuente, y adónde fueron. Botones: abrir la carpeta, verla en PAILA (su Bandeja, con lo de esa carpeta) y buscar de otra forma lo
// que faltó. Lo guarda el proceso principal en historial.json (core/sockseek/tanda.ts); sacar una entrada no toca lo bajado.
import { useState } from 'react'
import { Boton, Caja, Info, PantallaVacia, Pildora } from '@paila/diseno'
import type { EntradaHistorial } from '@paila/shared/napia'
import logo from './assets/logo.png'
import type { ParaReintentar } from './Reintentar'
import { fechaHora, num, plural, textos } from '@paila/shared/idioma'
import { TIP, n } from './textos'
import { TC } from './Calidad'

const T = textos({
  vacioTitulo: { es: 'Todavía no bajaste nada con NAPIA', en: "You haven't downloaded anything with NAPIA yet" },
  vacio: { es: 'Cuando termine cada lista, acá vas a ver qué llegó, qué no se encontró y adónde fue.', en: "When each list finishes, you'll see here what arrived, what wasn't found and where it went." },
  intro: { es: 'Cada lista que bajaste, la más nueva arriba. Sacar una de acá no borra nada de lo que bajó.', en: "Every list you downloaded, newest on top. Removing one from here doesn't delete anything you downloaded." },
  otraBusqueda: { es: 'Otra búsqueda', en: 'Another search' },
  cortada: { es: 'Cortada', en: 'Stopped' },
  seFreno: { es: 'Se frenó', en: 'Paused' },
  tardo: { es: (t: string) => `tardó ${t}`, en: (t: string) => `took ${t}` },
  menosMinuto: { es: 'menos de un minuto', en: 'less than a minute' },
  unMinuto: { es: '1 minuto', en: '1 minute' },
  minutos: { es: (m: string) => `${m} minutos`, en: (m: string) => `${m} minutes` },
  horas: { es: (h: string) => `${h} horas`, en: (h: string) => `${h} hours` },
  tema: { es: (c: number) => plural(c, 'tema', 'temas'), en: (c: number) => plural(c, 'track', 'tracks') },
  llego: { es: (c: number) => plural(c, 'llegó', 'llegaron'), en: () => 'arrived' },
  yaEstaban: { es: (c: number) => plural(c, 'ya estaba', 'ya estaban'), en: () => 'already had' },
  yaEstabanTip: { es: 'Se habían bajado antes con esta misma lista: no se bajan de nuevo.', en: "They were downloaded before with this same list: they aren't downloaded again." },
  yaLoTenias: { es: (c: number) => plural(c, 'ya lo tenías', 'ya los tenías'), en: () => 'already in' },
  enPaila: { es: ' en PAILA', en: ' PAILA' },
  noEncontro: { es: (c: number) => plural(c, 'no se encontró', 'no se encontraron'), en: () => 'not found' },
  noSePudo: { es: (c: number) => plural(c, 'no se pudo bajar', 'no se pudieron bajar'), en: () => "couldn't get" },
  sinTerminar: { es: 'sin terminar', en: 'unfinished' },
  quedaronEn: { es: 'Quedaron en ', en: 'They ended up in ' },
  abrirCarpeta: { es: 'Abrir la carpeta', en: 'Open folder' },
  verEnPaila: { es: 'Ver en PAILA', en: 'See in PAILA' },
  verEnPailaTip: { es: 'Abre la Bandeja de PAILA con lo que llegó a esta carpeta', en: "Opens PAILA's Inbox with what arrived in this folder" },
  buscarOtraForma: {
    es: (c: number) => `Buscar de otra forma ${c === 1 ? 'el que falta' : `los ${num(c)} que faltan`}…`,
    en: (c: number) => `Search another way for ${c === 1 ? 'the missing one' : `the ${num(c)} missing ones`}…`,
  },
  ocultarCuales: { es: 'Ocultar cuáles', en: 'Hide which' },
  verCuales: { es: 'Ver cuáles', en: 'See which' },
  sacar: { es: 'Sacar del historial', en: 'Remove from history' },
  sacarTip: { es: 'La saca de esta lista. No borra ningún tema.', en: "Removes it from this list. It doesn't delete any track." },
  llegaron: { es: (t: string) => `Llegaron (${t})`, en: (t: string) => `Arrived (${t})` },
  noLlegaron: { es: (t: string) => `No llegaron (${t})`, en: (t: string) => `Didn't arrive (${t})` },
  fallo: { es: 'no se pudo bajar', en: "couldn't get it" },
  noEncontroUno: { es: 'no se encontró', en: 'not found' },
  soloFalsaUno: { es: 'solo se encontró en calidad falsa', en: 'only found in fake quality' },
  sinMejorUno: { es: 'no se encontró una copia mejor que la tuya', en: "couldn't find a copy better than yours" },
  sinMejor: { es: (c: number) => plural(c, 'sin una copia mejor que la tuya', 'sin una copia mejor que las tuyas'), en: () => 'without a copy better than yours' },
  truchos: { es: (c: number) => plural(c, 'llegó trucho', 'llegaron truchos'), en: () => 'arrived bogus' },
  noSirvieron: { es: (c: number) => plural(c, 'llegó trucho o no mejor que el tuyo', 'llegaron truchos o no mejores que los tuyos'), en: () => 'arrived bogus or not better than yours' },
  reemplazados: { es: (c: number) => plural(c, 'se reemplazó por otra fuente', 'se reemplazaron por otra fuente'), en: () => 'replaced from another source' },
  soloFalsa: { es: (c: number) => plural(c, 'solo estaba trucho', 'solo estaban truchos'), en: () => 'only found bogus' },
})

interface Props {
  items: EntradaHistorial[]
  onCambio: (h: EntradaHistorial[]) => void
  onVerEnPaila: (folder: string) => void
  onReintentar: (p: ParaReintentar) => void
}

const cuando = (iso: string) => fechaHora(iso, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const minutos = (a: string, b: string) => { const m = Math.round((Date.parse(b) - Date.parse(a)) / 60_000); return m < 1 ? T.menosMinuto : m === 1 ? T.unMinuto : m < 120 ? T.minutos(n(m)) : T.horas(num(m / 60, { maximumFractionDigits: 1 })) }
const temas = (x: number) => `${n(x)} ${T.tema(x)}`

export default function Historial({ items, onCambio, onVerEnPaila, onReintentar }: Props) {
  if (!items.length) {
    return <PantallaVacia imagen={logo} titulo={T.vacioTitulo}>{T.vacio}</PantallaVacia>
  }
  return (
    <div className="historial">
      <p className="muted small">{T.intro}<Info tip={TIP.historial} /></p>
      {items.map((e) => <Entrada key={e.id} e={e} onCambio={onCambio} onVerEnPaila={onVerEnPaila} onReintentar={onReintentar} />)}
    </div>
  )
}

function Entrada({ e, onCambio, onVerEnPaila, onReintentar }: { e: EntradaHistorial; onCambio: Props['onCambio']; onVerEnPaila: Props['onVerEnPaila']; onReintentar: Props['onReintentar'] }) {
  const [ver, setVer] = useState(false)
  const noEncontrados = e.faltan.length
  return (
    <Caja className="historial-entrada" pad>
      <div className="row">
        <b className="historial-nombre ellipsis">{e.lista}</b>
        {e.reintento && <Pildora>{T.otraBusqueda}</Pildora>}
        {e.cortada && <Pildora>{T.cortada}</Pildora>}
        {e.problema && <Pildora tone="error">{T.seFreno}</Pildora>}
        <span className="muted small push-right">{cuando(e.inicio)} · {T.tardo(minutos(e.inicio, e.fin))}</span>
      </div>
      <div className="historial-cifras small">
        <span><b className="num">{n(e.bajados)}</b> {T.llego(e.bajados)}</span>
        {e.yaEstaban > 0 && <span><b className="num">{n(e.yaEstaban)}</b> {T.yaEstaban(e.yaEstaban)}<Info tip={T.yaEstabanTip} /></span>}
        {e.yaEnPaila > 0 && <span><b className="num">{n(e.yaEnPaila)}</b> {T.yaLoTenias(e.yaEnPaila)}{T.enPaila}<Info tip={TIP.yaTenes} /></span>}
        {e.noEncontrados > 0 && <span className="historial-atencion"><b className="num">{n(e.noEncontrados)}</b> {T.noEncontro(e.noEncontrados)}<Info tip={TIP.noEncontrado} /></span>}
        {e.noSePudieron > 0 && <span className="historial-error"><b className="num">{n(e.noSePudieron)}</b> {T.noSePudo(e.noSePudieron)}<Info tip={TIP.noSePudo} /></span>}
        {e.sinTerminar > 0 && <span><b className="num">{n(e.sinTerminar)}</b> {T.sinTerminar}</span>}
        {!!e.descartados && <span className="historial-atencion"><b className="num">{n(e.descartados)}</b> {e.sinMejor ? T.noSirvieron(e.descartados) : T.truchos(e.descartados)}<Info tip={TC.tip} /></span>}
        {!!e.reemplazados && <span><b className="num">{n(e.reemplazados)}</b> {T.reemplazados(e.reemplazados)}</span>}
        {!!e.soloFalsa && <span className="historial-error"><b className="num">{n(e.soloFalsa)}</b> {T.soloFalsa(e.soloFalsa)}</span>}
        {!!e.sinMejor && <span className="historial-atencion"><b className="num">{n(e.sinMejor)}</b> {T.sinMejor(e.sinMejor)}</span>}
      </div>
      {e.problema && <p className="small muted" style={{ margin: 'var(--sp-1) 0 0' }}>{e.problema}</p>}
      {e.carpeta && <p className="small muted ellipsis" style={{ margin: 'var(--sp-1) 0 0' }} title={e.carpeta}>{T.quedaronEn}<bdi>{e.carpeta}</bdi></p>}
      <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
        {e.carpeta && <Boton size="sm" variant="ghost" onClick={() => window.napia.openFolder(e.carpeta!)}>{T.abrirCarpeta}</Boton>}
        {e.carpeta && e.bajados > 0 && <Boton size="sm" variant="ghost" onClick={() => onVerEnPaila(e.carpeta!)} title={T.verEnPailaTip}>{T.verEnPaila}</Boton>}
        {noEncontrados > 0 && <Boton size="sm" onClick={() => onReintentar({ nombre: e.lista, faltan: e.faltan })}>{T.buscarOtraForma(noEncontrados)}</Boton>}
        {(e.llegaron.length > 0 || noEncontrados > 0) && <button className="link" onClick={() => setVer(!ver)}>{ver ? T.ocultarCuales : T.verCuales}</button>}
        <button className="link push-right muted small" onClick={async () => onCambio(await window.napia.sacarDelHistorial(e.id))} title={T.sacarTip}>{T.sacar}</button>
      </div>
      {ver && (
        <div className="historial-detalle small">
          {e.llegaron.length > 0 && <><b>{T.llegaron(temas(e.llegaron.length))}</b><ul>{e.llegaron.map((t, i) => <li key={i}>{t.artist ? `${t.artist} - ` : ''}{t.title}</li>)}</ul></>}
          {noEncontrados > 0 && <><b>{T.noLlegaron(temas(noEncontrados))}</b><ul>{e.faltan.map((t, i) => <li key={i}>{t.artist ? `${t.artist} - ` : ''}{t.title} <span className="muted">· {t.estado === 'sinMejor' ? T.sinMejorUno : t.estado === 'soloFalsa' ? T.soloFalsaUno : t.estado === 'fallo' ? T.fallo : T.noEncontroUno}</span></li>)}</ul></>}
        </div>
      )}
    </Caja>
  )
}
