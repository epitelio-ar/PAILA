// Corrida supervisada de la etapa 4 del MASTERPLAN-5: deshacer encadenado y sin restos (bitácora en docs/pruebas/mp5-etapa4-deshacer.md).
// Sobre una COPIA de la base apuntando a D:\PAILA-trabajo\Música-copia (prepararla con `scripts/aplicar-corrida.ts preparar`, con el
// aviso copia-en-uso.lock), o sobre una carpeta de prueba que arma este mismo script (`prueba`). Nunca toca la Música original ni la
// base real. Los modos, en orden:
//   prueba:   arma <datos>/PAILA-trabajo/Música-copia con ~300 temas de prueba (repetidos, nombres desprolijos, discos sueltos), su
//             base y una copia intacta en <datos>/original para comparar.
//   aplicar:  cuatro Aplicar seguidos sobre una muestra (~300 temas): repetidos → nombres → mover → tapas. Muestra la cadena que
//             ofrece el Historial para cada uno y los puntos de "Volver a como estaba".
//   cadena:   deshace el mover con su cadena (tiene que traer las tapas): ningún cover.jpg suelto, ninguna carpeta nueva vacía, y las
//             tapas que puso PAILA en la papelera.
//   volver:   vuelve a como estaba antes del primero y controla que cada tema volvió a su lugar con su tamaño.
//   comparar: la copia contra el original (--original "D:/Música"; en la prueba, <datos>/original): lo que falta, sobra o cambió
//             (byte a byte) y las carpetas de más, aparte lo de _PAILA.
//
//   node scripts/run-ts.mjs scripts/deshacer-corrida.ts prueba --datos <carpeta>
//   node scripts/run-ts.mjs scripts/deshacer-corrida.ts aplicar|cadena|volver|comparar --datos <carpeta> [--original <Música>]
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { findDuplicates } from '@paila/core/duplicates'
import { History } from '@paila/core/history'
import { tidy, toProposals } from '@paila/core/tidy'
import { rulesOf, DEFAULT_PROFILE } from '@paila/shared/tidy-profiles'
import { readCover } from '@paila/core/tagio'
import { guardarRegla, reglaElegida } from '@paila/core/estado-dejar'
import { aplicarTodo, descartar } from '@paila/core/aplicar'
import { proponerMover, proponerPapelera } from '@paila/core/propuestas'
import { createServices } from '../apps/paila/electron/context'
import { arg, controlar, count, datos, fail, log, mode, open, unknownFiles, visibles, type Antes } from './corte-base'

