// "Traer una lista", lo que salió del uso real del 24/10 (lo usa core/requests.ts):
// - "Los dos" en otra versión: la tuya entra a la playlist y la versión pedida es un tema más del pedido, en el mismo lugar, que
//   falta (va a la lista «Faltan o suenan mal») y queda enganchada a la tuya (`request_versions`); cuando llega, entra al lado.
// - Traer otra vez una lista que ya está (mismo nombre): se actualiza esa en vez de armar «Joda (2)», «Joda (3)»…
// Solo cambia la base, nunca archivos.
import type { Db } from './db'
import { sameSong } from './listmatch'
import type { NewItem, Saved } from './requests'
import type { RequestPreview } from '@paila/shared/types'
import { T } from './requests.textos'

/** La lista ya traída con ese nombre (la última, sin deshacer, con su playlist y que no venga de Rekordbox). */
export function sameName(db: Db, name: string): RequestPreview['existing'] {
  const r = db.prepare(
    `SELECT r.id, r.name, p.name AS playlistName FROM requests r JOIN playlists p ON p.id = r.playlist_id
     WHERE r.undone_at IS NULL AND r.id NOT IN (SELECT request_id FROM request_import WHERE import_id IS NOT NULL) AND (lower(r.name) = lower(?) OR lower(p.name) = lower(?)) ORDER BY r.id DESC LIMIT 1`,
  ).get(name.trim(), name.trim()) as { id: number; name: string; playlistName: string | null } | undefined
  return r ?? null
}

/** ¿Otro pedido (o este mismo, en otro tema) usa esa fila de la lista «Faltan o suenan mal»? */
export function othersUse(db: Db, s: Pick<Saved, 'id' | 'wantedId'>): boolean {
  return !!db.prepare('SELECT 1 FROM request_items i JOIN requests r ON r.id = i.request_id WHERE i.wanted_id = ? AND i.id != ? AND r.undone_at IS NULL').get(s.wantedId, s.id)
}

/** De qué tema tuyo es la versión pedida (null si no es una de "Los dos"). */
export function versionOf(db: Db, itemId: number): number | null {
  return (db.prepare('SELECT of_item AS o FROM request_versions WHERE item_id = ?').get(itemId) as { o: number } | undefined)?.o ?? null
}

/** Las parejas de "Los dos" de un pedido: la versión pedida (`item`) y la tuya (`of`). */
export function versionPairs(db: Db, requestId: number): { item: number; of: number }[] {
  return db.prepare('SELECT v.item_id AS item, v.of_item AS of FROM request_versions v JOIN request_items i ON i.id = v.item_id WHERE i.request_id = ?').all(requestId) as { item: number; of: number }[]
}

/** "Los dos": suma la versión pedida como un tema más del pedido, en el mismo lugar que la tuya. Sin acomodarla. */
export function addVersion(db: Db, requestId: number, ofItem: number) {
  if (db.prepare('SELECT 1 FROM request_versions WHERE of_item = ?').get(ofItem)) return
  const o = db.prepare('SELECT position, artist, title, album, duration, isrc FROM request_items WHERE id = ?').get(ofItem) as { position: number; artist: string; title: string; album: string | null; duration: number | null; isrc: string | null }
  const id = Number(db.prepare("INSERT INTO request_items (request_id, position, artist, title, album, duration, isrc, kind, file_id, decision, why) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', NULL, NULL, ?)")
    .run(requestId, o.position, o.artist, o.title, o.album, o.duration, o.isrc, T.versionPedida).lastInsertRowid)
  db.prepare('INSERT INTO request_versions (item_id, of_item) VALUES (?, ?)').run(id, ofItem)
}

/** Saca la versión pedida de "Los dos" (al cambiar de decisión) y lo que sumó a la lista «Faltan o suenan mal», si nadie más lo usa. */
export function dropVersion(db: Db, ofItem: number) {
  const v = db.prepare('SELECT item_id AS id FROM request_versions WHERE of_item = ?').get(ofItem) as { id: number } | undefined
  if (!v) return
  const s = db.prepare('SELECT id, file_id AS fileId, wanted_id AS wantedId, wanted_created AS wantedCreated FROM request_items WHERE id = ?').get(v.id) as unknown as Saved
  if (s.fileId != null) {
    // ya llegó y entró a la playlist: queda como un tema más del pedido (ya no es "la que falta")
    db.prepare('DELETE FROM request_versions WHERE item_id = ?').run(v.id)
    return
  }
  if (s.wantedId != null && s.wantedCreated && !othersUse(db, s)) db.prepare("DELETE FROM wanted WHERE id = ? AND status IN ('pendiente', 'pedido')").run(s.wantedId)
  db.prepare('DELETE FROM request_items WHERE id = ?').run(v.id)
}

/**
 * Trae otra vez una lista que ya está: suma lo nuevo al final y lo que antes faltaba y ahora sí tenés (o confirmaste en la vista
 * previa). Lo que ya estaba queda como estaba; nada se saca. `insert` guarda un tema y `settle` lo acomoda (core/requests.ts).
 * Corre dentro de la transacción del que llama.
 */
export function updateItems(db: Db, requestId: number, items: NewItem[], deps: { saved: () => Saved[]; insert: (i: NewItem, position: number) => number; settle: (s: Saved) => void }): { added: number; found: number } {
  const before = deps.saved()
  const used = new Set<number>()
  let next = Math.max(0, ...before.map((s) => s.position)) + 1, added = 0, found = 0
  const touched: number[] = []
  for (const i of [...items].sort((a, b) => a.position - b.position)) {
    const same = before.find((s) => !used.has(s.id) && versionOf(db, s.id) == null && sameSong(s, i))
    if (!same) { touched.push(deps.insert(i, next++)); added++; continue }
    used.add(same.id)
    // lo que faltaba (y no se descartó a mano) y ahora apareció en tu biblioteca
    if (same.fileId == null && same.decision !== 'no' && i.fileId != null && i.kind !== 'none' && db.prepare('SELECT 1 FROM files WHERE id = ?').get(i.fileId)) {
      db.prepare('UPDATE request_items SET kind = ?, file_id = ?, decision = ?, why = ? WHERE id = ?').run(i.kind, i.fileId, i.decision === 'ambos' ? 'si' : i.decision, i.why, same.id)
      if (i.decision === 'ambos') addVersion(db, requestId, same.id)
      touched.push(same.id); found++
    }
  }
  for (const s of deps.saved()) if (touched.includes(s.id) || (s.fileId == null && touched.includes(versionOf(db, s.id) ?? -1))) deps.settle(s)
  return { added, found }
}
