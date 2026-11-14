// Laboratorio de Separar voz (MASTERPLAN-4, 4B.6; bitácoras docs/pruebas/2026-10-2*-4B6-stems-*.md): separa un tema con
// MDX-Net (el mismo código de la app, core/analysis/stems.ts) o con Mel-Band RoFormer "Kim", y mide el SDR contra la acapella
// y el instrumental oficiales. Contra el tema original, cada parte se alinea por su lado y se le aplica el EQ del mastering.
// No toca nada: lee copias y escribe en la carpeta de salida. Los modelos y onnxruntime, en --base (se bajan aparte).
// Uso: node scripts/run-ts.mjs scripts/stems-prueba.ts --modelo inst_hq3|voc_ft|roformer (--tema x | --acapella a --instrumental i
//      [--original o [--version v] [--mezcla suma]]) [--desde s --segundos n] [--salida dir] [--flac|--sin-archivos] [--motor web] [--hilos 4]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { INST_HQ3, STEMS_RATE as SR, fft, fftPlan, istftStereo, mdxSeparate, sdr, stftStereo, type MdxConfig, type MdxModel, type Stereo } from '@paila/core/analysis/stems'
import { writeFlac } from '@paila/core/stems/correr'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const flag = (k: string) => process.argv.includes(`--${k}`)
const base = arg('base', 'D:/PAILA-trabajo/stems-prueba')!

// Voc_FT: huella 77d07b26… en model_data.json de UVR (n_fft 7680, compensate 1,021). RoFormer: STFT 2048/441, 8 s cada 4 s.
const MODELOS: Record<string, { file: string; mdx?: MdxConfig }> = {
  inst_hq3: { file: 'uvr/UVR-MDX-NET-Inst_HQ_3.onnx', mdx: INST_HQ3 },
  voc_ft: { file: 'uvr/UVR-MDX-NET-Voc_FT.onnx', mdx: { ...INST_HQ3, nfft: 7680, compensate: 1.021, primary: 'vocals' } },
  roformer: { file: 'mel-roformer/mel-roformer.fp16.onnx' },
}
const RF = { nfft: 2048, hop: 441, chunk: 352800, overlap: 2 }
const reflect = (n: number, i: number) => { while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * (n - 1) - i } return i }

async function cargar(nombre: string, motor: string, hilos: number) {
  const ort = createRequire(path.join(base, 'npm', 'package.json'))(motor === 'web' ? 'onnxruntime-web' : 'onnxruntime-node')
  if (motor === 'web') ort.env.wasm.numThreads = hilos
  const opts = motor === 'web' ? { executionProviders: ['wasm'], logSeverityLevel: 3 } : { executionProviders: ['cpu'], intraOpNumThreads: hilos, interOpNumThreads: 1, graphOptimizationLevel: 'all', logSeverityLevel: 3 }
  const s = await ort.InferenceSession.create(path.join(base, 'modelos', MODELOS[nombre].file), opts)
  const reloj = { modelo: 0 }
  const run: MdxModel = async (data, dims) => { const t = Date.now(); const o = (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, dims) }))[s.outputNames[0]].data; reloj.modelo += Date.now() - t; return o }
  return { run, reloj }
}