const estadoFile = datos && path.join(datos, 'cadena.json')
interface Estado { startedAt: string; antes: Antes; tandas: Record<string, number>; tapas: { id: number; dir: string }[]; creadas: string[] }
const leer = () => JSON.parse(fs.readFileSync(estadoFile, 'utf8')) as Estado
const guardar = (e: Estado) => fs.writeFileSync(estadoFile, JSON.stringify(e, null, 1))
const hash = (s: string) => crypto.createHash('md5').update(s).digest().readUInt32LE(0)
const mezcla = <T>(xs: T[], salt: string, k: (x: T) => unknown = (x) => x) => [...xs].sort((a, b) => hash(`${salt}${String(k(a))}`) - hash(`${salt}${String(k(b))}`))
const seg = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)} s`
const REGLA = { rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la regla y la carpeta de fábrica

function servicios() {
  const { lib, root, rootPath } = open()
  const c = createServices({ lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: datos, version: 'corrida' })
  const h = new History(lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, imports: c.imports, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, separar: c.stems, carpetas: c.space.empty, rootPath })
  return { lib, root, c, h, pathOf: (id: number) => lib.trackPath(id) }
}
const aplicarYa = async (s: ReturnType<typeof servicios>, que: string) => {
  const t0 = Date.now()
  const r = await s.lib.ops.run(`corrida: ${que}`, () => aplicarTodo({ db: s.lib.db, changes: s.c.changes, trash: s.c.trash, organizer: s.c.organizer }))
  log(`Aplicar (${que}) en ${seg(t0)}: ${JSON.stringify(r.partes)} · tanda ${r.tanda} · ${r.failed.length} no se pudieron${r.failed.length ? `: ${r.failed.slice(0, 5).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  return r.tanda
}

/** La carpeta de prueba: discos con tags, sueltos con nombres desprolijos, repetidos exactos y algunas tapas adentro de los temas. */
async function prueba() {
  if (!datos) fail('Falta --datos')
  const copia = path.join(datos, 'PAILA-trabajo', 'Música-copia')
  if (fs.existsSync(copia)) fail(`Ya hay una prueba en ${copia}: borrala a mano si querés empezar de nuevo`)
  const ffmpeg = findFfmpeg()!
  const tapa = path.join(datos, 'tapa.jpg')
  fs.mkdirSync(copia, { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', tapa])
  const artistas = ['La Renga', 'Soda Stereo', 'Charly García', 'Los Redondos', 'Fito Páez', 'Babasónicos'] // idioma-ok: datos de prueba
  let n = 0
  const tema = (rel: string, meta: Record<string, string>, conTapa: boolean) => {
    const out = path.join(copia, ...rel.split('/'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const pic = conTapa ? ['-i', tapa, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-id3v2_version', '3', '-disposition:v', 'attached_pic'] : []
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${200 + (n++ * 7) % 1800}:duration=1`, ...pic, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
  }
  for (const [a, art] of artistas.entries()) for (let d = 0; d < 4; d++) for (let t = 1; t <= 9; t++) {
    const disco = `Disco ${d + 1}`, y = String(1985 + a * 3 + d)
    const rel = d % 2 ? `Descargas/${art} - ${disco}/${String(t).padStart(2, '0')} ${art.toUpperCase()} - tema ${t}.mp3` : `Sueltos ${a}/${art.toLowerCase().replace(/ /g, '_')}_tema_${d}_${t}.mp3`
    // nombres para Arreglar nombres: basura de páginas, un "ft." y un artista sin acento (Babasonicos)
    const titulo = `Tema ${t} de ${disco}${t % 3 === 0 ? ' [www.musicafull.net]' : ''}${t % 4 === 0 ? ' ft. Fito' : ''}`
    tema(rel, { artist: art === 'Babasónicos' && t % 2 ? 'Babasonicos' : art, title: titulo, album: disco, date: y, track: String(t) }, t === 1)
  }
  // repetidos exactos, en la misma carpeta y en otra
  const todos = (fs.readdirSync(copia, { recursive: true }) as string[]).filter((f) => f.endsWith('.mp3')).sort()
  for (const f of todos.filter((_, i) => i % 9 === 3)) fs.copyFileSync(path.join(copia, f), path.join(copia, f.replace(/\.mp3$/, ' (1).mp3')))
  fs.cpSync(copia, path.join(datos, 'original'), { recursive: true, preserveTimestamps: true })
  const lib = new Library(path.join(datos, 'paila.db'), findFfprobe())
  await lib.addRoot(copia, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  guardarRegla(lib.db, REGLA)
  log(`Prueba lista: ${visibles(lib).length} temas en ${copia}.`)
  lib.close()
}

