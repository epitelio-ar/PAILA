// Corrida supervisada de la grilla con tempo que se mueve (cierre del masterplan 2): en una COPIA de la base, compara la
// grilla de PAILA (Beat This!) y la que trajo Rekordbox contra el AUDIO, sin usar Beat This! (así la comparación no se
// favorece a sí misma): dónde caen los golpes que se oyen (flujo espectral) respecto de cada línea de la grilla, tramo por
// tramo de 8 compases. Escribe una tabla, una imagen por tema y, si se pide, el tema con clics en cada grilla para oírlo.
// Solo lee la base y el audio.
// Con `--golpes carpeta` (los que guardó la app con PAILA_GRID_BEATS) la grilla de PAILA se vuelve a armar con el código
// de ahora, sin volver a correr Beat This!: sirve para ajustar la regla de la grilla.
// Uso: node scripts/run-ts.mjs scripts/grilla-vivo.ts --base <copia de paila.db> --playlist 65 [--salida carpeta] [--clics 3332,2721] [--golpes carpeta]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { DjData } from '@paila/core/djdata'
import { beatThisGrid, decodeMono, envelopes } from '@paila/core/analysis/gridscan'
import { BT_RATE } from '@paila/core/analysis/beatthis'
import { getFft } from '@paila/core/analysis/fft'
import { gridBeats, nearestBeat, shiftGrid, type GridSegment } from '@paila/core/analysis/grid'
import { carpetaTrabajo } from './turnos.mjs'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const base = arg('base', path.join(carpetaTrabajo(), 'app-grillas', 'paila.db'))!
const playlist = Number(arg('playlist', '65'))
const metodo = arg('metodo', 'beatthis')!
const salida = arg('salida', path.join(carpetaTrabajo(), 'grillas-prueba'))!
const golpes = arg('golpes')
const clics = new Set((arg('clics', '') ?? '').split(',').filter(Boolean).map(Number))
fs.mkdirSync(salida, { recursive: true })

const SR = 44100, ESR = 22050, N = 1024, HOP = 110 // ~200 cuadros por segundo (5 ms)
const FPS = ESR / HOP

/** Dónde empieza un golpe que se oye: flujo espectral (todas las bandas), menos el promedio de alrededor (medio segundo). */
function onsets(mono: Float32Array): Float32Array {
  const x = new Float32Array(mono.length >> 1)
  for (let i = 0; i < x.length; i++) x[i] = (mono[2 * i] + mono[2 * i + 1]) / 2
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1)
  const fft = getFft(N), re = new Float64Array(N), im = new Float64Array(N)
  let prev = new Float64Array(N / 2), cur = new Float64Array(N / 2)
  const flux = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = x[f * HOP + i] * fft.win[i]; im[i] = 0 }
    fft.run(re, im)
    let s = 0
    for (let k = 1; k < N / 2; k++) { cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k])); const d = cur[k] - prev[k]; if (d > 0) s += d }
    // el cuadro mira N muestras hacia adelante: el golpe se nota cuando entra en la mitad de la ventana
    flux[f] = s
    const t = prev; prev = cur; cur = t
  }
  const w = Math.round(FPS / 4), out = new Float32Array(frames)
  let acc = 0
  for (let f = 0; f < frames; f++) {
    acc += flux[f]; if (f - 2 * w - 1 >= 0) acc -= flux[f - 2 * w - 1]
    const c = f - w
    if (c >= 0) out[c] = Math.max(0, flux[c] - acc / Math.min(f + 1, 2 * w + 1))
  }
  return out
}
/** El cuadro del momento `t` (segundos). La ventana de N muestras está centrada medio cuadro después. */
const frameAt = (t: number) => Math.round((t * ESR - N / 2) / HOP)

interface Score { fuerza: number; tramos: number[]; corridos: number; peor: number; medio: number }
/**
 * Qué tan bien cae una grilla en los golpes que se oyen. `fuerza`: el flujo justo en la línea contra el promedio (1 = al
 * azar). Por tramo de 8 compases, la mediana de cuánto se corre el golpe más fuerte cercano (±70 ms) de cada línea.
 */
