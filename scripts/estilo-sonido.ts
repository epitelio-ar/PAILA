// Prueba del estilo por el sonido (MASTERPLAN-3, punto 3): corre Discogs-EffNet (de la UPF, licencia no comercial, se baja
// aparte) sobre una muestra de la Música y compara los estilos que dice con el género del tag y la carpeta. Solo lee audio.
// Uso: node scripts/run-ts.mjs scripts/estilo-sonido.ts --muestra muestra.json [--modelos D:/PAILA-trabajo/modelos] [--salida carpeta] [--segundos 120]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { decodeMono } from '@paila/core/analysis/gridscan'
import { EF_RATE, effnetMel, effnetPatches, effnetWindows, meanRows } from '@paila/core/analysis/effnet'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const modelos = arg('modelos', 'D:/PAILA-trabajo/modelos')!
const salida = arg('salida', path.join(process.env.TEMP ?? '.', 'paila-estilo'))!
const pedazos = Number(arg('pedazos', '4')) // 0 = el tema entero
fs.mkdirSync(salida, { recursive: true })
const muestra: { id: number; p: string; genre: string | null; artist: string | null; title: string | null }[] = JSON.parse(fs.readFileSync(arg('muestra')!, 'utf8'))

const dir = path.join(modelos, 'discogs-effnet')
const ort = createRequire(path.join(modelos, 'npm', 'package.json'))('onnxruntime-web')
ort.env.wasm.numThreads = Number(arg('hilos', '4'))
const sess = (f: string) => ort.InferenceSession.create(path.join(dir, f), { executionProviders: ['wasm'], logSeverityLevel: 3 })
const effnet = await sess('discogs-effnet-bsdynamic-1.onnx')
const classes: string[] = JSON.parse(fs.readFileSync(path.join(dir, 'discogs-effnet-bsdynamic-1.json'), 'utf8')).classes
const HEADS = ['mood_aggressive', 'mood_relaxed', 'mood_party', 'danceability', 'mood_electronic', 'engagement_regression']
const heads = new Map<string, { s: any; classes: string[] }>()
for (const h of HEADS) heads.set(h, { s: await sess(`${h}-discogs-effnet-1.onnx`), classes: JSON.parse(fs.readFileSync(path.join(dir, `${h}-discogs-effnet-1.json`), 'utf8')).classes })
console.log('EffNet:', effnet.inputNames, effnet.outputNames, '· cabezas:', [...heads].map(([k, v]) => `${k} ${v.s.inputNames}→${v.s.outputNames}`).join(' · '))

const rows: any[] = []
for (const t of muestra) {
  const t0 = Date.now()
  let y: Float32Array
  try { y = await decodeMono(ffmpeg, t.p, EF_RATE) } catch (e) { console.log('✗', t.p, (e as Error).message); continue }
  const td = Date.now()
  const dur = y.length / EF_RATE
  const ws: [number, number][] = pedazos ? effnetWindows(dur, pedazos) : [[0, dur]]
  const parts = ws.map(([a, l]) => effnetPatches(effnetMel(y.subarray(Math.floor(a * EF_RATE), Math.floor((a + l) * EF_RATE)))))
  const n = parts.reduce((s, p) => s + p.n, 0)
  const x = new Float32Array(n * 128 * 96)
  let off = 0
  for (const p of parts) { x.set(p.x, off); off += p.x.length }
  const tm = Date.now()
  const pred = new Float32Array(n * 400), emb = new Float32Array(n * 1280)
  for (let k = 0; k < n; k += 64) {
    const m = Math.min(64, n - k)
    const o = await effnet.run({ [effnet.inputNames[0]]: new ort.Tensor('float32', x.subarray(k * 128 * 96, (k + m) * 128 * 96), [m, 128, 96]) })
    pred.set(o[effnet.outputNames[0]].data as Float32Array, k * 400); emb.set(o[effnet.outputNames[1]].data as Float32Array, k * 1280)
  }
  const te = Date.now()
  const styles = meanRows(pred, n)
  const top = [...styles].map((v, c) => [classes[c], Math.round(v * 1000) / 1000] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 15)
  const moods: Record<string, number> = {}
  for (const [h, { s, classes: hc }] of heads) {
    const hr = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', emb, [n, 1280]) })
    const d = hr[s.outputNames[0]].data as Float32Array, w = d.length / n
    const m = meanRows(d, n)
    moods[h] = Math.round(m[w > 1 ? Math.max(0, hc.findIndex((c) => !c.startsWith('non_') && !c.startsWith('not_'))) : 0] * 1000) / 1000
  }
  rows.push({ id: t.id, p: t.p, genre: t.genre, top, moods, ms: { decode: td - t0, mel: tm - td, model: te - tm, total: Date.now() - t0 }, patches: n, dur })
  console.log(`${path.basename(t.p).slice(0, 48).padEnd(48)} ${String(t.genre ?? '').slice(0, 14).padEnd(14)} → ${top.slice(0, 3).map(([c, v]) => `${c.split('---')[1]} ${v}`).join(', ')} · ${Date.now() - t0} ms`)
}
fs.writeFileSync(path.join(salida, 'estilo.json'), JSON.stringify(rows, null, 1))
console.log(`\n${rows.length} temas · detalle: ${path.join(salida, 'estilo.json')}`)