/** Cuatro Aplicar sobre una muestra: repetidos → nombres → mover → tapas. */
async function aplicar() {
  const s = servicios(), { lib, root, c, h, pathOf } = s
  descartar(lib.db, c.changes)
  const antes: Antes = { files: visibles(lib), playlistItems: count(lib, 'SELECT COUNT(*) AS n FROM playlist_items'), batch: 0, unknown: unknownFiles(lib, root) }
  const est: Estado = { startedAt: new Date().toISOString(), antes, tandas: {}, tapas: [], creadas: [] }
  guardar(est)
  // 1. repetidos: hasta 30 copias de los grupos seguros
  const grupos = await findDuplicates(lib.db, pathOf)
  const seguros = grupos.filter((g) => g.keep != null && !g.decidir && g.level !== 'version' && g.level !== 'probable')
  const pap = mezcla(seguros.flatMap((g) => g.items.filter((i) => i.id !== g.keep).map((i) => ({ id: i.id, kept: g.keep }))), 'pap', (x) => x.id).slice(0, 30)
  proponerPapelera(lib.db, pap, 'Duplicados') // idioma-ok: el motivo de la tanda
  est.tandas.repetidos = (await aplicarYa(s, 'repetidos'))!
  // 2. nombres: lo que propone Arreglar nombres para 150 temas
  const ch = tidy(lib.db, undefined, pathOf, rulesOf(DEFAULT_PROFILE)).changes
  const temas = new Set(mezcla([...new Set(ch.map((x) => x.id))], 'nom').slice(0, 150))
  c.changes.stageMany(toProposals(ch.filter((x) => temas.has(x.id))))
  est.tandas.nombres = (await aplicarYa(s, 'nombres'))!
  // 3. mover: los de los nombres y más, hasta ~300 temas, sin los que chocan
  const plan = c.organizer.plan(reglaElegida(lib.db), true), choca = new Set((plan.clashes ?? []).map((x) => x.fileId))
  const libres = plan.moves.filter((m) => !choca.has(m.fileId))
  const otros = new Set(mezcla(libres.map((m) => m.fileId).filter((id) => !temas.has(id)), 'mov').slice(0, Math.max(0, 300 - temas.size)))
  const mover = libres.filter((m) => temas.has(m.fileId) || otros.has(m.fileId))
  proponerMover(lib.db, mover)
  est.tandas.mover = (await aplicarYa(s, 'mover'))!
  est.creadas = (lib.db.prepare("SELECT rel FROM creados WHERE tipo = 'organizar' AND batch = (SELECT MAX(batch_id) FROM moves_log) AND rel != ''").all() as { rel: string }[]).map((r) => r.rel)
  // 4. tapas: cover.jpg (la tapa de adentro del tema) en 15 discos movidos que no tenían, en la carpeta nueva
  for (const m of mezcla(mover, 'tap', (x) => x.fileId)) {
    if (est.tapas.length >= 15) break
    const dir = path.posix.dirname(m.to)
    if (est.tapas.some((t) => t.dir === dir) || fs.existsSync(path.join(root, ...dir.split('/'), 'cover.jpg'))) continue
    let v: string | null = null
    try { v = readCover(pathOf(m.fileId)!) } catch { /* sin tapa legible */ }
    if (!v || !/image\/jpe?g/i.test(v)) continue
    c.changes.stage([m.fileId], 'folderCover', v)
    est.tapas.push({ id: m.fileId, dir })
  }
  est.tandas.tapas = (await aplicarYa(s, 'tapas'))!
  guardar(est)
  log(`Carpetas que creó el mover: ${est.creadas.length} · cover.jpg nuevos: ${est.tapas.length}`)
  for (const e of h.list().filter((x) => x.kind === 'aplicar' && x.at >= est.startedAt)) {
    log(`- ${e.summary} · ${e.canUndo ? 'se puede deshacer' : `NO: ${e.whyNot}`}${e.cadena?.length ? ` · cadena: ${e.cadena.map((x) => `«${x.summary}»`).join(', ')}` : ''}`)
  }
  for (const p of h.puntos().filter((x) => x.at >= est.startedAt)) log(`  punto antes de la tanda ${p.tanda}: deshace ${p.entradas.length} · ${p.canUndo ? 'se puede' : p.whyNot}`)
  lib.close()
}

