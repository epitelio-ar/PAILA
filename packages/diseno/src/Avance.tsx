// Piezas para mostrar trabajo largo tema por tema (las estrenó NAPIA; sirven en las dos apps): cifra grande con su rótulo,
// fila con estado (ícono, nombre, píldora y barrita), paso numerado de un recorrido, carpeta (ruta) y zona para soltar archivos.
import { T } from './textos'
import { useState, type DragEvent, type ReactNode } from 'react'
import { Barra } from './Barra'
import { Icon, type IconName } from './Icono'
import { Info } from './Info'
import { Pildora, type TonoPildora } from './Nota'

/** Un número grande con lo que cuenta abajo ("12 · bajados"). El color dice la función, el texto siempre acompaña. */
export function Cifra({ valor, label, tone = 'neutro', info }: { valor: ReactNode; label: string; tone?: TonoPildora; info?: string }) {
  return <div className={`cifra cifra-${tone}`}><b className="num">{valor}</b><span>{label}{info && <Info tip={info} />}</span></div>
}

const ICONO: Record<TonoPildora, IconName> = { neutro: 'dot', acento: 'down', ok: 'check', info: 'info', atencion: 'alert', error: 'close' }

export interface FilaEstadoProps {
  tone: TonoPildora
  titulo: ReactNode
  sub?: ReactNode
  /** La palabra del estado ("Bajado", "Te falta"…), en una píldora. */
  estado: string
  /** 0–100 mientras avanza (se ve una barrita); null o sin valor: sin barrita. */
  avance?: number | null
  /** Ícono propio (por defecto, uno según el tono). */
  icono?: ReactNode
  /** Está en curso: el ícono gira. */
  activo?: boolean
}

/** Una fila de una lista larga con su estado: siempre con texto (el color nunca es lo único que dice algo). */
export function FilaEstado({ tone, titulo, sub, estado, avance, icono, activo, accion }: FilaEstadoProps & { /** Un botón chico antes del estado (NAPIA: «Ver en PAILA»). */ accion?: ReactNode }) {
  return (
    <div className={`fila-estado fe-${tone}${activo ? ' activo' : ''}`}>
      <span className="fe-icono" aria-hidden>{activo ? <i className="spinner mini" /> : icono ?? <Icon name={ICONO[tone]} size={14} />}</span>
      <span className="fe-texto"><span className="fe-titulo ellipsis">{titulo}</span>{sub && <span className="fe-sub ellipsis">{sub}</span>}</span>
      {avance != null && <Barra value={avance} className="fe-barra" />}
      {accion}
      <Pildora tone={tone}>{estado}</Pildora>
    </div>
  )
}

/** Un paso numerado de un recorrido (1. Qué · 2. Dónde · 3. Bajar). Hecho: el número pasa a un tilde. Apagado: todavía no toca. */
export function Paso({ n, titulo, info, hecho, apagado, acciones, children }: { n: number; titulo: ReactNode; info?: string; hecho?: boolean; apagado?: boolean; acciones?: ReactNode; children?: ReactNode }) {
  return (
    <section className={`paso${hecho ? ' hecho' : ''}${apagado ? ' apagado' : ''}`}>
      <header className="paso-cab"><span className="paso-n num">{hecho ? <Icon name="check" size={14} /> : n}</span><h3>{titulo}{info && <Info tip={info} />}</h3>{acciones && <div className="paso-acciones">{acciones}</div>}</header>
      {children && <div className="paso-cuerpo">{children}</div>}
    </section>
  )
}

/** Una carpeta o archivo: la ruta en letra fija (si es larga se corta por la izquierda, lo importante es el final) y sus botones. */
export function Ruta({ ruta, vacio = T.sinElegir, acciones }: { ruta: string | null; vacio?: string; acciones?: ReactNode }) {
  return (
    <div className="ruta">
      <span className="ruta-icono" aria-hidden><Icon name="folder" size={16} /></span>
      <span className={`ruta-texto${ruta ? '' : ' vacia'}`} title={ruta ?? undefined}><bdi>{ruta ?? vacio}</bdi></span>
      {acciones && <span className="ruta-acciones">{acciones}</span>}
    </div>
  )
}

/** Zona para soltar un archivo (o tocarla para elegirlo). Se marca cuando hay algo arriba. */
export function ZonaSoltar({ onSoltar, onElegir, children }: { onSoltar: (f: File) => void; onElegir?: () => void; children: ReactNode }) {
  const [encima, setEncima] = useState(false)
  const over = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setEncima(true) }
  return (
    <div className={`zona-soltar${encima ? ' encima' : ''}`} role={onElegir ? 'button' : undefined} tabIndex={onElegir ? 0 : undefined}
      onClick={onElegir} onKeyDown={(e) => { if (onElegir && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onElegir() } }}
      onDragOver={over} onDragEnter={over} onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setEncima(false); const f = e.dataTransfer.files[0]; if (f) onSoltar(f) }}>
      {children}
    </div>
  )
}
