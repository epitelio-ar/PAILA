// Corrida supervisada de la "Faltan o suenan mal" + Bandeja vigilada (MASTERPLAN-2, 0.1), sobre una COPIA de la base.
//   preparar: exporta la lista real, arma una Bandeja de prueba con llegadas simuladas (copias y conversiones de archivos de
//             la biblioteca: nunca escribe en ella), corre la vigilancia de verdad y escribe cada emparejamiento.
//   aplicar:  "Reemplazar todos" sobre la copia completa de la Música (con el aviso de turno), compara contra el original,
//             deshace desde el Historial y vuelve a comparar.
//
//   node scripts/run-ts.mjs scripts/bandeja.ts preparar --base <copia.db> --bandeja <carpeta> --salida <informe.md>
//   node scripts/run-ts.mjs scripts/bandeja.ts aplicar  --base <copia.db> --bandeja <carpeta> --salida <informe.md> --copia <Música-copia> --original <Música>
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { tomarCopia } from './turnos.mjs'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { findDuplicates } from '@paila/core/duplicates'
import { Inbox } from '@paila/core/inbox'
import { Wanted } from '@paila/core/wanted'
import { InboxFlow } from '@paila/core/inboxflow'
import { InboxWatcher } from '@paila/core/inboxwatch'
import { Replacer, describeCandidate } from '@paila/core/replace'
import { History } from '@paila/core/history'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Improver } from '@paila/core/improve'
import { Playlists } from '@paila/core/playlists'
import { pcmHash } from '@paila/core/audiohash'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { InboxDecision } from '@paila/shared/types'

