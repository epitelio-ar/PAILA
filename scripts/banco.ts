// Banco de pruebas de BPM y tono (Fase E, 6.2): compara lo que calcula PAILA (o una variante del motor) con una referencia
// —el rekordbox.xml exportado por el usuario, o los tags de BPM y tono de los archivos— y da el número de coincidencias.
// Solo lee: la base es una COPIA y los archivos no se tocan.
// Uso: node scripts/run-ts.mjs scripts/banco.ts <copia.db> <carpeta-salida> (--rekordbox <x.xml> | --tags)
//        [--variantes actual,genero,degara,percival,tono:edma,tono:shaath,…] [--max N] [--parte k/n]
//   actual   lo guardado en la base (BPM preciso si lo hay)      genero   lo guardado, puesto en el rango de su género
//   degara / multifeature / percival   BPM recalculado con ese método (90 s del medio, rango general y por género)
//   tono:<perfil>   tono recalculado con ese perfil de Essentia (edma, bgate, shaath, krumhansl, temperley…)
//   tono:<perfil>:36 · :3v · :5k   con 36 bandas por octava · tres pedazos de 30 s (20 %, 50 % y 80 % del tema) · hasta 5 kHz
//   tono:keyfinder  tono al estilo KeyFinder sobre el tema entero (core/analysis/keyfinder.ts)
//   beatthis · tempocnn   los modelos (necesitan --modelos <carpeta de modelos>: onnxruntime-web y TensorFlow.js en npm/)
//   --giantsteps <carpeta>   referencia: la colección pública GiantSteps (tempo y tono) en vez de la biblioteca
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseRekordboxXml, score, scoreText, bpmMatch, parseKey, keyMatch, camelotText, type BenchItem } from '@paila/core/analysis/bench'
import { bpmForStyle, styleOf } from '@paila/core/analysis/bpmrange'
import { findFfprobe } from '@paila/core/probe'
import { Motores, type Out } from './banco-motores'

const ffprobe = findFfprobe()!

const args = process.argv.slice(2)
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const [dbFile, outDir] = args
if (!dbFile || !outDir) { console.error('Uso: banco.ts <copia.db> <carpeta-salida> (--rekordbox x.xml | --tags) [--variantes …]'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })
const variants = (opt('--variantes') ?? 'actual,genero').split(',')
const max = Number(opt('--max')) || Infinity
const [part, parts] = (opt('--parte') ?? '1/1').split('/').map(Number)

interface Row { id: number; rel: string; root: string; genre: string | null; duration: number | null; bpm: number | null; camelot: string | null; artist: string | null; title: string | null }
const gs = opt('--giantsteps')
const rows = gs ? [] as Row[] : new DatabaseSync(dbFile, { readOnly: true }).prepare(
  `SELECT f.id, f.rel_path AS rel, v.last_mount || r.rel_path AS root, f.genre, f.duration, a.bpm, a.camelot, f.artist, f.title
   FROM files f LEFT JOIN analysis a ON a.file_id = f.id JOIN roots r ON r.id = f.root_id JOIN volumes v ON v.id = r.volume_id
   WHERE f.kind != 'produccion' AND f.trashed_at IS NULL AND f.missing_at IS NULL`,
).all() as unknown as Row[]
const full = (r: Row) => path.join(r.root, r.rel)
const keyOfPath = (p: string) => p.replace(/\\/g, '/').normalize('NFC').toLowerCase()

