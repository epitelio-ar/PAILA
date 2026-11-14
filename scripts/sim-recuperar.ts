// Solo para revisar (no se usa en la app): con una COPIA de la base, aplica las migraciones y anota lo que quedó movido sin anotar,
// como haría la recuperación al abrir, sin tocar ningún archivo. Uso: node scripts/run-ts.mjs scripts/sim-recuperar.ts <copia.db> 1=<carpeta raíz> …
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATIONS } from '@paila/core/migrations'
import { logMove, type MoveData } from '@paila/core/organizer'

const db = new DatabaseSync(process.argv[2])
const v = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
console.log('versión de la base', v, '→', MIGRATIONS.length)
for (let i = v; i < MIGRATIONS.length; i++) db.exec(MIGRATIONS[i])
// las carpetas raíz, número=carpeta (las de esa base; antes iban escritas acá, con las de una PC)
const roots: Record<number, string> = Object.fromEntries(process.argv.slice(3).map((a) => { const i = a.indexOf('='); return [Number(a.slice(0, i)), a.slice(i + 1)] }))
if (!Object.keys(roots).length) { console.error('Uso: node scripts/run-ts.mjs scripts/sim-recuperar.ts <copia.db> 1=<carpeta raíz 1> [2=<carpeta raíz 2>…]'); process.exit(2) }
const abiertos = db.prepare("SELECT id, op, root_id, file_id, src_rel, dst_rel, data FROM op_journal WHERE result IS NULL").all() as { id: number; op: string; root_id: number; file_id: number; src_rel: string; dst_rel: string; data: string }[]
let ok = 0
for (const j of abiertos) {
  const src = path.join(roots[j.root_id], ...j.src_rel.split('/')), dst = path.join(roots[j.root_id], ...j.dst_rel.split('/'))
  if (j.op !== 'organizar' || fs.existsSync(src) || !fs.existsSync(dst)) { console.log('no es el caso', j.id); continue }
  try { logMove(db as never, JSON.parse(j.data) as MoveData); ok++ } catch (e) { console.log('FALLA', j.id, (e as Error).message) }
  const f = db.prepare('SELECT rel_path, trashed_at FROM files WHERE id = ?').get(j.file_id)
  console.log(j.id, JSON.stringify(f))
}
console.log(`anotados ${ok} de ${abiertos.length}`)
const choques = db.prepare('SELECT COUNT(*) AS n FROM files a JOIN files b ON a.root_id = b.root_id AND a.rel_path = b.rel_path AND a.id < b.id').get()
console.log('filas en el mismo lugar', JSON.stringify(choques))
console.log('en la papelera anotados afuera de _PAILA', JSON.stringify(db.prepare("SELECT COUNT(*) AS n FROM files WHERE trashed_at IS NOT NULL AND rel_path NOT LIKE '%_PAILA/papelera/%'").get()))