/** Mel-Band RoFormer como demix() de Music-Source-Separation-Training (num_overlap 2, fundido lineal de C/10). Devuelve la voz. */
async function separarRoformer(run: MdxModel, L: Float32Array, R: Float32Array): Promise<Stereo> {
  const C = RF.chunk, step = C / RF.overlap, fade = Math.floor(C / 10), border = C - step, n0 = L.length, conBorde = n0 > 2 * border
  let xL = L, xR = R
  if (conBorde) { xL = new Float32Array(n0 + 2 * border); xR = new Float32Array(n0 + 2 * border); for (let i = 0; i < xL.length; i++) { const j = reflect(n0, i - border); xL[i] = L[j]; xR[i] = R[j] } }
  const n = xL.length, resL = new Float64Array(n), resR = new Float64Array(n), cnt = new Float64Array(n), win = new Float64Array(C).fill(1)
  for (let i = 0; i < fade; i++) { win[i] = i / (fade - 1); win[C - fade + i] = 1 - i / (fade - 1) }
  for (let i = 0; i < n; i += step) {
    const len = Math.min(C, n - i), pL = new Float32Array(C), pR = new Float32Array(C)
    pL.set(xL.subarray(i, i + len)); pR.set(xR.subarray(i, i + len))
    if (len < C && len > C / 2) for (let j = len; j < C; j++) { const k = reflect(len, j); pL[j] = xL[i + k]; pR[j] = xR[i + k] }
    const bins = RF.nfft / 2 + 1, { data, T } = stftStereo(pL, pR, RF.nfft, RF.hop, bins)
    const [oL, oR] = istftStereo(await run(data, [1, 4, bins, T]), bins, T, RF.nfft, RF.hop)
    const w = Float64Array.from(win)
    if (i === 0) w.fill(1, 0, fade)
    if (i + step >= n) w.fill(1, C - fade)
    for (let j = 0; j < len; j++) { resL[i + j] += oL[j] * w[j]; resR[i + j] += oR[j] * w[j]; cnt[i + j] += w[j] }
  }
  const o = conBorde ? border : 0, outL = new Float32Array(n0), outR = new Float32Array(n0)
  for (let j = 0; j < n0; j++) { const c = cnt[j + o]; outL[j] = c > 0 ? resL[j + o] / c : 0; outR[j] = c > 0 ? resR[j + o] / c : 0 }
  return [outL, outR]
}

function decodificar(file: string, desde = 0, segundos = 0): Promise<Stereo> {
  const a = ['-v', 'error', ...(desde ? ['-ss', String(desde)] : []), '-i', file, ...(segundos ? ['-t', String(segundos)] : []), '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']
  return new Promise((ok, mal) => {
    const p = spawn(ffmpeg, a), partes: Buffer[] = []
    p.stdout.on('data', (d: Buffer) => partes.push(d))
    p.on('close', (c) => {
      if (c) return mal(new Error(`ffmpeg ${c}`))
      const b = Buffer.concat(partes), f = new Float32Array(b.buffer, b.byteOffset, b.length / 4), n = f.length / 2
      const L = new Float32Array(n), R = new Float32Array(n)
      for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1] }
      ok([L, R])
    })
  })
}

/** Cuánto está corrido `a` respecto de `b` (muestras; > 0: `a` empieza después): correlación de los primeros ~95 s, hasta ±30 s. */
function desfase(a: Stereo, b: Stereo): number {
  const N = 1 << 23, W = 1 << 22, ar = new Float64Array(N), br = new Float64Array(N), z = new Float64Array(N)
  for (let i = 0; i < W && i < a[0].length; i++) ar[i] = a[0][i] + a[1][i]
  for (let i = 0; i < W && i < b[0].length; i++) br[i] = b[0][i] + b[1][i]
  const pl = fftPlan(N), Ar = new Float64Array(N), Ai = new Float64Array(N), Br = new Float64Array(N), Bi = new Float64Array(N)
  fft(pl, ar, z, Ar, Ai); fft(pl, br, z, Br, Bi)
  for (let k = 0; k < N; k++) { const r = Ar[k] * Br[k] + Ai[k] * Bi[k], i = Ai[k] * Br[k] - Ar[k] * Bi[k]; Ar[k] = r; Ai[k] = -i }
  fft(pl, Ar, Ai, Br, Bi) // conj(FFT(conj(A·conj(B)))) = correlación (la parte real)
  let mejor = 0, pico = -Infinity
  for (let lag = -30 * SR; lag <= 30 * SR; lag++) { const v = Br[(lag + N) % N]; if (v > pico) { pico = v; mejor = lag } }
  return mejor
}
const correr = (x: Stereo, k: number, n: number): Stereo => x.map((c) => Float32Array.from({ length: n }, (_, i) => { const j = i - k; return j >= 0 && j < c.length ? c[j] : 0 })) as Stereo

