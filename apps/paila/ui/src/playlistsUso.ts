// Qué playlists se ven en la barra lateral: las fijadas y, después, las últimas que se usaron (abiertas o con temas soltados).
// Con 66 playlists la lista entera tapaba todo; el resto se recorre en la pantalla Playlists. Se acuerda en este equipo (localStorage).
import { useCallback, useState } from 'react'

const FIJADAS = 'paila.pl.fijadas', RECIENTES = 'paila.pl.recientes'
/** Cuántas playlists caben en la barra lateral (fijadas primero). */
export const EN_BARRA = 6

const leer = (k: string): number[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : [] } catch { return [] } }
const guardar = (k: string, v: number[]) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin almacenamiento */ } }

/** Las ids a mostrar en la barra: fijadas, luego recientes (sin repetir), solo las que existen. */
export function idsDeLaBarra(fijadas: number[], recientes: number[], existen: Set<number>, max = EN_BARRA): number[] {
  const out: number[] = []
  for (const id of [...fijadas, ...recientes]) if (existen.has(id) && !out.includes(id)) out.push(id)
  return out.slice(0, Math.max(max, Math.min(fijadas.filter((f) => existen.has(f)).length, 12)))
}

export function usePlaylistsUso() {
  const [fijadas, setFijadas] = useState(() => leer(FIJADAS))
  const [recientes, setRecientes] = useState(() => leer(RECIENTES))
  /** Anota que se usó (primero en la lista de recientes). */
  const usada = useCallback((id: number) => setRecientes((r) => { if (r[0] === id) return r; const v = [id, ...r.filter((x) => x !== id)].slice(0, 20); guardar(RECIENTES, v); return v }), [])
  const fijar = useCallback((id: number) => setFijadas((f) => { const v = f.includes(id) ? f.filter((x) => x !== id) : [...f, id]; guardar(FIJADAS, v); return v }), [])
  return { fijadas, recientes, usada, fijar }
}
