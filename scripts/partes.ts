// Corrida supervisada de las partes del tema (MASTERPLAN-3, punto 3): en una muestra de la Música arma la grilla con Beat
// This! (procesador), los cues de hoy (core/analysis/cues.ts) y las partes nuevas (core/analysis/partes.ts), y los compara
// con All-In-One (si se corrió antes: un .json por tema en --allin1) y con los cues de Mixed In Key. Una imagen por tema
// para revisar a ojo. Solo lee audio.
// Uso: node scripts/run-ts.mjs scripts/partes.ts --muestra muestra.json [--allin1 carpeta] [--salida carpeta] [--modelos D:/PAILA-trabajo/modelos]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { decodeMono, envelopes, beatThisGrid } from '@paila/core/analysis/gridscan'
import { BT_RATE, beatThisWindows, melSpectrogram, predict, readBeats } from '@paila/core/analysis/beatthis'
import { loadBeatThis } from '@paila/core/analysis/beatrun'
import { getFft } from '@paila/core/analysis/fft'
import { songParts, type BarBands, type PartRole } from '@paila/core/analysis/partes'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const salida = arg('salida', path.join(process.env.TEMP ?? '.', 'paila-partes'))!
const allin1Dir = arg('allin1')
fs.mkdirSync(salida, { recursive: true })
const muestra: { id: number; p: string; genre: string | null; mik?: { t: number; name: string }[] }[] = JSON.parse(fs.readFileSync(arg('muestra')!, 'utf8'))
const bt = await loadBeatThis(arg('modelos', 'D:/PAILA-trabajo/modelos')!, { threads: Number(arg('hilos', '4')) })

/** Potencia por cuadro (50 por segundo) en graves (<150 Hz), medios (150 Hz–2,5 kHz) y agudos (>2,5 kHz). */
function bandFrames(y: Float32Array, sr: number) {
  const n = 1024, hop = Math.round(sr / 50), fft = getFft(n), hz = sr / n
  const frames = Math.max(0, Math.floor((y.length - n) / hop) + 1)
  const out = { all: new Float32Array(frames), low: new Float32Array(frames), mid: new Float32Array(frames), high: new Float32Array(frames) }
  const re = new Float64Array(n), im = new Float64Array(n)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < n; i++) { re[i] = y[f * hop + i] * fft.win[i]; im[i] = 0 }
    fft.run(re, im)
    let lo = 0, mi = 0, hi = 0
    for (let k = 1; k < n / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; const fq = k * hz; if (fq < 150) lo += p; else if (fq < 2500) mi += p; else hi += p }
    out.low[f] = lo; out.mid[f] = mi; out.high[f] = hi; out.all[f] = lo + mi + hi
  }
  return { ...out, fps: sr / hop }
}

type Ref = Partial<Record<PartRole, number>>
/** Lo que dice All-In-One, llevado a los cuatro momentos: inicio, el primer estribillo/drop, el primer break y la salida. */
function allin1Ref(file: string): { ref: Ref; segs: { start: number; end: number; label: string }[] } | null {
  if (!allin1Dir) return null
  const f = path.join(allin1Dir, `${path.basename(file, path.extname(file))}.json`)
  if (!fs.existsSync(f)) return null
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  const segs: { start: number; end: number; label: string }[] = j.segments
  const ref: Ref = {}
  const music = segs.filter((s) => s.label !== 'start' && s.label !== 'end')
  if (music.length) ref.inicio = music[0].start
  const ch = music.find((s) => s.label === 'chorus')
  if (ch) ref.drop = ch.start
  const br = music.find((s) => (s.label === 'break' || s.label === 'bridge') && (ref.drop == null || s.start > ref.drop))
  if (br) ref.break = br.start
  const ou = music.find((s) => s.label === 'outro')
  if (ou) ref.salida = ou.start
  return { ref, segs }
}

const COLORS: Record<PartRole, number[]> = { inicio: [40, 167, 69], drop: [220, 38, 38], break: [37, 99, 235], salida: [234, 120, 0] }
const SEG: Record<string, number[]> = { start: [230, 230, 230], end: [230, 230, 230], intro: [180, 180, 180], verse: [120, 160, 230], chorus: [230, 90, 90], break: [250, 210, 60], bridge: [170, 110, 220], inst: [110, 200, 120], solo: [250, 150, 60], outro: [60, 60, 60] }

function writePng(file: string, w: number, h: number, px: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1) }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

/**
 * El tema entero de izquierda a derecha: arriba la forma de onda por bandas (rojo graves, verde medios, azul agudos, como
 * la de Rekordbox), una marca cada 8 compases, y debajo tres filas: los cues de hoy, las partes nuevas y All-In-One.
 */
