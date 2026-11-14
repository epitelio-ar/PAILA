// El enlace que NAPIA le deja a PAILA (enlace.ts), armado del avance de la lista que baja: cuántos bajados, truchos y no
// encontrados, y lo último que pasó tema por tema (lo que llegó, lo trucho, lo que no estaba). Puro, con tests
// (tests/napia-enlace.test.ts). Lo escribe apps/napia/electron/enlace.ts cada 2 s.
import type { RunStatus, TrackProgress } from '@paila/shared/napia'
import type { EnlaceNapia, FaltaNapia, FinLista, UltimoNapia } from './enlace'

const TRUCHO = new Set(['trucho', 'soloFalsa', 'sinMejor'])
const MAX_ULTIMOS = 8

/** Qué pasó con un tema, para la lista de "lo último" (null: todavía no terminó). */
export function ultimoDe(t: TrackProgress): UltimoNapia | null {
  const c = t.calidad
  if (c && TRUCHO.has(c.estado)) return { artist: t.artist, title: t.title, estado: 'trucho', es: c.es }
  if (t.state === 'bajado' && c?.estado === 'reemplazado') return { artist: t.artist, title: t.title, estado: 'llego', otraCopia: true }
  if (t.state === 'bajado' && (!c || c.estado === 'buena' || c.estado === 'sinRevisar')) return { artist: t.artist, title: t.title, estado: 'llego' }
  if (t.state === 'noEncontrado' || t.state === 'fallo') return { artist: t.artist, title: t.title, estado: 'noEsta' }
  return null
}

export interface ExtraEnlace { carpeta: string | null; fin: FinLista | null; enEspera: number; falta: FaltaNapia | null; hora?: number }

/** El enlace completo a partir del estado de la corrida. `orden`: los temas en el orden en que terminaron (los últimos al final). */
export function armarEnlace(st: RunStatus, x: ExtraEnlace, orden: TrackProgress[] = st.tracks): EnlaceNapia {
  const k = st.counts
  const ultimos = orden.map(ultimoDe).filter((u): u is UltimoNapia => !!u).slice(-MAX_ULTIMOS).reverse()
  return {
    hora: x.hora ?? Date.now(), corriendo: st.running, lista: st.listName, hechos: k.bajado + k.yaEstaba + k.noEncontrado + k.fallo + k.cancelado,
    total: st.tracks.length, bajados: k.bajado, carpeta: x.carpeta, fin: x.fin,
    truchos: st.calidad?.descartados ?? st.tracks.filter((t) => t.calidad && TRUCHO.has(t.calidad.estado)).length,
    noEncontrados: k.noEncontrado + k.fallo, enEspera: x.enEspera, falta: x.falta, ultimos,
  }
}

/** Qué le falta a NAPIA para bajar, de lo que sabe de sockseek y de la carpeta. */
export const faltaNapia = (i: { exe: string | null; hasUser: boolean; hasPass: boolean }, carpetaConfirmada: boolean): FaltaNapia | null =>
  !i.exe ? 'sockseek' : !(i.hasUser && i.hasPass) ? 'cuenta' : !carpetaConfirmada ? 'carpeta' : null
