// La última medición de la etapa 3 del MASTERPLAN-5 (bitácora docs/pruebas/mp5-etapa3-aplicar-400.md): Ordenar armado sobre una COPIA
// de la base apuntando a D:\PAILA-trabajo\Música-copia, unas cartas contestadas, una muestra tildada (lo demás destildado) y el Aplicar
// único; después, la copia contra la Música original y el deshacer encadenado desde el Historial. Nunca toca D:\Música ni la base real
// (corte-base.ts se niega a abrir una base que no apunte a la copia). La copia de la base se prepara con aplicar-corrida.ts preparar.
//   armar:    la revisión de Ordenar con la regla que ya tiene la Biblioteca (disco con año, sin número); vuelca la vista previa entera.
//   aplicar:  contesta cartas de cada tipo, deja tildada la muestra (todos los grupos), destilda lo demás, anota la vista previa de lo
//             tildado y aplica con aplicarTodo. Después controla cada cambio contra su vista previa.
//   comparar: la copia contra el original: fuera de lo aplicado nada cambió, sin carpetas vacías de más ni "(2)" sin aceptar, y cada
//             tema que salió de su lugar está en su lugar nuevo o en la papelera de PAILA.
//   deshacer: deshace lo de la corrida desde el Historial, en cadena, y controla que todo volvió (después: robocopy /L).
//
//   node scripts/run-ts.mjs scripts/aplicar-corrida.ts preparar --base <paila.db real> --datos <carpeta>
//   node scripts/run-ts.mjs scripts/ordenar-aplicar-400.ts armar|aplicar|comparar|deshacer --datos <carpeta> [--original "D:/Música"]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { findDuplicates } from '@paila/core/duplicates'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import { History } from '@paila/core/history'
import { readTags } from '@paila/core/tagio'
import { armarCarpetas, armarRevision, decidir, delNombre, elegirCarpetas } from '@paila/core/revision-armar'
import { leerRevision } from '@paila/core/revision'
import { apagar } from '@paila/core/revision-apagados'
import { aplicarTodo, descartar } from '@paila/core/aplicar'
import { reglasGuardadas } from '@paila/core/tidy-reglas'
import { AUDIO_EXT } from '@paila/core/files'
import type { CartaRevision, FilaRevision, GrupoRevision, OrganizeOptions } from '@paila/shared/types'
import { createServices } from '../apps/paila/electron/context'
import { arg, controlar, datos, fail, log, mode, open, type Antes } from './corte-base'

