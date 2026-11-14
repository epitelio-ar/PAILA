// Corrida supervisada del respaldo liviano (24/10; bitácora docs/pruebas/2026-10-24-respaldo-liviano.md): repite sobre
// D:\PAILA-trabajo\Música-copia las tandas de Cambios pendientes del ensayo general del punto 1 (nombres con el perfil Oficial,
// y tapas + volumen parejo, la que con copias enteras ocupó 45 GB) con los MISMOS cambios: se leen de la base del ensayo, tema
// por tema (mismo número de tema), y las tapas salen de su carpeta "tapas". Mide cuánto ocupa el respaldo y cuánto tarda, y
// deshace desde el Historial. La copia de la base la arma `motor-corrida.ts preparar` (exige el aviso copia-en-uso.lock) y la
// comparación contra el original es `motor-corrida.ts comparar`. Nunca toca la Música original ni la base real.
//
//   node scripts/run-ts.mjs scripts/respaldo-corrida.ts aplicar  --datos <carpeta> --ensayo <paila.db del ensayo> --tanda <n> [--muestra N]
// --muestra: no hace falta aplicar todo para ver los efectos (pedido del autor, 24/10). De cada combinación de formato y campos
// entran todos si son pocos y una parte pareja de los grupos grandes, más todos los temas de carpetas donde la tanda cambia el
// cover.jpg más de una vez. La vista previa se calcula igual para la tanda entera, y lo medido se proyecta por grupo.
//   node scripts/run-ts.mjs scripts/respaldo-corrida.ts deshacer --datos <carpeta> --tanda <n de esta corrida>
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { History } from '@paila/core/history'
import crypto from 'node:crypto'
import { listBackups } from '@paila/core/ops/backup'
import { createServices } from '../apps/paila/electron/context'
import { arg, datos, fail, log, mode, open } from './corte-base'