// 1) la referencia
interface Ref { bpm: number | null; key: string | null; source: string }
const refs = new Map<number, Ref>()
const xml = opt('--rekordbox')
if (gs) {
  // GiantSteps: previews de 2 min de Beatport con el tempo (annotations_v2) y el tono corregidos por usuarios
  const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null)
  for (const file of fs.readdirSync(path.join(gs, 'audio')).filter((f) => f.endsWith('.mp3'))) {
    const id = Number(file.split('.')[0])
    const base = file.replace(/.mp3$/, '')
    const bpm = Number(read(path.join(gs, 'tempo', 'annotations_v2', 'tempo', base + '.bpm'))) || null
    const key = read(path.join(gs, 'key', 'annotations', 'key', base + '.key'))
    const genre = read(path.join(gs, 'tempo', 'annotations', 'genre', base + '.genre')) ?? read(path.join(gs, 'key', 'annotations', 'genre', base + '.genre'))
    if (!bpm && !key) continue
    rows.push({ id, rel: file, root: path.join(gs, 'audio'), genre, duration: 120, bpm: null, camelot: null, artist: null, title: null })
    refs.set(id, { bpm, key: key?.replace(/s*-s*.*$/, '') ?? null, source: 'giantsteps' })
  }
  console.log(`GiantSteps: ${refs.size} previews (${[...refs.values()].filter((r) => r.bpm).length} con tempo, ${[...refs.values()].filter((r) => r.key).length} con tono)`)
} else if (xml) {
  const byPath = new Map(rows.map((r) => [keyOfPath(full(r)), r]))
  const byName = new Map<string, Row[]>()
  for (const r of rows) { const n = keyOfPath(path.basename(r.rel)); byName.set(n, [...(byName.get(n) ?? []), r]) }
  // si cambió la ruta (se renombró o movió desde que se cargó en Rekordbox): por nombre de archivo, o por artista + título + duración
  const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const byTag = new Map<string, Row[]>()
  for (const r of rows) if (r.title) { const k = fold(r.artist) + '|' + fold(r.title); byTag.set(k, [...(byTag.get(k) ?? []), r]) }
  const how = { ruta: 0, nombre: 0, tags: 0, no: 0 }
  for (const t of parseRekordboxXml(fs.readFileSync(xml, 'utf8'))) {
    if (!t.bpm && !t.key) continue
    let r = byPath.get(keyOfPath(t.path))
    if (r) how.ruta++
    else if (byName.get(keyOfPath(path.basename(t.path)))?.length === 1) { r = byName.get(keyOfPath(path.basename(t.path)))![0]; how.nombre++ }
    else {
      const c = (byTag.get(fold(t.artist) + '|' + fold(t.name)) ?? []).filter((x) => t.seconds == null || x.duration == null || Math.abs(x.duration - t.seconds) <= 2)
      if (c.length === 1) { r = c[0]; how.tags++ } else how.no++
    }
    if (r) refs.set(r.id, { bpm: t.bpm, key: t.key, source: 'rekordbox' })
  }
  console.log(`Rekordbox: ${refs.size} temas emparejados con PAILA (por ruta ${how.ruta}, por nombre de archivo ${how.nombre}, por artista y título ${how.tags}); ${how.no} sin emparejar`)
} else if (args.includes('--tags')) {
  const cacheFile = path.join(outDir, 'tags.json')
  let tags: Record<number, { bpm: string | null; key: string | null }> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
  const todo = rows.filter((r) => !(r.id in tags))
  let next = 0
  const probe = (r: Row) => new Promise<void>((ok) => execFile(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_entries', 'format_tags:stream_tags', full(r)], { windowsHide: true, maxBuffer: 1 << 24 }, (_e, out) => {
    let t: Record<string, string> = {}
    try { const j = JSON.parse(out); t = { ...(j.streams?.[0]?.tags ?? {}), ...(j.format?.tags ?? {}) } } catch { /* sin tags */ }
    const pick = (re: RegExp) => Object.entries(t).find(([k]) => re.test(k))?.[1] ?? null
    tags[r.id] = { bpm: pick(/^(TBPM|BPM|tempo|tmpo)$/i), key: pick(/^(TKEY|INITIALKEY|KEY|initial ?key)$/i) }
    ok()
  }))
  await Promise.all(Array.from({ length: 3 }, async () => { while (next < todo.length) await probe(todo[next++]) }))
  fs.writeFileSync(cacheFile, JSON.stringify(tags))
  for (const r of rows) {
    const t = tags[r.id]
    const bpm = Number(t?.bpm)
    // BPM de tag fuera de lo razonable (0, 192 en todo un disco de los 60…) no sirven de referencia
    if (t && (t.key || (bpm >= 50 && bpm <= 220))) refs.set(r.id, { bpm: bpm >= 50 && bpm <= 220 ? bpm : null, key: t.key, source: 'tags' })
  }
  console.log(`Tags: ${refs.size} temas con BPM o tono escrito`)
} else { console.error('Falta la referencia: --rekordbox <x.xml> o --tags'); process.exit(2) }

// 2) las variantes
const sel = rows.filter((r) => refs.has(r.id)).filter((_, i) => i % parts === part - 1).slice(0, max)
const motores = new Motores(variants, opt('--modelos'))
await motores.init()
const results: Record<string, Record<number, Out>> = Object.fromEntries(variants.map((v) => [v, {}]))
const t0 = Date.now()
for (const [i, r] of sel.entries()) {
  const style = styleOf(r.genre, r.rel.includes('/') ? path.dirname(r.rel) : null)
  if (results.actual) results.actual[r.id] = { bpm: r.bpm, key: r.camelot }
  if (results.genero) results.genero[r.id] = { bpm: r.bpm ? bpmForStyle(r.bpm, style) : null, key: r.camelot }
  try {
    for (const [name, out] of Object.entries(await motores.run(full(r), r.duration, style))) (results[name] ??= {})[r.id] = out
  } catch (e) { console.log(`${r.rel}: ${(e as Error).message}`) }
  if ((i + 1) % 25 === 0) console.log(`${i + 1} / ${sel.length} (${Math.round((Date.now() - t0) / 1000)} s)`)
}

// 3) el número de cada variante y los desacuerdos
const report: string[] = [`Referencia: ${gs ? 'GiantSteps' : xml ? 'Rekordbox' : 'tags'} · ${sel.length} temas`]
const detail: string[] = [['variante', 'id', 'ref BPM', 'BPM', 'BPM', 'ref tono', 'tono', 'tono', 'archivo'].join('\t')]
for (const [name, res] of Object.entries(results)) {
  const items: BenchItem[] = sel.filter((r) => res[r.id]).map((r) => ({ bpm: res[r.id].bpm, refBpm: refs.get(r.id)!.bpm, key: res[r.id].key, refKey: refs.get(r.id)!.key }))
  report.push(`\n${name}`, ...scoreText(score(items)).map((l) => '  ' + l))
  for (const r of sel) {
    const o = res[r.id], ref = refs.get(r.id)!
    if (!o) continue
    const bm = o.bpm && ref.bpm ? bpmMatch(o.bpm, ref.bpm) : ''
    const a = parseKey(o.key), b = parseKey(ref.key)
    const km = a && b ? keyMatch(a, b) : ''
    if ((bm && bm !== 'igual') || (km && km !== 'exacto')) detail.push([name, r.id, ref.bpm ?? '', o.bpm ?? '', bm, b ? camelotText(b) : '', a ? camelotText(a) : '', km, r.rel].join('\t'))
  }
}
const tag = parts > 1 ? `-${part}de${parts}` : ''
fs.writeFileSync(path.join(outDir, `resultado${tag}.txt`), report.join('\n'))
fs.writeFileSync(path.join(outDir, `desacuerdos${tag}.tsv`), detail.join('\n'))
fs.writeFileSync(path.join(outDir, `crudo${tag}.json`), JSON.stringify({ refs: Object.fromEntries(sel.map((r) => [r.id, refs.get(r.id)])), results }))
console.log(report.join('\n'))
