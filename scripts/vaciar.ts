// Prueba de "Vaciar papelera" (guion: docs/archivo/pruebas/2026-10-21-guion-corte-y-vaciar.md) con una biblioteca de prueba aparte:
// temas COPIADOS de la Música (que solo se lee), sample packs, archivos de afuera y trampas (un acceso directo de carpeta
// dentro de la papelera que apunta afuera, un archivo de solo lectura). Llena la papelera por todos los caminos (tirar,
// reemplazar, WAV→FLAC, limpieza de Espacio), vacía primero "más de 30 días" y después todo, y controla que lo de afuera
// quede intacto y que el Historial y restaurar expliquen que ya no se puede. Borra de verdad, pero solo copias de prueba.
//
//   node scripts/run-ts.mjs scripts/vaciar.ts --carpeta <trabajo>/vaciar --original <Música original> [--datos-app]
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { guardWith } from '@paila/core/ops/checks'
import { Trash } from '@paila/core/trash'
import { Playlists } from '@paila/core/playlists'
import { Replacer } from '@paila/core/replace'
import { Space } from '@paila/core/space'
import { Organizer } from '@paila/core/organizer'
import { Changes } from '@paila/core/changes'
import { Improver } from '@paila/core/improve'
import { History } from '@paila/core/history'
import { purgeTrash, trashUsage } from '@paila/core/purge'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--carpeta'), original = arg('--original')
if (!base || !original || !/[\\/](?:PAILA-trabajo[\\/])?vaciar$/i.test(base)) { console.error('Uso: --carpeta <una carpeta "vaciar" en un disco NTFS> --original <Música>'); process.exit(2) }
if (fs.existsSync(base)) { console.error(`Ya existe ${base}: borrala a mano para empezar de nuevo`); process.exit(2) }
const ffmpeg = findFfmpeg()!, ffprobe = findFfprobe()!
const M = path.join(base, 'M'), afuera = path.join(base, 'afuera')
const log = (...a: unknown[]) => console.log(...a)
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const ff = (...a: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...a])
/** Todo lo que NO está dentro de una papelera de PAILA, con su MD5 (rutas completas). */
const outsideTrash = () => {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isSymbolicLink() || /[\\/]_PAILA[\\/]papelera$/i.test(p) || p === path.join(base, 'datos')) continue
      if (e.isDirectory()) walk(p); else out.set(p, md5(p))
    }
  }
  walk(base)
  return out
}

// 1) biblioteca de prueba: copias de la Música (por formato), sample packs y archivos de afuera
const want: Record<string, number> = { mp3: 10, flac: 6, wav: 4, aiff: 3, m4a: 2 }
const picked: string[] = []
const seenDir = new Set<string>()
for (const f of fs.readdirSync(original, { recursive: true }) as string[]) {
  const ext = path.extname(f).slice(1).toLowerCase(), dir = path.dirname(f)
  if (!want[ext] || seenDir.has(dir) || /^_PAILA|PIONEER|Samples|Ableton/i.test(f)) continue
  const st = fs.statSync(path.join(original, f))
  if (st.size > 40e6) continue
  want[ext]--; seenDir.add(dir); picked.push(f)
}
for (const f of picked) { fs.mkdirSync(path.dirname(path.join(M, f)), { recursive: true }); fs.copyFileSync(path.join(original, f), path.join(M, f)) }
fs.mkdirSync(path.join(M, 'Samples', 'Kit'), { recursive: true })
for (let i = 1; i <= 5; i++) ff('-f', 'lavfi', '-i', `sine=frequency=${100 * i}:duration=0.5`, path.join(M, 'Samples', 'Kit', `kick ${i}.wav`))
fs.mkdirSync(path.join(M, 'Descargas'), { recursive: true })
fs.writeFileSync(path.join(M, 'Descargas', 'leeme.txt'), 'no es música')
fs.writeFileSync(path.join(M, 'Descargas', 'thumbs.db'), 'basura de Windows')
fs.mkdirSync(afuera, { recursive: true })
fs.writeFileSync(path.join(afuera, 'testigo.txt'), 'si esto se borra, Vaciar siguió un acceso directo')
fs.copyFileSync(path.join(M, picked[0]), path.join(afuera, 'tema.mp3'))
log(`Biblioteca de prueba: ${picked.length} temas copiados de la Música + 5 samples + 2 que no son música`)