const REGLA: OrganizeOptions = { rule: '%artista%/%año% - %album%/%titulo%', dest: 'Biblioteca' } // idioma-ok: la que ya tiene la Biblioteca
const MUESTRA = 400
const COPIA = 'D:\\PAILA-trabajo\\Música-copia'
if (!datos) fail('Falta --datos <carpeta>')
const corridaFile = path.join(datos, 'corrida.json')
interface Corrida { startedAt: string; antes: Antes; dosAntes?: string[]; vista?: FilaVista[]; cartas?: string[]; apagadas?: number; aplicado?: unknown }
interface FilaVista { grupo: GrupoRevision; clave: string; fileId: number; rel: string; campo: string; antes: string | null; despues: string | null }
const leer = () => JSON.parse(fs.readFileSync(corridaFile, 'utf8')) as Corrida
const guardar = (c: Corrida) => fs.writeFileSync(corridaFile, JSON.stringify(c, null, 1))
const hash = (s: string) => crypto.createHash('md5').update(s).digest().readUInt32LE(0)
const mezcla = <T>(xs: T[], salt: string, k: (x: T) => string) => [...xs].sort((a, b) => hash(salt + k(a)) - hash(salt + k(b)))
const seg = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)} s`

function servicios() {
  const { lib, root, rootPath } = open()
  const c = createServices({ lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: datos, version: 'corrida' })
  const setting = (k: string) => (lib.db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
  const pathOf = (id: number) => lib.trackPath(id)
  const deps = () => ({ db: lib.db, changes: c.changes, organizer: c.organizer, pathOf, reglas: reglasGuardadas(setting) })
  const revision = () => leerRevision(lib.db, c.changes, c.organizer)
  return { lib, root, rootPath, c, deps, revision, pathOf }
}
const filas = (r: ReturnType<ReturnType<typeof servicios>['revision']>) =>
  (Object.entries(r.grupos) as [GrupoRevision, FilaRevision[]][]).flatMap(([grupo, fs_]) => fs_.map((f) => ({ grupo, ...f })))
const cuenta = (r: ReturnType<ReturnType<typeof servicios>['revision']>) =>
  Object.fromEntries(Object.entries(r.grupos).map(([g, f]) => [g, `${f.filter((x) => x.on).length}/${f.length}`]))

async function armar() {
  const { lib, c, deps, revision, pathOf } = servicios()
  descartar(lib.db, c.changes)
  const t0 = Date.now()
  guardarRepetidos(lib.db, await findDuplicates(lib.db, pathOf))
  elegirCarpetas(deps(), REGLA)
  armarRevision(deps())
  const r = revision()
  log(`Armado en ${seg(t0)} · tildado/total por grupo: ${JSON.stringify(cuenta(r))} · cartas: ${['par', 'choque', 'quien'].map((t) => `${t} ${r.decidir.filter((x) => x.tipo === t).length}`).join(', ')}`)
  fs.writeFileSync(path.join(datos, 'vista-armada.json'), JSON.stringify({ grupos: r.grupos, decidir: r.decidir }, null, 1))
  lib.close()
}

/** Contesta unas cartas de cada tipo (lo que haría una persona) y devuelve qué contestó. */
function contestar(s: ReturnType<typeof servicios>, cartas: CartaRevision[]): string[] {
  const hechas: string[] = []
  const de = (t: CartaRevision['tipo']) => mezcla(cartas.filter((x) => x.tipo === t), 'carta', (x) => x.clave)
  const uno = (k: string, e: Parameters<typeof decidir>[2], que: string) => { try { decidir(s.deps(), k, e, false); hechas.push(`${k} → ${que}`) } catch (err) { hechas.push(`${k} → ${que} (NO: ${(err as Error).message})`) } }
  const par = de('par') as Extract<CartaRevision, { tipo: 'par' }>[]
  for (const x of par.slice(0, 4)) uno(x.clave, 'mejor', 'se queda el mejor')
  for (const x of par.slice(4, 5)) uno(x.clave, 'distintos', 'son distintos')
  const choque = de('choque') as Extract<CartaRevision, { tipo: 'choque' }>[]
  for (const x of choque.slice(0, 1)) uno(x.clave, 'version', 'los dos, con (2)')
  for (const x of choque.slice(1, 2)) uno(x.clave, 'dejar', 'este no se mueve')
  const quien = de('quien') as Extract<CartaRevision, { tipo: 'quien' }>[]
  // la persona acepta la sugerencia cuando es buena (no "Unknown Artist" ni un código de catálogo: esas las corregiría a mano)
  const buena = (q: Extract<CartaRevision, { tipo: 'quien' }>) => !!q.sugerido && !/unknown|^[A-Z]{2,6}\d{2,4}$/i.test(q.sugerido.artista)
  for (const x of quien.filter(buena).slice(0, 2)) uno(x.clave, { artista: x.sugerido!.artista, titulo: x.sugerido!.titulo }, `${x.sugerido!.artista} — ${x.sugerido!.titulo}`)
  for (const x of quien.filter((q) => !q.sugerido).slice(0, 2)) {
    const d = delNombre(x.rel) ?? { artista: 'Prueba PAILA', titulo: path.posix.basename(x.rel, path.posix.extname(x.rel)) }
    uno(x.clave, { artista: d.artista, titulo: d.titulo }, `a mano: ${d.artista} — ${d.titulo}`)
  }
  for (const x of quien.slice(-1)) uno(x.clave, 'dejar', 'dejar como está')
  armarCarpetas(s.deps())
  return hechas
}

async function aplicar() {
  const s = servicios()
  const { lib, c, revision } = s
  const cor = leer()
  const hechas = contestar(s, revision().decidir)
  hechas.forEach((h) => log(`carta: ${h}`))
  // la muestra: todo lo de los grupos chicos y lo que entre de "a su carpeta"; el resto, destildado (y un 10 % de los chicos también,
  // para probar que lo destildado no se aplica)
  let r = revision()
  const todas = filas(r)
  const temas = new Set<number>()
  const tilde = new Set<string>()
  for (const g of ['rep', 'nom', 'net', 'tap'] as GrupoRevision[]) {
    const fs_ = mezcla(todas.filter((f) => f.grupo === g && !f.error), `t${g}`, (f) => f.clave)
    const fuera = fs_.length >= 5 ? Math.max(1, Math.round(fs_.length * 0.1)) : 0
    for (const f of fs_.slice(fuera)) { tilde.add(f.clave); temas.add(f.fileId) }
  }
  const mov = mezcla(todas.filter((f) => f.grupo === 'mov' && !f.error), 'tmov', (f) => f.clave)
  // primero los que ya entraron por otro grupo (su tema se renombra y se mueve), después los demás, hasta la muestra
  for (const f of [...mov.filter((f) => temas.has(f.fileId)), ...mov.filter((f) => !temas.has(f.fileId))]) {
    if (temas.size >= MUESTRA && !temas.has(f.fileId)) continue
    tilde.add(f.clave); temas.add(f.fileId)
  }
  const apagadas = todas.filter((f) => !tilde.has(f.clave)).map((f) => f.clave)
  apagar(lib.db, apagadas, true)
  apagar(lib.db, [...tilde], false)
  armarCarpetas(s.deps()) // destildar un nombre cambia adónde va el tema
  r = revision()
  // lo nuevo que apareció al recalcular las carpetas, fuera de la muestra, también se destilda
  const nuevas = filas(r).filter((f) => f.on && !temas.has(f.fileId)).map((f) => f.clave)
  if (nuevas.length) { apagar(lib.db, nuevas, true); r = revision() }
  const vista: FilaVista[] = filas(r).filter((f) => f.on && !f.error).map(({ grupo, clave, fileId, rel, campo, antes, despues }) => ({ grupo, clave, fileId, rel, campo, antes, despues }))
  log(`Muestra: ${new Set(vista.map((v) => v.fileId)).size} temas · tildado/total: ${JSON.stringify(cuenta(r))} · destildadas ${apagadas.length + nuevas.length}`)
  guardar({ ...cor, vista, cartas: hechas, apagadas: apagadas.length + nuevas.length })
  const t0 = Date.now()
  const res = await lib.ops.run('corrida: aplicar', () => aplicarTodo({ db: lib.db, changes: c.changes, trash: c.trash, organizer: c.organizer }))
  log(`Aplicar único en ${seg(t0)}: ${JSON.stringify(res.partes)} · aplicados ${res.applied} · tanda ${res.tanda} · ${res.failed.length} no se pudieron`)
  for (const f of res.failed.slice(0, 30)) log(`  NO: ${f.rel} · ${f.error}`)
  guardar({ ...leer(), aplicado: res })
  lib.close()
}

/** Cada cambio tildado, contra su vista previa; y la copia contra el original. */
async function comparar() {
  const { lib, root } = servicios()
  const cor = leer()
  const original = arg('--original', 'D:/Música')
  const bad: string[] = [], ok: Record<string, number> = {}
  const bien = (g: string) => { ok[g] = (ok[g] ?? 0) + 1 }
  const fila = lib.db.prepare('SELECT rel_path AS rel, trashed_at AS t FROM files WHERE id = ?')
  const abs = (rel: string) => path.join(root, ...rel.split('/'))
  const tagsDe = new Map<number, Record<string, string | null>>()
  const tags = (id: number) => { if (!tagsDe.has(id)) { const f = fila.get(id) as { rel: string }; try { tagsDe.set(id, readTags(abs(f.rel), { exact: true }) as Record<string, string | null>) } catch { tagsDe.set(id, {}) } } return tagsDe.get(id)! }
  const vista = cor.vista ?? []
  const movido = new Map(vista.filter((v) => v.grupo === 'mov').map((v) => [v.fileId, v.despues!]))
  for (const v of vista) {
    const f = fila.get(v.fileId) as { rel: string; t: string | null }
    if (v.grupo === 'rep') {
      const tl = lib.db.prepare('SELECT trash_rel AS tr FROM trash_log WHERE file_id = ? AND restored_at IS NULL ORDER BY id DESC LIMIT 1').get(v.fileId) as { tr: string } | undefined
      if (!f.t || !tl) bad.push(`papelera: ${v.rel} no quedó en la papelera`)
      else if (!fs.existsSync(abs(tl.tr))) bad.push(`papelera: ${v.rel} dice que está en ${tl.tr} y ahí no hay archivo`)
      else if (fs.existsSync(path.join(original, ...v.rel.split('/'))) && fs.existsSync(abs(v.rel))) bad.push(`papelera: ${v.rel} sigue en su lugar`)
      else bien('rep')
    } else if (v.grupo === 'mov') {
      if (f.rel !== v.despues) bad.push(`mover: ${v.rel} → vista previa ${v.despues}, quedó ${f.rel}`)
      else if (!fs.existsSync(abs(f.rel))) bad.push(`mover: ${f.rel} no está en el disco`)
      else if (fs.existsSync(abs(v.antes!)) && v.antes!.toLowerCase() !== f.rel.toLowerCase()) bad.push(`mover: quedó algo en el lugar viejo ${v.antes}`)
      else bien('mov')
    } else if (v.campo === 'filename' || v.campo === 'extension') {
      const base = path.posix.basename(f.rel), dest = movido.get(v.fileId)
      const okNombre = v.campo === 'filename' ? base.slice(0, base.length - path.posix.extname(base).length) === v.despues || (!!dest && f.rel === dest) : path.posix.extname(base).slice(1) === v.despues
      if (!okNombre) bad.push(`${v.campo}: ${v.rel} → vista previa «${v.despues}», quedó ${base}`); else bien(v.campo)
    } else if (v.grupo === 'tap') bien('tap (sin control)')
    else {
      const t = tags(v.fileId)[v.campo] ?? null
      const norm = (x: string | null) => (x ?? '').trim()
      if (norm(t) !== norm(v.despues)) bad.push(`${v.campo}: ${v.rel} → vista previa «${v.despues}», en el archivo «${t ?? ''}»`); else bien(v.grupo)
    }
  }
  // la copia contra el original
  const lista = (r: string) => {
    const files = new Map<string, fs.Stats>(), dirs = new Map<string, number>()
    for (const x of fs.readdirSync(r, { recursive: true }) as string[]) {
      const rel = x.split(path.sep).join('/'), st = fs.statSync(path.join(r, x))
      if (st.isDirectory()) dirs.set(rel, 0); else { files.set(rel, st); const d = path.posix.dirname(rel); if (d !== '.') dirs.set(d, (dirs.get(d) ?? 0) + 1) }
    }
    for (const d of [...dirs.keys()]) for (let p = path.posix.dirname(d); p !== '.'; p = path.posix.dirname(p)) if (!dirs.has(p)) dirs.set(p, 0)
    return { files, dirs }
  }
  const A = lista(original), B = lista(COPIA)
  const paila = (r: string) => /^_paila\//i.test(r)
  const tocados = new Set<string>()
  for (const v of vista) { tocados.add(v.rel.toLowerCase()); if (v.grupo === 'mov') tocados.add(v.despues!.toLowerCase()) }
  for (const v of vista) if (v.grupo !== 'mov') { const now = (fila.get(v.fileId) as { rel: string }).rel; tocados.add(now.toLowerCase()) }
  // los temas de las cartas contestadas cambian también (una copia a la papelera, artista y título a mano, "(2)")
  const deCartas = new Set<number>()
  for (const r of lib.db.prepare('SELECT file_id AS id FROM journal WHERE applied_at >= ? UNION SELECT file_id FROM moves_log WHERE created_at >= ? UNION SELECT file_id FROM trash_log WHERE created_at >= ?').all(cor.startedAt, cor.startedAt, cor.startedAt) as { id: number | null }[]) if (r.id != null && fila.get(r.id)) deCartas.add(r.id)
  const enVista = new Set(vista.map((v) => v.fileId))
  const fueraDeVista = [...deCartas].filter((id) => !enVista.has(id))
  for (const id of fueraDeVista) {
    const now = (fila.get(id) as { rel: string }).rel
    tocados.add(now.toLowerCase())
    for (const m of lib.db.prepare('SELECT from_rel AS a FROM moves_log WHERE file_id = ? AND created_at >= ?').all(id, cor.startedAt) as { a: string }[]) tocados.add(m.a.toLowerCase())
    for (const m of lib.db.prepare('SELECT orig_rel AS a FROM trash_log WHERE file_id = ? AND created_at >= ?').all(id, cor.startedAt) as { a: string }[]) tocados.add(m.a.toLowerCase())
  }
  const esCover = (r: string) => /(^|\/)(cover|folder)\.(jpe?g|png)$/i.test(r)
  let fuera = 0
  for (const [rel, st] of A.files) {
    if (paila(rel) || tocados.has(rel.toLowerCase())) continue
    const b = B.files.get(rel)
    if (!b) { if (esCover(rel)) continue; bad.push(`fuera de la muestra, falta en la copia: ${rel}`); fuera++ }
    else if (b.size !== st.size || Math.abs(b.mtimeMs - st.mtimeMs) > 2000) { bad.push(`fuera de la muestra, cambió: ${rel}`); fuera++ }
  }
  for (const rel of B.files.keys()) if (!paila(rel) && !A.files.has(rel) && !tocados.has(rel.toLowerCase()) && !esCover(rel)) { bad.push(`sobra en la copia: ${rel}`); fuera++ }
  // carpetas vacías de más (fuera de _PAILA): vacías en la copia y no en el original (o que el original no tiene)
  const vacias = [...B.dirs].filter(([d, n]) => !paila(d) && n === 0 && ![...B.dirs.keys()].some((x) => x.startsWith(d + '/')) && (A.dirs.get(d) ?? -1) !== 0).map(([d]) => d)
  for (const d of vacias) bad.push(`carpeta vacía de más: ${d}`)
  // "(2)" que no estaban antes y nadie aceptó
  const aceptados = new Set(cor.cartas?.filter((x) => x.includes('con (2)')).map((x) => Number(x.split('|')[1].split(' ')[0])) ?? [])
  for (const rel of B.files.keys()) if (!paila(rel) && / \(\d+\)\.[^./]+$/.test(rel) && !A.files.has(rel)) {
    const id = (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number } | undefined)?.id
    if (id == null || !aceptados.has(id)) bad.push(`"(2)" sin aceptar: ${rel}`); else bien('(2) aceptado')
  }
  // ningún tema perdido: cada audio del original está en la copia, en su lugar nuevo (moves_log) o en la papelera de PAILA
  let perdidos = 0
  for (const rel of A.files.keys()) {
    if (paila(rel) || !AUDIO_EXT.has(path.extname(rel).slice(1).toLowerCase()) || B.files.has(rel)) continue
    // movido (moves_log), a la papelera (trash_log) o renombrado por Nombres (journal anota dónde estaba al escribir)
    const f = lib.db.prepare(`SELECT id, rel_path AS now, trashed_at AS t FROM files WHERE id = (SELECT file_id FROM moves_log WHERE from_rel = ? AND created_at >= ?
      UNION SELECT file_id FROM trash_log WHERE orig_rel = ? AND created_at >= ? UNION SELECT file_id FROM journal WHERE rel_path = ? AND field = 'filename' AND applied_at >= ? LIMIT 1)`)
      .get(rel, cor.startedAt, rel, cor.startedAt, rel, cor.startedAt) as { id: number; now: string; t: string | null } | undefined
    const tl = f && (lib.db.prepare('SELECT trash_rel AS tr FROM trash_log WHERE file_id = ? AND restored_at IS NULL ORDER BY id DESC LIMIT 1').get(f.id) as { tr: string } | undefined)
    const donde = !f ? null : f.t ? (tl ? tl.tr : null) : f.now
    if (!donde || !fs.existsSync(abs(donde))) { perdidos++; bad.push(`tema perdido: ${rel}${donde ? ` (debería estar en ${donde})` : ''}`) }
    else bien(f!.t ? 'en la papelera de PAILA' : 'movido y en su lugar')
  }
  log(`Contra la vista previa: ${vista.length} cambios tildados en ${new Set(vista.map((v) => v.fileId)).size} temas · bien: ${JSON.stringify(ok)}`)
  log(`Temas tocados por las cartas fuera de la muestra: ${fueraDeVista.length} · fuera de la muestra, distintos del original: ${fuera} · carpetas vacías de más: ${vacias.length} · temas perdidos: ${perdidos}`)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 80).join('\n  ')}` : 'Todo en orden.')
  fs.writeFileSync(path.join(datos, 'comparar.json'), JSON.stringify({ ok, bad, fueraDeVista }, null, 1))
  lib.close()
}