function score(env: Float32Array, mean: number, segs: GridSegment[], from: number, to: number): Score {
  const beats = gridBeats(segs, from, to)
  let sum = 0
  const offs: number[] = []
  for (const b of beats) {
    const c = frameAt(b.time)
    let hit = 0
    for (let d = -2; d <= 2; d++) hit = Math.max(hit, env[c + d] ?? 0)
    sum += hit
    let best = 0, bestD = 0
    const r = Math.round(0.07 * FPS)
    for (let d = -r; d <= r; d++) { const v = env[c + d] ?? 0; if (v > best) { best = v; bestD = d } }
    offs.push(best > mean * 1.5 ? (bestD * 1000) / FPS : NaN)
  }
  const tramos: number[] = []
  for (let i = 0; i + 16 <= offs.length; i += 32) {
    const xs = offs.slice(i, i + 32).filter((o) => !Number.isNaN(o)).sort((a, b) => a - b)
    if (xs.length >= 10) tramos.push(xs[xs.length >> 1])
  }
  const abs = tramos.map(Math.abs)
  return { fuerza: beats.length ? sum / beats.length / mean : 0, tramos, corridos: abs.filter((x) => x > 20).length / Math.max(1, abs.length), peor: Math.max(0, ...abs), medio: abs.sort((a, b) => a - b)[abs.length >> 1] ?? NaN }
}

/** Una imagen PNG mínima (RGB), sin bibliotecas: zlib de Node. */
function writePng(file: string, w: number, h: number, px: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1) }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

/**
 * Un dibujo del tema en tres momentos (6 s cada uno, de arriba abajo: al 15 %, al 50 % y al 85 %): en gris los golpes que
 * se oyen; arriba la grilla de PAILA (azul) y abajo la de Rekordbox (naranja); el 1 del compás, más grueso.
 */
function picture(file: string, env: Float32Array, mean: number, grids: { segs: GridSegment[]; rgb: number[] }[], d: number) {
  const W = 1200, H = 110, GAP = 8, h = 3 * H + 2 * GAP
  const px = new Uint8Array(W * h * 3).fill(255)
  const put = (x: number, y: number, c: number[]) => { if (x < 0 || x >= W || y < 0 || y >= h) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2] }
  ;[0.15, 0.5, 0.85].map((q) => Math.max(0, d * q - 3)).forEach((from, row) => {
    const y0 = row * (H + GAP)
    for (let y = y0; y < y0 + H; y++) for (let x = 0; x < W; x++) put(x, y, [244, 244, 244])
    for (let x = 0; x < W; x++) {
      let m = 0
      for (let fr = frameAt(from + (x / W) * 6); fr <= frameAt(from + ((x + 1) / W) * 6); fr++) m = Math.max(m, env[fr] ?? 0)
      const top = Math.round(y0 + H - Math.min(1, m / (mean * 8)) * (H - 4))
      for (let y = top; y < y0 + H; y++) put(x, y, [120, 120, 120])
    }
    grids.forEach((g, i) => {
      for (const b of gridBeats(g.segs, from, from + 6)) {
        const x = Math.round(((b.time - from) / 6) * W)
        for (let dx = 0; dx < (b.beat === 1 ? 3 : 1); dx++) for (let y = y0 + (i ? H / 2 : 0); y < y0 + (i ? H : H / 2); y++) put(x + dx, y, g.rgb)
      }
    })
  })
  writePng(file, W, h, px)
}

/** El tema con un clic en cada línea de la grilla (más agudo en el 1 del compás), para oírlo. */
function clickTrack(mono: Float32Array, segs: GridSegment[], file: string) {
  const out = new Float32Array(mono.length)
  for (let i = 0; i < mono.length; i++) out[i] = mono[i] * 0.7
  for (const b of gridBeats(segs, 0, mono.length / SR)) {
    const s0 = Math.round(b.time * SR), f = b.beat === 1 ? 2000 : 1200
    for (let i = 0; i < 0.03 * SR && s0 + i < out.length; i++) out[s0 + i] += 0.45 * Math.sin((2 * Math.PI * f * i) / SR) * Math.exp(-i / (0.006 * SR))
  }
  const raw = file + '.f32'
  fs.writeFileSync(raw, Buffer.from(out.buffer))
  spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-b:a', '192k', file])
  fs.unlinkSync(raw)
}