fs.mkdirSync(path.join(base, 'datos'), { recursive: true })
const lib = new Library(path.join(base, 'datos', 'paila.db'), ffprobe)
guardWith(lib.db, lib.ops)
await lib.addRoot(M, [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
await lib.scan()
const rootPath = (id: number) => lib.roots().find((r) => r.id === id && r.available)?.path ?? null
const playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
const trash = new Trash(lib.db, rootPath, playlists)
const replacer = new Replacer(lib.db, rootPath, ffprobe, ffmpeg)
const space = new Space(lib.db, () => lib.roots())
const hist = new History(lib.db, { changes: new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg), trash, organizer: new Organizer(lib.db, rootPath), replacer, improver: new Improver(lib.db), rootPath })
const ids = (lib.db.prepare("SELECT id, rel_path AS rel, ext FROM files WHERE kind = 'musica' ORDER BY rel_path").all() as { id: number; rel: string; ext: string }[])

// 2) llenar la papelera por todos los caminos
await lib.ops.run('test', async () => {
  const mp3 = ids.filter((x) => x.ext === 'mp3')
  const t1 = await trash.trash(mp3.slice(0, 3).map((x) => x.id), 'prueba vieja')
  const t2 = await trash.trash(mp3.slice(3, 6).map((x) => x.id), 'prueba nueva')
  log(`Papelera: ${t1.moved} + ${t2.moved} temas`)
  // la primera tanda "de hace 40 días": la fecha va en el nombre de la carpeta
  const folder = fs.readdirSync(path.join(M, '_PAILA', 'papelera')).find((n) => n.includes(`tanda-${t1.batchId}_`))!
  const d = new Date(Date.now() - 40 * 86_400_000), p = (n: number) => String(n).padStart(2, '0')
  const old = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_10-00-00${folder.slice(19)}`
  fs.renameSync(path.join(M, '_PAILA', 'papelera', folder), path.join(M, '_PAILA', 'papelera', old))
  lib.db.prepare('UPDATE trash_log SET trash_rel = replace(trash_rel, ?, ?) WHERE batch_id = ?').run(folder, old, t1.batchId)
  // un reemplazo: el MP3 por un FLAC hecho de él (el original va a la papelera)
  const cand = path.join(base, 'bajado', 'mejor.flac')
  fs.mkdirSync(path.dirname(cand), { recursive: true })
  ff('-i', path.join(M, ...mp3[6].rel.split('/')), cand)
  await replacer.replace(mp3[6].id, cand, { keepTags: true, keepCover: true, sameName: true })
  // WAV → FLAC (los WAV van a la papelera)
  const w = await space.wavToFlac(space.convertibles().map((x) => x.id).slice(0, 2), (i) => lib.trackPath(i), replacer, ffmpeg, path.join(base, 'datos', 'shrink'))
  log(`Reemplazo: 1; WAV→FLAC: ${w.converted} (fallas: ${w.failed.length})`)
  const l = await space.trashFiles([{ rootId: 1, rel: 'Descargas/leeme.txt' }, { rootId: 1, rel: 'Descargas/thumbs.db' }])
  log(`Limpieza de Espacio: ${l.moved}`)
})
// 3) trampas dentro de la papelera: un acceso directo de carpeta que apunta afuera y un archivo de solo lectura
const newest = trashUsage(lib.db, () => lib.roots()).folders[0]
const trap = path.join(M, '_PAILA', 'papelera', newest.folder, 'trampa')
let trapOk = true
try { fs.symlinkSync(afuera, trap, 'junction') } catch (e) { trapOk = false; log(`(El disco no admite accesos directos de carpeta, por ejemplo exFAT: esa trampa no se arma acá. ${(e as Error).message.split(',')[0]})`) }
const ro = path.join(M, '_PAILA', 'papelera', newest.folder, 'solo-lectura.txt')
fs.writeFileSync(ro, 'x'); fs.chmodSync(ro, 0o444)
const before = outsideTrash()
const u0 = trashUsage(lib.db, () => lib.roots())
log(`Papelera: ${u0.files} archivos, ${(u0.bytes / 1e6).toFixed(1)} MB en ${u0.folders.length} tandas (${u0.folders.map((f) => `${f.folder.slice(20)}: ${f.ageDays} días`).join(', ')})`)

// 4) vaciar: primero más de 30 días, después todo
const r1 = await lib.ops.run('test', () => purgeTrash(lib.db, () => lib.roots(), u0.folders.filter((f) => f.ageDays > 30).map((f) => f.key)))
log(`Vaciar más de 30 días: ${r1.deleted} borrados (${(r1.bytes / 1e6).toFixed(1)} MB), ${r1.kept.length} conservados, ${r1.failed.length} fallas`)
const u1 = trashUsage(lib.db, () => lib.roots())
log(`  quedan ${u1.folders.length} tandas, ninguna de más de 30 días: ${u1.folders.every((f) => f.ageDays <= 30)}`)
const r2 = await lib.ops.run('test', () => purgeTrash(lib.db, () => lib.roots(), u1.folders.map((f) => f.key)))
log(`Vaciar todo: ${r2.deleted} borrados (${(r2.bytes / 1e6).toFixed(1)} MB), ${r2.kept.length} conservados, ${r2.failed.length} fallas${r2.failed.length ? `: ${r2.failed.map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)

// 5) controles
const after = outsideTrash()
const changed = [...before].filter(([p, h]) => after.get(p) !== h).map(([p]) => path.relative(base, p))
const leftFiles = (fs.readdirSync(path.join(M, '_PAILA', 'papelera'), { recursive: true }) as string[]).filter((f) => { try { return fs.lstatSync(path.join(M, '_PAILA', 'papelera', f)).isFile() } catch { return false } })
log(`Lo de afuera de la papelera (${before.size} archivos, con el destino del acceso directo y los samples): ${changed.length ? `CAMBIÓ: ${changed.join(', ')}` : 'intacto'}`)
log(`acceso directo armado: ${trapOk}; afuera/testigo.txt sigue: ${fs.existsSync(path.join(afuera, 'testigo.txt'))}; samples: ${fs.readdirSync(path.join(M, 'Samples', 'Kit')).length} de 5`)
log(`Archivos que quedaron en la papelera: ${leftFiles.length ? leftFiles.join(', ') : 'ninguno'}`)
const h = hist.list().filter((e) => ['papelera', 'reemplazo', 'conversion', 'limpieza'].includes(e.kind))
for (const e of h) log(`  Historial ${e.kind} ${e.id}: puede deshacer=${e.canUndo} · ${e.whyNot ?? ''}`)
const tb = trash.batches()[0]
const rest = await lib.ops.run('test', () => trash.restore(tb.batchId))
log(`Restaurar la tanda ${tb.batchId}: ${rest.failed.map((f) => f.error)[0] ?? 'se restauró (MAL)'}`)
try { await lib.ops.run('test', () => replacer.undo(replacer.list()[0].id)); log('Deshacer reemplazo: se deshizo (MAL)') } catch (e) { log(`Deshacer reemplazo: ${(e as Error).message}`) }
lib.close()
