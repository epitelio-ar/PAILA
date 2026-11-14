// Qué muestra la tabla: colección, filtro de problema, búsqueda, playlist abierta y orden. Devuelve las filas a la vista:
// con una biblioteca chica las filtra y ordena acá; con una grande las pide al proceso principal (useBigTable).
import { useDeferredValue, useMemo, useState } from 'react'
import type { CollectionKind, Track } from '@paila/shared/types'
import { queryTracks, type TableQuery } from '@paila/shared/tableview'
import type { SortKey } from '../TrackTable'
import type { ProblemKey } from '../problems'
import { useBigTable, type TableRows } from './useBigTable'

const noop = () => {}

/** `lib`: lo que devuelve useLibrary. `plIds`: los temas de la playlist abierta, en orden (null = no hay playlist abierta). */
export function useTableView(lib: { tracks: Track[]; big: boolean; version: number }, plIds: number[] | null) {
  const [kind, setKind] = useState<CollectionKind | 'todo'>('musica')
  const [problem, setProblem] = useState<ProblemKey | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'artist', dir: 1 })
  const deferredQuery = useDeferredValue(query)
  const q: TableQuery = { kind, problem, query: lib.big ? query : deferredQuery, plIds, sort }

  // Biblioteca chica: todo acá, como siempre.
  const byId = useMemo(() => new Map(lib.tracks.map((t) => [t.id, t])), [lib.tracks])
  const visible = useMemo(() => (lib.big ? [] : queryTracks(lib.tracks, q).map((t) => t.id)),
    [lib.tracks, lib.big, kind, deferredQuery, sort, problem, plIds])
  const small = useMemo<TableRows>(() => ({ ids: visible, get: (id) => byId.get(id), need: noop, tick: 0, loading: false }), [visible, byId])

  // Biblioteca grande: el proceso principal filtra, ordena y manda solo lo que se ve.
  const big = useBigTable(lib.big, q, lib.version)

  return { kind, setKind, problem, setProblem, query, setQuery, sort, setSort, rows: lib.big ? big : small }
}