const mode = process.argv[2]
const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), bandeja = arg('--bandeja'), out = arg('--salida')
if (!['preparar', 'revisar', 'aplicar'].includes(mode) || !base || !bandeja || !out) { console.error('Uso: preparar|aplicar --base <copia.db> --bandeja <carpeta> --salida <informe.md>'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
const ffmpeg = findFfmpeg()!, ffprobe = findFfprobe()!
const ff = (...a: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...a])
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const manifestPath = path.join(path.dirname(path.resolve(out)), 'manifiesto.json')
/** alts: las otras copias con el mismo audio (cualquiera de ellas es una pareja correcta). */
interface Case { file: string; expect: InboxDecision; target: string | null; what: string; alts?: string[] }

const lib = new Library(base, ffprobe)
const real = { full: analyzeFile, prints: analyzePrints }
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
const replacer = new Replacer(lib.db, rootPath, ffprobe, ffmpeg)
const wanted = new Wanted(lib.db)
const inbox = new Inbox(lib.db, ffprobe, path.join(path.dirname(path.resolve(out)), 'zip'), ffmpeg, wanted)
const flow = new InboxFlow(lib.db, inbox, wanted, replacer, { ffprobe, describe: (f) => describeCandidate(real, ffprobe, ffmpeg, f), inRekordbox: () => [] })
const abs = (id: number) => lib.trackPath(id)!
const lines: string[] = []
const log = (s = '') => { lines.push(s); console.log(s) }

async function preparar() {
  if (fs.existsSync(bandeja) && fs.readdirSync(bandeja).length) { console.error('La Bandeja de prueba no está vacía'); process.exit(2) }
  if (lib.roots().some((r) => !path.relative(r.path, bandeja).startsWith('..'))) { console.error('La Bandeja de prueba no puede estar dentro de la biblioteca'); process.exit(2) }
  fs.mkdirSync(bandeja, { recursive: true })
  const dest = (name: string) => path.join(bandeja, name)
  // 1) la lista real
  const list = wanted.list()
  const txt = wanted.export('txt'), csv = wanted.export('csv')
  const dir = path.dirname(path.resolve(out))
  fs.writeFileSync(path.join(dir, 'lista.txt'), txt.text); fs.writeFileSync(path.join(dir, 'lista.csv'), csv.text)
  log(`# Bandeja vigilada — corrida supervisada sobre ${base}`)
  log(); log(`## Faltan o suenan mal`); log()
  log(`${list.length} temas con las casillas de fábrica (nota D/F, lossless falsos e inflados). Exportados: ${txt.count} (.txt) — quedaron "pedidos" ${csv.marked + txt.marked}.`)
  const by = (r: string) => list.filter((i) => i.reasons.includes(r as never)).length
  const revisar = list.filter((i) => i.fileId != null && (lib.db.prepare('SELECT kind FROM files WHERE id = ?').get(i.fileId) as { kind: string }).kind === 'revisar').length
  log(`Motivos: nota ${by('nota')}, lossless falso ${by('lossless_falso')}, inflado ${by('inflado')}. De Para revisar: ${revisar}.`)
  // 2) las llegadas simuladas
  const groups = await findDuplicates(lib.db, () => null)
  const grade = (id: number) => (lib.db.prepare('SELECT grade FROM analysis WHERE file_id = ?').get(id) as { grade: string } | undefined)?.grade
  const lossless = new Set(['flac', 'wav', 'aiff', 'aif'])
  const wantedIds = new Set(list.filter((i) => i.fileId != null).map((i) => i.fileId!))
  const pairs = groups.filter((g) => g.level === 'quality' || g.level === 'exact').flatMap((g) => {
    const bad = g.items.filter((i) => wantedIds.has(i.id) && !lossless.has(i.ext) && (i.duration ?? 0) < 900)
    const good = g.items.filter((i) => lossless.has(i.ext) && ['A', 'A+'].includes(grade(i.id) ?? ''))
    return bad.length && good.length ? [{ bad: bad[0], good: good[0], alts: g.items.filter((i) => !lossless.has(i.ext)).map((i) => i.rel) }] : []
  }).sort((a, b) => a.bad.rel.localeCompare(b.bad.rel))
  log(); log(`Pares para simular (un tema pedido de mala calidad con el mismo audio en lossless de nota A en la biblioteca): ${pairs.length}.`)
  const cases: Case[] = []
  const take = (n: number) => pairs.splice(0, n)
  const nameOf = (rel: string) => path.posix.basename(rel)
  for (const p of take(6)) { const f = dest(nameOf(p.good.rel)); fs.copyFileSync(abs(p.good.id), f); cases.push({ file: f, expect: 'reemplazar', target: p.bad.rel, what: 'el mismo tema en mejor calidad (copia del lossless)', alts: p.alts }) }
  take(3).forEach((p, i) => { const f = dest(`track0${i + 1}.flac`); ff('-i', abs(p.good.id), '-map', '0:a', '-map_metadata', '-1', '-c:a', 'flac', f); cases.push({ file: f, expect: 'reemplazar', target: p.bad.rel, what: 'renombrado y sin tags', alts: p.alts }) })
  for (const p of take(3)) { const f = dest(nameOf(p.good.rel).replace(/\.[^.]+$/, ' [320].mp3')); ff('-i', abs(p.good.id), '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '320k', f); cases.push({ file: f, expect: grade(p.bad.id) === 'C' ? 'no-sirve' : 'reemplazar', target: p.bad.rel, what: 'convertido a MP3 320 con ffmpeg', alts: p.alts }) }
  for (const p of take(2)) { const f = dest(nameOf(p.bad.rel).replace(/\.[^.]+$/, '.flac')); ff('-i', abs(p.bad.id), '-map', '0:a', '-c:a', 'flac', f); cases.push({ file: f, expect: 'no-sirve', target: p.bad.rel, what: 'FLAC falso (hecho con el MP3 malo)' }) }
  for (const p of take(1)) { const f = dest(nameOf(p.good.rel).replace(/\.[^.]+$/, ' (Radio Edit).flac')); ff('-i', abs(p.good.id), '-map', '0:a', '-t', String(Math.round((p.good.duration ?? 200) * 0.6)), '-c:a', 'flac', f); cases.push({ file: f, expect: 'mirar', target: p.bad.rel, what: 'versión distinta: recortada al 60 % (radio edit)' }) }
  for (const p of take(1)) {
    const intro = path.join(dir, 'intro.wav')
    ff('-f', 'lavfi', '-i', 'anoisesrc=d=25:c=brown:a=0.2', '-ac', '2', '-ar', '44100', intro)
    const f = dest(nameOf(p.good.rel).replace(/\.[^.]+$/, ' (Extended Mix).flac'))
    ff('-i', intro, '-i', abs(p.good.id), '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-c:a', 'flac', f)
    cases.push({ file: f, expect: 'mirar', target: p.bad.rel, what: 'versión distinta: 25 s de intro propia (extended)' })
  }
  // un pedido que todavía no tiene huella en la biblioteca: solo por tags + duración ("probable", a mano)
  const noPrint = list.find((i) => i.fileId != null && !(lib.db.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?').get(i.fileId) as { chromaprint: string | null } | undefined)?.chromaprint && lib.trackPath(i.fileId) && (i.duration ?? 0) < 600 && i.ext === 'mp3')
  if (noPrint) {
    const f = dest(`${noPrint.artist} - ${noPrint.title}.m4a`.replace(/[\\/:*?"<>|]/g, '_'))
    ff('-i', abs(noPrint.fileId!), '-map', '0:a', '-c:a', 'aac', '-b:a', '256k', '-metadata', `artist=${noPrint.artist}`, '-metadata', `title=${noPrint.title}`, f)
    cases.push({ file: f, expect: 'mirar', target: noPrint.rel, what: 'pedido sin huella en la biblioteca: solo por tags y duración' })
  }
  // un sample (produccion): nunca es candidato
  const sample = lib.db.prepare("SELECT id, rel_path AS rel FROM files WHERE kind = 'produccion' AND duration BETWEEN 20 AND 300 AND trashed_at IS NULL ORDER BY rel_path LIMIT 1").get() as { id: number; rel: string } | undefined
  if (sample && lib.trackPath(sample.id)) { const f = dest('descarga sin nombre.mp3'); ff('-i', abs(sample.id), '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '256k', f); cases.push({ file: f, expect: 'sin-pareja', target: null, what: `suena como un sample (${sample.rel}): los samples nunca se emparejan` }) }
  // el tema que falta (Duplicados: el mismo audio con dos títulos)
  const warn = groups.find((g) => g.warning && g.items.filter((i) => i.title && i.artist).length >= 2)
  if (warn && sample) {
    const it = warn.items.find((i) => i.title && i.artist)!
    wanted.addMissing(it.artist!, it.title!, it.id)
    const f = dest(`${it.artist} - ${it.title}.mp3`.replace(/[\\/:*?"<>|]/g, '_'))
    ff('-i', abs(sample.id), '-map', '0:a', '-t', '30', '-c:a', 'libmp3lame', '-b:a', '320k', f)
    cases.push({ file: f, expect: 'falta', target: null, what: `el tema que faltaba («${it.title}», de un grupo con títulos distintos)` })
  }
  // un ZIP con un FLAC adentro
  for (const p of take(1)) {
    const tmp = path.join(dir, 'zip-src'); fs.mkdirSync(tmp, { recursive: true })
    fs.copyFileSync(abs(p.good.id), path.join(tmp, nameOf(p.good.rel)))
    execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', dest('compra.zip'), '-C', tmp, nameOf(p.good.rel)])
    cases.push({ file: path.join(inbox.workDir, `compra-${fs.statSync(dest('compra.zip')).size}`, nameOf(p.good.rel)), expect: 'reemplazar', target: p.bad.rel, what: 'dentro de un ZIP', alts: p.alts })
  }
  // 3) la vigilancia de verdad, con una descarga en curso (.part que crece y después se renombra)
  const live = take(1)[0]
  const watcher = new InboxWatcher({ handle: async (f) => { await flow.evaluate(f) }, list: (p) => inbox.expand(p), canWork: () => !lib.ops.busy })
  watcher.start(bandeja)
  if (live) {
    const part = dest(nameOf(live.good.rel) + '.part'), buf = fs.readFileSync(abs(live.good.id))
    for (let i = 0; i < 8; i++) { fs.appendFileSync(part, buf.subarray(Math.floor((i * buf.length) / 8), Math.floor(((i + 1) * buf.length) / 8))); await new Promise((r) => setTimeout(r, 700)) }
    fs.renameSync(part, dest(nameOf(live.good.rel)))
    cases.push({ file: dest(nameOf(live.good.rel)), expect: 'reemplazar', target: live.bad.rel, what: 'bajado mientras PAILA miraba (.part que crece y se renombra)', alts: live.alts })
  }
  const t = performance.now()
  await new Promise((r) => setTimeout(r, 6000))
  await watcher.idle(30 * 60_000)
  watcher.stop()
  fs.writeFileSync(manifestPath, JSON.stringify(cases, null, 2))
  informe(cases, `${((performance.now() - t) / 1000).toFixed(0)} s para ${cases.length} archivos`)
}

/** Vuelve a revisar la misma Bandeja (después de arreglar algo) y escribe el informe de nuevo. */
async function revisar() {
  const cases = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Case[]
  const t = performance.now()
  for (const c of cases) if (fs.existsSync(c.file)) await flow.evaluate(c.file, { force: true })
  log(`# Bandeja vigilada — revisión de nuevo sobre ${base}`)
  informe(cases, `${((performance.now() - t) / 1000).toFixed(0)} s para ${cases.length} archivos, revisados de nuevo`)
}

function informe(cases: Case[], timing: string) {
  log(); log(`## Emparejamientos (${timing})`); log()
  const results = flow.results(bandeja)
  let bad = 0
  for (const c of cases) {
    const r = results.find((x) => path.resolve(x.path) === path.resolve(c.file))
    const ok = !!r && r.decision === c.expect && (c.target == null || r.match?.rel === c.target || !!c.alts?.includes(r.match?.rel ?? ''))
    if (!ok) bad++
    log(`- ${ok ? '✔' : '✘'} **${path.basename(c.file)}** — ${c.what}. Esperado: ${c.expect}${c.target ? ` → \`${c.target}\`` : ''}.`)
    log(`  Resultado: ${r ? `${r.decision}${r.match ? ` → \`${r.match.rel}\` (${r.match.kind}, por ${r.match.by}${r.match.sharedSeconds != null ? `, ${r.match.sharedSeconds} s iguales` : ''})` : ''}${r.check ? ` · nota ${r.check.oldGrade} → ${r.check.newGrade} (${r.check.newLabel})` : ''}` : 'NO SE REVISÓ'}`)
    if (r) log(`  «${r.why}»`)
  }
  for (const r of results.filter((x) => !cases.some((c) => path.resolve(c.file) === path.resolve(x.path)))) log(`- ? **${r.name}** (no estaba en el manifiesto): ${r.decision} — ${r.why}`)
  log(); log(`${cases.length - bad} de ${cases.length} como se esperaba.`)
  const plan = flow.plan(bandeja)
  log(); log(`## Simulación de "Reemplazar todos"`); log()
  log(`Se reemplazan ${plan.replace.length}; van a no-sirvió ${plan.reject.length}.`)
  for (const p of plan.replace) log(`- \`${p.rel}\` → \`${p.newRel}\` con «${p.name}» (nota ${p.oldGrade} → ${p.newGrade})${p.warnings.length ? ` ⚠ ${p.warnings.join(' ')}` : ''}`)
  for (const r of plan.reject) log(`- no-sirvió: «${r.name}»: ${r.reason}`)
}

async function aplicar() {
  const copia = arg('--copia'), original = arg('--original')
  if (!copia || !original) { console.error('Falta --copia/--original'); process.exit(2) }
  await tomarCopia(copia, { que: 'Bandeja vigilada: Reemplazar todos, comparar y deshacer', horas: 2, propio: process.argv.includes('--aviso-propio') }) // el aviso de turno: se suelta solo al terminar
  // la copia de la base apunta a la copia de la Música (mismo disco: se cambia la carpeta)
  const rel = path.relative(path.parse(copia).root, copia).split(path.sep).join('/')
  lib.db.prepare('UPDATE roots SET rel_path = ? WHERE id = 1').run(rel)
  if (!lib.roots()[0]?.available || path.resolve(lib.roots()[0].path) !== path.resolve(copia)) { console.error('La base no quedó apuntando a la copia'); process.exit(2) }
  const plan = flow.plan(bandeja)
  const plCount = () => (lib.db.prepare('SELECT COUNT(*) AS n FROM playlist_items').get() as { n: number }).n
  const before = plCount()
  const orig = new Map(plan.replace.map((p) => [p.fileId, { rel: p.rel, md5: md5(path.join(original, ...p.rel.split('/'))), row: lib.db.prepare('SELECT artist, title, album FROM files WHERE id = ?').get(p.fileId) }]))
  // antes de tocar nada: la copia tiene que estar igual al original en lo que se va a reemplazar
  const differ = plan.replace.filter((p) => { const c = path.join(copia, ...p.rel.split('/')); return !fs.existsSync(c) || md5(c) !== orig.get(p.fileId)!.md5 })
  if (differ.length) { console.error(`La copia no está igual al original en: ${differ.map((p) => p.rel).join(', ')}`); process.exit(2) }
  log(`# Bandeja vigilada — aplicar sobre ${copia}`); log()
  const t = performance.now()
  const r = await lib.ops.run('corrida', () => flow.apply(bandeja, plan))
  log(`"Reemplazar todos": ${r.replaced} reemplazados, ${r.rejected} a no-sirvió, ${r.failed.length} fallas en ${((performance.now() - t) / 1000).toFixed(1)} s.`)
  for (const f of r.failed) log(`- ✘ falla: ${f.name}: ${f.error}`)
  let bad = 0
  const check = (ok: boolean, msg: string) => { if (!ok) bad++; log(`- ${ok ? '✔' : '✘'} ${msg}`) }
  for (const p of plan.replace) {
    const o = orig.get(p.fileId)!
    const row = lib.db.prepare('SELECT rel_path AS rel, artist, title, album FROM files WHERE id = ?').get(p.fileId) as { rel: string; artist: string; title: string; album: string }
    const used = path.join(bandeja, 'usados', path.basename(p.path))
    const now = path.join(copia, ...row.rel.split('/'))
    const sameAudio = fs.existsSync(now) && fs.existsSync(used) && await pcmHash(ffmpeg, now) === await pcmHash(ffmpeg, used)
    const trash = (lib.db.prepare('SELECT old_trash_rel AS t FROM replacements WHERE file_id = ? ORDER BY id DESC LIMIT 1').get(p.fileId) as { t: string }).t
    const keptOld = md5(path.join(copia, ...trash.split('/'))) === o.md5
    const sameTags = JSON.stringify({ artist: row.artist, title: row.title, album: row.album }) === JSON.stringify(o.row)
    check(sameAudio && keptOld && sameTags && row.rel === p.newRel, `\`${o.rel}\` → \`${row.rel}\`: audio = el de la Bandeja ${sameAudio ? 'sí' : 'NO'}, tags de antes ${sameTags ? 'sí' : 'NO'}, el viejo intacto en la papelera ${keptOld ? 'sí' : 'NO'}`)
  }
  check(plCount() === before, `playlists: ${before} lugares antes, ${plCount()} después`)
  check(plan.replace.every((p) => wanted.list().find((i) => i.fileId === p.fileId)?.status === 'reemplazado'), 'los reemplazados quedan "reemplazado" en la lista')
  check(plan.reject.every((x) => fs.existsSync(path.join(bandeja, 'no-sirvió', path.basename(x.path)))), `no-sirvió: ${fs.existsSync(path.join(bandeja, 'no-sirvió', 'motivos.txt')) ? fs.readFileSync(path.join(bandeja, 'no-sirvió', 'motivos.txt'), 'utf8').trim().split('\r\n').length : 0} motivos anotados`)
  const playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
  const hist = new History(lib.db, { changes: new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg), trash: new Trash(lib.db, rootPath, playlists), organizer: new Organizer(lib.db, rootPath), replacer, improver: new Improver(lib.db), rootPath })
  const tanda = hist.list().find((e) => e.kind === 'reemplazo')!
  check(tanda.files === r.replaced, `Historial: una tanda «${tanda.summary}» con ${tanda.files} temas`)
  log(); log('## Deshacer desde el Historial'); log()
  const u = await lib.ops.run('corrida', () => hist.undo('reemplazo', tanda.id))
  check(u.failed.length === 0, `deshechos ${u.done}, fallas ${u.failed.length}${u.failed.map((f) => ` (${f.rel}: ${f.error})`).join('')}`)
  for (const p of plan.replace) {
    const o = orig.get(p.fileId)!
    const f = path.join(copia, ...o.rel.split('/'))
    check(fs.existsSync(f) && md5(f) === o.md5 && (p.newRel === o.rel || !fs.existsSync(path.join(copia, ...p.newRel.split('/')))), `\`${o.rel}\` volvió idéntico al original`)
  }
  check(plan.replace.every((p) => wanted.list().find((i) => i.fileId === p.fileId)?.status === 'pedido'), 'después de deshacer, vuelven a "pedido"')
  log(); log(`${bad === 0 ? 'Todo bien' : `${bad} comprobaciones fallaron`}.`)
}

await (mode === 'preparar' ? preparar() : mode === 'revisar' ? revisar() : aplicar())
lib.close()
fs.appendFileSync(out, lines.join('\n') + '\n\n')
