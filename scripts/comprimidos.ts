// Corrida supervisada de los ZIP y RAR de la biblioteca (masterplan 3, punto 4): sobre una COPIA de la base, escanea en solo
// lectura (los archivos solo se leen), lista cada comprimido con lo que tiene, cuáles son sample packs y cuántos temas ya
// están afuera; con --leer, lee y analiza los temas de adentro (de a uno, en una carpeta temporal) y compara la nota, el BPM
// y el tono con los del mismo tema afuera, si está.
// Uso: node scripts/run-ts.mjs scripts/comprimidos.ts <copia.db> <carpeta-salida> [--leer] [--solo <texto del nombre>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Archives } from '@paila/core/archives'
import { readArchives } from '@paila/core/archive/analyze'
import { analyzeFile } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const args = process.argv.slice(2)
const [dbFile, outDir] = args
if (!dbFile || !outDir) { console.error('Uso: comprimidos.ts <copia.db> <carpeta-salida> [--leer] [--solo <texto>]'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(dbFile)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1].toLowerCase() : null
process.env.PAILA_SOLO_LECTURA = '1' // por las dudas: nada de esta corrida escribe archivos
fs.mkdirSync(outDir, { recursive: true })

const lib = new Library(dbFile, findFfprobe())
const rootPath = (id: number) => lib.roots().find((r) => r.id === id && r.available)?.path ?? null
const t0 = Date.now()
const s = await lib.scan()
const out: string[] = [`# Comprimidos (${new Date().toLocaleString('es-AR')})`, '', `Escaneo: ${Date.now() - t0} ms · ${s.phase}`, '']
const arch = new Archives(lib.db, rootPath)
const list = arch.list()
out.push('| Comprimido | Formato | Estado | Sample pack | Archivos | Temas | Ya afuera | Nota |', '|---|---|---|---|---|---|---|---|')
for (const a of list) out.push(`| ${a.rel} | ${a.format}${a.volumes > 1 ? ` (${a.volumes} partes)` : ''}${a.solid ? ', sólido' : ''} | ${a.status} | ${a.samplePack ? 'sí' : ''} | ${a.files} | ${a.audio} | ${a.outside} | ${a.note ?? ''} |`)

if (args.includes('--leer')) {
  const direct = { full: analyzeFile, prints: () => Promise.reject(new Error('no')) } as unknown as AnalysisRunner
  const ids = list.filter((a) => !a.samplePack && a.status === 'ok' && (!solo || a.rel.toLowerCase().includes(solo))).map((a) => a.id)
  const t1 = Date.now()
  const r = await readArchives(arch, ids, { ffprobe: findFfprobe()!, ffmpeg, analysis: direct, tmpDir: path.join(os.tmpdir(), 'paila-comprimidos-corrida') },
    { progress: (d, t, c) => process.stdout.write(`\r${d}/${t} ${c.slice(0, 70).padEnd(70)}`) })
  out.push('', `Leído: ${JSON.stringify(r)} en ${Math.round((Date.now() - t1) / 1000)} s`, '')
  // el mismo tema afuera: mismo nombre de archivo
  const lib2 = lib.db.prepare(`SELECT f.rel_path AS rel, a.grade, a.bpm, a.camelot AS key FROM files f LEFT JOIN analysis a ON a.file_id = f.id
    WHERE f.trashed_at IS NULL AND f.missing_at IS NULL`).all() as { rel: string; grade: string | null; bpm: number | null; key: string | null }[]
  const byBase = new Map(lib2.map((x) => [path.posix.basename(x.rel).toLowerCase(), x]))
  out.push('| Comprimido | Tema | Duración | Nota adentro | Nota afuera | BPM adentro / afuera | Tono adentro / afuera | Error |', '|---|---|---|---|---|---|---|---|')
  for (const id of ids) for (const e of arch.entries(id).filter((x) => x.audio)) {
    const o = byBase.get(e.name.toLowerCase())
    out.push(`| ${list.find((a) => a.id === id)!.name} | ${e.artist ? `${e.artist} – ` : ''}${e.title ?? e.name} | ${e.duration?.toFixed(0) ?? ''} | ${e.grade ?? ''} | ${o?.grade ?? ''} | ${e.bpm ?? ''} / ${o?.bpm != null ? Math.round(o.bpm * 10) / 10 : ''} | ${e.key ?? ''} / ${o?.key ?? ''} | ${e.error ?? ''} |`)
  }
}
fs.writeFileSync(path.join(outDir, 'comprimidos.md'), out.join('\n') + '\n')
console.log(`\n${list.length} comprimidos → ${path.join(outDir, 'comprimidos.md')}`)
lib.close()
