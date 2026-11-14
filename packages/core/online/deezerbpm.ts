// "Segunda opinión" del BPM desde Deezer (gratis, sin clave): busca el tema por artista y título, exige la misma
// duración y lee el BPM y la ganancia que tiene cargados. Sirve para desempatar el doble o la mitad; no da el tono y no
// reemplaza al análisis propio. Usa el ritmo tranquilo de Deezer (core/online/sources.ts) y la caché `online_cache`.
import type { Deezer } from './sources'
import type { OnlineCache } from './http'

export interface DeezerBpm { id: string; bpm: number | null; gain: number | null }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** El mismo tema: título igual (sin lo que va entre paréntesis), artista que coincide y duración a ±3 s. */
function same(hit: { title: string; duration?: number; artist?: { name: string } }, artist: string, title: string, seconds: number | null): boolean {
  if (seconds != null && hit.duration != null && Math.abs(hit.duration - seconds) > 3) return false
  const a = fold(hit.artist?.name ?? ''), b = fold(artist)
  return fold(hit.title) === fold(title) && !!a && !!b && (a.includes(b) || b.includes(a))
}

/** BPM y ganancia de Deezer para un tema; null si no lo encuentra. `bpm` es null si Deezer no lo tiene (viene en 0). */
export async function deezerBpm(dz: Deezer, artist: string, title: string, seconds: number | null, cache?: OnlineCache): Promise<DeezerBpm | null> {
  const key = `bpm:${fold(artist)}|${fold(title)}|${seconds ? Math.round(seconds) : ''}`
  const hit = cache?.get<DeezerBpm | null>('deezer', key)
  if (hit?.status === 'ok') return hit.data
  const q = (s: string) => s.replace(/"/g, ' ')
  const search = (query: string) => dz.http.json<{ data?: { id: number; title: string; duration?: number; artist?: { name: string } }[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`)
  let j = await search(`artist:"${q(artist)}" track:"${q(title)}"`)
  if (!j.data?.some((t) => same(t, artist, title, seconds))) j = await search(`${q(artist)} ${q(title)}`)
  const t = j.data?.find((x) => same(x, artist, title, seconds))
  let out: DeezerBpm | null = null
  if (t) {
    const d = await dz.http.json<{ bpm?: number; gain?: number }>(`https://api.deezer.com/track/${t.id}`)
    out = { id: String(t.id), bpm: d.bpm && d.bpm > 0 ? Math.round(d.bpm * 10) / 10 : null, gain: d.gain ?? null }
  }
  cache?.put('deezer', key, 'ok', out)
  return out
}

/**
 * Qué dice Deezer del BPM de PAILA: 'confirma' (±2 %), 'doble'/'mitad' (Deezer dice el doble o la mitad: se propone
 * corregir), 'distinto' (no se usa) o null si Deezer no tiene BPM.
 */
export function deezerVerdict(ours: number, deezer: number | null): 'confirma' | 'doble' | 'mitad' | 'distinto' | null {
  if (!deezer) return null
  const r = deezer / ours
  if (Math.abs(r - 1) <= 0.02) return 'confirma'
  if (Math.abs(r - 2) <= 0.04) return 'doble'
  if (Math.abs(r - 0.5) <= 0.01) return 'mitad'
  return 'distinto'
}
