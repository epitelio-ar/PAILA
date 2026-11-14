// Corrida supervisada del motor único (masterplan 4, 4B.4; bitácora docs/pruebas/2026-10-23-motor-unico.md), sobre una COPIA de
// la base apuntando a D:\PAILA-trabajo\Música-copia. Nunca toca la Música original ni la base real (la real solo se lee para
// copiarla). Cada operación que toca archivos se aplica sobre una muestra, algunas se cortan a propósito (se mata el proceso en
// el medio), se revisa que todo quede coherente, se deshace todo desde el Historial y la copia se compara contra el original.
//   preparar: copia la base (VACUUM INTO), la apunta a la copia y elige las muestras (necesita copia-en-uso.lock).
//   paso:     una operación (--que …) sobre su muestra; con --cortar N la corre en otro proceso y lo MATA cuando lleva N pasos.
//   revisar:  "abre PAILA" (la recuperación al abrir) y controla que todo quedó coherente.
//   deshacer: deshace desde el Historial todo lo de la corrida, de lo más nuevo a lo más viejo, y vuelve a controlar.
//   vaciar:   vacía de la papelera de la copia solo lo que dejó esta corrida (lo único que se borra de verdad, y es la copia).
//   comparar: la copia contra el original: lo que falta, sobra o cambió; lo que cambió, por bytes, sonido y tags.
//   respaldos: cada respaldo de la corrida contra el original (tiene que ser idéntico: es lo de antes de escribir); con
//             --borrar, los borra como desde Configuración → Respaldos.
//
//   node scripts/run-ts.mjs scripts/motor-corrida.ts preparar --base <paila.db real> --datos <carpeta>
//   node scripts/run-ts.mjs scripts/motor-corrida.ts paso     --datos <carpeta> --que <operación> [--cortar N]
//   node scripts/run-ts.mjs scripts/motor-corrida.ts revisar  --datos <carpeta>
//   node scripts/run-ts.mjs scripts/motor-corrida.ts deshacer --datos <carpeta>
//   node scripts/run-ts.mjs scripts/motor-corrida.ts vaciar   --datos <carpeta>
//   node scripts/run-ts.mjs scripts/motor-corrida.ts comparar --datos <carpeta> --original <Música>
//   node scripts/run-ts.mjs scripts/motor-corrida.ts respaldos --datos <carpeta> --original <Música> [--borrar]
// Operaciones: organizar, tags, volumen, recortar, convertir, flac, papelera, limpieza, comprimido, pendrive, celular, listas,
// rekordbox, traktor, serato, virtualdj.
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { DEFAULT_RULE } from '@paila/core/organizer'
import { recover } from '@paila/core/recovery'
import { History } from '@paila/core/history'
import { gainChanges, gainPlan } from '@paila/core/replaygain'
import { applyTrim, planTrims, trimValue } from '@paila/core/trim'
import { convertForDj, djUnreadable } from '@paila/core/convert'
import { DEFAULT_EXPORT } from '@paila/core/export'
import { PhoneCopier } from '@paila/core/carry'
import { exportM3uLists } from '@paila/core/m3uexport'
import { DjExport } from '@paila/core/djexport'
import { purgeTrash, trashUsage } from '@paila/core/purge'
import { createServices } from '../apps/paila/electron/context'
import { comparar, respaldos } from './motor-comparar'
import { arg, count, count0, datos, dbFile, fail, log, mode, open, unknownFiles, visibles, type Antes } from './corte-base'

const corridaFile = datos && path.join(datos, 'corrida.json')
const salidas = datos && path.join(datos, 'salidas')
interface Corrida {
  startedAt: string
  antes: Antes
  muestras: Record<string, number[]>
  /** Organizar: de qué carpetas salen los temas de la muestra (la primera vista previa). */
  organizar?: string[]
}
const leer = () => JSON.parse(fs.readFileSync(corridaFile, 'utf8')) as Corrida
const guardar = (c: Corrida) => fs.writeFileSync(corridaFile, JSON.stringify(c))

