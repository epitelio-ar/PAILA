// Gráficos compartidos: barras horizontales (rankings), columnas (cosas en orden, como las décadas) y anillo (partes de un total).
// Todos usan los colores del diseño (la paleta de notas, las series o el acento), muestran los números como texto y llevan su
// descripción para quien no los ve. Nunca el color es lo único que dice algo.

export interface Dato { label: string; valor: number; /** Texto de ayuda al pasar el mouse. */ detalle?: string; /** Un color CSS (por ejemplo 'var(--nota-b)'). Sin color: el acento. */ color?: string }

/** Colores para cosas que no tienen orden (formatos, géneros): una serie de 8 que se reparte pareja. */
export const SERIE = ['var(--serie-1)', 'var(--serie-2)', 'var(--serie-3)', 'var(--serie-4)', 'var(--serie-5)', 'var(--serie-6)', 'var(--serie-7)', 'var(--serie-8)']
export const colorSerie = (i: number) => SERIE[i % SERIE.length]

/** El color de cada nota de calidad ('A+' → var(--nota-ap)). */
export const colorNota = (g: string) => `var(--nota-${g.replace('+', 'p').toLowerCase()})`

type Formato = (v: number) => string
const num: Formato = (v) => numero(v)
const describe = (titulo: string, datos: Dato[], formato: Formato) => `${titulo}: ${datos.map((d) => `${d.label} ${formato(d.valor)}`).join(', ')}`

/** Barras horizontales: una fila por dato, con el nombre, la barra y el número. El ancho es contra el mayor (o contra `total`). */
export function BarrasH({ datos, total, formato = num, titulo }: { datos: Dato[]; total?: number; formato?: Formato; titulo: string }) {
  const max = total ?? Math.max(1, ...datos.map((d) => d.valor))
  return (
    <div className="grafico barras-h" role="img" aria-label={describe(titulo, datos, formato)}>
      {datos.map((d) => (
        <div key={d.label} className="bh-fila" title={d.detalle}>
          <span className="bh-nombre">{d.label}</span>
          <span className="bh-pista"><i style={{ width: `${Math.max(1, (d.valor * 100) / max)}%`, background: d.color ?? 'var(--acento)' }} /></span>
          <span className="bh-valor num">{formato(d.valor)}</span>
        </div>
      ))}
    </div>
  )
}

/** Desde esta cantidad de puntos las columnas no entran (se ven los números encimados): se dibuja una línea en su lugar. */
export const MAX_COLUMNAS = 32

/** Columnas verticales, en el orden dado (décadas, años). Con muchos datos (más de MAX_COLUMNAS) pasa sola a una línea. */
export function Columnas({ datos, alto = 140, formato = num, titulo }: { datos: Dato[]; alto?: number; formato?: Formato; titulo: string }) {
  if (datos.length > MAX_COLUMNAS) return <Linea datos={datos} alto={alto} formato={formato} titulo={titulo} />
  const max = Math.max(1, ...datos.map((d) => d.valor))
  return (
    <div className="grafico columnas" role="img" aria-label={describe(titulo, datos, formato)}>
      <div className="col-area" style={{ height: alto }}>
        {datos.map((d) => (
          <div key={d.label} className="col-barra" title={d.detalle ?? `${d.label}: ${formato(d.valor)}`}>
            <span className="col-valor num">{formato(d.valor)}</span>
            <i style={{ height: `${Math.max(1, (d.valor * 100) / max)}%`, background: d.color ?? 'var(--acento)' }} />
          </div>
        ))}
      </div>
      <div className="col-nombres">{datos.map((d) => <span key={d.label}>{d.label}</span>)}</div>
    </div>
  )
}

/** Línea con área, para muchos puntos en orden (la curva de energía de un set de 180 temas). Muestra el mayor y el menor, y cada punto se explica al pasar el mouse. */
export function Linea({ datos, alto = 120, formato = num, titulo }: { datos: Dato[]; alto?: number; formato?: Formato; titulo: string }) {
  const W = 600, n = datos.length
  const max = Math.max(1, ...datos.map((d) => d.valor)), min = Math.min(0, ...datos.map((d) => d.valor))
  const x = (i: number) => (n <= 1 ? W / 2 : (i * W) / (n - 1))
  const y = (v: number) => alto - 4 - ((v - min) / (max - min || 1)) * (alto - 12)
  const linea = datos.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.valor).toFixed(1)}`).join(' ')
  const paso = W / Math.max(1, n)
  return (
    <div className="grafico linea" role="img" aria-label={describe(titulo, datos, formato)}>
      <div className="lin-eje num"><span>{formato(max)}</span><span>{formato(min)}</span></div>
      <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" style={{ height: alto }}>
        <path d={`${linea} L${x(n - 1).toFixed(1)} ${alto} L${x(0).toFixed(1)} ${alto} Z`} fill="var(--acento-suave)" />
        <path d={linea} fill="none" stroke="var(--acento)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {datos.map((d, i) => <rect key={i} x={x(i) - paso / 2} y={0} width={paso} height={alto} fill="transparent"><title>{d.detalle ?? `${d.label}: ${formato(d.valor)}`}</title></rect>)}
      </svg>
      <div className="lin-pie"><span>{datos[0]?.label}</span><span>{datos[n - 1]?.label}</span></div>
    </div>
  )
}

/** Anillo: partes de un total. `centro` es lo que se lee adentro (un porcentaje, por ejemplo). Con la leyenda al lado. */
export function Anillo({ datos, centro, tam = 150, formato = num, titulo }: { datos: Dato[]; centro?: string; tam?: number; formato?: Formato; titulo: string }) {
  const total = datos.reduce((s, d) => s + d.valor, 0)
  const r = 48, c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="grafico anillo" role="img" aria-label={describe(titulo, datos, formato)}>
      <div className="anillo-dibujo" style={{ width: tam, height: tam }}>
        <svg viewBox="0 0 140 140" width={tam} height={tam}>
          <circle cx="70" cy="70" r={r} fill="none" stroke="var(--superficie-3)" strokeWidth="22" />
          {total > 0 && datos.filter((d) => d.valor > 0).map((d) => {
            const len = (d.valor / total) * c
            const el = <circle key={d.label} cx="70" cy="70" r={r} fill="none" stroke={d.color ?? 'var(--acento)'} strokeWidth="22" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)"><title>{d.detalle ?? `${d.label}: ${formato(d.valor)}`}</title></circle>
            acc += len
            return el
          })}
        </svg>
        {centro && <div className="anillo-centro num">{centro}</div>}
      </div>
      <div className="anillo-leyenda">
        {datos.map((d) => <span key={d.label} title={d.detalle}><i style={{ background: d.color ?? 'var(--acento)' }} />{d.label} <b className="num">{formato(d.valor)}</b></span>)}
      </div>
    </div>
  )
}
import { num as numero } from '@paila/shared/idioma'
