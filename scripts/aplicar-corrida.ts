// Corrida supervisada de la etapa 2 del MASTERPLAN-5 (las propuestas guardadas y un solo Aplicar; bitácora en docs/pruebas/), sobre una
// COPIA de la base apuntando a D:\PAILA-trabajo\Música-copia. Nunca toca la Música original ni la base real (la real solo se lee
// para copiarla). Cambia por dónde pasa todo lo que escribe, así que se mira entero y se aplica una muestra:
//   preparar: copia la base (VACUUM INTO) y la apunta a la copia (necesita el aviso copia-en-uso.lock).
//   vista:    la vista previa de TODO: repetidos, nombres y carpetas sobre cómo van a quedar (con los repetidos afuera y los nombres
//             nuevos), con ejemplos para revisar a ojo (vista.md). No toca archivos.
//   aplicar:  deja en la lista una muestra (~400 temas: repetidos, nombres, lo que se mueve y cover.jpg de discos que se mueven),
//             cambia 3 archivos "por afuera" (riesgo 2) y aplica con el Aplicar único. Después revisa: cada tema donde la base dice,
//             ningún "(2)" nuevo, cada cover.jpg en la carpeta nueva, los 3 tocados sin tocar y la tanda con sus partes.
//   deshacer: deshace desde el Historial lo de la corrida, de lo más nuevo a lo más viejo, y controla que todo volvió.
//   comparar: la copia contra el original (scripts/motor-comparar.ts).
//
//   node scripts/run-ts.mjs scripts/aplicar-corrida.ts preparar --base <paila.db real> --datos <carpeta>
//   node scripts/run-ts.mjs scripts/aplicar-corrida.ts vista|aplicar|deshacer --datos <carpeta>
//   node scripts/run-ts.mjs scripts/aplicar-corrida.ts comparar --datos <carpeta> --original "D:/Música"
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { findDuplicates } from '@paila/core/duplicates'
import { History } from '@paila/core/history'
import { tidy, toProposals } from '@paila/core/tidy'
import { rulesOf, DEFAULT_PROFILE, type TidyRule } from '@paila/shared/tidy-profiles'
import { readCover } from '@paila/core/tagio'
import { reglaElegida } from '@paila/core/estado-dejar'
import { aplicarTodo, descartar, paraAplicar } from '@paila/core/aplicar'
import { proponerMover, proponerPapelera } from '@paila/core/propuestas'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import { createServices } from '../apps/paila/electron/context'
import { comparar } from './motor-comparar'
import { arg, controlar, count, datos, dbFile, fail, log, mode, open, unknownFiles, visibles, type Antes } from './corte-base'

