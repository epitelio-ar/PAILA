// Modo avanzado: el registro de operaciones. Lo que PAILA hizo sobre archivos (el Historial) y lo que anotó en su diario antes de
// tocarlos (incluso lo que quedó a medias), más los últimos errores sin datos personales. Solo mira; deshacer está en el Historial.
import { useEffect, useState } from 'react'
import type { OpLogEntry } from '@paila/shared/types'
import { Boton, Caja, Cabecera, Info, Pildora } from '@paila/diseno'
import { textos, fechaHora, cant } from '@paila/shared/idioma'

const T = textos({
  titulo: { es: 'Registro de operaciones', en: 'Operations log' },
  info: { es: 'Cada vez que PAILA va a mover o escribir un archivo, lo anota en su diario antes de hacerlo (así, si se corta la luz, sabe cómo volver atrás). Acá ves ese diario y el Historial juntos.', en: 'Every time PAILA is about to move or write a file, it notes it in its journal first (so, if the power goes out, it knows how to go back). Here you see that journal and the History together.' },
  sub: { es: 'Lo que PAILA hizo sobre tus archivos, del más nuevo al más viejo.', en: 'What PAILA did to your files, from newest to oldest.' },
  actualizar: { es: 'Actualizar', en: 'Refresh' },
  todo: { es: 'Todo', en: 'All' },
  diario: { es: 'Diario', en: 'Journal' },
  historial: { es: 'Historial', en: 'History' },
  infoFiltro: { es: 'Diario: lo que se anota antes de tocar un archivo (una fila por archivo). Historial: lo que ya terminó, por tanda, con deshacer.', en: 'Journal: what is noted before touching a file (one row per file). History: what has already finished, by batch, with undo.' },
  nada: { es: 'PAILA todavía no hizo nada sobre tus archivos.', en: "PAILA hasn't done anything to your files yet." },
  cuando: { es: 'Cuándo', en: 'When' },
  que: { es: 'Qué', en: 'What' },
  estado: { es: 'Estado', en: 'State' },
  detalle: { es: 'Detalle', en: 'Detail' },
  diarioOp: { es: (op: string) => `diario · ${op}`, en: (op: string) => `journal · ${op}` },
  archivos: { es: (n: number) => ` (${cant(n, 'archivo', 'archivos')})`, en: (n: number) => ` (${cant(n, 'file', 'files')})` },
  ultimosErrores: { es: 'Últimos errores', en: 'Latest errors' },
  erroresInfo: { es: 'Los errores que PAILA anotó, ya sin rutas, nombres de temas ni datos personales (es lo mismo que se manda en «Exportar diagnóstico»).', en: 'The errors PAILA noted, with no paths, track names or personal data (it is the same as what is sent in "Export diagnostics").' },
  sinErrores: { es: 'Sin errores anotados.', en: 'No errors noted.' },
})

type Registro = { ops: OpLogEntry[]; errores: { at: string; where: string; msg: string }[] }
const cuando = (iso: string) => fechaHora(iso, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function RegistroOps() {
  const [r, setR] = useState<Registro | null>(null)
  const [solo, setSolo] = useState<'todo' | 'diario' | 'historial'>('todo')
  const cargar = () => window.paila.advOpLog().then(setR)
  useEffect(() => { void cargar() }, [])
  if (!r) return <div className="page"><div className="center"><div className="spinner" /></div></div>
  const ops = r.ops.filter((o) => solo === 'todo' || o.source === solo)

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} info={T.info}
        sub={T.sub} acciones={<Boton variant="ghost" size="sm" onClick={cargar}>{T.actualizar}</Boton>} />
      <div className="row">
        {(['todo', 'diario', 'historial'] as const).map((k) => <Boton key={k} variant="ghost" size="sm" selected={solo === k} onClick={() => setSolo(k)}>{k === 'todo' ? T.todo : k === 'diario' ? T.diario : T.historial}</Boton>)}
        <Info tip={T.infoFiltro} />
      </div>
      <Caja pad>
        {ops.length === 0 ? <span className="muted">{T.nada}</span> : (
          <table className="insp-tabla">
            <thead><tr><th>{T.cuando}</th><th>{T.que}</th><th>{T.estado}</th><th>{T.detalle}</th></tr></thead>
            <tbody>{ops.map((o) => (
              <tr key={`${o.source}${o.id}`}>
                <td className="num">{cuando(o.at)}</td>
                <td><Pildora>{o.source === 'diario' ? T.diarioOp(o.op) : o.op}</Pildora></td>
                <td>{o.state}</td>
                <td className="muted small">{o.detail}{o.source === 'historial' ? T.archivos(o.files) : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Caja>
      <Caja head={<><b>{T.ultimosErrores}</b><Info tip={T.erroresInfo} /></>} pad>
        {r.errores.length === 0 ? <span className="muted small">{T.sinErrores}</span> : <ul className="insp-items">{r.errores.map((e, i) => <li key={i}><span className="num muted small">{cuando(e.at)}</span> <b>{e.where}</b>: <span className="small">{e.msg.split('\n')[0]}</span></li>)}</ul>}
      </Caja>
    </div>
  )
}