const lib = new Library(base, findFfprobe())
const dj = new DjData(lib.db, (id) => lib.trackPath(id))
const ids = (lib.db.prepare('SELECT file_id AS id FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(playlist) as { id: number }[]).map((r) => r.id)
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
const ms = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '-')
const rows = ['id\ttema\tformato\tpaila_bpm\tpaila_tramos\tvariable\terror_ms\trb_bpm\trb_puntos\tpaila_fuerza\trb_fuerza\tpaila_corridos\trb_corridos\tpaila_peor_ms\trb_peor_ms\tpaila_medio_ms\trb_medio_ms\tuno_igual\trb_tramos_ms']
for (const id of ids) {
  const p = lib.trackPath(id)
  const f = lib.db.prepare('SELECT ext, duration FROM files WHERE id = ?').get(id) as { ext: string; duration: number }
  const gs = dj.grids(id)
  let ours = gs.find((g) => g.method === metodo)
  const rb = gs.find((g) => g.method === 'rekordbox')
  const dumped = golpes && p ? path.join(golpes, p.replace(/[\\/:*?"<>|]/g, '_').slice(-120) + '.json') : null
  if (p && dumped && fs.existsSync(dumped)) {
    // la grilla de nuevo, con los golpes guardados y la regla de ahora (lo mismo que hace la app)
    const g = JSON.parse(fs.readFileSync(dumped, 'utf8')) as { dur: number; windows: [number, number][]; sparse: { beats: number[]; downbeats: number[] }; whole: { beats: number[]; downbeats: number[] } }
    const env = envelopes(await decodeMono(ffmpeg, p, BT_RATE, undefined, undefined, true), BT_RATE)
    const same = (ws: [number, number][]) => ws.length === g.windows.length && ws.every((w, i) => w[0] === g.windows[i][0])
    const r = await beatThisGrid(g.dur, env, g.windows, async (ws) => (same(ws) ? g.sparse : g.whole), true)
    ours = r.grid ? { rbTime: false, method: 'beatthis', bpm: r.grid.bpm, segments: r.grid.segments, errorMs: r.grid.errorMs, variable: r.grid.variable, barEnergy: [] } : undefined
  }
  if (!p || !ours) { console.log(`${id}\tsin grilla de PAILA\t${p}`); rows.push(`${id}\t${p}\t${f.ext}\t-`); continue }
  const t0 = Date.now()
  const mono = await decodeMono(ffmpeg, p, SR)
  const d = mono.length / SR
  const env = onsets(mono)
  let mean = 0
  for (const v of env) mean += v
  mean /= Math.max(1, env.length)
  // todo en el tiempo de PAILA (como decodifica ffmpeg): la de Rekordbox se corre al revés del desfase de los MP3
  const rbSegs = rb ? shiftGrid(rb.segments, -dj.rbShift(id)) : null
  const a = score(env, mean, ours.segments, d * 0.05, d * 0.95)
  const b = rbSegs ? score(env, mean, rbSegs, d * 0.05, d * 0.95) : null
  let uno = NaN
  if (rbSegs) {
    const ones = gridBeats(ours.segments, d * 0.1, d * 0.9).filter((x) => x.beat === 1)
    uno = ones.filter((x) => { const nb = nearestBeat(rbSegs, x.time)!; return nb.beat === 1 && Math.abs(nb.offset) < 0.1 }).length / Math.max(1, ones.length)
  }
  const name = path.basename(p)
  picture(path.join(salida, `${id} ${safe(name)}.png`), env, mean, [{ segs: ours.segments, rgb: [21, 101, 192] }, ...(rbSegs ? [{ segs: rbSegs, rgb: [230, 81, 0] }] : [])], d)
  if (clics.has(id)) {
    clickTrack(mono, ours.segments, path.join(salida, `${id} ${safe(name)} - clics PAILA.mp3`))
    if (rbSegs) clickTrack(mono, rbSegs, path.join(salida, `${id} ${safe(name)} - clics Rekordbox.mp3`))
  }
  rows.push([id, name, f.ext, ours.bpm, ours.segments.length, ours.variable ? 'sí' : '', ours.errorMs, rb?.bpm ?? '-', rb?.segments.length ?? '-', a.fuerza.toFixed(2), b ? b.fuerza.toFixed(2) : '-',
    (a.corridos * 100).toFixed(0), b ? (b.corridos * 100).toFixed(0) : '-', ms(a.peor), b ? ms(b.peor) : '-', ms(a.medio), b ? ms(b.medio) : '-', Number.isNaN(uno) ? '-' : uno.toFixed(2), b ? b.tramos.map((x) => x.toFixed(0)).join(' ') : ''].join('\t'))
  console.log(`${id}\t${name.slice(0, 50)}\tPAILA ${ours.bpm}${ours.variable ? ' var' : ''} fuerza ${a.fuerza.toFixed(2)} corridos ${(a.corridos * 100).toFixed(0)}% peor ${ms(a.peor)}` +
    (b ? `\t| RB ${rb!.bpm} fuerza ${b.fuerza.toFixed(2)} corridos ${(b.corridos * 100).toFixed(0)}% peor ${ms(b.peor)}\tuno ${uno.toFixed(2)}` : '') + `\t${((Date.now() - t0) / 1000).toFixed(1)} s`)
}
fs.writeFileSync(path.join(salida, 'grilla-vivo.tsv'), rows.join('\n'))
console.log(`Tabla en ${path.join(salida, 'grilla-vivo.tsv')}`)
