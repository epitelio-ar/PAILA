// Corrida supervisada de la grilla (Fase F): compara la grilla que arma PAILA con la que ya calculó Rekordbox (su
// rekordbox.xml) en una muestra de temas, y escribe cada tema para revisarlo. Solo lee audio y el XML.
// Uso: node scripts/run-ts.mjs scripts/grilla.ts --rekordbox <rekordbox.xml> --n 60 [--metodo beatthis --modelos <carpeta de modelos>] [--salida carpeta]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parseRbXml, type RbTrack } from '@paila/core/rbxml'
import { analyzeGrid, analyzeGridBeatThis } from '@paila/core/analysis/gridscan'
import { nearestBeat, gridBeats } from '@paila/core/analysis/grid'
import { readMp3Info, rekordboxMp3Shift } from '@paila/core/analysis/mp3info'
import { loadBeatThis } from '@paila/core/analysis/beatrun'
import { carpetaTrabajo } from './turnos.mjs'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const xmlPath = arg('rekordbox', path.join(carpetaTrabajo(), 'rekordbox.xml'))!
const n = Number(arg('n', '40'))
const metodo = arg('metodo', 'degara')!
const salida = arg('salida', path.join(process.env.TEMP ?? '.', 'paila-grilla'))!
const solo = arg('solo') // un texto que tiene que estar en la ruta
fs.mkdirSync(salida, { recursive: true })

const all = parseRbXml(fs.readFileSync(xmlPath, 'utf8')).filter((t) => t.grid.length && /M[uú]sica\//i.test(t.path) && fs.existsSync(t.path) && (!solo || t.path.includes(solo)))
// muestra pareja por formato: cada k-ésimo tema de cada tipo
const byExt = new Map<string, RbTrack[]>()
for (const t of all) { const e = path.extname(t.path).toLowerCase(); byExt.set(e, [...(byExt.get(e) ?? []), t]) }
const sample: RbTrack[] = []
const want = (e: string) => (e === '.mp3' ? Math.ceil(n * 0.55) : Math.ceil(n * 0.15))
for (const [e, ts] of byExt) { const k = Math.min(ts.length, want(e)); for (let i = 0; i < k; i++) sample.push(ts[Math.floor((i * ts.length) / k)]) }
console.log(`${all.length} temas con grilla de Rekordbox en la Música; muestra de ${sample.length}`)

const bt = metodo === 'beatthis' ? await loadBeatThis(arg('modelos', path.join(carpetaTrabajo(), 'modelos'))!, { threads: Number(arg('hilos', '4')) }) : null
const rows: string[] = ['tema\tformato\tlame\trelleno_ms\trb_bpm\tpaila_bpm\tdif_bpm\tdesfase_ms\tdesfase_sin_relleno_ms\tgolpe1_igual\ttramos_rb\tpaila_variable\terror_ms\tseg']
const sum = { n: 0, bpmOk: 0, phaseOk: 0, phaseOkFixed: 0, down: 0, downN: 0, shift: [0, 0, 0, 0] }
for (const t of sample) {
  const t0 = Date.now()
  let r
  try {
    r = bt ? await analyzeGridBeatThis({ ffmpeg, file: t.path }, bt.model, bt.fb, Number(arg('pedazos', '2'))) : await analyzeGrid({ ffmpeg, file: t.path })
  } catch (e) { console.log('✗', t.path, (e as Error).message); continue }
  const ext = path.extname(t.path).slice(1).toLowerCase()
  const info = ext === 'mp3' ? readMp3Info(t.path) : null
  const pad = ext === 'mp3' ? rekordboxMp3Shift(t.path) : 0
  const g = r.grid
  if (!g) { rows.push(`${t.path}\t${ext}\t${info?.encoder ?? ''}\t${pad}\t${t.bpm}\t\t\t\t\t\t${t.grid.length}\t\t\t${Date.now() - t0}`); continue }
  // desfase: mediana, en los golpes de PAILA entre el 20 % y el 80 % del tema, de cuánto se corren respecto de Rekordbox
  const dur = t.seconds ?? 300
  const ours = gridBeats(g.segments, dur * 0.2, dur * 0.8)
  const offs = ours.map((b) => nearestBeat(t.grid, b.time)!.offset).sort((a, b) => a - b)
  const off = offs.length ? offs[offs.length >> 1] : NaN
  const fixed = off + pad / 44100 // lo que daría si se corre la grilla por el relleno del MP3
  const same = ours.filter((b) => nearestBeat(t.grid, b.time)!.beat === b.beat).length / Math.max(1, ours.length)
  const dBpm = g.bpm - (t.grid[0].bpm)
  sum.n++
  if (Math.abs(dBpm) < 0.06) sum.bpmOk++
  if (Math.abs(off) < 0.010) sum.phaseOk++
  if (Math.abs(fixed) < 0.010) sum.phaseOkFixed++
  if (Math.abs(off) < 0.03) {
    sum.downN++; if (same > 0.5) sum.down++
    const d = ours.map((b) => (b.beat - nearestBeat(t.grid, b.time)!.beat + 4) % 4); const c = [0, 0, 0, 0]; for (const x of d) c[x]++; sum.shift[c.indexOf(Math.max(...c))]++
  }
  rows.push([t.path, ext, info?.encoder ?? '', (pad / 44.1).toFixed(1), t.grid[0].bpm, g.bpm, dBpm.toFixed(2), (off * 1000).toFixed(1), (fixed * 1000).toFixed(1), same.toFixed(2), t.grid.length, g.variable ? 'sí' : '', g.errorMs, Date.now() - t0].join('\t'))
  console.log(`${path.basename(t.path).slice(0, 50).padEnd(50)} rb ${t.grid[0].bpm} paila ${g.bpm} desfase ${(off * 1000).toFixed(1)} ms (corregido ${(fixed * 1000).toFixed(1)}) golpe1 ${same.toFixed(2)} ${Date.now() - t0} ms`)
}
fs.writeFileSync(path.join(salida, `grilla-${metodo}.tsv`), rows.join('\n') + '\n')
const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0} %`
console.log(`\n${sum.n} temas · BPM igual (±0,06) ${pct(sum.bpmOk, sum.n)} · grilla en fase (±10 ms) ${pct(sum.phaseOk, sum.n)} · corrigiendo el relleno de los MP3 ${pct(sum.phaseOkFixed, sum.n)} · el 1 del compás igual ${pct(sum.down, sum.downN)} de los que están en fase (corrido 0/1/2/3 golpes: ${sum.shift.join('/')})`)
console.log(`Detalle: ${path.join(salida, `grilla-${metodo}.tsv`)}`)