/** El mastering como filtro lineal por frecuencia y canal (H = Σ O·conj(S) / Σ |S|², cuadros de 4096), aplicado a las partes. */
function ecualizar(orig: Stereo, ss: Stereo, sv: Stereo, si: Stereo): { voz: Stereo; inst: Stereo; suma: Stereo } {
  const N = 4096, hop = 1024, half = N / 2, n = orig[0].length, pl = fftPlan(N), w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  const zr = new Float64Array(N), zi = new Float64Array(N), Zr = new Float64Array(N), Zi = new Float64Array(N)
  const out: [Float32Array[], Float32Array[]] = [[], []]
  for (let c = 0; c < 2; c++) {
    const nr = new Float64Array(half + 1), ni = new Float64Array(half + 1), de = new Float64Array(half + 1)
    for (let s = 0; s + N <= n; s += hop) {
      for (let j = 0; j < N; j++) { zr[j] = orig[c][s + j] * w[j]; zi[j] = ss[c][s + j] * w[j] }
      fft(pl, zr, zi, Zr, Zi)
      for (let f = 0; f <= half; f++) {
        const g = f === 0 ? 0 : N - f, xr = (Zr[f] + Zr[g]) / 2, xi = (Zi[f] - Zi[g]) / 2, yr = (Zi[f] + Zi[g]) / 2, yi = -(Zr[f] - Zr[g]) / 2
        nr[f] += xr * yr + xi * yi; ni[f] += xi * yr - xr * yi; de[f] += yr * yr + yi * yi
      }
    }
    const hr = Float64Array.from(nr, (v, f) => (de[f] > 1e-12 ? v / de[f] : 0)), hi = Float64Array.from(ni, (v, f) => (de[f] > 1e-12 ? v / de[f] : 0))
    const ya = new Float64Array(n), yb = new Float64Array(n), env = new Float64Array(n)
    for (let s = 0; s + N <= n; s += hop) {
      for (let j = 0; j < N; j++) { zr[j] = sv[c][s + j] * w[j]; zi[j] = si[c][s + j] * w[j] }
      fft(pl, zr, zi, Zr, Zi)
      for (let f = 0; f < N; f++) { const k = f <= half ? f : N - f, q = (f <= half ? 1 : -1) * hi[k]; zr[f] = Zr[f] * hr[k] - Zi[f] * q; zi[f] = -(Zr[f] * q + Zi[f] * hr[k]) }
      fft(pl, zr, zi, Zr, Zi)
      for (let j = 0; j < N; j++) { ya[s + j] += (Zr[j] / N) * w[j]; yb[s + j] += (-Zi[j] / N) * w[j]; env[s + j] += w[j] * w[j] }
    }
    out[0].push(Float32Array.from(ya, (v, j) => (env[j] > 1e-3 ? v / env[j] : 0))); out[1].push(Float32Array.from(yb, (v, j) => (env[j] > 1e-3 ? v / env[j] : 0)))
  }
  const voz = out[0] as Stereo, inst = out[1] as Stereo
  return { voz, inst, suma: [0, 1].map((c) => Float32Array.from(voz[c], (v, j) => v + inst[c][j])) as Stereo }
}

// ── Principal ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const nombre = arg('modelo')!, motor = arg('motor', 'node')!, hilos = Number(arg('hilos', '4'))
if (!MODELOS[nombre]) { console.error('Falta --modelo inst_hq3|voc_ft|roformer'); process.exit(2) }
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* sin permiso: sigue igual */ }
const salida = arg('salida', path.join(base, 'salida'))!
fs.mkdirSync(salida, { recursive: true })
const desde = Number(arg('desde', '0')) || 0, segundos = Number(arg('segundos', '0')) || 0
const sumar = (a: Stereo, b: Stereo, n: number): Stereo => [0, 1].map((c) => Float32Array.from({ length: n }, (_, i) => a[c][i] + b[c][i])) as Stereo