async function deshacer() {
  const { lib, root, rootPath, c } = servicios()
  const cor = leer()
  const h = new History(lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, imports: c.imports, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, separar: c.stems, carpetas: c.space.empty, rootPath })
  const mine = () => h.list().filter((e) => e.at >= cor.startedAt && !e.undone && e.canUndo)
  log(`Del Historial, de esta corrida: ${mine().map((e) => `${e.kind} ${e.id} (${e.files}${e.cadena?.length ? `, cadena ${e.cadena.length}` : ''})`).join(' · ')}`)
  // la más vieja con su cadena: deshace todo lo de la corrida de una, de lo más nuevo a lo más viejo
  for (let vuelta = 0; vuelta < 5 && mine().length; vuelta++) {
    const e = mine().sort((a, b) => a.at.localeCompare(b.at))[0]
    const t0 = Date.now()
    const r = await lib.ops.run('deshaciendo', () => h.undo(e.kind, e.id, { cadena: true }))
    log(`Deshecho ${e.kind} ${e.id}${e.cadena?.length ? ` con su cadena (${e.cadena.length})` : ''}: ${r.done} en ${seg(t0)}${r.failed.length ? ` · fallas ${r.failed.length}: ${r.failed.slice(0, 8).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  }
  descartar(lib.db, c.changes)
  const bad = controlar(lib, root, cor.antes, true)
  log(bad.length ? `PROBLEMAS después de deshacer (${bad.length}):\n  ${bad.slice(0, 60).join('\n  ')}` : 'Todo volvió según la base: cada tema en su lugar y con su tamaño, playlists intactas, diario vacío.')
  lib.close()
}

if (mode === 'armar') await armar()
else if (mode === 'aplicar') await aplicar()
else if (mode === 'comparar') await comparar()
else if (mode === 'deshacer') await deshacer()
else fail('Modos: armar, aplicar, comparar, deshacer')
