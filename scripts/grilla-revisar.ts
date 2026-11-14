// Corrida supervisada de la grilla en la app (Fase F): compara las grillas que PAILA guardó en una COPIA de la base (las
// que calculó "Grilla y cues", con Beat This! o degara) con las que ya tenía Rekordbox en su rekordbox.xml, ya corridas al
// tiempo de Rekordbox como al exportar. Escribe cada tema para revisarlo. Solo lee.
// Uso: node scripts/run-ts.mjs scripts/grilla-revisar.ts --base <copia de paila.db> [--rekordbox x.xml] [--metodo beatthis] [--salida carpeta]
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { DjData } from '@paila/core/djdata'
import { parseRbXml } from '@paila/core/rbxml'
import { gridBeats, nearestBeat, shiftGrid } from '@paila/core/analysis/grid'
import { carpetaTrabajo } from './turnos.mjs'

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const base = arg('base')!
const metodo = arg('metodo', 'beatthis')!
const salida = arg('salida', path.join(process.env.TEMP ?? '.', 'paila-grilla'))!
fs.mkdirSync(salida, { recursive: true })
const rb = new Map(parseRbXml(fs.readFileSync(arg('rekordbox', path.join(carpetaTrabajo(), 'rekordbox.xml'))!, 'utf8')).map((t) => [t.path.toLowerCase(), t]))
const lib = new Library(base, findFfprobe())
const dj = new DjData(lib.db, (id) => lib.trackPath(id))
const rows = lib.db.prepare('SELECT g.file_id AS id, f.ext, f.duration, g.bpm, g.variable, g.error_ms AS err FROM dj_grid g JOIN files f ON f.id = g.file_id WHERE g.method = ?').all(metodo) as { id: number; ext: string; duration: number; bpm: number; variable: number; err: number }[]

type Cat = { n: number; bpm: number; fase: number; medio: number; uno: number; unoN: number }
const cats = new Map<string, Cat>()
const cat = (k: string) => { if (!cats.has(k)) cats.set(k, { n: 0, bpm: 0, fase: 0, medio: 0, uno: 0, unoN: 0 }); return cats.get(k)! }
const out = ['tema\tformato\tcorrimiento_ms\trb_bpm\tpaila_bpm\tdesfase_ms\tmedio_golpe\tgolpe1_igual\tvariable\terror_ms\tcues']
let sinRb = 0
for (const r of rows) {
  const p = lib.trackPath(r.id)
  const t = p && rb.get(p.split(path.sep).join('/').toLowerCase())
  if (!t || !t.grid.length) { sinRb++; continue }
  const g = dj.grids(r.id).find((x) => x.method === metodo)!
  const shift = dj.rbShift(r.id)
  const segs = shiftGrid(g.segments, shift) // como sale en el rekordbox.xml
  const d = r.duration || t.seconds || 300
  const ours = gridBeats(segs, d * 0.2, d * 0.8)
  const offs = ours.map((b) => nearestBeat(t.grid, b.time)!.offset).sort((a, b) => a - b)
  const off = offs[offs.length >> 1] ?? NaN
  const period = 60 / t.grid[0].bpm
  const half = Math.abs(Math.abs(off) - period / 2) < 0.04
  const same = ours.filter((b) => nearestBeat(t.grid, b.time)!.beat === b.beat).length / Math.max(1, ours.length)
  const bpmOk = Math.abs(g.bpm - t.grid[0].bpm) < 0.06 || Math.abs(g.bpm * 2 - t.grid[0].bpm) < 0.1 || Math.abs(g.bpm / 2 - t.grid[0].bpm) < 0.05
  for (const k of ['todos', r.ext.toLowerCase() === 'mp3' ? (shift ? 'mp3 con LAME' : 'mp3 sin LAME') : 'sin pérdida y otros']) {
    const c = cat(k)
    c.n++; if (bpmOk) c.bpm++; if (Math.abs(off) < 0.012) c.fase++; if (half) c.medio++
    if (Math.abs(off) < 0.03) { c.unoN++; if (same > 0.5) c.uno++ }
  }
  const cues = dj.cues(r.id).filter((c) => c.kind === 'memory').map((c) => `${c.name} ${c.start.toFixed(1)}`).join(', ')
  out.push([p, r.ext, (shift * 1000).toFixed(1), t.grid[0].bpm, g.bpm, (off * 1000).toFixed(1), half ? 'sí' : '', same.toFixed(2), r.variable ? 'sí' : '', r.err, cues].join('\t'))
}
fs.writeFileSync(path.join(salida, `revisar-${metodo}.tsv`), out.join('\n') + '\n')
const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0} %`
console.log(`${rows.length} temas con grilla de PAILA (${metodo}); ${sinRb} sin grilla de Rekordbox para comparar`)
for (const [k, c] of cats) console.log(`${k.padEnd(20)} ${String(c.n).padStart(4)} temas · BPM igual ${pct(c.bpm, c.n)} · en fase (±12 ms) ${pct(c.fase, c.n)} · medio golpe corrido ${pct(c.medio, c.n)} · el 1 del compás igual ${pct(c.uno, c.unoN)}`)
console.log(`Detalle: ${path.join(salida, `revisar-${metodo}.tsv`)}`)
lib.close()