function picture(file: string, bf: ReturnType<typeof bandFrames>, dur: number, firstBar: number, barLen: number, rows: { marks: { role: PartRole; time: number }[] }[], segs: { start: number; end: number; label: string }[] | null, mik: { t: number }[] | undefined) {
  const W = 1400, WH = 160, RH = 22, H = WH + 4 * (RH + 4)
  const px = new Uint8Array(W * H * 3).fill(255)
  const put = (x: number, y: number, c: number[]) => { if (x < 0 || x >= W || y < 0 || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2] }
  const X = (t: number) => Math.round((t / dur) * (W - 1))
  const fr = (t: number) => Math.min(bf.all.length - 1, Math.max(0, Math.floor(t * bf.fps)))
  let top = 0
  for (let f = 0; f < bf.all.length; f++) top = Math.max(top, Math.sqrt(bf.all[f]))
  for (let x = 0; x < W; x++) {
    const a = fr((x / W) * dur), b = Math.max(a + 1, fr(((x + 1) / W) * dur))
    let s = 0, lo = 0, mi = 0, hi = 0
    for (let f = a; f < b; f++) { s = Math.max(s, Math.sqrt(bf.all[f])); lo += bf.low[f]; mi += bf.mid[f]; hi += bf.high[f] }
    const tot = lo + mi + hi + 1e-12
    const c = [Math.round(255 * Math.sqrt(lo / tot)), Math.round(255 * Math.sqrt(mi / tot)), Math.round(255 * Math.sqrt(hi / tot))]
    const hgt = Math.round((s / (top || 1)) * (WH / 2 - 2))
    for (let y = WH / 2 - hgt; y <= WH / 2 + hgt; y++) put(x, y, c)
  }
  for (let t = firstBar; t < dur; t += barLen * 8) for (let y = 0; y < 6; y++) put(X(t), y, [0, 0, 0])
  for (const m of mik ?? []) for (let y = WH - 14; y < WH; y++) { put(X(m.t), y, [150, 0, 150]); put(X(m.t) + 1, y, [150, 0, 150]) }
  rows.forEach((r, i) => {
    const y0 = WH + 4 + i * (RH + 4)
    for (let x = 0; x < W; x++) for (let y = y0; y < y0 + RH; y++) put(x, y, [246, 246, 246])
    for (const m of r.marks) for (let y = y0; y < y0 + RH; y++) for (let d = 0; d < 4; d++) put(X(m.time) + d, y, COLORS[m.role])
  })
  if (segs) {
    const y0 = WH + 4 + rows.length * (RH + 4)
    for (const s of segs) for (let x = X(s.start); x < X(s.end); x++) for (let y = y0; y < y0 + RH; y++) put(x, y, x === X(s.start) ? [0, 0, 0] : (SEG[s.label] ?? [200, 0, 200]))
  }
  writePng(file, W, H, px)
}

