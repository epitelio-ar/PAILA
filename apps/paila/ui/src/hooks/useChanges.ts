// Cambios pendientes en la interfaz: lo que está por escribirse, lo último que hizo PAILA (para deshacerlo) y armar cambios nuevos.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditableField, HistoryEntry, PendingChange } from '@paila/shared/types'

const CAMBIOS = 'paila:cambios'
/**
 * Cuando cambian los Cambios pendientes (se propuso, se aplicó, se descartó o se deshizo algo): para que una pantalla que propone
 * vuelva a pedir su lista. Antes, después de aplicar seguía ofreciendo "Proponer 2 cambios" con lo ya aplicado (el autor, 01/11).
 */
export function useAlCambiarCambios(f: () => void) {
  const ref = useRef(f); ref.current = f
  useEffect(() => { const h = () => ref.current(); window.addEventListener(CAMBIOS, h); return () => window.removeEventListener(CAMBIOS, h) }, [])
}

/** `afterApply`: lo que hay que recargar después de aplicar o deshacer (la tabla). */
export function useChanges(afterApply: () => Promise<void>) {
  const [pending, setPending] = useState<PendingChange[]>([])
  // lo último del Historial, de cualquier tipo (tags, papelera, carpetas, reemplazos…): el "Deshacer lo último" de arriba.
  // Antes era solo la última tanda de tags, y después de mandar mil duplicados a la papelera seguía ofreciendo deshacer una tapa de ayer.
  const [ultimo, setUltimo] = useState<HistoryEntry | null>(null)

  const loadChanges = useCallback(async () => {
    setPending(await window.paila.pendingChanges())
    setUltimo((await window.paila.history())[0] ?? null)
    // las pantallas que proponen se enteran (alCambiarCambios): lo propuesto, aplicado o descartado sale de su lista solo
    window.dispatchEvent(new Event(CAMBIOS))
  }, [])
  const stage = useCallback(async (ids: number[], field: EditableField, value: string | null) => { setPending(await window.paila.stageChange(ids, field, value)) }, [])
  /** Corre aplicar o deshacer y devuelve el resultado, o el mensaje de error en castellano. */
  const asResult = async <R,>(fn: () => Promise<R>): Promise<R | string> => {
    try { const r = await fn(); await Promise.all([loadChanges(), afterApply()]); return r } catch (e) { return (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }
  }

  useEffect(() => { loadChanges() }, [loadChanges])
  // lo que va a la papelera o vuelve de ella también es una tanda nueva del Historial (papelera.ts avisa con este evento)
  useEffect(() => { const f = () => { void loadChanges() }; window.addEventListener('paila:papelera', f); return () => window.removeEventListener('paila:papelera', f) }, [loadChanges])

  return { pending, setPending, ultimo, loadChanges, stage, asResult }
}