/** Deshacer el mover con su cadena: las tapas vuelven a la papelera de PAILA y las carpetas nuevas se van. */
async function cadena() {
  const { lib, root, h } = servicios(), est = leer()
  const e = h.list().find((x) => x.kind === 'aplicar' && x.id === est.tandas.mover)
  if (!e) fail('No está el Aplicar del mover')
  log(`El mover ofrece: ${e!.cadena?.length ? e!.cadena.map((x) => `«${x.summary}»`).join(', ') : '(sin cadena)'}`)
  try { await h.undo('aplicar', e!.id); log('PROBLEMA: se deshizo solo, sin la cadena') } catch (err) { log(`Solo, no: «${(err as Error).message}»`) }
  const t0 = Date.now()
  const r = await lib.ops.run('corrida: cadena', () => h.undo('aplicar', e!.id, { cadena: true }))
  log(`Deshecho con la cadena en ${seg(t0)}: ${r.done} · ${r.tandas} tandas · ${r.carpetas ?? 0} carpetas vacías sacadas · ${r.failed.length} fallas${r.failed.length ? `: ${r.failed.slice(0, 5).map((f) => `${f.rel} (${f.error})`).join('; ')}` : ''}`)
  const bad: string[] = []
  for (const t of est.tapas) if (fs.existsSync(path.join(root, ...t.dir.split('/'), 'cover.jpg'))) bad.push(`cover.jpg suelto en ${t.dir}`)
  for (const d of est.creadas) if (fs.existsSync(path.join(root, ...d.split('/')))) bad.push(`quedó la carpeta nueva ${d}${fs.readdirSync(path.join(root, ...d.split('/'))).length ? ' (con algo adentro)' : ' (vacía)'}`)
  const pap = path.join(root, '_PAILA', 'papelera')
  const enPapelera = fs.existsSync(pap) ? fs.readdirSync(pap).filter((x) => x.includes('_tapas-deshechas_')).flatMap((x) => (fs.readdirSync(path.join(pap, x), { recursive: true }) as string[]).filter((f) => /cover\.jpg$/i.test(f))).length : 0
  if (enPapelera < est.tapas.length) bad.push(`en la papelera hay ${enPapelera} cover.jpg de los ${est.tapas.length} que se pusieron`)
  log(bad.length ? `PROBLEMAS (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : `Sin restos: ningún cover.jpg suelto, las ${est.creadas.length} carpetas nuevas se fueron y las ${enPapelera} tapas están en la papelera de PAILA.`)
  lib.close()
}

/** Volver a como estaba antes del primero, y controlar. */
async function volver() {
  const { lib, root, c, h } = servicios(), est = leer()
  const p = h.puntos().find((x) => x.tanda === est.tandas.repetidos)
  if (!p) fail('No está el punto del primer Aplicar')
  log(`Volver a antes de la tanda ${p!.tanda}: deshace ${p!.entradas.map((x) => `«${x.summary}»`).join(', ')}`)
  const t0 = Date.now()
  const r = await lib.ops.run('corrida: volver', () => h.volver(p!.tanda))
  log(`Vuelto en ${seg(t0)}: ${r.done} · ${r.tandas} tandas · ${r.carpetas ?? 0} carpetas vacías sacadas · ${r.failed.length} fallas`)
  descartar(lib.db, c.changes)
  const bad = controlar(lib, root, est.antes, true)
  log(bad.length ? `PROBLEMAS después de volver (${bad.length}):\n  ${bad.slice(0, 40).join('\n  ')}` : 'Todo volvió: cada tema en su lugar y con su tamaño, playlists intactas, diario vacío.')
  lib.close()
}

/** La copia contra el original: faltan, sobran, cambiaron (por bytes) y carpetas de más, aparte lo de _PAILA. Solo lee. */
function comparar() {
  const { lib, root } = open()
  lib.close()
  const original = arg('--original') || path.join(datos, 'original')
  if (!fs.existsSync(original)) fail(`No está el original: ${original}`)
  const listar = (raiz: string) => {
    const files = new Map<string, fs.Stats>(), dirs = new Set<string>()
    for (const f of fs.readdirSync(raiz, { recursive: true }) as string[]) {
      const rel = f.split(path.sep).join('/'), st = fs.statSync(path.join(raiz, f))
      if (/^_paila(\/|$)/i.test(rel)) continue
      if (st.isDirectory()) dirs.add(rel); else files.set(rel, st)
    }
    return { files, dirs }
  }
  const a = listar(original), b = listar(root)
  const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
  const faltan = [...a.files.keys()].filter((r) => !b.files.has(r)), sobran = [...b.files.keys()].filter((r) => !a.files.has(r))
  const distintos = [...a.files.keys()].filter((r) => b.files.has(r) && (a.files.get(r)!.size !== b.files.get(r)!.size || Math.abs(a.files.get(r)!.mtimeMs - b.files.get(r)!.mtimeMs) > 2000))
  const deVerdad = distintos.filter((r) => md5(path.join(original, ...r.split('/'))) !== md5(path.join(root, ...r.split('/'))))
  const deMas = [...b.dirs].filter((d) => !a.dirs.has(d)), deMenos = [...a.dirs].filter((d) => !b.dirs.has(d))
  log(`Original ${a.files.size} archivos y ${a.dirs.size} carpetas; copia ${b.files.size} y ${b.dirs.size} (sin _PAILA).`)
  log(`Faltan ${faltan.length}, sobran ${sobran.length}, cambiaron ${deVerdad.length} (y ${distintos.length - deVerdad.length} solo de fecha, mismos bytes), carpetas de más ${deMas.length}, de menos ${deMenos.length}.`)
  for (const [t, l] of [['falta', faltan], ['sobra', sobran], ['distinto', deVerdad], ['carpeta de más', deMas], ['carpeta de menos', deMenos]] as const) for (const r of l.slice(0, 20)) log(`  ${t}: ${r}`)
}

if (mode === 'prueba') await prueba()
else if (mode === 'aplicar') await aplicar()
else if (mode === 'cadena') await cadena()
else if (mode === 'volver') await volver()
else if (mode === 'comparar') comparar()
else fail('Modos: prueba, aplicar, cadena, volver, comparar')
