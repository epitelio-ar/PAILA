// Laboratorio de archivos difíciles (MASTERPLAN-2, 0.2): corre PAILA sobre copias de archivos problemáticos reales y muestra
// qué cambió respecto de la corrida anterior y qué no cumple lo esperado (tests/corpus.json).
//
//   npm run corpus                         todo: escaneo, nota de calidad, Arreglar nombres, Organizar, Duplicados y escribir tags
//   npm run corpus -- --rapido             sin nota de calidad (el análisis es lo más lento)
//   npm run corpus -- --armar <carpeta>    copia al laboratorio los archivos del manifiesto que falten, desde tu carpeta de música
//                                          (solo lee esa carpeta; nunca escribe en ella)
//   npm run corpus -- --agregar <lista.json> --desde <carpeta>
//                                          suma archivos al laboratorio y al manifiesto; la lista es [{ "origen": "ruta/relativa.mp3", "caso": "..." }]
//
// El laboratorio vive fuera del repo (la música no va a git): PAILA_CORPUS o, si no, C:\PAILA-laboratorio.
// PAILA nunca trabaja sobre el laboratorio mismo: cada corrida lo copia a una carpeta temporal con una base temporal.
// Los resultados quedan en <laboratorio>/_resultados, uno por tipo (ultima-rapido.json y anterior-rapido.json, o -completo):
// cada corrida se compara solo con la anterior del mismo tipo. Corre uno a la vez: mientras corre deja _resultados/corriendo.lock
// y el que llega después espera (scripts/corpus-turno.ts).
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { Changes } from '@paila/core/changes'
import { listBackups } from '@paila/core/ops/backup'
import { analyzeFolder } from '@paila/core/collections'
import { findDuplicates } from '@paila/core/duplicates'
import { sniff } from '@paila/core/extensions'
import { Library } from '@paila/core/library'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'
import { findFfprobe } from '@paila/core/probe'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { guardarCorrida, tomarTurno, ultimaDelMismoTipo, type Resultados } from './corpus-turno'
import { esperarSinMedicion } from './turnos.mjs'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const MANIFEST = path.join(process.cwd(), 'tests', 'corpus.json')
const LAB = process.env.PAILA_CORPUS || 'C:\\PAILA-laboratorio'
const OUT = path.join(LAB, '_resultados')

/** Lo que tiene que pasar con un archivo. Solo se revisa lo que está escrito. */
interface Expect {
  escribe?: boolean // se le pueden escribir tags sin tocar el sonido (o se rechaza, como los WMA)
  formatoReal?: string // lo que es por dentro ("WAV", "M4A/MP4"…)
  extension?: string // la extensión que propone Arreglar nombres
  nombre?: string // el nombre de archivo nuevo que propone (sin extensión)
  artista?: string // cómo queda el artista después de Arreglar nombres (lo que había o lo propuesto)
  titulo?: string
  desdeNombre?: string // "Artista — Título" que saca del nombre del archivo solo, sin tags ("dudoso: …" si no se anima)
  rajatabla?: string // lo mismo con el perfil Rajatabla (mayúsculas parejas, sin marcas propias)
  set?: boolean // se propone para la colección "Sets y en vivo" (y no se le inventa Artista - Título)
  dudoso?: boolean // queda en "para mirar a mano" sin proponerse
  nota?: string // nota de calidad (A, B, C, D, F)
  organiza?: string // "saltea" o la ruta nueva (con la regla de siempre, dentro de "Biblioteca")
  duplicadoDe?: string // otro archivo del laboratorio
  serato?: 'intacto' // los marcadores de Serato (GEOB) siguen después de escribir
  coleccion?: string // "musica", "produccion" (sample packs: nunca se renombran ni se mueven)…
}
/** `pendiente`: un problema conocido que todavía no está resuelto (se muestra en cada corrida para no olvidarlo). */
interface Entry { archivo: string; sha256: string; bytes: number; caso: string; espera?: Expect; pendiente?: string; origen?: string }
interface Manifest { version: number; nota: string; archivos: Entry[] }
type Result = Record<string, string | number | boolean | null>

