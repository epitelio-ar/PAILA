// La oreja-termómetro del Inicio como barra: cuánta cera tiene la Música (100 − limpieza: menos es mejor) y en cuál de los
// cinco niveles queda. Cinco escalones iguales que la cera va desbloqueando: los pasados, llenos; el actual, hasta donde da el
// número; los que faltan, vacíos (elegido en docs/archivo/pruebas/termometro). La lógica de los niveles es la de
// @paila/shared/oreja: acá solo se muestra.
import { Info } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { n } from './format'
import { TRAMOS, tramoDe } from './tramos'

const T = textos({
  cera: { es: 'Cera', en: 'Wax' },
  tope: {
    es: (nivel: string, num: string, unTema: boolean) => `Queda en «${nivel}» aunque el número dé «${num}»: ${unTema ? 'todavía hay temas con nota D o F' : 'muchos de tus temas tienen nota F'}.`,
    en: (nivel: string, num: string, unTema: boolean) => `It stays at "${nivel}" even though the number says "${num}": ${unTema ? 'there are still tracks graded D or F' : 'many of your tracks are graded F'}.`,
  },
  tip: {
    es: (a: string, analizando: boolean) => `Cuánta cera tiene tu Música, de 0 a 100: 0 = todo en A. Cada tema suma según su nota: B un poco, C más, D bastante, F mucho. Arreglando lo del Centro de problemas (sobre todo, consiguiendo mejores versiones de los D y F) la cera baja. Cuentan los ${a} temas de Música ya analizados.${analizando ? ' El análisis sigue: se va actualizando.' : ''}`,
    en: (a: string, analizando: boolean) => `How much wax your Music has, from 0 to 100: 0 = everything is an A. Each track adds according to its grade: B a little, C more, D quite a bit, F a lot. Fixing what's in the Problem center (above all, getting better versions of the D and F tracks) brings the wax down. It counts the ${a} Music tracks already analyzed.${analizando ? ' Analysis is still running: it keeps updating.' : ''}`,
  },
  aria: { es: (c: number, nivel: string) => `Cera ${c} %: nivel ${nivel}`, en: (c: number, nivel: string) => `Wax ${c}%: level ${nivel}` },
  leyenda: { es: 'Cera: cuánto pesa lo de mala calidad en tu Música. 0 % es todo en A; A+ es la mejor nota y F la peor.', en: 'Wax: how much poor-quality music weighs on your Music. 0% is all A; A+ is the best grade and F the worst.' },
  tramo: { es: (nombre: string, d: number, h: number) => `${nombre}: de ${d} a ${h} % de cera`, en: (nombre: string, d: number, h: number) => `${nombre}: ${d} to ${h}% wax` },
})

export default function Termometro({ limpieza, nivel, analizados, analizando }: { limpieza: number; nivel: number; analizados: number; analizando: boolean }) {
  const cera = 100 - limpieza
  // el escalón donde cae el número; el nivel puede quedar más arriba por los topes de oreja() (muchos F, o D y F con nota alta)
  const zona = tramoDe(cera)
  const t = TRAMOS[zona]
  const dentro = t.hasta > t.desde ? (cera - t.desde) / (t.hasta - t.desde) : 1
  const punta = ((zona + dentro) / TRAMOS.length) * 100
  const tope = nivel > zona ? T.tope(TRAMOS[nivel].nombre, t.nombre, nivel === 1) : null
  return (
    <div className="termometro">
      <div className="t-dato">
        <span>{T.cera}</span> <b className="num">{cera}</b><span className="t-por">%</span>
        <Info tip={T.tip(n(analizados), analizando)} />
      </div>
      <p className="t-leyenda muted small">{T.leyenda}</p>
      <div className="t-barra" role="img" aria-label={T.aria(cera, TRAMOS[nivel].nombre)}>
        {TRAMOS.map((x, i) => (
          <i key={x.nombre} className="t-tramo" title={T.tramo(x.nombre, x.desde, x.hasta)}>
            <i className="t-lleno" style={{ width: i < zona ? '100%' : i === zona ? `${dentro * 100}%` : 0 }} />
          </i>
        ))}
        <i className="t-punta" style={{ left: `${punta}%` }} />
      </div>
      <div className="t-marcas">
        {TRAMOS.map((x, i) => <span key={x.nombre} className={i === nivel ? 'on' : i < nivel ? 'pasado' : ''}>{x.nombre}</span>)}
      </div>
      {tope && <p className="t-tope">{tope}</p>}
    </div>
  )
}
