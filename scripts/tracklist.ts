// Corrida supervisada del tracklist de sets (MASTERPLAN-3, punto 5) sobre una COPIA de la base. No escribe nada en la base
// ni en la música: lee el set, arma el tracklist y lo escribe tramo por tramo para revisarlo.
//
//   node scripts/run-ts.mjs scripts/tracklist.ts --base <copia de paila.db> --id <tema> --raiz <copia de la carpeta raíz> [--salida <tramos.md>] [--disco]
//   node scripts/run-ts.mjs scripts/tracklist.ts --base <copia de paila.db> --set <archivo> [--salida <tramos.md>] [--disco]
//   node scripts/run-ts.mjs scripts/tracklist.ts --base <copia> --sinteticos <carpeta> [--cuantos 6] [--semilla 1] [--velocidades]
//
// --id escucha un set de la biblioteca con lo mismo que la app (core/setlists.ts: también los temas de su carpeta, enteros),
// leyendo los archivos de --raiz (la copia de la Música). Guarda la huella y el tracklist en la copia de la base.
// --sinteticos arma sets de prueba con temas de la biblioteca (con ffmpeg: cruces de 12 s, temas acelerados o frenados
// con "master tempo" o como un disco, empezando en la intro o más adelante) y compara el tracklist con lo que se sabe que
// suena. Los sets quedan en esa carpeta (con su respuesta en .json) para volver a correrlos.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Library } from '@paila/core/library'
import { findFfmpeg } from '@paila/core/probe'
import { decodeFingerprint, encodeFingerprint } from '@paila/core/analysis/chromaprint'
import { setPrint } from '@paila/core/analysis/setprint'
import { libraryPrints } from '@paila/core/soundindex'
import { setReason } from '@paila/core/sets'
import { clock, type TracklistEntry } from '@paila/core/tracklist'
import { buildTracklist } from '@paila/core/tracklist-build'
import { SetLists, refiner, scanSet, twins } from '@paila/core/setlists'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base')
if (!base) { console.error('Uso: --base <copia de paila.db> (--set <archivo> | --sinteticos <carpeta>)'); process.exit(2) }
if (/\\PAILA\\paila\.db$|\/PAILA\/paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
const ffmpeg = findFfmpeg()!
// --sin-master: sin probar las velocidades con master tempo · --disco: segunda pasada a otras velocidades como un disco
const noMaster = process.argv.includes('--sin-master'), disc = process.argv.includes('--disco')
const lib = new Library(base, null)
const db = lib.db
const info = db.prepare('SELECT rel_path AS rel, duration, artist, title, kind FROM files WHERE id = ?')
const row = (id: number) => info.get(id) as { rel: string; duration: number | null; artist: string | null; title: string | null; kind: string }
const isSet = (id: number) => { const r = row(id); return !r || r.kind === 'sets' || setReason(r.rel, r.duration, r) != null }
const nameOf = (id: number) => { const r = row(id); return r.artist && r.title ? `${r.artist} - ${r.title}` : r.rel.split('/').pop()! }

async function tracklistOf(file: string, cache?: string): Promise<{ entries: TracklistEntry[]; seconds: number; ms: { print: number; search: number }; bytes: number }> {
  const t0 = performance.now()
  let fp: Uint32Array, seconds: number
  if (cache && fs.existsSync(cache)) { fp = decodeFingerprint(fs.readFileSync(cache, 'utf8')); seconds = fp.length / (11025 / 1365) }
  else { const r = await setPrint({ ffmpeg, file, channels: 2, duration: null }); fp = r.fp; seconds = r.seconds; if (cache) fs.writeFileSync(cache, encodeFingerprint(fp)) }
  const t1 = performance.now()
  const lp = await libraryPrints(db)
  const hits = await scanSet(lp, fp, seconds, (from, secs, speed) => setPrint({ ffmpeg, file, channels: 2, duration: null, from, seconds: secs, speed }).then((x) => x.fp),
    { exclude: isSet, speeds: disc, ...(noMaster ? { rates: [] } : {}) })
  const entries = buildTracklist(hits, seconds, (id) => row(id).duration, undefined, refiner(lp, fp), twins(lp))
  return { entries, seconds, ms: { print: t1 - t0, search: performance.now() - t1 }, bytes: encodeFingerprint(fp).length }
}

// ---------- un set de la biblioteca, como lo hace la app ----------
const setId = Number(arg('--id', '0'))
if (setId) {
  const root = arg('--raiz')
  if (!root) { console.error('Falta --raiz <copia de la carpeta raíz>'); process.exit(2) }
  const sl = new SetLists(db, (id) => path.join(root, row(id).rel), ffmpeg)
  const t0 = performance.now()
  const t = await sl.listen(setId, { speeds: disc, onProgress: (p) => process.stdout.write(`${p.current.slice(0, 60).padEnd(60)} ${p.total ? `${p.done}/${p.total}` : ''}   `) })
  process.stdout.write('\n')
  const lines = [`# Tracklist de ${t.rel.split('/').pop()}`, '',
    `${clock(t.seconds)} de set · huella ${t.printKb} KB · leer ${t.took?.read} s · buscar ${t.took?.search} s · todo ${((performance.now() - t0) / 1000).toFixed(1)} s${disc ? ' (con la pasada de disco)' : ''} · temas de la carpeta escuchados enteros: ${sl.neighbors(setId).length}`, '',
    '| Entra | Tema | Seguridad | Ventanas | Velocidad | Otros archivos |', '|---|---|---|---|---|---|',
    ...t.entries.map((e) => e.source == null
      ? `| ${clock(e.start)} | _sin reconocer hasta ${clock(e.until)}_ | | | | |`
      : `| ${clock(e.start)} | ${[e.artist, e.title].filter(Boolean).join(' - ')} | ${e.confidence} | ${e.windows} | ${Math.abs(e.rate - 1) >= 0.015 ? `${e.rate > 1 ? '+' : ''}${Math.round((e.rate - 1) * 100)} %` : ''} | ${e.alsoIds.map(nameOf).join(', ')} |`)]
  const out = arg('--salida')
  if (out) fs.writeFileSync(out, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}

// ---------- un archivo cualquiera ----------
const setFile = arg('--set')
if (setFile) {
  const r = await tracklistOf(setFile, arg('--cache') || undefined)
  const lines = [`# Tracklist de ${path.basename(setFile)}`, '',
    `${clock(r.seconds)} de set · huella ${Math.round(r.bytes / 1024)} KB · leer ${(r.ms.print / 1000).toFixed(1)} s · buscar ${(r.ms.search / 1000).toFixed(1)} s${noMaster ? ' (sin master tempo)' : ''}${disc ? ' (con la pasada de disco)' : ''}`, '',
    '| Entra | Tema | Seguridad | Ventanas | Contraste | Velocidad | Otros archivos |', '|---|---|---|---|---|---|---|',
    ...r.entries.map((e) => e.fileId == null
      ? `| ${clock(e.start)} | _sin reconocer hasta ${clock(e.heardUntil)}_ | | | | | |`
      : `| ${clock(e.start)} | ${nameOf(e.fileId)} | ${e.confidence} | ${e.windows} | ${e.contrast.toFixed(2)} | ${e.rate === 1 ? '' : `${e.rate > 1 ? '+' : ''}${Math.round((e.rate - 1) * 100)} %`} | ${e.alsoIds.map(nameOf).join(', ')} |`)]
  const out = arg('--salida')
  if (out) fs.writeFileSync(out, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}

// ---------- sets sintéticos con la respuesta conocida ----------
interface Truth { fileId: number; name: string; at: number; from: number; rate: number; mode: 'master' | 'disco' | 'normal' }
const synthDir = arg('--sinteticos')
if (synthDir) {
  fs.mkdirSync(synthDir, { recursive: true })
  const count = Number(arg('--cuantos', '6'))
  let seed = Number(arg('--semilla', '1'))
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const pool = (db.prepare(`SELECT f.id FROM files f JOIN analysis a ON a.file_id = f.id WHERE f.kind = 'musica' AND f.trashed_at IS NULL
    AND f.missing_at IS NULL AND a.chromaprint IS NOT NULL AND f.duration BETWEEN 180 AND 600 ORDER BY f.id`).all() as { id: number }[]).map((r) => r.id).filter((id) => !isSet(id))
  let ok = 0, total = 0, wrong = 0, doubtful = 0, startErr: number[] = []
  const report: string[] = []
  for (let n = 0; n < count; n++) {
    const file = path.join(synthDir, `set-${arg('--semilla', '1')}-${n + 1}.mp3`), truthFile = file.replace(/\.mp3$/, '.json')
    let truth: Truth[]
    if (fs.existsSync(file) && fs.existsSync(truthFile)) truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'))
    else {
      // 8 temas: la mitad desde el principio, el resto desde 20–60 s; 150–200 s de cada uno; cruces de 12 s
      const picks: Truth[] = []
      const inputs: string[] = [], chains: string[] = []
      let at = 0
      for (let i = 0; i < 8; i++) {
        const id = pool[Math.floor(rnd() * pool.length)]
        const from = rnd() < 0.5 ? 0 : Math.round(20 + rnd() * 40), len = Math.min(Math.round(150 + rnd() * 50), Math.floor((row(id).duration ?? 0) - from - 2))
        const modeR = rnd(), mode: Truth['mode'] = n === 0 ? 'normal' : modeR < 0.5 ? 'master' : modeR < 0.8 ? 'disco' : 'normal'
        const rate = mode === 'normal' ? 1 : Math.round((0.95 + rnd() * 0.1) * 100) / 100
        picks.push({ fileId: id, name: nameOf(id), at, from, rate, mode })
        inputs.push('-ss', String(from), '-t', String(len), '-i', lib.trackPath(id)!)
        const speed = mode === 'master' ? `,atempo=${rate}` : mode === 'disco' ? `,asetrate=${Math.round(44100 * rate)},aresample=44100` : ''
        chains.push(`[${i}:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo${speed}[s${i}]`)
        at += len / rate - 12
      }
      let last = 's0'
      for (let i = 1; i < 8; i++) { chains.push(`[${last}][s${i}]acrossfade=d=12[x${i}]`); last = `x${i}` }
      const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', chains.join(';'), '-map', `[${last}]`, '-b:a', '192k', file], { encoding: 'utf8' })
      if (r.status !== 0) { console.error(r.stderr); continue }
      truth = picks
      fs.writeFileSync(truthFile, JSON.stringify(truth, null, 1))
    }
    const r = await tracklistOf(file)
    const found = r.entries.filter((e) => e.fileId != null)
    report.push(`\n## ${path.basename(file)}`)
    for (const t of truth) {
      total++
      const e = found.find((x) => x.fileId === t.fileId || x.alsoIds.includes(t.fileId))
      if (e) { ok++; startErr.push(e.start - t.at) }
      report.push(`- ${e ? '✔' : '✘'} ${clock(t.at)} ${t.name} (desde ${t.from} s, ${t.mode}${t.rate !== 1 ? ` ${t.rate}` : ''})${e ? ` → entra ${clock(e.start)} (${e.start - t.at >= 0 ? '+' : ''}${Math.round(e.start - t.at)} s, ${e.confidence}, ${e.windows} v, x${e.rate})` : ''}`)
    }
    for (const e of found) if (!truth.some((t) => t.fileId === e.fileId || e.alsoIds.includes(t.fileId))) { if (e.confidence === 'baja') doubtful++; else wrong++; report.push(`- ⚠ de más: ${clock(e.start)} ${nameOf(e.fileId!)} (${e.confidence}, ${e.windows} v, c ${e.contrast.toFixed(2)})`) }
  }
  startErr = startErr.map(Math.abs).sort((a, b) => a - b)
  console.log(report.join('\n'))
  console.log(`\nReconocidos ${ok} de ${total} · de más ${wrong} (y ${doubtful} dudosos, que no salen sin confirmar) · error al entrar: mediana ${startErr[startErr.length >> 1]?.toFixed(0)} s, peor ${startErr[startErr.length - 1]?.toFixed(0)} s`)
}
lib.close()