/** Siempre la misma muestra para la misma base (mezcla por número de tema, sin azar). */
const mezcla = (ids: number[], salt: string) => [...ids].sort((a, b) => hash(`${salt}${a}`) - hash(`${salt}${b}`))
const hash = (s: string) => crypto.createHash('md5').update(s).digest().readUInt32LE(0)

async function preparar() {
  const base = arg('--base')
  if (!base || !datos) fail('Uso: preparar --base <paila.db> --datos <carpeta>')
  const copia = 'D:\\PAILA-trabajo\\Música-copia'
  if (!fs.existsSync(path.join(path.dirname(copia), 'copia-en-uso.lock'))) fail('Falta el aviso copia-en-uso.lock')
  if (fs.existsSync(dbFile)) fail(`Ya hay una base en ${dbFile}: borrala a mano si querés empezar de nuevo`)
  fs.mkdirSync(datos, { recursive: true })
  const src = new DatabaseSync(base, { readOnly: true })
  src.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`)
  src.close()
  const raw = new DatabaseSync(dbFile)
  raw.prepare('UPDATE roots SET rel_path = ? WHERE id = 1').run(path.relative(path.parse(copia).root, copia).split(path.sep).join('/'))
  raw.close()
  const { lib, root } = open()
  const antes: Antes = { files: visibles(lib), playlistItems: count(lib, 'SELECT COUNT(*) AS n FROM playlist_items'), batch: count(lib, 'SELECT COALESCE(MAX(batch_id), 0) AS n FROM moves_log'), unknown: unknownFiles(lib, root) }
  // los temas de la colección Música que están en el disco (los sample packs, sets e inéditos no entran en las muestras)
  const pool = (lib.db.prepare("SELECT id, rel_path AS rel, ext FROM files WHERE trashed_at IS NULL AND missing_at IS NULL AND excluded_at IS NULL AND error IS NULL AND kind = 'musica'").all() as { id: number; rel: string; ext: string }[])
    .filter((f) => fs.existsSync(path.join(root, ...f.rel.split('/'))))
  const ids = (salt: string, n: number, keep: (f: { ext: string }) => boolean = () => true) => mezcla(pool.filter(keep).map((f) => f.id), salt).slice(0, n)
  const writable = (f: { ext: string }) => ['mp3', 'flac', 'm4a', 'wav', 'aiff', 'aif'].includes(f.ext.toLowerCase())
  const lists = (lib.db.prepare("SELECT p.id FROM playlists p WHERE p.kind = 'list' AND (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) BETWEEN 5 AND 60 ORDER BY p.id").all() as { id: number }[]).map((r) => r.id)
  const muestras: Record<string, number[]> = {
    tags: ids('tags', 120, writable),
    renombrar: ids('tags', 30, writable),
    volumen: ids('volumen', 400),
    papelera: ids('papelera', 50),
    pendrive: ids('pendrive', 60),
    celular: ids('celular', 30),
    listas: lists.slice(0, 3),
    programas: lists.slice(0, 2),
  }
  guardar({ startedAt: new Date().toISOString(), antes, muestras })
  const missing = antes.files.filter((f) => !fs.existsSync(path.join(root, ...f.rel.split('/'))))
  log(`Copia lista: ${antes.files.length} temas visibles (${pool.length} de Música en el disco), ${antes.playlistItems} lugares en playlists. Sin archivo en la copia: ${missing.length}. Playlists para las listas: ${lists.length}`)
  lib.close()
}

/** Lo que va haciendo cada operación, sumado: sirve para saber cuándo matar el proceso en el medio. */
const PROGRESO = `SELECT (SELECT COUNT(*) FROM moves_log) + (SELECT COUNT(*) FROM journal) + (SELECT COUNT(*) FROM trash_log)
  + (SELECT COUNT(*) FROM replacements) + (SELECT COUNT(*) FROM copies_log) + (SELECT COUNT(*) FROM archive_extracted) AS n`

/** Una operación sobre su muestra, como la hace la app (con el candado tomado). */
async function hacer(que: string) {
  const { lib, root } = open()
  const ffmpeg = findFfmpeg()!, ffprobe = findFfprobe()!
  const c = createServices({ lib, ffprobe, ffmpeg, userData: datos, version: 'corrida' })
  const cor = leer()
  const pathOf = (id: number) => lib.trackPath(id)
  const out = (x: string) => path.join(salidas, x)
  c.changes.trimmer = (id, value, batch) => applyTrim(lib.db, c.replacer, pathOf, ffmpeg, path.join(datos, 'recortes'), id, value, batch)
  const run = <T>(fn: () => Promise<T> | T) => lib.ops.run(`corrida: ${que}`, fn)
  const fallas = (f: { rel?: string; name?: string; error: string }[]) => f.length ? ` · fallas ${f.length}: ${f.slice(0, 5).map((x) => `${x.rel ?? x.name} (${x.error})`).join('; ')}` : ''
  /** Aplicar solo los cambios pendientes de esta muestra (la copia de la base trae también los de verdad: esos no se tocan). */
  const aplicarPendientes = async (fileIds: number[], fields: string[]) => {
    const want = new Set(fileIds)
    const ids = c.changes.list().filter((x) => want.has(x.fileId) && fields.includes(x.field)).map((x) => x.id)
    const r = await run(() => c.changes.apply(ids))
    log(`aplicados ${r.applied} cambios en ${new Set(ids).size} pendientes${fallas(r.failed)}`)
  }
  switch (que) {
    case 'organizar': {
      const plan = c.organizer.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
      // la muestra: los temas de las primeras carpetas (en orden) hasta juntar ~300; se guarda para retomar después de un corte
      if (!cor.organizar) {
        const dirs: string[] = []
        let n = 0
        for (const m of [...plan.moves].sort((a, b) => a.from.localeCompare(b.from))) {
          const d = path.posix.dirname(m.from)
          if (!dirs.includes(d)) { if (n >= 300) break; dirs.push(d) }
          n++
        }
        cor.organizar = dirs; guardar(cor)
      }
      const dirs = new Set(cor.organizar)
      const sub = { ...plan, moves: plan.moves.filter((m) => dirs.has(path.posix.dirname(m.from))), extras: plan.extras.filter((x) => dirs.has(path.posix.dirname(x.from))) }
      log(`PLAN ${sub.moves.length} temas y ${sub.extras.length} acompañantes de ${dirs.size} carpetas (Organizar entero movería ${plan.moves.length})`)
      const r = await run(() => c.organizer.apply(sub))
      log(`movidos ${r.moved} + ${r.extras} acompañantes${fallas(r.failed)}`)
      break
    }
    case 'tags': {
      const ren = new Set(cor.muestras.renombrar)
      const items = cor.muestras.tags.flatMap((id) => {
        const rel = (lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id) as { rel: string }).rel
        const baseName = path.posix.basename(rel, path.posix.extname(rel))
        return [{ id, field: 'genre' as const, value: 'Prueba motor único' }, ...(ren.has(id) && !baseName.endsWith(' [motor]') ? [{ id, field: 'filename' as const, value: `${baseName} [motor]` }] : [])]
      })
      if (!c.changes.list().some((x) => x.field === 'genre' && x.after === 'Prueba motor único')) c.changes.stageMany(items)
      await aplicarPendientes(cor.muestras.tags, ['genre', 'filename'])
      break
    }
    case 'volumen': {
      const plan = await gainPlan(lib.db, pathOf, { readCurrent: true })
      const want = new Set(cor.muestras.volumen)
      const items = gainChanges(plan).filter((x) => want.has(x.id)).slice(0, 60)
      c.changes.stageMany(items)
      await aplicarPendientes(items.map((x) => x.id), ['replaygain'])
      break
    }
    case 'recortar': {
      if (!cor.muestras.recortar) {
        const cands = (lib.db.prepare("SELECT s.file_id AS id FROM silence s JOIN files f ON f.id = s.file_id WHERE f.kind = 'musica' AND (s.silence_start >= 2 OR s.silence_end >= 2) ORDER BY f.size LIMIT 40").all() as { id: number }[]).map((r) => r.id)
        const plan = await planTrims(lib.db, pathOf, ffmpeg, { ids: cands })
        cor.muestras.recortar = plan.items.slice(0, 8).map((p) => p.fileId); guardar(cor)
        const want = new Set(cor.muestras.recortar)
        c.changes.stageMany(plan.items.filter((p) => want.has(p.fileId)).map((p) => ({ id: p.fileId, field: 'trim' as const, value: trimValue(p) })))
        log(`propuestas: ${plan.items.length} de ${cands.length} candidatos; se recortan ${want.size}`)
      }
      await aplicarPendientes(cor.muestras.recortar, ['trim'])
      break
    }
    case 'convertir': {
      const ids = djUnreadable(lib.db).slice(0, 4).map((u) => u.id)
      const r = await run(() => convertForDj(lib.db, ids, 'mp3', pathOf, c.replacer, ffmpeg, ffprobe, path.join(datos, 'convert')))
      log(`convertir ${ids.length}: ${JSON.stringify({ ...r, failed: undefined })}${fallas(r.failed)}`)
      break
    }
    case 'flac': {
      const ids = c.space.convertibles().slice(0, 6).map((x) => x.id)
      const r = await run(() => c.space.wavToFlac(ids, pathOf, c.replacer, ffmpeg, path.join(datos, 'shrink')))
      log(`a FLAC ${r.converted} de ${ids.length}, ahorro ${(r.savedBytes / 1e6).toFixed(0)} MB${fallas(r.failed)}`)
      break
    }
    case 'papelera': {
      const r = await run(() => c.trash.trash(cor.muestras.papelera, 'corrida del motor único'))
      log(`a la papelera ${r.moved}${fallas(r.failed)}`)
      break
    }
    case 'limpieza': {
      const junk = c.space.junk().files.filter((f) => f.kind === 'basura' || f.kind === 'imagen').slice(0, 15)
      const r = await run(() => c.space.trashFiles(junk.map((f) => ({ rootId: f.rootId, rel: f.rel }))))
      log(`limpieza ${r.moved} de ${junk.length}${fallas(r.failed)}`)
      break
    }
    case 'comprimido': {
      const a = c.archives.list().filter((x) => !(x as { samplePack?: boolean }).samplePack && x.size < 300e6).sort((x, y) => x.size - y.size)
        .find((x) => { try { const p = c.archiveExtract.plan(x.id); return p.items.length > 0 } catch { return false } })
      if (!a) { log('No hay un comprimido para sacar en la copia'); break }
      const plan = c.archiveExtract.plan(a.id)
      const r = await run(() => c.archiveExtract.apply(plan))
      log(`sacado ${a.rel}: ${JSON.stringify(r).slice(0, 300)}`)
      break
    }
    case 'pendrive': {
      const plan = c.exporter.plan('Corrida motor', cor.muestras.pendrive, { ...DEFAULT_EXPORT, dest: out('pendrive') })
      const r = await run(() => c.exporter.run(plan))
      log(`pendrive: copiados ${r.copied}, convertidos ${r.converted}, ya estaban ${r.skippedExisting}${fallas(r.failed)}`)
      break
    }
    case 'celular': {
      const phone = new PhoneCopier(lib.db, pathOf, ffmpeg, ffprobe, () => lib.roots().filter((x) => x.available).map((x) => x.path))
      const plan = phone.plan('Corrida motor', cor.muestras.celular, { dest: out('celular'), format: 'aac', quality: 'normal', layout: 'lista', numbered: true })
      const r = await run(() => phone.run(plan))
      log(`celular: copiados ${r.copied}, convertidos ${r.converted}, ya estaban ${r.skippedExisting}${fallas(r.failed)}`)
      break
    }
    case 'listas': {
      const r = await run(() => exportM3uLists(lib.db, c.playlists, pathOf, cor.muestras.listas, { dir: out('listas'), relative: false }))
      log(`listas: ${r.files.map((f) => `${f.name} (${f.tracks})`).join(', ')}`)
      break
    }
    case 'rekordbox': {
      // dos veces al mismo archivo: la segunda tiene que guardar la primera en PAILA-respaldos
      for (let i = 0; i < 2; i++) {
        const r = await run(() => c.rekordbox.export({ scope: 'playlists', playlistIds: cor.muestras.programas, dest: out('programas/rekordbox.xml'), grid: true, suggestedCues: false, pailaWhenMoving: false }))
        log(`rekordbox.xml: ${r.tracks} temas, ${r.playlists} listas`)
      }
      break
    }
    case 'traktor': case 'serato': case 'virtualdj': {
      // una "carpeta de usuario" de prueba: las crates, la base de VirtualDJ y el .nml van ahí, nunca a las de los programas
      const dj = new DjExport(c.rekordbox, out('programas/home'), out('programas/vdj'))
      const o = { scope: 'playlists' as const, playlistIds: cor.muestras.programas, grid: true, suggestedCues: false, pailaWhenMoving: false }
      for (let i = 0; i < 2; i++) {
        const r = await run(() => que === 'traktor' ? dj.traktor({ ...o, dest: out('programas/PAILA para Traktor.nml') }) : que === 'serato' ? dj.serato(o) : dj.virtualdj(o))
        log(`${que}: ${r.written.length} archivos, respaldos ${r.backups.length}`)
      }
      break
    }
    default: fail(`No conozco la operación ${que}`)
  }
  log('TERMINÓ')
  void root
  lib.close()
}

async function paso() {
  const que = arg('--que'), cortar = Number(arg('--cortar', '0'))
  if (!que) fail('Uso: paso --datos <carpeta> --que <operación> [--cortar N]')
  if (!cortar) { await hacer(que); return }
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const before = count0(db, PROGRESO)
  const child = spawn(process.execPath, ['scripts/run-ts.mjs', 'scripts/motor-corrida.ts', 'hijo', '--datos', datos, '--que', que], { stdio: ['ignore', 'pipe', 'inherit'] })
  child.stdout.on('data', (d) => process.stdout.write(`  [hijo] ${d}`))
  const t0 = Date.now()
  let killed = false
  await new Promise<void>((resolve) => {
    const iv = setInterval(() => {
      const now = count0(db, PROGRESO)
      if (now - before >= cortar) {
        clearInterval(iv)
        killed = true
        try { execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }) } catch { /* ya terminó */ }
        log(`MATADO con ${now - before} pasos anotados (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
        resolve()
      }
    }, 15)
    child.on('exit', () => { clearInterval(iv); if (!killed) log('El proceso terminó antes de matarlo: probá con un --cortar más chico'); resolve() })
  })
  log(`Anotaciones del diario sin resolver después del corte: ${count0(db, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')}`)
  db.close()
}

