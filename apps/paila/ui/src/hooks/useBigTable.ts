// Tabla de una biblioteca grande (BIG_LIBRARY temas o más): pide al proceso principal el orden de los ids a la vista y,
// aparte, solo las filas que se ven (con una memoria de las ya pedidas). Ver core/tableindex.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { TRACK_FIELDS, type Track } from '@paila/shared/types'
import type { TableQuery } from '@paila/shared/tableview'

/** Lo que la tabla necesita para dibujar filas, venga de la lista completa (biblioteca chica) o del proceso principal. */
export interface TableRows {
  /** Los ids a la vista, en orden. */
  ids: number[]
  /** El tema, si ya está (en una biblioteca grande puede estar todavía en camino). */
  get(id: number): Track | undefined
  /** Pide los temas que falten (biblioteca grande; `first` = desde qué posición se está viendo); en una chica no hace nada. */
  need(ids: number[], first?: number): void
  /** Cambia cuando llegan filas nuevas o se recargan los datos (para volver a dibujar y volver a pedir). */
  tick: number
  /** true mientras el orden de una biblioteca grande está en camino. */
  loading: boolean
}

export const toTrack = (r: unknown[]) => Object.fromEntries(TRACK_FIELDS.map((f, i) => [f, r[i]])) as Track

/** `version`: sube cada vez que se recargan los datos (escaneo, análisis, tags…): lo ya pedido se vuelve a pedir. */
export function useBigTable(enabled: boolean, query: TableQuery, version: number): TableRows {
  const [ids, setIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  // id → tema y de qué carga es (t = undefined: el tema ya no existe; no se vuelve a pedir hasta la próxima carga)
  const cache = useRef(new Map<number, { t?: Track; v: number }>())
  const wanted = useRef(new Set<number>())
  const inflight = useRef(new Set<number>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ver = useRef(version)
  ver.current = version
  const first = useRef(0)

  const key = JSON.stringify(query)
  const wait = query.query ? 150 : 0
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setLoading(true)
    // mientras se escribe en la búsqueda, se espera un poquito para no pedir una vez por letra
    const t = setTimeout(() => {
      const v = ver.current
      window.paila.tableQuery(JSON.parse(key) as TableQuery, first.current).then((r) => {
        if (!alive) return
        // las filas que se ven llegan junto con el orden: la tabla cambia de una vez, sin filas vacías
        for (const row of r.rows) { const t = toTrack(row); cache.current.set(t.id, { t, v }) }
        setIds(r.ids); setLoading(false)
      }, () => { if (alive) setLoading(false) })
    }, wait)
    return () => { alive = false; clearTimeout(t) }
  }, [enabled, key, wait, version])
  // datos nuevos: lo que se ve se vuelve a pedir
  useEffect(() => { setTick((x) => x + 1) }, [version])

  const need = useCallback((list: number[], from?: number) => {
    if (from != null) first.current = from
    for (const id of list) {
      const c = cache.current.get(id)
      if ((!c || c.v !== ver.current) && !inflight.current.has(id)) wanted.current.add(id)
    }
    if (!wanted.current.size || timer.current) return
    timer.current = setTimeout(async () => {
      timer.current = null
      const batch = [...wanted.current]
      wanted.current.clear()
      const v = ver.current
      for (const id of batch) inflight.current.add(id)
      try {
        const got = new Set<number>()
        for (const r of await window.paila.tableRows(batch)) { const t = toTrack(r); got.add(t.id); cache.current.set(t.id, { t, v }) }
        for (const id of batch) if (!got.has(id)) cache.current.set(id, { v })
      } catch {
        // falló (por ejemplo, se estaba recargando): se queda con lo que tenía hasta la próxima carga, sin pedir en bucle
        for (const id of batch) cache.current.set(id, { t: cache.current.get(id)?.t, v })
      } finally {
        for (const id of batch) inflight.current.delete(id)
      }
      setTick((x) => x + 1)
    }, 16)
  }, [])

  const get = useCallback((id: number) => cache.current.get(id)?.t, [])
  return { ids: enabled ? ids : [], get, need, tick, loading: enabled && loading }
}
