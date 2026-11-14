// "Traer una lista": lo que llega por la Bandeja (lo usa core/requests.ts, `sync`). Los temas que faltaban y la Bandeja encontró
// ("llegó"): cuando el archivo ya está en tu Música (lo copiaste y se escaneó), entra solo a la playlist del pedido, en su lugar.
// Solo cambia la base, nunca archivos.
import fs from 'node:fs'
import path from 'node:path'
import { transaction, type Db } from './db'
import { sameSong, type LibTrack, type ListMatcher } from './listmatch'
import type { Saved } from './requests'
import { T } from './requests.textos'

/**
 * Se reconoce por el mismo archivo (nombre y tamaño) o, si se renombró, por el nombre y la duración; y nunca si sus tags dicen otro
 * tema (pedía «Self Control» y llegó «Spanish Eddie», del disco Self Control: uso real del 24/10). Devuelve cuántos entraron.
 */
export function syncArrived(db: Db, deps: { rows: () => LibTrack[]; saved: (requestId: number) => Saved[]; matcher: () => ListMatcher; settle: (s: Saved) => void }): number {
  const todo = db.prepare(
    `SELECT i.id, i.request_id AS requestId, w.arrived_path AS arrived FROM request_items i JOIN requests r ON r.id = i.request_id JOIN wanted w ON w.id = i.wanted_id
     WHERE r.undone_at IS NULL AND w.file_id IS NULL AND w.status = 'llego' AND w.arrived_path IS NOT NULL`,
  ).all() as { id: number; requestId: number; arrived: string }[]
  if (!todo.length) return 0
  const lib = deps.rows()
  const sizeOf = (id: number) => (db.prepare('SELECT size FROM files WHERE id = ?').get(id) as { size: number } | undefined)?.size ?? null
  let added = 0
  let m: ListMatcher | null = null
  for (const t of todo) {
    const s = deps.saved(t.requestId).find((x) => x.id === t.id)!
    const size = (db.prepare('SELECT size FROM inbox_items WHERE path = ?').get(t.arrived) as { size: number } | undefined)?.size ?? (() => { try { return fs.statSync(t.arrived).size } catch { return null } })()
    const base = path.basename(t.arrived).toLowerCase()
    let hit = lib.find((r) => path.posix.basename(r.rel).toLowerCase() === base && size != null && sizeOf(r.id) === size)?.id ?? null
    if (hit == null) {
      m ??= deps.matcher()
      const r = m.match({ position: s.position, artist: s.artist, title: s.title, album: s.album, duration: s.duration, isrc: s.isrc, path: null })
      if (r.kind === 'isrc' || r.kind === 'exacto' || r.kind === 'probable') hit = r.fileId
    }
    // que no sea un tema que ya está en el pedido por otro lado (sería otro tema con el mismo nombre)
    if (hit == null || db.prepare('SELECT 1 FROM request_items WHERE request_id = ? AND file_id = ? AND id != ?').get(s.requestId, hit, s.id)) continue
    // ni otro tema que bajó en su lugar: si sus tags dicen otro título, no entra
    const got = lib.find((r) => r.id === hit)
    if (got?.title && !sameSong({ artist: got.artist ?? s.artist, title: got.title }, { artist: s.artist, title: s.title })) continue
    transaction(db, () => {
      db.prepare("UPDATE request_items SET kind = 'llego', file_id = ?, decision = 'si', arrived_at = ? WHERE id = ?").run(hit, new Date().toISOString(), s.id)
      const name = (db.prepare('SELECT name FROM requests WHERE id = ?').get(s.requestId) as { name: string }).name
      db.prepare("UPDATE wanted SET status = 'reemplazado', note = ?, updated_at = ? WHERE id = ?").run(T.yaEnMusica(name), new Date().toISOString(), s.wantedId)
      deps.settle({ ...s, kind: 'llego', fileId: hit, decision: 'si', wantedId: null, wantedCreated: 0 })
      db.prepare('UPDATE request_items SET wanted_id = COALESCE(wanted_id, ?) WHERE id = ?').run(s.wantedId, s.id)
    })
    added++
  }
  return added
}
