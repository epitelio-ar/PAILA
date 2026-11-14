// Comparación con Fakin' The Funk (MASTERPLAN-3, punto 3): mide con el motor actual de PAILA las COPIAS de la muestra
// (D:\PAILA-trabajo\ftf-comparacion\muestra.tsv, armada desde una copia de la base) y, si está el resultado de Fakin' The Funk,
// cruza las dos opiniones tema por tema.
// Uso: node scripts/run-ts.mjs scripts/ftf.ts <copia.db> <carpeta> [--hilos 2] [--solo-renotar]
//   <carpeta>/muestra.tsv   n, file_id, … y la ruta de la copia (columna "copia")
//   <carpeta>/ftf.tsv       (opcional) n y lo que dijo Fakin' The Funk: columnas n, ftf, ftf_kbps, ftf_corte
// Escribe <carpeta>/medidas.json (las mediciones, para volver a poner la nota sin decodificar) y <carpeta>/paila.tsv.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { analyzeFile, type RawAnalysis } from '@paila/core/analysis/analyze'
import { grade, type GradeInput } from '@paila/core/analysis/grade'
import { cluesFor, readClues } from '@paila/core/analysis/clues'
import type { Db } from '@paila/core/db'
import { isLossless } from '@paila/core/queue'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

const args = process.argv.slice(2)
const [dbFile, dir] = args
if (!dbFile || !dir) { console.error('Uso: ftf.ts <copia.db> <carpeta> [--hilos N] [--solo-renotar]'); process.exit(2) }
const threads = Number(args[args.indexOf('--hilos') + 1]) || 2
const regrade = args.includes('--solo-renotar')

const table = (file: string) => {
  const [head, ...rest] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
  const cols = head.split('\t')
  return rest.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])) as Record<string, string>)
}
const sample = table(path.join(dir, 'muestra.tsv'))
const db = new DatabaseSync(dbFile, { readOnly: true })
interface Row { id: number; ext: string; codec: string | null; sample_rate: number | null; bits: number | null; channels: number | null; kbps: number | null; duration: number | null }
const info = db.prepare('SELECT id, ext, codec, sample_rate, bits, channels, kbps, duration FROM files WHERE id = ?')
const infoOf = (r: Row): GradeInput => ({ codec: r.codec, ext: r.ext, lossless: isLossless(r.codec, r.ext), kbps: r.kbps, sampleRate: r.sample_rate, bits: r.bits, channels: r.channels })

type Measured = Omit<RawAnalysis, 'prints' | 'dj' | 'cutoff'> & { cutoff: Omit<RawAnalysis['cutoff'], 'spectrum'> }
const cacheFile = path.join(dir, 'medidas.json')
const cache: Record<string, Measured> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}

const t0 = Date.now()
let next = 0, done = 0
await Promise.all(Array.from({ length: threads }, async () => {
  while (next < sample.length) {
    const s = sample[next++]
    if (cache[s.n] || regrade) continue
    const r = info.get(Number(s.file_id)) as unknown as Row
    try {
      const raw = await analyzeFile({ ffmpeg, file: s.copia, ...infoOf(r), duration: r.duration, withDj: false, withPrints: false })
      const { prints: _p, dj: _d, cutoff: { spectrum: _s, ...cutoff }, ...rest } = raw
      cache[s.n] = { ...rest, cutoff }
    } catch (e) { console.error(s.n, String(e)) }
    if (++done % 20 === 0) { console.log(`${done} / ${sample.length} (${Math.round((Date.now() - t0) / 1000)} s)`); fs.writeFileSync(cacheFile, JSON.stringify(cache)) }
  }
}))
fs.writeFileSync(cacheFile, JSON.stringify(cache))

const ftfFile = path.join(dir, 'ftf.tsv')
const ftf = fs.existsSync(ftfFile) ? Object.fromEntries(table(ftfFile).map((r) => [r.n.padStart(3, '0'), r])) : {}
const lines = [['n', 'grupo', 'formato', 'kHz', 'kbps', 'nota base', 'nota ahora', 'es', 'marcas', 'corte', 'caída medio kHz', 'caída total', 'escalón 16k', 'titileo',
  'LAME corta en', 'pistas', 'ftf', 'ftf kbps', 'ftf corte', 'archivo'].join('\t')]
for (const s of sample) {
  const m = cache[s.n]
  if (!m) continue
  const r = info.get(Number(s.file_id)) as unknown as Row
  const raw = { ...m, cutoff: { ...m.cutoff, spectrum: [] }, prints: { audioMd5: null, chromaprint: null, size: null, mtime: null }, dj: null } as RawAnalysis
  const clues = cluesFor(db as unknown as Db, r.id)
  const v = grade(infoOf(r), raw, clues)
  const c = m.cutoff
  const f = ftf[s.n] ?? {}
  lines.push([s.n, s.grupo, s.ext, (r.sample_rate ?? 0) / 1000, r.kbps, s.nota, v.grade, v.is, v.flags.join(','), c.cutoff ?? '', c.sharp ?? '', c.fall ?? '', c.step16 ?? '',
    m.flicker == null ? '' : m.flicker.toFixed(2), m.mp3?.lowpassHz ?? '', readClues(clues, m.meta).map((x) => x.kind).join(','),
    f.ftf ?? '', f.ftf_kbps ?? '', f.ftf_corte ?? '', s.original].join('\t'))
}
fs.writeFileSync(path.join(dir, 'paila.tsv'), lines.join('\n') + '\n')
console.log(`Listo: ${Object.keys(cache).length} medidos en ${Math.round((Date.now() - t0) / 1000)} s.`)