/** Lo que tiene que valer después de cada paso: cada tema una vez y donde la base dice, nada de más, playlists intactas, diario vacío. */
function controlar(lib: ReturnType<typeof open>['lib'], root: string, antes: Antes, original: boolean): string[] {
  const bad: string[] = []
  const now = new Map((lib.db.prepare('SELECT id, rel_path AS rel, trashed_at AS trashed FROM files').all() as { id: number; rel: string; trashed: string | null }[]).map((f) => [f.id, f]))
  for (const f of antes.files) {
    const n = now.get(f.id)
    if (!n) { bad.push(`falta el tema ${f.id} (${f.rel})`); continue }
    if (n.trashed && !original) continue // en la papelera: lo controla su registro
    if (!fs.existsSync(path.join(root, ...n.rel.split('/')))) bad.push(`la base dice ${n.rel} y ahí no hay archivo`)
    if (original && (n.rel !== f.rel || n.trashed)) bad.push(`${f.rel} no volvió a su lugar (está en ${n.trashed ? 'la papelera' : n.rel})`)
  }
  const before = new Set(antes.unknown)
  for (const rel of unknownFiles(lib, root)) if (!before.has(rel)) bad.push(`archivo que la base no conoce: ${rel}`)
  const pl = count(lib, 'SELECT COUNT(*) AS n FROM playlist_items')
  if (pl !== antes.playlistItems) bad.push(`lugares en playlists: ${antes.playlistItems} → ${pl}`)
  const op = count(lib, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')
  if (op) bad.push(`${op} anotaciones del diario sin resolver`)
  // lo que quedó de una copia cortada afuera (pendrive, celular, programas): ninguna copia temporal suelta
  if (fs.existsSync(salidas)) for (const f of fs.readdirSync(salidas, { recursive: true }) as string[]) if (/\.paila-tmp/.test(f)) bad.push(`copia temporal suelta: ${f}`)
  return bad
}

async function revisar() {
  const { lib, root, rootPath } = open()
  const cor = leer()
  const rep = await lib.ops.run('revisando', () => recover(lib.db, { rootPath, ffmpeg: findFfmpeg()!, backupDir: path.join(datos, 'resguardo'), workDirs: [path.join(datos, 'convert'), path.join(datos, 'shrink'), path.join(datos, 'recortes')] }))
  const by = new Map<string, number>()
  for (const i of rep.items) by.set(i.result, (by.get(i.result) ?? 0) + 1)
  log(`Recuperación al abrir: ${rep.items.length} avisos ${JSON.stringify(Object.fromEntries(by))}`)
  for (const i of rep.items) log(`  ${i.result} · ${i.op}: ${i.message}`)
  lib.db.prepare('UPDATE op_journal SET seen_at = ? WHERE recovered_at IS NOT NULL AND seen_at IS NULL').run(new Date().toISOString())
  const bad = controlar(lib, root, cor.antes, false)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : 'Todo coherente: cada tema donde la base dice, nada de más, playlists intactas, diario vacío, sin copias temporales sueltas.')
  lib.close()
}

