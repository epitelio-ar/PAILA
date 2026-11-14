// Restaura un tema de la papelera con otro nombre, cuando su lugar de antes está ocupado (02/11: «Es La Que Va» de Los Nota Lokos,
// otra versión de «Es la que va», el mismo nombre para Windows). Cambia el lugar de destino anotado y usa la restauración normal de
// PAILA (diario, Historial). Con PAILA cerrada.
//   node scripts/run-ts.mjs scripts/restaurar-con-nombre.ts "<lugar de antes>" "<nombre nuevo>"
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'

const [orig, nombre] = process.argv.slice(2)
const lib = new Library(path.join(process.env.APPDATA!, 'PAILA', 'paila.db'), findFfprobe())
const t = lib.db.prepare('SELECT id, batch_id AS batch, file_id AS fileId FROM trash_log WHERE orig_rel = ? AND restored_at IS NULL AND purged_at IS NULL').get(orig) as { id: number; batch: number; fileId: number } | undefined
if (!t) throw new Error(`No está en la papelera: ${orig}`)
const nuevo = path.posix.join(path.posix.dirname(orig), nombre)
lib.db.prepare('UPDATE trash_log SET orig_rel = ? WHERE id = ?').run(nuevo, t.id)
const trash = new Trash(lib.db, (rid) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null, new Playlists(lib.db, (id) => lib.trackPath(id)))
const r = await trash.restore(t.batch, [t.fileId])
if (!r.moved) lib.db.prepare('UPDATE trash_log SET orig_rel = ? WHERE id = ?').run(orig, t.id)
console.log(r.moved ? `Restaurado como ${nuevo}` : `No se pudo: ${r.failed.map((f) => f.error).join(', ')}`)
lib.close()
