// Cabecera de una sección o de una pantalla: título con su ⓘ, una frase que dice para qué sirve y, a la derecha, las acciones.
// En una pantalla (nivel 2) el texto largo va en "Cómo funciona", que se abre y se cierra (y recuerda cómo lo dejaste).
import { T } from './textos'
import { useState, type ReactNode } from 'react'
import { Info } from './Info'
import { Icon } from './Icono'

const leer = (k: string) => { try { return localStorage.getItem(k) === '1' } catch { return false } }

export function Cabecera({ titulo, info, sub, ayuda, acciones, nivel = 3 }: {
  titulo: ReactNode; info?: string
  /** Una frase (un renglón) que dice para qué sirve. */
  sub?: ReactNode
  /** El texto largo de la pantalla: queda plegado detrás de "Cómo funciona". */
  ayuda?: ReactNode
  acciones?: ReactNode; nivel?: 2 | 3 | 4
}) {
  const H = `h${nivel}` as 'h2' | 'h3' | 'h4'
  const clave = `paila.ayuda.${typeof titulo === 'string' ? titulo : 'pantalla'}`
  const [abierta, setAbierta] = useState(() => leer(clave))
  const alternar = () => setAbierta((a) => { try { localStorage.setItem(clave, a ? '0' : '1') } catch { /* sin almacenamiento */ } return !a })
  return (
    <>
      <div className={`cabecera cabecera-${nivel}`}>
        <H>{titulo}{info && <Info tip={info} />}</H>
        {(acciones || ayuda) && (
          <div className="cabecera-acciones">
            {ayuda && <button className="ayuda-btn" aria-expanded={abierta} onClick={alternar}><Icon name="info" size={14} /> {T.comoFunciona}</button>}
            {acciones}
          </div>
        )}
      </div>
      {sub && <p className="cabecera-sub muted">{sub}</p>}
      {ayuda && abierta && <div className="cabecera-ayuda muted">{ayuda}</div>}
    </>
  )
}
