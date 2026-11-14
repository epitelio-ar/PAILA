// Corrida supervisada del volumen parejo que puso otro programa (decidido el 22/10/2026), siempre sobre una COPIA
// de la base: PAILA lo compara con lo que mide; si está a menos de 1 dB se deja, si no se corrige.
//   vista:   lee el volumen parejo de cada tema (no escribe nada) y anota los que tienen el de otro programa: bien o mal,
//            con la diferencia, y si tienen la marca "Sound Check" de iTunes (iTunNORM).
//   aplicar: sobre la copia completa de la Música (con el aviso de turno): arma y aplica una muestra (todos los que se
//            corrigen, más temas nuevos y algunos con iTunNORM), verifica que solo cambió el volumen parejo (el sonido y la
//            marca de iTunes, iguales al original), deshace desde el Historial y compara contra el original.
//
//   node scripts/run-ts.mjs scripts/volumen.ts vista   --base <copia.db> --salida <carpeta>
//   node scripts/run-ts.mjs scripts/volumen.ts aplicar --base <copia.db> --salida <carpeta> --copia <Música-copia> --original <Música> [--muestra 400]
import fs from 'node:fs'
import path from 'node:path'
import { tomarCopia } from './turnos.mjs'
import { execFileSync } from 'node:child_process'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { gainChanges, gainPlan } from '@paila/core/replaygain'
import { readReplayGain } from '@paila/core/tagio'
import { pcmHash } from '@paila/core/audiohash'
import type { GainPlan, GainTrack } from '@paila/shared/types'

const mode = process.argv[2]
const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), outDir = arg('--salida')
if (!['vista', 'aplicar'].includes(mode) || !base || !outDir) { console.error('Uso: vista|aplicar --base <copia.db> --salida <carpeta> [--copia <Música-copia> --original <Música>]'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })
const ffmpeg = findFfmpeg()!
const ffprobe = findFfprobe()!
const lib = new Library(base, ffprobe)
const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(outDir, 'datos', 'resguardo'))
const log = (s: string) => { console.log(s); fs.appendFileSync(path.join(outDir, 'corrida.log'), `${new Date().toISOString()} ${s}\n`) }
const progress = (p: { done: number; total: number; current: string }) => { if (p.done % 500 === 0) log(`volumen ${p.done}/${p.total}`) }

/** Todos los tags tal como los ve ffprobe, sin los de ReplayGain: lo que no tiene que cambiar (incluida iTunNORM). */
function otherTags(file: string): Record<string, string> {
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file]).toString())
  const out: Record<string, string> = {}
  for (const src of [j.format?.tags, ...(j.streams ?? []).map((s: { tags?: object }) => s.tags)]) {
    if (src) for (const [k, v] of Object.entries(src)) if (!/replaygain/i.test(k)) out[k.toLowerCase()] = String(v)
  }
  return out
}
/** ¿Tiene la marca "Sound Check" de iTunes? Se busca en el principio y el final del archivo (ahí van los tags de MP3 y M4A). */
function hasNorm(file: string): boolean {
  if (!/\.(mp3|m4a|mp4|aac)$/i.test(file)) return false
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const b = Buffer.alloc(Math.min(size, 262_144))
    fs.readSync(fd, b, 0, b.length, 0)
    if (b.includes('iTunNORM', 0, 'latin1')) return true
    fs.readSync(fd, b, 0, b.length, Math.max(0, size - b.length))
    return b.includes('iTunNORM', 0, 'latin1')
  } catch { return false } finally { if (fd != null) fs.closeSync(fd) }
}
const tracks = (plan: GainPlan) => plan.albums.flatMap((a) => a.tracks)
const cur = (t: GainTrack) => (t.current ? JSON.parse(t.current) as { tg: number | null; ag: number | null } : null)

async function vista() {
  const plan = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true, onProgress: progress })
  const others = tracks(plan).filter((t) => cur(t)?.tg != null && t.why !== 'Ya tiene este mismo volumen parejo')
  const albumOf = new Map(plan.albums.flatMap((a) => a.tracks.map((t) => [t.id, a.gain] as const)))
  const rows = others.map((t) => {
    const c = cur(t)!
    const f = lib.trackPath(t.id)!
    return [t.wrong != null ? 'CORRIGE' : 'deja', c.tg, t.gain, t.gain == null ? '' : Math.round((c.tg! - t.gain) * 100) / 100, c.ag ?? '', albumOf.get(t.id) ?? '', t.lufs, hasNorm(f) ? 'iTunNORM' : '', t.rel].join('\t')
  })
  fs.writeFileSync(path.join(outDir, 'otro-programa.tsv'), ['qué\ttenía\tPAILA\tdiferencia\tdisco tenía\tdisco PAILA\tLUFS\tmarca\tarchivo', ...rows].join('\n'))
  const norm = tracks(plan).filter((t) => t.gain != null && !t.why && t.wrong == null).filter((t) => hasNorm(lib.trackPath(t.id)!)).length
  log(`volumen: ${plan.ready} listos (de esos, ${plan.wrong} corrigen el de otro programa) · ${plan.other} de otro programa y bien (se dejan) · ${plan.same} iguales · ${plan.notAnalyzed} sin analizar · ${plan.cantWrite} no se pueden escribir · con iTunNORM entre los listos: ${norm}`)
}

