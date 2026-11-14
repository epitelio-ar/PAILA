// Playlists en la interfaz: el árbol, la playlist abierta y sus temas (las inteligentes se recalculan solas).
import { useEffect, useState } from 'react'
import type { PlaylistNode } from '@paila/shared/types'
import { toast } from '../toast'
import { tr, cant } from '@paila/shared/idioma'

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** `version`: cuando se recargan los temas (escaneo, análisis), los de la playlist abierta se vuelven a pedir. */
export function usePlaylists(version: number) {
  const [plNodes, setPlNodes] = useState<PlaylistNode[]>([])
  const [activePl, setActivePl] = useState<number | null>(null)
  const [plIds, setPlIds] = useState<number[]>([])

  useEffect(() => { window.paila.playlists().then(setPlNodes) }, [])
  // Los temas de la playlist elegida (las inteligentes se recalculan cuando cambian las reglas o el análisis).
  useEffect(() => {
    if (activePl == null) { setPlIds([]); return }
    let alive = true
    window.paila.playlistTracks(activePl).then((x) => { if (alive) setPlIds(x) })
    return () => { alive = false }
  }, [activePl, plNodes, version])

  // avisa a las pantallas que muestran playlists por su cuenta (la lista «Faltan o suenan mal») que hay que volver a leerlas
  const reloadPlaylists = async () => { setPlNodes(await window.paila.playlists()); window.dispatchEvent(new Event('paila:playlists')) }
  const addToPlaylist = async (plId: number, ids: number[]) => {
    const n = await window.paila.addToPlaylist(plId, ids)
    setPlNodes(await window.paila.playlists())
    const name = plNodes.find((p) => p.id === plId)?.name
    toast(tr({
      es: `Se agregaron ${cant(n, 'tema', 'temas')} a "${name}"${n < ids.length ? ` (${ids.length - n} ya estaban)` : ''}.`,
      en: `${cant(n, 'track', 'tracks')} added to "${name}"${n < ids.length ? ` (${ids.length - n} already there)` : ''}.`,
    }), 'ok')
  }
  /** Corre un cambio de playlists y muestra el árbol nuevo (o el error). */
  const plAction = async (fn: () => Promise<PlaylistNode[]>) => { try { setPlNodes(await fn()) } catch (e) { toast(errorText(e), 'error') } }
  const activeNode = plNodes.find((n) => n.id === activePl) ?? null

  return { plNodes, setPlNodes, activePl, setActivePl, plIds, setPlIds, activeNode, reloadPlaylists, addToPlaylist, plAction }
}
