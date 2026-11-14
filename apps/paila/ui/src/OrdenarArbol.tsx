// Ordenar, "Cómo va a quedar" (como en el boceto): dos árboles lado a lado, hoy y después, de los temas que cambian de lugar, con
// cuántos hay en cada carpeta. Se abren carpeta por carpeta. Lo destildado no se mueve y no entra.
import type { RevisionOrdenar } from '@paila/shared/types'
import { T } from './OrdenarGrupos.textos'
import { arbolDe, carpetasDe, type Nodo } from './arbolCarpetas'
import { n } from './format'

/** Hojas que se dibujan por carpeta: más que esto se cuenta y no se lista. */
const TOPE_HOJAS = 60

function Carpeta({ nodo, abierta }: { nodo: Nodo; abierta: boolean }) {
  return (
    <details open={abierta}>
      <summary>{nodo.nombre}<span className="ord-arbol-n">{n(nodo.temas)}</span></summary>
      {nodo.hijos.map((h) => <Carpeta key={h.nombre} nodo={h} abierta={false} />)}
      {nodo.hojas.slice(0, TOPE_HOJAS).map((f, i) => <div key={i} className="ord-hoja">{f}</div>)}
      {nodo.hojas.length > TOPE_HOJAS && <div className="ord-hoja muted">{T.yMas(nodo.hojas.length - TOPE_HOJAS)}</div>}
    </details>
  )
}

function Arbol({ titulo, cuenta, rutas }: { titulo: string; cuenta: string; rutas: string[] }) {
  const raiz = arbolDe(rutas)
  return (
    <div className="ord-arbol">
      <h3>{titulo}</h3>
      <div className="muted small">{cuenta}</div>
      {raiz.hijos.map((h) => <Carpeta key={h.nombre} nodo={h} abierta={raiz.hijos.length <= 3} />)}
      {raiz.hojas.map((f, i) => <div key={i} className="ord-hoja">{f}</div>)}
    </div>
  )
}

export function ComoQueda({ rev }: { rev: RevisionOrdenar }) {
  const mueven = rev.grupos.mov.filter((f) => f.on && f.despues)
  const hoy = mueven.map((f) => f.rel), despues = mueven.map((f) => f.despues!)
  const papelera = rev.grupos.rep.filter((f) => f.on).length
  return (
    <div className="ord-arboles">
      <Arbol titulo={T.hoy} cuenta={T.cuentaHoy(hoy.length, carpetasDe(hoy))} rutas={hoy} />
      <Arbol titulo={T.quedara} cuenta={T.cuentaQueda(despues.length, carpetasDe(despues), papelera)} rutas={despues} />
    </div>
  )
}