let mix: Stereo, refVoz: Stereo | null = null, refInst: Stereo | null = null, etiqueta: string, extra: Record<string, unknown> = {}
if (arg('original')) {
  const orig = await decodificar(arg('original')!), av = await decodificar(arg('acapella')!), ai = await decodificar(arg('instrumental')!)
  const n = orig[0].length, kv = desfase(orig, av), ki = desfase(orig, ai)
  let A = correr(av, kv, n), I = correr(ai, ki, n)
  let aa = 0, ii = 0, x = 0, oa = 0, oi = 0
  for (let c = 0; c < 2; c++) for (let j = 0; j < n; j++) { aa += A[c][j] ** 2; ii += I[c][j] ** 2; x += A[c][j] * I[c][j]; oa += orig[c][j] * A[c][j]; oi += orig[c][j] * I[c][j] }
  const det = aa * ii - x * x, ga = (oa * ii - oi * x) / det, gi = (oi * aa - oa * x) / det
  A = A.map((c) => c.map((v) => v * ga)) as Stereo; I = I.map((c) => c.map((v) => v * gi)) as Stereo
  let S = sumar(A, I, n)
  const techoCrudo = sdr(orig, S)
  if (!flag('sin-ecualizar')) { const e = ecualizar(orig, S, A, I); A = e.voz; I = e.inst; S = e.suma }
  const a = Math.floor(desde * SR), b = segundos ? Math.min(n, a + Math.floor(segundos * SR)) : n
  const cortar = (s: Stereo) => s.map((c) => c.slice(a, b)) as Stereo
  const O = cortar(orig)
  refVoz = cortar(A); refInst = cortar(I); S = cortar(S)
  let mezcla = arg('mezcla', 'original')!
  mix = mezcla === 'suma' ? S : O
  if (arg('version')) {
    // otra versión del mismo original (MP3 128, Opus…): se separa esa, con las partes ajustadas con el FLAC
    const v = await decodificar(arg('version')!), kq = desfase(orig, v)
    mix = cortar(correr(v, kq, n)); mezcla = path.basename(arg('version')!).replace(/\.\w+$/, '')
    extra.desfase_version_ms = +((kq / SR) * 1000).toFixed(1)
  }
  extra = { ...extra, mezcla, desfase_acapella_ms: +((kv / SR) * 1000).toFixed(1), desfase_instrumental_ms: +((ki / SR) * 1000).toFixed(1), ganancia_acapella: +ga.toFixed(3), ganancia_instrumental: +gi.toFixed(3), techo_sin_ecualizar: +techoCrudo.toFixed(2), techo: +sdr(O, S).toFixed(2) }
  etiqueta = path.basename(arg('acapella')!).replace(/ \(Acapella\)\.\w+$/, '') + ` (${mezcla})`
} else if (arg('acapella')) {
  refVoz = await decodificar(arg('acapella')!, desde, segundos); refInst = await decodificar(arg('instrumental')!, desde, segundos)
  const n = Math.min(refVoz[0].length, refInst[0].length)
  refVoz = refVoz.map((c) => c.subarray(0, n)) as Stereo; refInst = refInst.map((c) => c.subarray(0, n)) as Stereo
  mix = sumar(refVoz, refInst, n)
  etiqueta = path.basename(arg('acapella')!).replace(/ \(Acapella\)\.\w+$/, '')
} else {
  mix = await decodificar(arg('tema')!, desde, segundos)
  etiqueta = path.basename(arg('tema')!).replace(/\.\w+$/, '')
}
const dur = mix[0].length / SR
if (flag('solo-alinear')) { console.log(JSON.stringify({ tema: etiqueta, duracion_s: +dur.toFixed(1), ...extra })); process.exit(0) }
const { run, reloj } = await cargar(nombre, motor, hilos)
const t0 = Date.now()
const m = MODELOS[nombre]
let voz: Stereo, inst: Stereo
if (m.mdx) ({ vocals: voz, instrumental: inst } = await mdxSeparate(m.mdx, run, mix[0], mix[1]))
else { voz = await separarRoformer(run, mix[0], mix[1]); inst = [0, 1].map((c) => Float32Array.from(mix[c], (v, j) => v - voz[c][j])) as Stereo }
const seg = (Date.now() - t0) / 1000
const fila: Record<string, unknown> = { tema: etiqueta, modelo: nombre, motor, hilos, duracion_s: +dur.toFixed(1), tardo_s: +seg.toFixed(1), modelo_s: +(reloj.modelo / 1000).toFixed(1), x_tiempo_real: +(seg / dur).toFixed(2), rss_mb: Math.round(process.memoryUsage().rss / 2 ** 20) }
if (refVoz && refInst) Object.assign(fila, { sdr_voz: +sdr(refVoz, voz).toFixed(2), sdr_inst: +sdr(refInst, inst).toFixed(2), sdr_mezcla_como_inst: +sdr(refInst, mix).toFixed(2), ...extra })
console.log(JSON.stringify(fila))
fs.appendFileSync(path.join(salida, 'resultados.jsonl'), JSON.stringify(fila) + '\n')
if (flag('flac')) {
  await writeFlac(ffmpeg, voz, path.join(salida, `${etiqueta} (Acapella, ${nombre}).flac`))
  await writeFlac(ffmpeg, inst, path.join(salida, `${etiqueta} (Instrumental, ${nombre}).flac`))
}
