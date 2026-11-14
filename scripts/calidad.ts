// Corrida supervisada de la nota de calidad (Fase E, 6.1): vuelve a medir la calidad con el motor actual sobre los temas de
// una COPIA de la base (los archivos solo se leen) y escribe cada cambio de nota para revisarlo uno por uno.
// Uso: node scripts/run-ts.mjs scripts/calidad.ts <copia.db> <carpeta-salida> [--sin-perdida] [--kbps-min N] [--max N] [--dudosos] [--hilos 3] [--solo-renotar]
//   --sin-perdida   solo WAV/FLAC/AIFF/ALAC (y los de 32 kHz o menos)
//   --dudosos       solo los que el motor de antes mandaba a mirar el espectrograma, los de corte suave y los sin pérdida de
//                   32 kHz (la corrida del 22/10/2026: PAILA decide sola con pistas)
//   --solo-renotar  no decodifica: vuelve a poner la nota con las mediciones guardadas en <carpeta-salida>/medidas.json
//   --kbps-min N    además (o solo, sin --sin-perdida) los archivos con pérdida de N kbps o más
//   --max N         una muestra fija de N temas de los con pérdida (los mismos cada vez)
//   --escribir      guarda la nota nueva en esa COPIA de la base (para ver la app con el motor nuevo sin esperar el análisis)
// Cada cambio sale con sus pistas (core/analysis/clues.ts): el link de YouTube, el conversor, los nombres de antes, el año.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { analyzeFile, inputMeta, type RawAnalysis } from '@paila/core/analysis/analyze'
import { grade, type GradeInput } from '@paila/core/analysis/grade'
import { cluesFor, readClues } from '@paila/core/analysis/clues'
import type { Db } from '@paila/core/db'
import { isLossless, qualityCols } from '@paila/core/queue'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

