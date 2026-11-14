// Un lugar (root_id, rel_path) que todavía tiene anotado un tema de la papelera queda libre para el que llega (organizer.ts,
// logMove). Desde la migración v54 un tema en la papelera se anota donde está de verdad (_PAILA/papelera/…); esto cubre lo de antes
// o lo que restauró otro programa. Pasó el 01/11: 11 temas movidos en el disco que la base rechazó (UNIQUE root_id, rel_path).
import path from 'node:path'
import type { Db } from './db'

/** Si `rel` lo tiene anotado otro tema que está en la papelera, ese pasa a anotarse donde está de verdad: su lugar en la papelera. */
export function liberarLugar(db: Db, rootId: number, rel: string, fileId: number) {
  const o = db.prepare('SELECT id FROM files WHERE root_id = ? AND rel_path = ? AND id != ? AND trashed_at IS NOT NULL').get(rootId, rel, fileId) as { id: number } | undefined
  if (!o) return
  const t = db.prepare('SELECT trash_rel AS r FROM trash_log WHERE file_id = ? AND restored_at IS NULL ORDER BY id DESC LIMIT 1').get(o.id) as { r: string } | undefined
  db.prepare('UPDATE files SET rel_path = ? WHERE id = ?').run(t?.r ?? `_PAILA/papelera/${o.id}/${path.posix.basename(rel)}`, o.id)
}