/** Como el Historial: deshace todo lo de la corrida, de lo más nuevo a lo más viejo. */
async function deshacer() {
  const { lib, root, rootPath } = open()
  const cor = leer()
  const c = createServices({ lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: datos, version: 'corrida' })
  const h = new History(lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, imports: c.imports, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, rootPath })
  const mine = h.list().filter((e) => e.at >= cor.startedAt)
  log(`Del Historial, de esta corrida: ${mine.map((e) => `${e.kind} ${e.id} (${e.files}${e.undone ? ', deshecha' : ''}${e.canUndo ? '' : `, no: ${e.whyNot}`})`).join(' · ')}`)
  for (const e of mine) {
    if (!e.canUndo) continue
    const t0 = Date.now()
    try {
      const r = await lib.ops.run('deshaciendo', () => h.undo(e.kind, e.id))
      log(`Deshecho ${e.kind} ${e.id}: ${r.done} en ${((Date.now() - t0) / 1000).toFixed(1)} s${r.failed.length ? ` · fallas ${r.failed.length}: ${r.failed.slice(0, 5).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
    } catch (err) { log(`NO se pudo deshacer ${e.kind} ${e.id}: ${(err as Error).message}`) }
  }
  const quedan = h.list().filter((e) => e.at >= cor.startedAt && e.canUndo && !e.undone)
  if (quedan.length) log(`Quedan sin deshacer: ${quedan.map((e) => `${e.kind} ${e.id}: ${e.summary}`).join(' · ')}`)
  const bad = controlar(lib, root, cor.antes, true)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 60).join('\n  ')}` : 'Todo volvió a su lugar.')
  lib.close()
}

/** Vacía de la papelera de la copia solo las carpetas que dejó esta corrida. */
async function vaciar() {
  const { lib } = open()
  const cor = leer()
  const roots = () => lib.roots()
  const mine = trashUsage(lib.db, roots).folders.filter((f) => f.createdAt >= cor.startedAt)
  log(`Carpetas de la papelera de esta corrida: ${mine.length} (${mine.reduce((s, f) => s + f.files, 0)} archivos): ${mine.map((f) => f.folder).join(', ')}`)
  const r = await lib.ops.run('vaciando', () => purgeTrash(lib.db, roots, mine.map((f) => f.key)))
  log(`Vaciado: ${r.deleted} archivos, ${(r.bytes / 1e6).toFixed(0)} MB, ${r.folders} carpetas; guardados ${r.kept.length}${r.failed.length ? `; fallas ${r.failed.length}: ${r.failed.slice(0, 5).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  lib.close()
}

const MODES: Record<string, () => Promise<void>> = { preparar, paso, hijo: () => hacer(arg('--que')), revisar, deshacer, vaciar, respaldos: () => respaldos(leer().startedAt), comparar: () => comparar(arg('--original'), leer().startedAt) }
if (!MODES[mode]) fail(`Modo desconocido: ${mode}`)
await MODES[mode]()
