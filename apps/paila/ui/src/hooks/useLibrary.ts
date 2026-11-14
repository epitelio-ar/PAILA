// Estado general de la biblioteca en la interfaz: carpetas, escaneo/análisis en curso y los temas para la tabla. Con una
// biblioteca grande (BIG_LIBRARY temas o más) los temas quedan en el proceso principal: acá solo llegan los números.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, ScanStatus, Track } from '@paila/shared/types'
import { libraryStats, type LibraryStats } from '@paila/shared/tableview'
import { toTrack } from './useBigTable'
import { marcaArranque, marcasArranque } from '../arranque'

type Temas = Awaited<ReturnType<typeof window.paila.getTracks>>
let adelantados: { estado: Promise<AppState>; temas: Promise<Temas> } | null = null
/** Al abrir, el estado y los temas se piden juntos y antes de que React arme la pantalla (main.tsx): no esperan en fila. */
export function adelantarPedidos() { adelantados = { estado: window.paila.getState(), temas: window.paila.getTracks() } }
const tomar = <K extends 'estado' | 'temas'>(k: K) => { const p = adelantados?.[k]; if (adelantados) adelantados[k] = null as never; return p ?? null }

export function useLibrary() {
  const [state, setState] = useState<AppState | null>(null)
  const [scan, setScan] = useState<ScanStatus | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [bigStats, setBigStats] = useState<LibraryStats | null>(null)
  /** Sube cada vez que se recargan los temas (la tabla grande vuelve a pedir lo que muestra). */
  const [version, setVersion] = useState(0)
  const isBig = useRef(false)

  const loadTracks = useCallback(async () => {
    const r = await (tomar('temas') ?? window.paila.getTracks())
    marcaArranque('temas')
    isBig.current = !r.rows
    if (r.rows) { setTracks(r.rows.map(toTrack)); setBigStats(null) } else { setTracks([]); setBigStats(r.big.stats) }
    setVersion((v) => v + 1)
  }, [])

  const refresh = useCallback(async () => {
    const s = await (tomar('estado') ?? window.paila.getState())
    marcaArranque('estado')
    setState(s); setScan(s.scan)
    await loadTracks()
  }, [loadTracks])

  // un disco que se desconecta o vuelve: el puntito de la barra lateral cambia en el momento (core/rootswatch.ts)
  useEffect(() => window.paila.onRoots((roots) => setState((s) => (s ? { ...s, roots } : s))), [])

  useEffect(() => {
    refresh()
    let wasRunning = false
    let lastLoad = 0
    return window.paila.onScanStatus((s) => {
      setScan(s)
      // Mientras escanea o analiza, la tabla se actualiza cada tanto; al terminar, una última vez. Con una biblioteca grande,
      // cada 30 s (cada recarga vuelve a leer todos los temas en el proceso principal).
      const every = isBig.current ? 30_000 : s.job === 'analysis' ? 6000 : 4000
      if ((s.running && Date.now() - lastLoad > every) || (wasRunning && !s.running)) { lastLoad = Date.now(); loadTracks() }
      if (wasRunning && !s.running) window.paila.getState().then(setState)
      wasRunning = s.running
    })
  }, [refresh, loadTracks])

  // la primera vez que los temas están en pantalla: cuánto tardó en abrir PAILA (Exportar diagnóstico, scripts/arranque.ts)
  useEffect(() => { if (version === 1) window.paila.uiLista(marcasArranque) }, [version])

  /** Los números de la barra lateral, la de abajo e Inicio (en una biblioteca grande los calcula el proceso principal). */
  const stats = useMemo(() => bigStats ?? libraryStats(tracks), [tracks, bigStats])

  /** Un tema por id, esté o no a la vista (en una biblioteca grande se pide al proceso principal). */
  const trackById = useCallback(async (id: number): Promise<Track | null> => {
    if (!bigStats) return tracks.find((t) => t.id === id) ?? null
    const [r] = await window.paila.tableRows([id])
    return r ? toTrack(r) : null
  }, [tracks, bigStats])

  return { state, scan, tracks, big: bigStats != null, stats, counts: stats.counts, version, loadTracks, refresh, trackById }
}
