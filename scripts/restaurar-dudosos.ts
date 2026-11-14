// Una sola vez (02/11/2026, pedido del autor: "volvelos a su lugar, después me fijo"): devuelve a su lugar lo que la revisión de
// la papelera marcó para mirar (docs/pruebas/revisar-papelera-2026-11-02.md), con las mismas operaciones de PAILA (diario, Historial,
// se puede deshacer):
// - lo que Duplicados mandó a la papelera y por la huella del sonido es otra versión u otro tema (core/sockseek/huella.ts): se
//   restaura (core/trash.ts);
// - los reemplazos donde la copia nueva es otra edición (más de 4 s de diferencia, o el nombre no coincide): se deshacen
//   (core/replace.ts): la vieja vuelve a su lugar y la nueva va a la papelera.
// Con PAILA cerrada (usa la base real). Sin --aplicar, solo dice qué haría.
//   node scripts/run-ts.mjs scripts/restaurar-dudosos.ts [--aplicar]
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'
import { Replacer } from '@paila/core/replace'
import { compararHuellas } from '@paila/core/sockseek/huella'

const aplicar = process.argv.includes('--aplicar')
const lib = new Library(path.join(process.env.APPDATA!, 'PAILA', 'paila.db'), findFfprobe())
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
const db = lib.db

// 1) Duplicados: otra versión u otro tema por el sonido
const dups = db.prepare(`SELECT t.batch_id AS batch, t.file_id AS fileId, t.orig_rel AS rel, f.duration AS d1, k.duration AS d2, a1.chromaprint AS p1, a2.chromaprint AS p2, a1.audio_md5 AS m1, a2.audio_md5 AS m2
  FROM trash_log t JOIN files f ON f.id = t.file_id LEFT JOIN files k ON k.id = t.kept_id
  LEFT JOIN analysis a1 ON a1.file_id = f.id LEFT JOIN analysis a2 ON a2.file_id = k.id
  WHERE t.reason = 'Duplicados' AND t.restored_at IS NULL AND t.purged_at IS NULL`).all() as { batch: number; fileId: number; rel: string; d1: number; d2: number; p1: string | null; p2: string | null; m1: string | null; m2: string | null }[]
const volver = dups.filter((r) => !(r.m1 && r.m1 === r.m2) && r.p1 && r.p2 && ['version', 'otro'].includes(compararHuellas(r.p1, r.d1, r.p2, r.d2) ?? ''))

// 2) Reemplazos con otra edición
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/^\d+[\s.\-_]*/, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const reps = (db.prepare(`SELECT r.id, r.old_row AS oldRow, f.rel_path AS now, f.duration AS dn FROM replacements r JOIN files f ON f.id = r.file_id WHERE r.undone_at IS NULL AND r.purged_at IS NULL`).all() as { id: number; oldRow: string; now: string; dn: number | null }[])
  .filter((r) => {
    const o = JSON.parse(r.oldRow) as { rel_path?: string; rel?: string; duration?: number | null }
    const viejo = norm((o.rel_path ?? o.rel ?? '').split('/').pop() ?? ''), nuevo = norm(r.now.split('/').pop() ?? '')
    const dd = o.duration != null && r.dn != null ? Math.abs(o.duration - r.dn) : null
    const mismo = viejo.includes(nuevo) || nuevo.includes(viejo) || viejo.split(' ').some((w) => w.length > 3 && nuevo.includes(w))
    return !mismo || (dd != null && dd > 4)
  })

console.log(`Duplicados para restaurar: ${volver.length} · reemplazos para deshacer: ${reps.length}`)
for (const r of volver) console.log('  restaurar  ', r.rel)
for (const r of reps) console.log('  deshacer   ', r.now)

if (aplicar) {
  const trash = new Trash(db, rootPath, new Playlists(db, (id) => lib.trackPath(id)))
  const porTanda = new Map<number, number[]>()
  for (const r of volver) porTanda.set(r.batch, [...(porTanda.get(r.batch) ?? []), r.fileId])
  let ok = 0
  for (const [batch, ids] of porTanda) {
    const res = await trash.restore(batch, ids)
    ok += res.moved
    for (const f of res.failed) console.log('  NO se restauró:', f.rel, '·', f.error)
  }
  console.log(`Restaurados: ${ok} de ${volver.length}`)
  const replacer = new Replacer(db, rootPath, findFfprobe()!, findFfmpeg()!)
  let deshechos = 0
  for (const r of reps) { try { replacer.undo(r.id); deshechos++ } catch (e) { console.log('  NO se deshizo:', r.now, '·', (e as Error).message) } }
  console.log(`Reemplazos deshechos: ${deshechos} de ${reps.length}`)
}
lib.close()
