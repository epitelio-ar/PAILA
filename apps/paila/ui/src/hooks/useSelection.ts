// Selección en la tabla: un tema (panel de detalle) o varios con Ctrl y Mayús (edición en grupo).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '@paila/shared/types'
import type { TableRows } from './useBigTable'

/** `rows`: los temas en el orden en que se ven (Mayús elige un tramo de esa lista). */
export function useSelection(rows: TableRows) {
  const [selected, setSelected] = useState<number | null>(null)
  const [multi, setMulti] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const { ids } = rows

  const onSelect = useCallback((id: number, mod: { ctrl: boolean; shift: boolean }) => {
    if (mod.shift && anchor != null) {
      const a = ids.indexOf(anchor), b = ids.indexOf(id)
      if (a >= 0 && b >= 0) { setMulti(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1))); setSelected(id); return }
    }
    if (mod.ctrl) {
      const next = new Set(multi.size ? multi : selected != null ? [selected] : [])
      if (next.has(id)) next.delete(id); else next.add(id)
      setMulti(next); setSelected(id); setAnchor(id); return
    }
    setMulti(new Set()); setSelected(id); setAnchor(id)
  }, [anchor, multi, selected, ids])

  // Los elegidos que se ven, en el orden en que se ven en la tabla.
  const pickedIds = useMemo(() => (multi.size > 1 ? ids.filter((id) => multi.has(id)) : []), [multi, ids])
  // En una biblioteca grande pueden no estar todos todavía: se piden, y mientras tanto `picked` es null (cargando).
  const picked = useMemo<Track[] | null>(() => {
    const out: Track[] = []
    for (const id of pickedIds) { const t = rows.get(id); if (!t) return null; out.push(t) }
    return out
  }, [pickedIds, rows.tick])
  useEffect(() => { if (!picked) rows.need(pickedIds) }, [picked, pickedIds, rows])

  /** Lo que se arrastra desde la tabla: los elegidos si el tema es parte de ellos, si no ese solo. */
  const dragIds = (id: number) => (multi.has(id) && multi.size > 1 ? [...multi] : [id])

  return { selected, setSelected, multi, setMulti, onSelect, picked, pickedCount: pickedIds.length, dragIds }
}

/** El panel del tema sigue lo que suena si estaba mostrando lo que sonaba antes: tocar un tema de «lo que sigue» lo hacía sonar pero el panel se quedaba con el anterior (prueba de la persona 2, 1/11). Si elegiste otro tema a propósito, no se toca. */
export function useSigueLoQueSuena(playingId: number | null, selected: number | null, setSelected: (id: number) => void) {
  const sonaba = useRef<number | null>(null)
  useEffect(() => {
    if (playingId != null && sonaba.current != null && selected === sonaba.current) setSelected(playingId)
    sonaba.current = playingId
  }, [playingId]) // eslint-disable-line react-hooks/exhaustive-deps
}
