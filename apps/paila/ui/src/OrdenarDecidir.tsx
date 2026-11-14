// Ordenar, "Para decidir vos": lo dudoso, con su pregunta y la respuesta ahí mismo (sin mandar a otra pantalla). Dos temas que se
// parecen solo por el nombre (se escuchan y se elige; si PAILA sabe cuál es el mejor, lo marca y se pueden resolver todos de una),
// dos que irían al mismo lugar, y un tema sin artista o título.
import { useState } from 'react'
import type { CartaRevision, EleccionRevision, ItemPar } from '@paila/shared/types'
import { Boton, Icon } from '@paila/diseno'
import { T } from './OrdenarGrupos.textos'
import { duration } from './format'
import { sinNumero } from './ordenarRegla'

type Decidir = (clave: string, e: EleccionRevision) => void
const base = (rel: string) => rel.split('/').pop() ?? rel
const carpeta = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

const Play = ({ id, onPlay }: { id: number; onPlay: (id: number) => void }) =>
  <button className="link ord-play" onClick={() => onPlay(id)} title={T.escuchar} aria-label={T.escuchar}><Icon name="play" size={13} /></button>

/** Un tema de la carta: escuchar, el nombre, la carpeta donde está y sus datos. */
function Tema({ rel, id, datos, onPlay, children }: { rel: string; id: number | null; datos?: string; onPlay: (id: number) => void; children?: React.ReactNode }) {
  return (
    <div className="ord-item">
      {id != null ? <Play id={id} onPlay={onPlay} /> : <span className="ord-play" />}
      <span className="ord-item-nombre" title={rel}>{base(rel)} <span className="muted small">{carpeta(rel)}</span></span>
      {datos && <span className="muted small ord-item-datos">{datos}</span>}
      {children}
    </div>
  )
}

const datosDe = (it: ItemPar) => [it.kbps ? T.kbps(it.kbps) : '', it.duration ? duration(it.duration) : '', it.grade ? T.nota(it.grade) : ''].filter(Boolean).join(' · ')

function Par({ c, onDecidir, onPlay }: { c: Extract<CartaRevision, { tipo: 'par' }>; onDecidir: Decidir; onPlay: (id: number) => void }) {
  return (
    <div className="ord-carta">
      <div className="ord-carta-cabeza"><b>{T.parTitulo}</b> <span className="muted small ord-porque" title={c.porQue}>{c.porQue}</span>
        <Boton size="sm" variant="ghost" className="ord-empuja" onClick={() => onDecidir(c.clave, 'distintos')}>{T.sonDistintos}</Boton></div>
      {c.items.map((it) => (
        <Tema key={it.id} rel={it.rel} id={it.id} datos={datosDe(it)} onPlay={onPlay}>
          {c.keep === it.id && <span className="ord-mejor" title={T.elMejorTip}>{T.elMejor}</span>}
          <Boton size="sm" variant="ghost" onClick={() => onDecidir(c.clave, { quedaId: it.id })}>{T.quedarme}</Boton>
        </Tema>
      ))}
    </div>
  )
}

function Choque({ c, onDecidir, onPlay }: { c: Extract<CartaRevision, { tipo: 'choque' }>; onDecidir: Decidir; onPlay: (id: number) => void }) {
  return (
    <div className="ord-carta">
      <div className="ord-carta-cabeza"><b>{T.choqueTitulo(sinNumero(c.destino))}</b> <span className="muted small">{T.choqueDice}</span></div>
      <Tema rel={c.rel} id={c.fileId} onPlay={onPlay}><Boton size="sm" variant="ghost" onClick={() => onDecidir(c.clave, { quedaId: c.fileId })}>{T.quedarme}</Boton></Tema>
      <Tema rel={c.con} id={c.conId} onPlay={onPlay}>{c.conId != null && <Boton size="sm" variant="ghost" onClick={() => onDecidir(c.clave, { quedaId: c.conId! })}>{T.quedarme}</Boton>}</Tema>
      <div className="row">
        <Boton size="sm" variant="ghost" onClick={() => onDecidir(c.clave, 'version')}>{T.losDos}</Boton>
        <Boton size="sm" variant="ghost" onClick={() => onDecidir(c.clave, 'dejar')}>{T.dejarAca}</Boton>
      </div>
    </div>
  )
}

