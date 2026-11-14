// El estado de la colección en la ventana (core/estado.ts): un solo pedido compartido por el Inicio, las pestañas y Organizar.
// Se vuelve a pedir cuando cambian los temas (`clave`: los números de la biblioteca), cuando se aplica o deshace algo, cuando el
// proceso principal avisa (terminaron los repetidos) y después de "Dejar como está". Nada se guarda en la ventana.
import { useEffect, useState } from 'react'
import type { EstadoColeccion, GrupoEstado } from '@paila/shared/types'
import { useAlCambiarCambios } from './useChanges'
import { ordenRecordado } from '../ordenUltimo'

let actual: EstadoColeccion | null = null
const avisar = new Set<() => void>()
let pidiendo = false, otraVez = false

/** Pide el estado de nuevo (si ya hay un pedido en camino, se repite al terminar: nunca dos a la vez). */
export function refrescarEstado() {
  if (pidiendo) { otraVez = true; return }
  pidiendo = true
  void window.paila.estado()
    // quien ordenó antes del 02/11 tenía la regla solo en esta ventana: pasa a la base una vez, para contar con la suya
    .then((e) => { const o = !e.reglaGuardada && ordenRecordado(); return o ? window.paila.estadoRegla(o) : e })
    .then((e) => { actual = e; for (const f of avisar) f() }, () => { /* sin estado: queda el último */ })
    .finally(() => { pidiendo = false; if (otraVez) { otraVez = false; refrescarEstado() } })
}

/** "Dejar como está" (o volver a contar) y el estado nuevo, para todos. */
export async function dejarComoEsta(grupo: GrupoEstado, ids: number[] | 'todos', si = true) {
  actual = await window.paila.dejarComoEsta(grupo, ids, si)
  for (const f of avisar) f()
}

export function useEstado(clave?: unknown): EstadoColeccion | null {
  const [e, setE] = useState(actual)
  useEffect(() => { const f = () => setE(actual); avisar.add(f); return () => { avisar.delete(f) } }, [])
  useEffect(() => window.paila.onEstado(refrescarEstado), [])
  useEffect(() => refrescarEstado(), [clave])
  useAlCambiarCambios(refrescarEstado)
  return e
}