const readManifest = (): Manifest => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
const writeManifest = (m: Manifest) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n')
const toPosix = (p: string) => p.split(path.sep).join('/')

function sha256(file: string): Promise<string> {
  return new Promise((ok, ko) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko)
  })
}

/** Cuántas veces aparece una marca en el principio del archivo (los tags ID3 van ahí): sirve para ver si Serato sigue. */
/** Todas las etiquetas como las ve ffprobe (archivo y pista), sin el título (la prueba lo cambia). */
function tagsOf(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const j = JSON.parse(execFileSync(findFfprobe()!, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file]).toString())
    for (const t of [j.format?.tags, ...(j.streams ?? []).map((x: { tags?: object }) => x.tags)]) if (t) for (const [k, v] of Object.entries(t)) if (k.toLowerCase() !== 'title') out[k.toLowerCase()] = String(v)
  } catch { /* ffprobe no lo lee: no se compara */ }
  return out
}
// Datos del contenedor, no etiquetas: cambian cuando un M4A fragmentado de YouTube se reacomoda para poder escribirle tags
// (core/tagio.ts, remuxFragmented); ahí también cambia el programa que lo armó.
const CONTAINER = ['major_brand', 'minor_version', 'compatible_brands']
function tagsDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  const remuxed = CONTAINER.some((k) => a[k] !== b[k])
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k] && !CONTAINER.includes(k) && !(remuxed && k === 'encoder'))
}

function countMarks(file: string, mark: string): number {
  const fd = fs.openSync(file, 'r')
  try {
    const b = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 2 * 1024 * 1024))
    fs.readSync(fd, b, 0, b.length, 0)
    let n = 0, i = -1
    while ((i = b.indexOf(mark, i + 1)) >= 0) n++
    return n
  } finally { fs.closeSync(fd) }
}

async function armar(from: string) {
  const m = readManifest()
  let copied = 0, ok = 0
  for (const e of m.archivos) {
    const dest = path.join(LAB, ...e.archivo.split('/'))
    if (fs.existsSync(dest) && (await sha256(dest)) === e.sha256) { ok++; continue }
    const src = path.join(from, ...(e.origen ?? e.archivo).split('/'))
    if (!fs.existsSync(src)) { console.log(`  no está en el origen: ${e.origen ?? e.archivo}`); continue }
    if ((await sha256(src)) !== e.sha256) { console.log(`  en el origen es distinto (se modificó): ${e.origen ?? e.archivo}`); continue }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL)
    copied++
  }
  console.log(`Laboratorio en ${LAB}: ${ok} ya estaban, ${copied} copiados.`)
}

async function agregar(list: string, from: string) {
  const m = readManifest()
  const items = JSON.parse(fs.readFileSync(list, 'utf8')) as { origen: string; caso: string }[]
  let added = 0
  for (const it of items) {
    if (m.archivos.some((e) => (e.origen ?? e.archivo) === it.origen)) continue
    const src = path.join(from, ...it.origen.split('/'))
    const dest = path.join(LAB, ...it.origen.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL)
    m.archivos.push({ archivo: it.origen, sha256: await sha256(dest), bytes: fs.statSync(dest).size, caso: it.caso })
    added++
  }
  m.archivos.sort((a, b) => a.archivo.localeCompare(b.archivo))
  writeManifest(m)
  console.log(`${added} archivos sumados al laboratorio y a tests/corpus.json.`)
}

async function correr(rapido: boolean) {
  const m = readManifest()
  if (!fs.existsSync(LAB)) { console.log(`No encuentro el laboratorio en ${LAB}. Armalo con: npm run corpus -- --armar "<tu carpeta de música>"`); process.exitCode = 1; return }
  await esperarSinMedicion() // una medición de velocidad de otra sesión no se contamina
  const soltar = await tomarTurno(OUT, rapido)
  if (!soltar) { console.log('El otro laboratorio sigue corriendo después de una hora: no arranco. Probá de nuevo más tarde.'); process.exitCode = 1; return }
  try { await correrConTurno(m, rapido) } finally { soltar() }
}

