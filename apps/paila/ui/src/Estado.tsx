// La tarjeta del Inicio con el estado de la colección (MASTERPLAN-5, 2.3 y etapa 1): cómo está tu música, contado de la música
// (no de marcas), con un solo botón para lo que sigue. "Ver cuáles" abre los temas de cada parte y deja marcar "Dejar como está".
// Qué dice cada renglón: Estado.lista.ts. Reemplaza a los "Primeros pasos" (02/11).
import { useState } from 'react'
import { Boton, Caja, Info } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import type { EstadoColeccion, GrupoEstado } from '@paila/shared/types'
import { Icon } from './icons'
import type { PageKey } from './nav'
import { renglones, siguiente, type Renglon } from './Estado.lista'
import { dejarComoEsta } from './hooks/useEstado'

const T = textos({
  titulo: { es: 'Cómo está tu colección', en: 'How your collection is doing' },
  sub: { es: 'Contado de tu música: si deshacés algo, el número vuelve. Hecho es 0.', en: 'Counted from your music: if you undo something, the number comes back. Done means 0.' },
  seguir: { es: (x: string) => `Seguir: ${x}`, en: (x: string) => `Next: ${x}` },
  alDia: { es: 'Está todo al día.', en: 'Everything is up to date.' },
  verCuales: { es: 'Ver cuáles', en: 'See which' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  dejar: { es: 'Dejar como está', en: 'Leave as it is' },
  dejarTip: {
    es: 'Este no se toca: deja de contar y no vuelve a aparecer acá. Queda guardado en PAILA (viaja con "Pasar a otra compu") y se puede volver a contar.',
    en: 'This one stays untouched: it stops counting and won\'t show up here again. It is saved in PAILA (it travels with "Move to another computer") and you can count it again.',
  },
  volver: { es: 'Volver a contar los dejados', en: 'Count the ones left again' },
  hayMas: { es: (k: number) => `y ${k} más`, en: (k: number) => `and ${k} more` },
})

/** Los temas de una parte, con "Dejar como está" en cada uno. */
function Cuales({ e, grupo }: { e: EstadoColeccion; grupo: GrupoEstado }) {
  const c = e.grupos[grupo]
  const [ocupado, setOcupado] = useState(false)
  const dejar = async (ids: number[] | 'todos', si = true) => { setOcupado(true); try { await dejarComoEsta(grupo, ids, si) } finally { setOcupado(false) } }
  return (
    <div className="estado-cuales">
      <ul>
        {c.filas.map((f) => (
          <li key={f.ids.join()}>
            <span className="estado-cual" title={f.detalle}>{f.texto}{f.detalle && <span className="muted small"> · {f.detalle}</span>}</span>
            <Boton size="sm" variant="ghost" disabled={ocupado} title={T.dejarTip} onClick={() => dejar(f.ids)}>{T.dejar}</Boton>
          </li>
        ))}
      </ul>
      {(c.n ?? 0) > c.filas.length && <p className="muted small">{T.hayMas((c.n ?? 0) - c.filas.length)}</p>}
      {c.dejados > 0 && <button className="link small" disabled={ocupado} onClick={() => dejar('todos', false)}>{T.volver}</button>}
    </div>
  )
}

export default function Estado({ e, onGo }: { e: EstadoColeccion; onGo: (p: PageKey) => void }) {
  const [abierto, setAbierto] = useState<GrupoEstado | null>(null)
  const lista = renglones(e)
  const sig = siguiente(lista)
  const fila = (r: Renglon) => (
    <li key={r.clave} className={`${r.como === 'hecho' ? 'hecho' : ''}${r === sig ? ' toca' : ''}`}>
      <button className="pasos-fila" onClick={() => onGo(r.page)}>
        <span className="pasos-n num">{r.como === 'hecho' ? <Icon name="check" size={13} /> : r.como === 'espera' ? '…' : '•'}</span>
        <b>{r.titulo}</b><span className="muted small">{r.texto}</span>
      </button>
      {r.lista && r.clave !== 'escuchar' && (
        <button className="link small" onClick={() => setAbierto(abierto === r.clave ? null : r.clave as GrupoEstado)}>{abierto === r.clave ? T.ocultar : T.verCuales}</button>
      )}
    </li>
  )
  return (
    <Caja className="pasos estado" head={<span className="rotulo">{T.titulo} <Info tip={T.sub} /></span>}>
      <ul className="pasos-lista">
        {lista.map((r) => [fila(r), abierto === r.clave && <li key={`${r.clave}-cuales`} className="estado-abierto"><Cuales e={e} grupo={abierto} /></li>])}
      </ul>
      <div className="estado-pie">
        {sig ? <Boton onClick={() => onGo(sig.page)}>{T.seguir(sig.titulo)}</Boton> : <span className="muted">{T.alDia}</span>}
      </div>
    </Caja>
  )
}
