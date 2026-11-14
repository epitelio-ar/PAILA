// Lo que NAPIA no consiguió vuelve a «Faltan o suenan mal» (core/sockseek/enlace.ts): cada tema de la lista que sigue
// pendiente o pedido queda con la nota "no_soulseek:<día>", y la pantalla muestra «No está en Soulseek (día)». Así no lo
// volvés a mandar sin saber que la última vez no apareció (el autor, 1/11). Se compara por artista y título normalizados.
import type { DatabaseSync } from 'node:sqlite'
import { normalize } from './dupnames'
import { listName, sePuedeBuscar } from './wanted'
import { napiaCsv } from './listexport'
import { flagList } from './better'
import { peorPrimero } from './peor-primero'

export const NOTA_NO_SOULSEEK = 'no_soulseek:'

/** Marca los temas que NAPIA no consiguió. `dia`: AAAA-MM-DD. Devuelve cuántos marcó. */
export function marcarNoConseguidos(db: DatabaseSync, pares: { artist: string; title: string }[], dia: string): number {
  const buscados = new Set(pares.map((p) => `${normalize(p.artist)}|${normalize(p.title)}`))
  if (!buscados.size) return 0
  const filas = db.prepare("SELECT id, artist, title FROM wanted WHERE status IN ('pendiente', 'pedido')").all() as { id: number; artist: string | null; title: string | null }[]
  const marcar = db.prepare('UPDATE wanted SET note = ?, updated_at = ? WHERE id = ?')
  const ahora = new Date().toISOString()
  let n = 0
  for (const f of filas) {
    if (!buscados.has(`${normalize(f.artist ?? '')}|${normalize(f.title ?? '')}`)) continue
    marcar.run(NOTA_NO_SOULSEEK + dia, ahora, f.id); n++
  }
  return n
}

/**
 * "Buscar mejor copia con NAPIA" desde un tema o una selección (Detail, Edición en grupo): la lista para NAPIA con esos
 * temas y la copia que ya tenés (su nota y su calidad real), aunque no estén en «Faltan o suenan mal». NAPIA se queda
 * solo con una copia claramente mejor.
 */
export function listaParaMejorar(db: DatabaseSync, ids: number[]): string {
  if (!ids.length) return ''
  const filas = db.prepare(`SELECT f.id, f.rel_path AS rel, f.artist, f.title, f.album, f.duration, f.kbps, a.grade, a.flags, a.eff_kbps AS effKbps, a.clip_events AS clipEvents, a.lufs
    FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as {
    id: number; rel: string; artist: string | null; title: string | null; album: string | null; duration: number | null; kbps: number | null; grade: string | null; flags: string | null; effKbps: number | null; clipEvents: number | null; lufs: number | null
  }[]
  return napiaCsv([...filas].sort(peorPrimero).map((f) => {
    const n = listName(f.artist ?? '', f.title ?? '', f.rel)
    const tuya = f.grade ? { nota: f.grade, kbps: f.effKbps ?? f.kbps, que: null, marcas: flagList(f.flags), recortes: f.clipEvents, lufs: f.lufs, duracion: f.duration, id: f.id } : null
    return { artist: n.artist, title: n.title, album: f.album, duration: f.duration, tuya }
  }).filter((i) => sePuedeBuscar(i)))
}
