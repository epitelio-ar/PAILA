// El ISRC de una lista traída, en Deezer (sin clave): `track/isrc:<código>` da el tema exacto (artista, título y duración
// oficiales). Se pregunta con buenos modales (Polite, menos de 3 pedidos por segundo) y queda en la caché `online_cache`
// (fuente deezer, clave `isrc:<código>`). Después, sin internet, se mira qué archivos de la biblioteca dieron ese mismo
// tema cuando "Completar desde internet" los buscó en Deezer: eso es un emparejamiento seguro (core/listmatch.ts).
import type { Db } from './db'
import { OnlineCache } from './online/http'
import type { Deezer } from './online/sources'
import type { RecHit } from './online/hits'
import { recKey } from './official-findings'
import { loose } from './names'
import { stripJunk } from './tagactions'

export const isrcKey = (isrc: string) => `isrc:${isrc}`
/** Cómo se reconoce un tema de Deezer en dos búsquedas distintas: su número, o artista + título + duración. */
const hitKeys = (h: Pick<RecHit, 'id' | 'title' | 'credit' | 'length'>) =>
  [h.id ? `id:${h.id}` : '', `n:${loose(h.credit[0]?.name ?? '')}|${loose(h.title)}|${h.length ?? ''}`].filter(Boolean)

/** Lo que falta preguntar (los ISRC que no están en la caché). */
export function isrcsToAsk(db: Db, isrcs: string[]): string[] {
  const cache = new OnlineCache(db)
  return [...new Set(isrcs)].filter((i) => !cache.get('deezer', isrcKey(i)))
}

/** Pregunta a Deezer los ISRC que faltan. Si se corta internet, para (lo ya preguntado queda guardado). */
export async function lookupIsrcs(db: Db, isrcs: string[], deezer: Deezer, onProgress?: (done: number, total: number) => void, cancelled: () => boolean = () => false): Promise<{ asked: number; found: number }> {
  const cache = new OnlineCache(db)
  const todo = isrcsToAsk(db, isrcs)
  let asked = 0, found = 0, fails = 0
  for (const i of todo) {
    if (cancelled()) break
    try {
      const r = await deezer.byIsrc(i)
      cache.put('deezer', isrcKey(i), 'ok', r)
      if (r) found++
      fails = 0
    } catch (e) {
      cache.put('deezer', isrcKey(i), 'error', { error: (e as Error).message })
      if (++fails >= 5) break
    }
    asked++
    onProgress?.(asked, todo.length)
  }
  return { asked, found }
}

/** El índice: tema de Deezer → archivos tuyos que lo dieron al buscarlos (por sus tags o por el nombre del archivo). */
export function deezerIndex(db: Db, lib: { id: number; artist: string | null; title: string | null; guess?: { artist: string; title: string } | null }[]) {
  const cache = new OnlineCache(db)
  const byHit = new Map<string, Set<number>>()
  for (const t of lib) {
    const names = [t.artist && t.title ? { artist: t.artist, title: stripJunk(t.title) } : null, t.guess ?? null].filter((n): n is { artist: string; title: string } => !!n)
    for (const n of names) {
      for (const h of cache.lista<RecHit>('deezer', recKey(n.artist, n.title))) {
        for (const k of hitKeys(h)) byHit.set(k, (byHit.get(k) ?? new Set()).add(t.id))
      }
    }
  }
  return (isrc: string) => {
    const r = cache.get<RecHit | null>('deezer', isrcKey(isrc))
    if (r?.status !== 'ok' || !r.data) return null
    const d = r.data
    const fileIds = new Set<number>()
    for (const k of hitKeys(d)) for (const id of byHit.get(k) ?? []) fileIds.add(id)
    return { artist: d.credit[0]?.name ?? '', title: d.title, length: d.length, fileIds: [...fileIds] }
  }
}