const lines = ['tema\tgenero\tdur\tbpm\tv1\tv2\tallin1\tms']
const err: Record<'v1' | 'v2', Record<PartRole, number[]>> = { v1: { inicio: [], drop: [], break: [], salida: [] }, v2: { inicio: [], drop: [], break: [], salida: [] } }
const found: Record<'v1' | 'v2' | 'ref', Record<PartRole, number>> = { v1: { inicio: 0, drop: 0, break: 0, salida: 0 }, v2: { inicio: 0, drop: 0, break: 0, salida: 0 }, ref: { inicio: 0, drop: 0, break: 0, salida: 0 } }
let done = 0
// contra Mixed In Key: de nuestros cues, cuántos caen a ±1 compás de uno suyo; de sus cambios de energía, cuántos encontramos
const mikSum = { v1: { ours: 0, hit: 0, found: 0 }, v2: { ours: 0, hit: 0, found: 0 }, changes: 0 }
for (const t of muestra) {
  const t0 = Date.now()
  let y: Float32Array
  try { y = await decodeMono(ffmpeg, t.p, BT_RATE, undefined, undefined, true) } catch (e) { console.log('✗', t.p, (e as Error).message); continue }
  const dur = y.length / BT_RATE
  const listen = async (ws: [number, number][]) => {
    const beats: number[] = [], downbeats: number[] = []
    for (const [from, len] of ws) {
      const r = await predict(melSpectrogram(y.subarray(Math.floor(from * BT_RATE), Math.floor((from + len) * BT_RATE)), bt.fb), bt.model)
      const got = readBeats(r.beat, r.downbeat)
      beats.push(...got.beats.map((x) => x + from)); downbeats.push(...got.downbeats.map((x) => x + from))
    }
    return { beats, downbeats }
  }
  const env = envelopes(y, BT_RATE)
  const g = await beatThisGrid(dur, env, beatThisWindows(dur, 3), listen, true) // como en la app con la placa de video: si duda, el tema entero
  const bf = bandFrames(y, BT_RATE)
  const a1 = allin1Ref(t.p)
  let v1: { role: PartRole; time: number }[] = [], v2: { role: PartRole; time: number }[] = [], firstBar = 0, barLen = 2
  if (g.grid) {
    const s0 = g.grid.segments[0]
    barLen = 240 / g.grid.bpm
    firstBar = s0.start + ((5 - s0.beat) % 4) * (60 / s0.bpm)
    v1 = g.cues
    const bars: BarBands[] = []
    for (let x = firstBar; x + barLen <= dur + 0.01; x += barLen) {
      const a = Math.floor(x * bf.fps), b = Math.min(bf.all.length, Math.floor((x + barLen) * bf.fps))
      const m = (arr: Float32Array) => { let s = 0; for (let i = a; i < b; i++) s += arr[i]; return b > a ? s / (b - a) : 0 }
      bars.push({ all: m(bf.all), low: m(bf.low), mid: m(bf.mid), high: m(bf.high) })
    }
    v2 = songParts(bars, firstBar, barLen)
  }
  if (a1) for (const role of Object.keys(a1.ref) as PartRole[]) {
    found.ref[role]++
    for (const [k, marks] of [['v1', v1], ['v2', v2]] as const) {
      const m = marks.find((x) => x.role === role)
      if (m) { found[k][role]++; err[k][role].push(Math.abs(m.time - a1.ref[role]!) / barLen) }
    }
  }
  if (t.mik?.length && barLen) {
    const lvl = (n: string) => Number(/Energy (\d+)/.exec(n)?.[1] ?? NaN)
    const changes = t.mik.filter((m, i) => i > 0 && lvl(m.name) !== lvl(t.mik![i - 1].name))
    mikSum.changes += changes.length
    for (const [k, marks] of [['v1', v1], ['v2', v2]] as const) {
      const ms = marks.filter((m) => m.role !== 'inicio')
      mikSum[k].ours += ms.length
      mikSum[k].hit += ms.filter((m) => t.mik!.some((c) => Math.abs(c.t - m.time) <= barLen)).length
      mikSum[k].found += changes.filter((c) => ms.some((m) => Math.abs(c.t - m.time) <= barLen)).length
    }
  }
  const fmt = (ms: { role: PartRole; time: number }[]) => ms.map((m) => `${m.role[0].toUpperCase()}${m.time.toFixed(0)}`).join(' ')
  const name = path.basename(t.p, path.extname(t.p))
  picture(path.join(salida, `${String(++done).padStart(3, '0')} ${name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.png`), bf, dur, firstBar, barLen, [{ marks: v1 }, { marks: v2 }], a1?.segs ?? null, t.mik)
  const ref = a1 ? Object.entries(a1.ref).map(([k, v]) => `${k[0].toUpperCase()}${v!.toFixed(0)}`).join(' ') : ''
  lines.push([t.p, t.genre ?? '', dur.toFixed(0), g.grid?.bpm ?? '', fmt(v1), fmt(v2), ref, Date.now() - t0].join('\t'))
  console.log(`${name.slice(0, 46).padEnd(46)} ${String(g.grid?.bpm ?? '—').padEnd(6)} hoy ${fmt(v1).padEnd(22)} nuevo ${fmt(v2).padEnd(22)} a1 ${ref} · ${Date.now() - t0} ms`)
}
fs.writeFileSync(path.join(salida, 'partes.tsv'), lines.join('\n') + '\n')
const sum = (k: 'v1' | 'v2') => (['inicio', 'drop', 'break', 'salida'] as PartRole[]).map((r) => {
  const e = err[k][r], ok = e.filter((x) => x <= 2).length, near = e.filter((x) => x <= 8).length
  return `${r}: ${ok}/${found.ref[r]} a ±2 compases, ${near} a ±8 (marcó ${found[k][r]})`
}).join(' · ')
if (allin1Dir) { console.log(`\nContra All-In-One, hoy: ${sum('v1')}`); console.log(`Contra All-In-One, nuevo: ${sum('v2')}`) }
if (mikSum.changes) for (const k of ['v1', 'v2'] as const) console.log(`Contra Mixed In Key, ${k === 'v1' ? 'hoy' : 'nuevo'}: ${mikSum[k].hit} de ${mikSum[k].ours} cues caen en uno suyo (±1 compás); encuentra ${mikSum[k].found} de sus ${mikSum.changes} cambios de energía`)
console.log(`Detalle e imágenes: ${salida}`)