const args = process.argv.slice(2)
const [dbFile, outDir] = args
if (!dbFile || !outDir) { console.error('Uso: calidad.ts <copia.db> <carpeta-salida> [--sin-perdida] [--kbps-min N] [--max N] [--dudosos] [--hilos N] [--solo-renotar]'); process.exit(2) }
const onlyLossless = args.includes('--sin-perdida')
const onlyDoubtful = args.includes('--dudosos')
const kbpsMin = args.includes('--kbps-min') ? Number(args[args.indexOf('--kbps-min') + 1]) : 0
const maxLossy = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : 0
const regrade = args.includes('--solo-renotar')
const write = args.includes('--escribir')
if (write && /[\\/]PAILA[\\/]paila\.db$/i.test(dbFile)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
const threads = Number(args[args.indexOf('--hilos') + 1]) || 3
fs.mkdirSync(outDir, { recursive: true })

interface Row {
  id: number; rel: string; root: string; ext: string; codec: string | null; sample_rate: number | null; bits: number | null
  channels: number | null; kbps: number | null; duration: number | null; grade: string | null; is_label: string | null; flags: string | null
  why: string | null; year: string | null
}
const db = new DatabaseSync(dbFile, { readOnly: !write })
const sampleKey = (x: { id: number }) => (x.id * 2654435761) % 1000003
let sampleTop: number | undefined
const rows = (db.prepare(
  `SELECT f.id, f.rel_path AS rel, v.last_mount || r.rel_path AS root, f.ext, f.codec, f.sample_rate, f.bits, f.channels, f.kbps, f.duration,
          a.grade, a.is_label, a.flags, a.why, f.year
   FROM files f JOIN analysis a ON a.file_id = f.id JOIN roots r ON r.id = f.root_id JOIN volumes v ON v.id = r.volume_id
   WHERE f.kind != 'produccion' AND f.error IS NULL AND a.error IS NULL AND a.grade IS NOT NULL
     AND f.trashed_at IS NULL AND f.missing_at IS NULL AND f.excluded_at IS NULL ORDER BY f.id`,
).all() as unknown as Row[]).filter((r) => {
  const lossless = isLossless(r.codec, r.ext) || (r.sample_rate ?? 44100) <= 32000
  if (!onlyLossless && !kbpsMin) return true
  return (onlyLossless && lossless) || (!!kbpsMin && !lossless && (r.kbps ?? 0) >= kbpsMin)
}).filter((r, _, all) => {
  // muestra fija de los con pérdida: los de menor (id × primo) mod un primo grande
  if (!maxLossy || isLossless(r.codec, r.ext)) return true
  sampleTop ??= all.filter((x) => !isLossless(x.codec, x.ext)).map(sampleKey).sort((a, b) => a - b)[maxLossy - 1] ?? Infinity
  return sampleKey(r) <= sampleTop
})
  .filter((r) => !onlyDoubtful || /espectrograma/i.test(r.why ?? '') || /soft_cutoff/.test(r.flags ?? '') || (isLossless(r.codec, r.ext) && (r.sample_rate ?? 44100) <= 32000))

type Measured = Omit<RawAnalysis, 'prints' | 'dj' | 'cutoff' | 'hires'> & { cutoff: Omit<RawAnalysis['cutoff'], 'spectrum'>; hires: RawAnalysis['hires'] }
const cacheFile = path.join(outDir, 'medidas.json')
const cache: Record<number, Measured> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
const infoOf = (r: Row): GradeInput => ({ codec: r.codec, ext: r.ext, lossless: isLossless(r.codec, r.ext), kbps: r.kbps, sampleRate: r.sample_rate, bits: r.bits, channels: r.channels })

async function measure(r: Row): Promise<Measured | null> {
  // una medición guardada antes de que existieran las etiquetas (meta): se leen solas, sin decodificar (es un instante)
  if (cache[r.id] && !cache[r.id].meta) {
    let err = ''
    try { execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', path.join(r.root, r.rel)], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { err = String((e as { stderr?: Buffer }).stderr ?? '') }
    cache[r.id].meta = inputMeta(err)
  }
  if (cache[r.id] || regrade) return cache[r.id] ?? null
  try {
    const raw = await analyzeFile({ ffmpeg, file: path.join(r.root, r.rel), ...infoOf(r), duration: r.duration, withDj: false, withPrints: false })
    const { prints: _p, dj: _d, cutoff: { spectrum: _s, ...cutoff }, ...rest } = raw
    return (cache[r.id] = { ...rest, cutoff })
  } catch { return null }
}

const t0 = Date.now()
let next = 0, done = 0
await Promise.all(Array.from({ length: threads }, async () => {
  while (next < rows.length) {
    await measure(rows[next++])
    if (++done % 50 === 0) {
      console.log(`${done} / ${rows.length} (${Math.round((Date.now() - t0) / 1000)} s)`)
      fs.writeFileSync(cacheFile, JSON.stringify(cache))
    }
  }
}))
fs.writeFileSync(cacheFile, JSON.stringify(cache))

// nota nueva y cambios
const lines = [['id', 'antes', 'ahora', 'formato', 'kHz', 'kbps', 'año', 'corte', 'caída medio kHz', 'caída total', 'escalón 16k', 'titileo', 'pistas', 'marcas', 'era', 'es', 'por qué', 'archivo'].join('\t')]
const moves: Record<string, number> = {}
for (const r of rows) {
  const m = cache[r.id]
  if (!m) continue
  const raw = { ...m, cutoff: { ...m.cutoff, spectrum: [] }, prints: { audioMd5: null, chromaprint: null, size: null, mtime: null }, dj: null } as RawAnalysis
  const clues = cluesFor(db as unknown as Db, r.id)
  const v = grade(infoOf(r), raw, clues)
  const found = readClues(clues, m.meta).map((x) => x.kind).join(',')
  if (write) {
    // solo la nota y su explicación (el espectro, el volumen y el BPM guardados no se tocan); las marcas de BPM y tono quedan
    const q = qualityCols(v, raw)
    const keep = (r.flags ?? '').split(',').filter((x) => /^(bpm_|key_|dj_)/.test(x))
    db.prepare('UPDATE analysis SET grade = ?, says = ?, is_label = ?, why = ?, confidence = ?, flags = ?, eff_kbps = ?, sound = ?, quality_v = ? WHERE file_id = ?')
      .run(q.grade, q.says, q.is_label, q.why, q.confidence, [q.flags, ...keep].filter(Boolean).join(',') || null, q.eff_kbps, q.sound, q.quality_v, r.id)
  }
  const key = `${r.grade} → ${v.grade}`
  moves[key] = (moves[key] ?? 0) + 1
  // la marca de BPM dudoso no es de calidad (la pasada de calidad la conserva)
  const before = (r.flags ?? '').split(',').filter((x) => x && x !== 'bpm_doubtful').join(',')
  if (r.grade === v.grade && before === v.flags.join(',') && !onlyDoubtful) continue
  const c = m.cutoff
  lines.push([r.id, r.grade, v.grade, r.ext, (r.sample_rate ?? 0) / 1000, r.kbps, clues.year ?? '', c.cutoff, c.sharp ?? '', c.fall ?? '', c.step16 ?? '', m.flicker == null ? '' : m.flicker.toFixed(2),
    found, v.flags.join(','), r.is_label, v.is, v.why.join(' ').replace(/\s+/g, ' '), r.rel].join('\t'))
}
fs.writeFileSync(path.join(outDir, 'cambios.tsv'), lines.join('\n'))
console.log(`Listo: ${Object.keys(cache).length} medidos en ${Math.round((Date.now() - t0) / 1000)} s. Cambios: ${lines.length - 1}`)
for (const [k, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) if (k.split(' → ')[0] !== k.split(' → ')[1]) console.log(`  ${k}: ${n}`)