const corridaFile = datos && path.join(datos, 'corrida.json')
interface Corrida { startedAt: string; antes: Antes; tocados?: { id: number; rel: string; que: string }[]; tapas?: { id: number; dir: string }[]; dosAntes?: string[] }
const leer = () => JSON.parse(fs.readFileSync(corridaFile, 'utf8')) as Corrida
const guardar = (c: Corrida) => fs.writeFileSync(corridaFile, JSON.stringify(c, null, 1))
const mezcla = (ids: number[], salt: string) => [...ids].sort((a, b) => hash(`${salt}${a}`) - hash(`${salt}${b}`))
const hash = (s: string) => crypto.createHash('md5').update(s).digest().readUInt32LE(0)
const seg = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)} s`

function servicios() {
  const { lib, root, rootPath } = open()
  const c = createServices({ lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: datos, version: 'corrida' })
  const reglas = (): TidyRule[] => { try { const v = (lib.db.prepare("SELECT value FROM settings WHERE key = 'tidy.reglas'").get() as { value: string } | undefined)?.value; return v ? JSON.parse(v) : rulesOf(DEFAULT_PROFILE) } catch { return rulesOf(DEFAULT_PROFILE) } }
  return { lib, root, rootPath, c, reglas, pathOf: (id: number) => lib.trackPath(id) }
}

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
  // otras carpetas de música (fuera de D:\Música) no entran: la corrida mira solo la copia (se sacan de la COPIA de la base)
  raw.exec('PRAGMA foreign_keys = ON')
  const otras = (raw.prepare('SELECT COUNT(*) AS n FROM files WHERE root_id != 1').get() as { n: number }).n
  raw.exec('DELETE FROM files WHERE root_id != 1; DELETE FROM roots WHERE id != 1')
  if (otras) log(`Sin las otras carpetas de música: ${otras} temas afuera de la copia.`)
  raw.close()
  const { lib, root } = open() // migra la copia de la base a la versión de hoy (v56)
  const antes: Antes = { files: visibles(lib), playlistItems: count(lib, 'SELECT COUNT(*) AS n FROM playlist_items'), batch: 0, unknown: unknownFiles(lib, root) }
  guardar({ startedAt: new Date().toISOString(), antes, dosAntes: antes.files.map((f) => f.rel).filter((r) => / \(\d+\)\.[^./]+$/.test(r)) })
  log(`Copia lista: ${antes.files.length} temas visibles, ${antes.playlistItems} lugares en playlists, ${antes.unknown.length} audios sin fila.`)
  lib.close()
}

/** La vista previa de todo, sin tocar archivos: deja en la lista los repetidos seguros y los nombres, y mira Organizar sobre el futuro. */
async function vista() {
  const { lib, c, reglas, pathOf } = servicios()
  descartar(lib.db, c.changes)
  let t0 = Date.now()
  const grupos = await findDuplicates(lib.db, pathOf)
  guardarRepetidos(lib.db, grupos)
  const seguros = grupos.filter((g) => g.keep != null && !g.decidir && g.level !== 'version')
  const papelera = seguros.flatMap((g) => g.items.filter((i) => i.id !== g.keep).map((i) => ({ id: i.id, kept: g.keep })))
  proponerPapelera(lib.db, papelera, 'Duplicados') // idioma-ok: el motivo de la tanda
  const out: string[] = [`# Vista previa de todo (copia de la base, ${new Date().toLocaleString('es-AR')})`, '',
    `## Repetidos (${seg(t0)})`, `${grupos.length} grupos: ${seguros.length} seguros (${papelera.length} copias a la papelera), ${grupos.filter((g) => g.decidir || g.level === 'probable').length} para decidir vos, ${grupos.filter((g) => g.level === 'version').length} de versiones.`, '']
  for (const g of mezcla(seguros.map((_, i) => i), 'rep').slice(0, 25).map((i) => seguros[i])) {
    const k = g.items.find((i) => i.id === g.keep)!
    out.push(`- [${g.level}] se queda \`${k.rel}\` · se van: ${g.items.filter((i) => i.id !== g.keep).map((i) => `\`${i.rel}\``).join(', ')}`)
  }
  t0 = Date.now()
  const ch = tidy(lib.db, undefined, pathOf, reglas()).changes
  const st = c.changes.stageMany(toProposals(ch))
  out.push('', `## Nombres (${seg(t0)})`, `${ch.length} cambios en ${new Set(ch.map((x) => x.id)).size} temas (sin los que van a la papelera): ${st.staged} en la lista, ${st.held} para mirar a mano, ${st.skipped} que no se pueden escribir.`, '')
  for (const x of mezcla(ch.map((_, i) => i), 'nom').slice(0, 40).map((i) => ch[i])) out.push(`- \`${x.rel}\` · ${x.field}: «${x.from ?? ''}» → «${x.to}»`)
  t0 = Date.now()
  const regla = reglaElegida(lib.db)
  const hoy = c.organizer.plan(regla), futuro = c.organizer.plan(regla, true)
  const destHoy = new Map(hoy.moves.map((m) => [m.fileId, m.to]))
  const cambiaPorNombre = futuro.moves.filter((m) => destHoy.has(m.fileId) && destHoy.get(m.fileId) !== m.to)
  out.push('', `## Carpetas, sobre cómo van a quedar (${seg(t0)})`, `Regla: \`${regla.rule}\` en \`${regla.dest || '(raíz)'}\`.`,
    `Hoy: ${hoy.moves.length} se mueven, ${hoy.conflicts} chocan ("(2)"). Después de aplicar lo de la lista: ${futuro.moves.length} se mueven, ${futuro.conflicts} chocan (no se suman sin aceptar el "(2)").`,
    `${cambiaPorNombre.length} temas van a otro lugar que hoy porque cambia su nombre; ${hoy.conflicts - futuro.conflicts} choques desaparecen porque una copia se va a la papelera.`, '')
  for (const m of mezcla(cambiaPorNombre.map((_, i) => i), 'car').slice(0, 25).map((i) => cambiaPorNombre[i])) out.push(`- \`${m.from}\` → hoy \`${destHoy.get(m.fileId)}\`, con el nombre nuevo \`${m.to}\``)
  for (const x of (futuro.clashes ?? []).slice(0, 15)) out.push(`- choca: \`${x.from}\` ↔ \`${x.with}\``)
  fs.writeFileSync(path.join(datos, 'vista.md'), out.join('\n'))
  log(out.slice(0, 4).join('\n')); log(`Vista completa en ${path.join(datos, 'vista.md')}`)
  lib.close()
}