const salidas = path.join(datos, 'salidas')
fs.mkdirSync(salidas, { recursive: true })
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`

function abrir() {
  const o = open()
  const c = createServices({ lib: o.lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: datos, version: 'respaldo-liviano' })
  return { ...o, c }
}
type Abierta = ReturnType<typeof abrir>

/** Lo que guardó el respaldo de una tanda: por tipo, los más grandes y cuánto ocupa en el disco de verdad. */
function informe(a: Abierta, op: string, ref: number) {
  const bks = listBackups(a.lib.db).filter((b) => b.op === op && b.ref === ref)
  const rows = a.lib.db.prepare(`SELECT f.kind, f.rel, f.bytes, f.old_size AS size FROM backup_files f JOIN backups b ON b.id = f.backup_id WHERE b.op = ? AND b.ref = ? ORDER BY f.bytes DESC`)
    .all(op, ref) as { kind: string; rel: string; bytes: number; size: number }[]
  // en el disco: cada archivo ocupa bloques enteros (512 KB en un disco exFAT grande)
  const disk = (d: string) => { const bs = Number(fs.statfsSync(d).bsize) || 4096; return (fs.readdirSync(d, { recursive: true }) as string[]).reduce((s, f) => { const st = fs.statSync(path.join(d, f)); return s + (st.isFile() ? Math.ceil(st.size / bs) * bs : 0) }, 0) }
  const byKind = Object.fromEntries([...new Set(rows.map((r) => r.kind))].map((k) => [k, { archivos: rows.filter((r) => r.kind === k).length, bytes: rows.filter((r) => r.kind === k).reduce((s, r) => s + r.bytes, 0) }]))
  const lines = [
    `Respaldo ${op} ${ref}: ${bks.reduce((s, b) => s + b.files, 0)} archivos, ${mb(bks.reduce((s, b) => s + b.bytes, 0))} anotados; en el disco ${mb(bks.reduce((s, b) => s + (b.exists ? disk(b.dir) : 0), 0))}. Música tocada: ${mb(rows.reduce((s, r) => s + r.size, 0))}.`,
    `Por tipo: ${JSON.stringify(byKind)}`,
    ...bks.map((b) => `  ${b.dir} (${b.complete ? 'completo' : 'INCOMPLETO'}, ${b.light ? 'liviano' : 'copias completas'})`),
    'Los 15 más grandes:', ...rows.slice(0, 15).map((r) => `  ${r.kind} · ${mb(r.bytes)} de ${mb(r.size)} · ${r.rel}`),
    `Guardados enteros (cambiaba casi todo): ${rows.filter((r) => r.kind === 'entero').map((r) => r.rel).join(' · ') || 'ninguno'}`,
  ]
  for (const l of lines) log(l)
  return lines
}

interface Muestra { ids: Set<number>; total: number; group: Map<number, string>; sizes: Map<string, number> }

/** La muestra pareja: por grupo (formato + campos que cambian) todos si son pocos y una parte de los grandes; y las carpetas con el cover compartido. */
function muestra(a: Abierta, rows: { id: number; field: string }[], n: number): Muestra | null {
  if (!n) return null
  const fields = new Map<number, string[]>()
  for (const r of rows) fields.set(r.id, [...(fields.get(r.id) ?? []), r.field])
  const info = a.lib.db.prepare('SELECT ext, rel_path AS rel FROM files WHERE id = ?')
  const group = new Map<number, string>(), byGroup = new Map<string, number[]>()
  for (const [id, f] of fields) { const k = `${(info.get(id) as { ext: string }).ext} · ${[...new Set(f)].sort().join('+')}`; group.set(id, k); byGroup.set(k, [...(byGroup.get(k) ?? []), id]) }
  const share = n / fields.size, h = (id: number) => crypto.createHash('md5').update(String(id)).digest().readUInt32LE(0)
  const ids = new Set<number>()
  for (const list of byGroup.values()) for (const id of [...list].sort((x, y) => h(x) - h(y)).slice(0, list.length <= 12 ? list.length : Math.max(12, Math.round(list.length * share)))) ids.add(id)
  // todos los temas de una carpeta donde la tanda cambia el cover.jpg más de una vez (el caso del error del 24/10)
  const dirOf = (id: number) => path.posix.dirname((info.get(id) as { rel: string }).rel)
  const covers = new Map<string, number[]>()
  for (const [id, f] of fields) if (f.includes('folderCover')) covers.set(dirOf(id), [...(covers.get(dirOf(id)) ?? []), id])
  for (const list of covers.values()) if (list.length > 1) for (const id of list) ids.add(id)
  return { ids, total: fields.size, group, sizes: new Map([...byGroup].map(([k, v]) => [k, v.length])) }
}

/** Lo medido en la muestra, proyectado a la tanda entera: por grupo, lo que ocupó cada tema por cuántos tiene el grupo. */
function proyectar(a: Abierta, ref: number, pick: Muestra, seconds: number): string[] {
  const rows = a.lib.db.prepare("SELECT f.file_id AS id, f.bytes, f.kind FROM backup_files f JOIN backups b ON b.id = f.backup_id WHERE b.op = 'tags' AND b.ref = ?").all(ref) as { id: number; bytes: number; kind: string }[]
  const per = new Map<string, number[]>()
  for (const r of rows) if (r.kind !== 'copia') { const k = pick.group.get(r.id)!; per.set(k, [...(per.get(k) ?? []), r.bytes]) }
  const covers = rows.filter((r) => r.kind === 'copia').reduce((s, r) => s + r.bytes, 0)
  let est = 0
  for (const [k, list] of per) est += (list.reduce((s, x) => s + x, 0) / list.length) * (pick.sizes.get(k) ?? 0)
  const lines = [`Proyectado a la tanda entera (${pick.total} temas): unos ${mb(est)} de lo que cambia, más los cover.jpg (en la muestra, ${mb(covers)}), y unos ${Math.round(seconds * pick.total / pick.ids.size)} s`]
  for (const l of lines) log(l)
  return lines
}

/** Arma en Cambios pendientes los cambios de una tanda del ensayo (por número de tema) y los aplica como el botón. */
async function aplicar(a: Abierta) {
  const ensayo = arg('--ensayo'), tanda = Number(arg('--tanda'))
  if (!ensayo || !tanda) fail('Uso: aplicar --datos <carpeta> --ensayo <paila.db del ensayo> --tanda <n>')
  const src = new DatabaseSync(ensayo, { readOnly: true })
  const rows = src.prepare('SELECT file_id AS id, field, after FROM journal WHERE batch_id = ? ORDER BY id').all(tanda) as { id: number; field: string; after: string | null }[]
  src.close()
  const ok = new Set((a.lib.db.prepare('SELECT id FROM files WHERE trashed_at IS NULL AND missing_at IS NULL').all() as { id: number }[]).map((r) => r.id))
  const all = rows.filter((r) => ok.has(r.id))
  const pick = muestra(a, all, Number(arg('--muestra')) || 0)
  const items = all.map((r) => ({ id: r.id, field: r.field as never, value: r.after }))
  log(`Tanda ${tanda} del ensayo: ${rows.length} cambios; ${items.length} de temas que están en esta copia. Por campo: ${JSON.stringify(Object.fromEntries([...new Set(rows.map((r) => r.field))].map((f) => [f, rows.filter((r) => r.field === f).length])))}`)
  a.c.changes.discard()
  a.c.changes.stageMany(items)
  const pend = a.c.changes.list()
  const t0 = Date.now()
  const vista = (q: ReturnType<typeof a.c.changes.backupPlan>, t: number) => `${q.files} archivos, unos ${mb(q.bytes)} en ${q.dirs.join(', ')}${q.warning ? ` · ${q.warning}` : ''}${q.problem ? ` · PROBLEMA: ${q.problem}` : ''} (${((Date.now() - t) / 1000).toFixed(1)} s)`
  const full = a.c.changes.backupPlan()
  log(`Vista previa del respaldo, la tanda entera: ${vista(full, t0)}`)
  if (pick) {
    a.c.changes.discard(pend.filter((x) => !pick.ids.has(x.fileId)).map((x) => x.id))
    pend.splice(0, pend.length, ...a.c.changes.list())
  }
  const t2 = Date.now()
  const plan = a.c.changes.backupPlan()
  if (pick) log(`Muestra: ${pick.ids.size} temas de ${pick.total} (${pend.length} cambios). Vista previa de la muestra: ${vista(plan, t2)}`)
  const t1 = Date.now()
  let last = 0
  const r = await a.lib.ops.run('corrida: respaldo liviano', () => a.c.changes.apply(undefined, { onProgress: (x) => { if (x.done - last >= 250) { last = x.done; log(`  ${x.done}/${x.total} (${Math.round((Date.now() - t1) / 1000)} s)`) } } }))
  const s = (Date.now() - t1) / 1000
  log(`TIEMPO aplicar: ${s.toFixed(1)} s · ${r.applied} cambios de ${pend.length} en ${new Set(pend.map((x) => x.fileId)).size} temas · ${r.failed.length} fallas · tanda ${r.batchId}`)
  for (const f of r.failed) log(`  FALLA ${f.rel}: ${f.error}`)
  const lines = r.batchId ? informe(a, 'tags', r.batchId) : []
  if (pick && r.batchId) lines.push(...proyectar(a, r.batchId, pick, s))
  const work = path.join(a.root, '_PAILA', 'escribiendo')
  log(`Temporales que quedaron en _PAILA/escribiendo: ${fs.existsSync(work) ? fs.readdirSync(work).length : 0}`)
  fs.writeFileSync(path.join(salidas, `aplicar-${tanda}.json`), JSON.stringify({ tanda, batchId: r.batchId, segundos: s, previstoEntera: full, previsto: plan, aplicados: r.applied, fallas: r.failed, informe: lines }, null, 1))
}

/** Deshace una tanda de esta corrida desde el Historial, como el botón, y mide cuánto tarda y cuánto ocupa su respaldo. */
async function deshacer(a: Abierta) {
  const id = Number(arg('--tanda'))
  const c = a.c
  const h = new History(a.lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, rootPath: a.rootPath })
  const t0 = Date.now()
  const r = await a.lib.ops.run('corrida: deshacer', () => h.undo('tags', id))
  const s = (Date.now() - t0) / 1000
  log(`TIEMPO deshacer ${id}: ${s.toFixed(1)} s · ${r.done} hechos · ${r.failed.length} fallas`)
  for (const f of r.failed) log(`  FALLA ${f.rel}: ${f.error}`)
  const lines = informe(a, 'deshacer-tags', id)
  fs.writeFileSync(path.join(salidas, `deshacer-${id}.json`), JSON.stringify({ id, segundos: s, hechos: r.done, fallas: r.failed, informe: lines }, null, 1))
}

const PASOS: Record<string, (a: Abierta) => Promise<void>> = { aplicar, deshacer }
if (!PASOS[mode]) fail(`Paso desconocido: ${mode}. Pasos: ${Object.keys(PASOS).join(', ')}`)
const a = abrir()
try { await PASOS[mode](a) } finally { a.lib.close() }