function Quien({ c, onDecidir, onPlay }: { c: Extract<CartaRevision, { tipo: 'quien' }>; onDecidir: Decidir; onPlay: (id: number) => void }) {
  const [a, setA] = useState(c.sugerido?.artista ?? '')
  const [t, setT] = useState(c.sugerido?.titulo ?? '')
  return (
    <div className="ord-carta">
      <Tema rel={c.rel} id={c.fileId} onPlay={onPlay} />
      <div className="row ord-quien">
        <input value={a} onChange={(e) => setA(e.target.value)} placeholder={T.artista} aria-label={T.artista} />
        <input value={t} onChange={(e) => setT(e.target.value)} placeholder={T.titulo} aria-label={T.titulo} />
        <Boton size="sm" disabled={!a.trim() || !t.trim()} onClick={() => onDecidir(c.clave, { artista: a, titulo: t })}>{T.asiEsta}</Boton>
        <Boton size="sm" variant="ghost" onClick={() => onDecidir(c.clave, 'dejar')}>{T.dejarComoEsta}</Boton>
      </div>
    </div>
  )
}

/** Un tipo de pregunta, con su título y lo que hay que saber una sola vez (no en cada carta). */
function Tanda({ titulo, dice, accion, children }: { titulo: string; dice: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ord-tanda">
      <div className="ord-tanda-cabeza"><b>{titulo}</b> <span className="muted small">{dice}</span>{accion}</div>
      <div className="ord-cartas">{children}</div>
    </div>
  )
}

export function ParaDecidir({ cartas, onDecidir, onDecidirVarias, onPlay }: { cartas: CartaRevision[]; onDecidir: Decidir
  onDecidirVarias: (lista: [string, EleccionRevision][]) => void; onPlay: (id: number) => void }) {
  if (!cartas.length) return null
  const pares = cartas.filter((c): c is Extract<CartaRevision, { tipo: 'par' }> => c.tipo === 'par')
  const choques = cartas.filter((c): c is Extract<CartaRevision, { tipo: 'choque' }> => c.tipo === 'choque')
  const quienes = cartas.filter((c): c is Extract<CartaRevision, { tipo: 'quien' }> => c.tipo === 'quien')
  const conMejor = pares.filter((c) => c.keep != null)
  return (
    <section className="ord-decidir">
      <h3>{T.decidir(cartas.length)}</h3>
      <p className="muted small">{T.decidirDice}</p>
      {pares.length > 0 && (
        <Tanda titulo={T.paresTitulo(pares.length)} dice={T.paresDice}
          accion={conMejor.length > 1 && <Boton size="sm" variant="ghost" className="ord-empuja" onClick={() => onDecidirVarias(conMejor.map((c) => [c.clave, 'mejor']))}>{T.todosMejor(conMejor.length)}</Boton>}>
          {pares.map((c) => <Par key={c.clave} c={c} onDecidir={onDecidir} onPlay={onPlay} />)}
        </Tanda>
      )}
      {choques.length > 0 && <Tanda titulo={T.choquesTitulo(choques.length)} dice={T.choquesDice}>{choques.map((c) => <Choque key={c.clave} c={c} onDecidir={onDecidir} onPlay={onPlay} />)}</Tanda>}
      {quienes.length > 0 && <Tanda titulo={T.quienesTitulo(quienes.length)} dice={T.quienDice}>{quienes.map((c) => <Quien key={c.clave} c={c} onDecidir={onDecidir} onPlay={onPlay} />)}</Tanda>}
    </section>
  )
}