/** Una muestra de ~400 temas en la lista, 3 tocados "por afuera", y el Aplicar único. */
async function aplicar() {
  const { lib, root, c, pathOf } = servicios()
  const cor = leer()
  const lista = paraAplicar(lib.db, c.changes)
  // la muestra: 30 repetidos, los nombres de 150 temas, lo que mueve Organizar (de esos y 380 más) y 15 discos con cover.jpg nuevo
  const pap = lista.filter((x) => x.field === 'papelera'), nom = lista.filter((x) => x.id > 0)
  const papSi = new Set(mezcla(pap.map((x) => x.fileId), 'pap').slice(0, 30))
  const nomSi = new Set(mezcla([...new Set(nom.map((x) => x.fileId))], 'nom').slice(0, 150))
  descartar(lib.db, c.changes, [...pap.filter((x) => !papSi.has(x.fileId)).map((x) => x.id), ...nom.filter((x) => !nomSi.has(x.fileId)).map((x) => x.id)])
  const regla = reglaElegida(lib.db)
  const plan = c.organizer.plan(regla, true), choca = new Set((plan.clashes ?? []).map((x) => x.fileId))
  const libres = plan.moves.filter((m) => !choca.has(m.fileId))
  const otros = new Set(mezcla(libres.map((m) => m.fileId).filter((id) => !nomSi.has(id)), 'mov').slice(0, 380))
  const mover = libres.filter((m) => nomSi.has(m.fileId) || otros.has(m.fileId))
  proponerMover(lib.db, mover)
  // cover.jpg con la tapa que ya tiene adentro el primer tema: tiene que caer en la carpeta NUEVA (va después de mover)
  const tapas: { id: number; dir: string }[] = []
  for (const m of mezcla(mover.map((x) => x.fileId), 'tap')) {
    if (tapas.length >= 15) break
    const m2 = mover.find((x) => x.fileId === m)!
    if (path.posix.dirname(m2.from) === path.posix.dirname(m2.to) || tapas.some((t) => t.dir === path.posix.dirname(m2.to))) continue
    let v: string | null = null
    try { v = readCover(pathOf(m)!) } catch { /* sin tapa legible */ }
    if (!v || !/image\/jpe?g/i.test(v) || fs.existsSync(path.join(root, ...path.posix.dirname(m2.from).split('/'), 'cover.jpg'))) continue
    c.changes.stage([m], 'folderCover', v)
    if (lib.db.prepare("SELECT 1 FROM pending_changes WHERE file_id = ? AND field = 'folderCover'").get(m)) tapas.push({ id: m, dir: path.posix.dirname(m2.to) })
  }
  // riesgo 2: tres archivos cambiados "por afuera" después de proponerlos (en la copia): no se tienen que tocar
  const tocados: Corrida['tocados'] = []
  const tocar = (id: number, que: string) => { const p = pathOf(id)!; fs.appendFileSync(p, Buffer.alloc(128)); const t = new Date(Date.now() + 120_000); fs.utimesSync(p, t, t); tocados.push({ id, rel: lib.trackPath(id)!.slice(root.length + 1).split(path.sep).join('/'), que }) }
  const conTags = new Set(paraAplicar(lib.db, c.changes).filter((x) => x.id > 0 && x.field !== 'folderCover').map((x) => x.fileId))
  const conMover = new Set(mover.map((m) => m.fileId))
  tocar([...papSi][0], 'papelera')
  tocar([...conTags].find((id) => !conMover.has(id))!, 'nombres')
  tocar([...conMover].find((id) => !conTags.has(id) && !tapas.some((t) => t.id === id))!, 'mover')
  const enLista = paraAplicar(lib.db, c.changes)
  const cuenta = (f: (x: typeof enLista[number]) => boolean) => enLista.filter(f).length
  log(`En la lista: ${cuenta((x) => x.field === 'papelera')} a la papelera, ${cuenta((x) => x.id > 0 && x.field !== 'folderCover')} cambios de nombre/tags en ${conTags.size} temas, ${cuenta((x) => x.field === 'mover')} se mueven, ${tapas.length} cover.jpg. Tocados por afuera: ${tocados.map((t) => `${t.que} ${t.rel}`).join(' · ')}`)
  guardar({ ...cor, tocados, tapas })
  const t0 = Date.now()
  const r = await lib.ops.run('corrida: aplicar', () => aplicarTodo({ db: lib.db, changes: c.changes, trash: c.trash, organizer: c.organizer }))
  log(`Aplicar único en ${seg(t0)}: ${JSON.stringify(r.partes)} · tanda ${r.tanda} · ${r.failed.length} no se pudieron:`)
  const motivos = new Map<string, number>()
  for (const f of r.failed) motivos.set(f.error, (motivos.get(f.error) ?? 0) + 1)
  for (const [m, n] of motivos) log(`  ${n} · ${m}`)
  revisar(lib, root, leer())
  lib.close()
}