async function aplicar() {
  const copia = path.resolve(arg('--copia')), original = path.resolve(arg('--original'))
  if (!copia || !original || copia === original) { console.error('Faltan --copia y --original (distintas)'); process.exit(2) }
  const soltar = await tomarCopia(copia, { que: 'volumen parejo: aplicar una muestra, comparar y deshacer', horas: 1, propio: process.argv.includes('--aviso-propio') }) // el aviso de turno: lo toma y lo suelta solo
  try {
    const root = lib.roots()[0]
    const rel = path.relative(path.parse(copia).root, copia).split(path.sep).join('/')
    lib.db.prepare('UPDATE roots SET rel_path = ? WHERE id = ?').run(rel, root.id)
    if (path.resolve(lib.roots()[0].path) !== copia) throw new Error(`La base no quedó apuntando a la copia (${lib.roots()[0].path})`)
    const origOf = (f: string) => path.join(original, path.relative(copia, f))
    const plan = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true, onProgress: progress })
    // la muestra: todos los que se corrigen, y temas nuevos repartidos (MP3, FLAC, M4A, AIFF, WAV), con los de iTunNORM
    const want = Number(arg('--muestra', '400'))
    const all = gainChanges(plan)
    const byId = new Map(tracks(plan).map((t) => [t.id, t]))
    const wrongs = all.filter((c) => byId.get(c.id)!.wrong != null)
    const rest = all.filter((c) => byId.get(c.id)!.wrong == null)
    const norms: typeof rest = []
    for (const c of rest) { if (norms.length >= 40) break; if (hasNorm(lib.trackPath(c.id)!)) norms.push(c) }
    const byExt = new Map<string, typeof rest>()
    for (const c of rest) { const e = path.extname(byId.get(c.id)!.rel).toLowerCase(); byExt.set(e, [...(byExt.get(e) ?? []), c]) }
    const spread: typeof rest = []
    const room = Math.max(0, want - wrongs.length - norms.length)
    for (const [, cs] of byExt) { const step = Math.max(1, Math.floor(cs.length / Math.ceil(room / byExt.size))); for (let i = 0; i < cs.length && spread.length < room; i += step) spread.push(cs[i]) }
    const sample = [...new Map([...wrongs, ...norms, ...spread].map((c) => [c.id, c])).values()]
    changes.stageMany(sample)
    log(`muestra: ${sample.length} temas (${wrongs.length} corrigen el de otro programa, ${norms.length} con iTunNORM) de ${all.length} listos`)
    const files = new Map(sample.map((c) => [c.id, lib.trackPath(c.id)!]))
    const tagsBefore = new Map([...files].map(([id, f]) => [id, JSON.stringify(otherTags(f))]))
    const origStat = new Map([...files].map(([id, f]) => { const s = fs.statSync(origOf(f)); return [id, `${s.size}:${s.mtimeMs}`] }))
    const t0 = Date.now()
    const r = await changes.apply()
    log(`aplicado: ${r.applied} cambios en ${((Date.now() - t0) / 60000).toFixed(1)} min; fallaron ${r.failed.length}`)
    for (const f of r.failed) log(`   no se tocó: ${f.rel} · ${f.error}`)
    let wrong = 0, otherChanged = 0, origTouched = 0, audioDiff = 0
    for (const c of sample) {
      const f = files.get(c.id)!
      if (r.failed.some((x) => x.fileId === c.id)) continue
      if (readReplayGain(f) !== c.value) { wrong++; log(`   distinto de lo esperado: ${f}`) }
      const now = otherTags(f), was = JSON.parse(tagsBefore.get(c.id)!) as Record<string, string>
      const keys = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k])
      if (keys.length) { otherChanged++; log(`   cambió otro tag (${keys.join(", ")}): ${f}`) }
      if (await pcmHash(ffmpeg, f) !== await pcmHash(ffmpeg, origOf(f))) { audioDiff++; log(`   sonido distinto al original: ${f}`) }
      const s = fs.statSync(origOf(f)); if (`${s.size}:${s.mtimeMs}` !== origStat.get(c.id)) { origTouched++; log(`   ¡ORIGINAL TOCADO! ${origOf(f)}`) }
    }
    log(`comparación: ${wrong} distintos de lo esperado · otros tags cambiados (iTunNORM incluida): ${otherChanged} · sonido distinto al original: ${audioDiff} · originales tocados: ${origTouched}`)
    const t1 = Date.now()
    const u = await changes.undo(r.batchId!)
    log(`deshecho: ${u.applied} cambios en ${((Date.now() - t1) / 60000).toFixed(1)} min; fallaron ${u.failed.length}`)
    for (const f of u.failed) log(`   no se pudo deshacer: ${f.rel} · ${f.error}`)
    let vsOrig = 0
    for (const f of files.values()) {
      const same = readReplayGain(f) === readReplayGain(origOf(f)) && JSON.stringify(otherTags(f)) === JSON.stringify(otherTags(origOf(f))) && await pcmHash(ffmpeg, f) === await pcmHash(ffmpeg, origOf(f))
      if (!same) { vsOrig++; log(`   distinto del original: ${f}`) }
    }
    const strays = [...new Set([...files.values()].map((f) => path.dirname(f)))].flatMap((d) => fs.readdirSync(d).filter((n) => n.includes('.paila-')).map((n) => path.join(d, n)))
    log(`después de deshacer, contra el original: ${vsOrig} de ${files.size} temas distintos (volumen parejo, demás tags y sonido) · temporales sueltos: ${strays.length}`)
  } finally {
    soltar()
    log('aviso de turno sacado.')
  }
}

await (mode === 'vista' ? vista() : aplicar())
lib.close()
