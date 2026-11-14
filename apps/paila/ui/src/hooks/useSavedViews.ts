// Vistas guardadas de la tabla (core/views.ts): la lista, guardar la vista de ahora con un nombre, volver a una (filtros, orden y
// columnas) y cuál es la que se está viendo, para marcarla en la barra lateral.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CollectionKind, SavedView } from '@paila/shared/types'
import type { SortKey } from '@paila/shared/trackinfo'
import type { ProblemKey } from '../problems'
import { COLUMNS } from '../TrackTable'

export interface TableState {
  kind: CollectionKind | 'todo'; setKind: (k: CollectionKind | 'todo') => void
  problem: ProblemKey | null; setProblem: (p: ProblemKey | null) => void
  query: string; setQuery: (q: string) => void
  sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void
}

/** Las columnas en el orden de la tabla (así se guardan y se comparan). */
const ordered = (shown: Set<SortKey>) => COLUMNS.map((c) => c.key).filter((k) => shown.has(k))

/** `open`: lo que hace falta para ver la tabla al volver a una vista (cerrar la playlist abierta e ir a la biblioteca). */
export function useSavedViews(t: TableState, cols: { shown: Set<SortKey>; setAll: (k: SortKey[] | null) => void }, open: () => void, inPlaylist: boolean) {
  const [views, setViews] = useState<SavedView[]>([])
  useEffect(() => { window.paila.views().then(setViews).catch(() => setViews([])) }, [])

  const save = useCallback(async (name: string) => {
    const all = await window.paila.saveView({ name, kind: t.kind, problem: t.problem, query: t.query, sort: t.sort.key === 'order' ? { key: 'artist', dir: 1 } : t.sort, columns: ordered(cols.shown) })
    setViews(all)
    return all.find((v) => v.name.toLowerCase() === name.trim().toLowerCase()) ?? null
  }, [t.kind, t.problem, t.query, t.sort, cols.shown])

  const apply = useCallback((v: SavedView) => {
    open()
    t.setKind(v.kind); t.setProblem(v.problem as ProblemKey | null); t.setQuery(v.query); t.setSort(v.sort as { key: SortKey; dir: 1 | -1 })
    if (v.columns) cols.setAll(v.columns as SortKey[])
  }, [open, t, cols])

  const remove = useCallback(async (id: string) => setViews(await window.paila.removeView(id)), [])
  const rename = useCallback(async (id: string, name: string) => setViews(await window.paila.renameView(id, name)), [])

  // la vista que coincide con lo que se ve ahora (si hay)
  const colKey = ordered(cols.shown).join(',')
  const active = useMemo(() => (inPlaylist ? null : views.find((v) => v.kind === t.kind && (v.problem ?? null) === t.problem && v.query === t.query.trim()
    && v.sort.key === t.sort.key && v.sort.dir === t.sort.dir && (!v.columns || v.columns.join(',') === colKey))?.id ?? null),
  [views, t.kind, t.problem, t.query, t.sort, colKey, inPlaylist])

  return { views, save, apply, remove, rename, active }
}