async function correrConTurno(m: Manifest, rapido: boolean) {
  const t0 = Date.now()
  // 1) ¿está todo y sin tocar?
  const faltan: string[] = [], distintos: string[] = []
  for (const e of m.archivos) {
    const f = path.join(LAB, ...e.archivo.split('/'))
    if (!fs.existsSync(f)) faltan.push(e.archivo)
    else if (fs.statSync(f).size !== e.bytes || (await sha256(f)) !== e.sha256) distintos.push(e.archivo)
  }
  if (faltan.length) console.log(`Faltan ${faltan.length} archivos en el laboratorio (npm run corpus -- --armar "<carpeta>"):\n  ${faltan.join('\n  ')}`)
  if (distintos.length) console.log(`Cambiaron ${distintos.length} archivos del laboratorio (alguien los tocó):\n  ${distintos.join('\n  ')}`)

  // 2) copia de trabajo y base temporal: el laboratorio no se toca nunca
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-corpus-'))
  const lib0 = path.join(work, 'lab')
  fs.cpSync(LAB, lib0, { recursive: true, filter: (src) => !toPosix(path.relative(LAB, src)).startsWith('_resultados') })
  const lib = new Library(path.join(work, 'paila.db'), findFfprobe())
  const results = new Map<string, Result>()
  let liviano = ''
  try {
    const a = await analyzeFolder(lib0)
    await lib.addRoot(lib0, a.suggestions.map((s) => ({ rel: s.rel, kind: s.kind })))
    await lib.scan()
    const rows = lib.db.prepare('SELECT id, rel_path AS rel, kind, ext, codec, error, artist, title FROM files').all() as { id: number; rel: string; kind: string; ext: string; codec: string | null; error: string | null; artist: string | null; title: string | null }[]
    const byRel = new Map(rows.map((r) => [r.rel, r]))
    for (const e of m.archivos) {
      const r = byRel.get(e.archivo)
      results.set(e.archivo, { coleccion: r?.kind ?? null, codec: r?.codec ?? null, error: r?.error ?? null })
    }
    const set = (rel: string, k: string, v: Result[string]) => { const x = results.get(rel); if (x) x[k] = v }
    for (const e of m.archivos) { try { set(e.archivo, 'formatoReal', sniff(path.join(lib0, ...e.archivo.split('/')))) } catch { /* ilegible */ } }

    // 3) nota de calidad (el BPM preciso no hace falta acá)
    if (!rapido) {
      process.stdout.write('Analizando calidad…')
      const runner: AnalysisRunner = { full: (job) => analyzeFile(job), prints: (job) => analyzePrints(job) }
      // la librería de BPM escribe "undefined" por cada tema (con su propia copia de console.log): se filtra la salida
      const write = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => (String(chunk).trim() === 'undefined' ? true : write(chunk as string, ...(rest as [])))) as typeof process.stdout.write
      // 4 a la vez (antes 2): todo corre en este proceso, con el tope de memoria de Node (~4 GB); PAILA_CORPUS_HILOS lo cambia
      const hilos = Number(process.env.PAILA_CORPUS_HILOS) || Math.min(4, Math.max(2, os.availableParallelism() - 2))
      try { await lib.analyze(runner, ffmpeg, hilos) } finally { process.stdout.write = write }
      for (const g of lib.db.prepare('SELECT f.rel_path AS rel, a.grade, a.flags FROM files f JOIN analysis a ON a.file_id = f.id').all() as { rel: string; grade: string | null; flags: string | null }[]) {
        set(g.rel, 'nota', g.grade); set(g.rel, 'marcas', g.flags)
      }
      console.log(' listo.')
    }

    // 4) Arreglar nombres y tags (solo la propuesta)
    const t = tidy(lib.db, undefined, (id) => lib.trackPath(id))
    const relOf = new Map(rows.map((r) => [r.id, r.rel]))
    for (const r of rows) { set(r.rel, 'artista', r.artist); set(r.rel, 'titulo', r.title) }
    for (const c of t.changes) {
      const rel = relOf.get(c.id)!
      const k = c.field === 'artist' ? 'artista' : c.field === 'title' ? 'titulo' : c.field === 'filename' ? 'nombre' : c.field === 'extension' ? 'extension' : `tag:${c.field}`
      set(rel, k, c.to)
      if (c.note) set(rel, 'aviso', c.note)
    }
    for (const d of t.review.filter((x) => !x.staged)) { set(relOf.get(d.id)!, 'dudoso', d.why) }
    for (const s of t.sets) set(s.rel, 'set', s.why) // se propone para "Sets y en vivo"

    // 4b) lo mismo "desde el nombre": muchos archivos ya traen tags (algunos mal puestos el 19/10), así que se borran artista,
    //     título y n.º en la base temporal para ver qué saca PAILA del nombre del archivo solo. Con el perfil por defecto
    //     (Prolijo, respeta mayúsculas) y con Rajatabla (mayúsculas parejas, sin marcas propias)
    lib.db.exec('SAVEPOINT nombre')
    lib.db.exec("UPDATE files SET artist = NULL, title = NULL, track = NULL WHERE kind = 'musica'")
    const t0n = tidy(lib.db, ['filename', 'junk', 'style'])
    const t0r = tidy(lib.db, ['filename', 'junk', 'style'], undefined, rulesOf('rajatabla'))
    lib.db.exec('ROLLBACK TO nombre; RELEASE nombre')
    for (const [key, tt] of [['desdeNombre', t0n], ['rajatabla', t0r]] as const) {
      const fromName = new Map<string, { a?: string; t?: string }>()
      for (const c of tt.changes) {
        const rel = relOf.get(c.id)!, x = fromName.get(rel) ?? {}
        if (c.field === 'artist') x.a = c.to
        if (c.field === 'title') x.t = c.to
        fromName.set(rel, x)
      }
      for (const r of rows) {
        const x = fromName.get(r.rel)
        const d = tt.review.find((v) => !v.staged && relOf.get(v.id) === r.rel)
        set(r.rel, key, x?.a || x?.t ? `${x.a ?? '?'} — ${x.t ?? '?'}` : d ? `dudoso: ${d.why}` : null)
      }
    }

    // 5) Organizar carpetas (vista previa, con lo que quedaría después de Arreglar nombres)
    const org = new Organizer(lib.db, (rid) => lib.roots().find((x) => x.id === rid)?.path ?? null)
    lib.db.exec('SAVEPOINT tidy')
    const col: Record<string, string> = { artist: 'artist', title: 'title', track: 'track', album: 'album', year: 'year', albumArtist: 'album_artist', genre: 'genre' }
    for (const c of t.changes) if (col[c.field]) lib.db.prepare(`UPDATE files SET ${col[c.field]} = ? WHERE id = ?`).run(c.to, c.id)
    const plan = org.plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
    lib.db.exec('ROLLBACK TO tidy; RELEASE tidy')
    for (const mv of plan.moves) set(relOf.get(mv.fileId)!, 'organiza', mv.to)
    for (const s of plan.skipped) set(s.rel, 'organiza', 'saltea')

    // 6) duplicados
    const groups = await findDuplicates(lib.db, (id) => lib.trackPath(id))
    for (const g of groups) for (const it of g.items) set(it.rel, g.level === 'version' ? 'versionDe' : 'duplicadoDe', g.items.filter((x) => x.id !== it.id).map((x) => x.rel).join(' | '))

    // 7) escribir tags: se le cambia el título a cada tema, como haría una persona; la huella del sonido tiene que quedar igual
    process.stdout.write('Probando escribir tags en cada archivo…')
    const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
    const music = rows.filter((r) => !r.error && results.has(r.rel))
    const geobBefore = new Map(music.map((r) => [r.rel, countMarks(lib.trackPath(r.id)!, 'GEOB')]))
    // guardar nunca borra etiquetas que PAILA no tocó, y deshacer las deja todas como estaban (22/10/2026)
    const tagsBefore = new Map(music.map((r) => [r.rel, tagsOf(lib.trackPath(r.id)!)]))
    // y deshacer deja cada archivo idéntico byte a byte, desde su respaldo liviano (24/10/2026)
    const sha = (rel: string) => crypto.createHash('sha1').update(fs.readFileSync(lib.trackPath(music.find((x) => x.rel === rel)!.id)!)).digest('hex')
    const bytesBefore = new Map(music.map((r) => [r.rel, sha(r.rel)]))
    ch.stageMany(music.map((r) => ({ id: r.id, field: 'title' as const, value: `${r.title ?? path.posix.basename(r.rel, path.posix.extname(r.rel))} [lab]` })))
    // a lo que no se le pueden escribir tags (un WebM que se llama .mp3) ya no se le propone nada (choques del 27/10, C4)
    const staged = new Set(ch.list().map((c) => c.fileId))
    const res = await ch.apply()
    const failed = new Map(res.failed.map((f) => [f.rel, f.error]))
    for (const r of music) {
      const err = failed.get(r.rel) ?? (staged.has(r.id) ? undefined : 'no se propone: no se le pueden escribir tags')
      set(r.rel, 'escribe', err ? `no: ${err.split('\n')[0].slice(0, 140)}` : 'sí')
      if (!err && geobBefore.get(r.rel)) {
        const p = lib.trackPath(r.id)!
        set(r.rel, 'serato', countMarks(p, 'GEOB') >= geobBefore.get(r.rel)! ? 'intacto' : 'perdido')
      }
      if (!err) { const d = tagsDiff(tagsBefore.get(r.rel)!, tagsOf(lib.trackPath(r.id)!)); set(r.rel, 'etiquetas', d.length ? `cambian al guardar: ${d.join(', ')}` : 'intactas') }
    }
    if (res.batchId) {
      const bk = listBackups(lib.db).filter((b) => b.ref === res.batchId && b.op === 'tags')
      liviano = `Respaldo liviano: ${Math.round(bk.reduce((t, b) => t + b.bytes, 0) / 1e3)} KB para ${bk.reduce((t, b) => t + b.files, 0)} archivos.`
      await ch.undo(res.batchId)
      for (const r of music) if (!failed.has(r.rel)) set(r.rel, 'deshacer', sha(r.rel) === bytesBefore.get(r.rel) ? 'idéntico' : 'distinto')
      for (const r of music) {
        if (failed.has(r.rel) || results.get(r.rel)?.etiquetas !== 'intactas') continue
        const d = tagsDiff(tagsBefore.get(r.rel)!, tagsOf(lib.trackPath(r.id)!))
        if (d.length) set(r.rel, 'etiquetas', `distintas al deshacer: ${d.join(', ')}`)
      }
    }
    console.log(' listo.')
  } finally {
    lib.close()
    fs.rmSync(work, { recursive: true, force: true })
  }

  // 8) comparar con lo esperado y con la corrida anterior
  const problems: string[] = []
  for (const e of m.archivos) {
    const r = results.get(e.archivo) ?? {}
    const x = e.espera
    const bad = (k: string, want: unknown, got: unknown) => problems.push(`${e.archivo}\n    ${k}: se esperaba ${JSON.stringify(want)} y salió ${JSON.stringify(got)}`)
    // vale para todos los archivos del laboratorio, aunque no tengan nada esperado
    if (r.escribe === 'sí' && r.etiquetas !== 'intactas') bad('etiquetas', 'intactas al guardar y al deshacer', r.etiquetas)
    if (r.escribe === 'sí' && r.deshacer !== 'idéntico') bad('deshacer', 'idéntico byte a byte', r.deshacer)
    if (!x) continue
    if (x.escribe !== undefined && (r.escribe === 'sí') !== x.escribe) bad('escribe', x.escribe ? 'sí' : 'no', r.escribe)
    if (x.formatoReal && r.formatoReal !== x.formatoReal) bad('formato real', x.formatoReal, r.formatoReal)
    if (x.extension && r.extension !== x.extension) bad('extensión', x.extension, r.extension)
    if (x.nombre && r.nombre !== x.nombre) bad('nombre', x.nombre, r.nombre)
    if (x.artista && r.artista !== x.artista) bad('artista', x.artista, r.artista)
    if (x.titulo && r.titulo !== x.titulo) bad('título', x.titulo, r.titulo)
    if (x.desdeNombre && r.desdeNombre !== x.desdeNombre) bad('desde el nombre', x.desdeNombre, r.desdeNombre)
    if (x.rajatabla && r.rajatabla !== x.rajatabla) bad('desde el nombre (Rajatabla)', x.rajatabla, r.rajatabla)
    if (x.set !== undefined && !!r.set !== x.set) bad('Sets y en vivo', x.set, r.set ?? false)
    if (x.dudoso !== undefined && !!r.dudoso !== x.dudoso) bad('dudoso', x.dudoso, r.dudoso ?? false)
    if (!rapido && x.nota && r.nota !== x.nota) bad('nota', x.nota, r.nota)
    if (x.organiza && r.organiza !== x.organiza) bad('organiza', x.organiza, r.organiza)
    if (x.duplicadoDe && !String(r.duplicadoDe ?? '').split(' | ').includes(x.duplicadoDe)) bad('duplicado de', x.duplicadoDe, r.duplicadoDe)
    if (x.serato && r.serato !== x.serato) bad('Serato', x.serato, r.serato)
    if (x.coleccion && r.coleccion !== x.coleccion) bad('colección', x.coleccion, r.coleccion)
    if (x.coleccion && x.coleccion !== 'musica' && (r.organiza || r.nombre)) bad('no se toca', 'sin mover ni renombrar', r.organiza ?? r.nombre)
  }
  const before: Resultados = ultimaDelMismoTipo(OUT, rapido)
  const now: Resultados = Object.fromEntries([...results].map(([k, v]) => [k, rapido ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'nota' && kk !== 'marcas')) : v]))
  const diffs: string[] = []
  for (const [rel, r] of Object.entries(now)) {
    const b = before[rel]
    if (!b) { if (Object.keys(before).length) diffs.push(`${rel}: nuevo en el laboratorio`); continue }
    for (const k of new Set([...Object.keys(r), ...Object.keys(b)])) {
      if (rapido && (k === 'nota' || k === 'marcas')) continue
      if (JSON.stringify(r[k] ?? null) !== JSON.stringify(b[k] ?? null)) diffs.push(`${rel}\n    ${k}: ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(r[k] ?? null)}`)
    }
  }
  const last = guardarCorrida(OUT, rapido, now)

  const n = m.archivos.length
  const writes = [...results.values()].filter((r) => r.escribe === 'sí').length
  console.log(`\nLaboratorio: ${n} archivos (${Math.round((Date.now() - t0) / 1000)} s, memoria máxima ${(process.resourceUsage().maxRSS / 1024 ** 2).toFixed(1)} GB). Se pudieron escribir ${writes}. ${liviano}`)
  const tipo = rapido ? 'rápida' : 'completa'
  console.log(Object.keys(before).length ? (diffs.length ? `\nCambios respecto de la corrida ${tipo} anterior (${diffs.length}):\n${diffs.join('\n')}` : `\nSin cambios respecto de la corrida ${tipo} anterior.`) : `\nPrimera corrida ${tipo}: queda guardada para comparar la próxima del mismo tipo.`)
  console.log(problems.length ? `\nNO CUMPLEN lo esperado (${problems.length}):\n${problems.join('\n')}` : '\nTodo cumple lo esperado en tests/corpus.json.')
  const pend = m.archivos.filter((e) => e.pendiente)
  if (pend.length) console.log(`\nProblemas conocidos sin resolver (${pend.length}):\n${pend.map((e) => `  ${e.archivo}\n    ${e.pendiente}`).join('\n')}`)
  console.log(`\nDetalle de cada archivo: ${last}`)
  if (problems.length || faltan.length || distintos.length) process.exitCode = 1
}

const args = process.argv.slice(2)
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
if (args.includes('--armar')) await armar(opt('--armar')!)
else if (args.includes('--agregar')) await agregar(opt('--agregar')!, opt('--desde')!)
else await correr(args.includes('--rapido'))