function revisar(lib: ReturnType<typeof open>['lib'], root: string, cor: Corrida) {
  const bad: string[] = []
  for (const f of visibles(lib)) if (!fs.existsSync(path.join(root, ...f.rel.split('/')))) bad.push(`la base dice ${f.rel} y ahí no hay archivo`)
  const dosAntes = new Set(cor.dosAntes ?? [])
  for (const f of visibles(lib)) if (/ \(\d+\)\.[^./]+$/.test(f.rel) && !dosAntes.has(f.rel) && !cor.antes.files.some((a) => a.id === f.id && a.rel === f.rel)) bad.push(`"(2)" nuevo: ${f.rel}`)
  for (const t of cor.tapas ?? []) {
    const ahora = lib.trackPath(t.id)!, puesta = lib.db.prepare("SELECT 1 FROM journal WHERE file_id = ? AND field = 'folderCover' AND undone_at IS NULL").get(t.id)
    if (puesta && !fs.existsSync(path.join(path.dirname(ahora), 'cover.jpg'))) bad.push(`cover.jpg no está en la carpeta nueva: ${path.dirname(ahora)}`)
  }
  for (const t of cor.tocados ?? []) {
    const ahora = (lib.db.prepare('SELECT rel_path AS r, trashed_at AS tr FROM files WHERE id = ?').get(t.id) as { r: string; tr: string | null })
    if (ahora.tr || ahora.r !== t.rel) bad.push(`el tocado (${t.que}) se movió igual: ${t.rel} → ${ahora.r}`)
    if (lib.db.prepare('SELECT 1 FROM journal WHERE file_id = ? AND undone_at IS NULL AND applied_at >= ?').get(t.id, cor.startedAt)) bad.push(`al tocado (${t.que}) se le escribió igual: ${t.rel}`)
  }
  const abiertas = count(lib, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')
  if (abiertas) bad.push(`${abiertas} anotaciones del diario sin resolver`)
  const tanda = lib.db.prepare('SELECT partes FROM tandas ORDER BY id DESC LIMIT 1').get() as { partes: string } | undefined
  log(`Tanda anotada: ${tanda?.partes ?? 'ninguna'}`)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : 'Todo en orden: cada tema donde la base dice, sin "(2)" nuevos, cada cover.jpg en la carpeta nueva y los 3 tocados por afuera sin tocar.')
}

async function deshacer() {
  const { lib, root, rootPath, c } = servicios()
  const cor = leer()
  const h = new History(lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, imports: c.imports, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, rootPath })
  const mine = h.list().filter((e) => e.at >= cor.startedAt && !e.undone && e.canUndo)
  log(`Del Historial, de esta corrida: ${mine.map((e) => `${e.kind} ${e.id} (${e.files})`).join(' · ')}`)
  for (const e of mine) {
    const t0 = Date.now()
    const r = await lib.ops.run('deshaciendo', () => h.undo(e.kind, e.id))
    log(`Deshecho ${e.kind} ${e.id}: ${r.done} en ${seg(t0)}${r.failed.length ? ` · fallas ${r.failed.length}: ${r.failed.slice(0, 5).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  }
  descartar(lib.db, c.changes)
  // los 3 tocados por afuera cambiaron de tamaño a propósito: es lo único que puede diferir
  const tocados = new Set((cor.tocados ?? []).map((t) => t.rel))
  const bad = controlar(lib, root, cor.antes, true).filter((b) => ![...tocados].some((t) => b.startsWith(`${t} cambió de tamaño`)))
  log(bad.length ? `PROBLEMAS después de deshacer (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : `Todo volvió: cada tema en su lugar, con su tamaño (salvo los ${tocados.size} tocados por afuera), playlists intactas, diario vacío.`)
  lib.close()
}

if (mode === 'preparar') await preparar()
else if (mode === 'vista') await vista()
else if (mode === 'aplicar') await aplicar()
else if (mode === 'deshacer') await deshacer()
else if (mode === 'comparar') await comparar(arg('--original'), leer().startedAt)
else fail('Modos: preparar, vista, aplicar, deshacer, comparar')
