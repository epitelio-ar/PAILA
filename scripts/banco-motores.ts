// Las variantes del motor de BPM y tono que prueba el banco (scripts/banco.ts): Essentia (métodos y perfiles), KeyFinder,
// y los modelos Beat This! (ONNX) y TempoCNN (TensorFlow.js), que se cargan de una carpeta aparte (`--modelos`) porque
// no son parte de PAILA: se bajaron solo para medir.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { bpmForStyle, foldBpm, type BpmStyle } from '@paila/core/analysis/bpmrange'
import { free } from '@paila/core/analysis/dj'
import { KF_RATE, keyFinder } from '@paila/core/analysis/keyfinder'
import { BT_CHUNK, BT_MELS, BT_RATE, melSpectrogram, predict, readBeats } from '@paila/core/analysis/beatthis'
import { getFft } from '@paila/core/analysis/fft'
import { tempoFromBeats } from '@paila/core/analysis/beats'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

export type Out = { bpm: number | null; key: string | null }

/** Audio mono de un pedazo del tema (`from` y `seconds` en segundos) a la frecuencia pedida. `mean`: promedio exacto de canales. */
export function decode(file: string, rate: number, from: number | null, seconds: number | null, mean = false): Float32Array | null {
  const args = ['-v', 'error', '-nostdin', ...(from != null ? ['-ss', String(from)] : []), ...(seconds != null ? ['-t', String(seconds)] : []), '-i', file, '-map', '0:a:0', '-vn',
    ...(mean ? ['-af', 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1'] : ['-ac', '1']), '-ar', String(rate), '-f', 'f32le', 'pipe:1']
  const p = spawnSync(ffmpeg, args, { maxBuffer: 1 << 28, windowsHide: true })
  if (!p.stdout || p.stdout.length < rate * 4 * 10) return null
  return new Float32Array(p.stdout.buffer.slice(p.stdout.byteOffset, p.stdout.byteOffset + p.stdout.length - (p.stdout.length % 4)))
}

interface Essentia {
  arrayToVector(a: Float32Array): { delete?: () => void }
  vectorToArray(v: unknown): Float32Array
  RhythmExtractor2013(v: unknown, maxTempo: number, method: string, minTempo: number): { bpm: number; ticks: unknown }
  PercivalBpmEstimator(v: unknown, frameSize: number, frameSizeOSS: number, hopSize: number, hopSizeOSS: number, maxBPM: number, minBPM: number, sampleRate: number): { bpm: number }
  KeyExtractor(...a: unknown[]): { key: string; scale: string; strength: number }
}

// TempoCNN: espectrograma mel como librosa (lo que usa tempo-cnn): 11025 Hz, n_fft 1024, hop 512, magnitud, 40 bandas
// "slaney" de 20 a 5000 Hz; pedazos de 256 cuadros cada 128; promedio de las probabilidades (256 clases, de 30 a 285 BPM).
const TC_RATE = 11025
const hzToMel = (f: number) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27))
const melToHz = (m: number) => (m < 15 ? m * (200 / 3) : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)))
function tempoCnnMel(y: Float32Array): Float32Array[] {
  const NB = 40, NF = 513
  const pts = Array.from({ length: NB + 2 }, (_, i) => melToHz(hzToMel(20) + (i * (hzToMel(5000) - hzToMel(20))) / (NB + 1)))
  const fb = Array.from({ length: NB }, (_, m) => Float64Array.from({ length: NF }, (_, k) => {
    const f = (k * TC_RATE) / 1024
    return Math.max(0, Math.min((f - pts[m]) / (pts[m + 1] - pts[m]), (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]))) * (2 / (pts[m + 2] - pts[m]))
  }))
  const fft = getFft(1024)
  const hann = Float64Array.from({ length: 1024 }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 1024))
  const out: Float32Array[] = []
  const re = new Float64Array(1024), im = new Float64Array(1024)
  for (let c = 0; c <= y.length; c += 512) {
    for (let i = 0; i < 1024; i++) { const j = c - 512 + i; re[i] = (j >= 0 && j < y.length ? y[j] : 0) * hann[i]; im[i] = 0 }
    fft.run(re, im)
    const row = new Float32Array(NB)
    for (let k = 0; k < NF; k++) { const mag = Math.hypot(re[k], im[k]); if (mag) for (let m = 0; m < NB; m++) row[m] += fb[m][k] * mag }
    out.push(row)
  }
  return out
}

/** Calcula, para un tema, todas las variantes pedidas (cada una con su versión "+genero" si es de BPM). */
export class Motores {
  private ess: Essentia | null = null
  private bt: { run: (x: Float32Array) => Promise<{ beat: Float32Array; downbeat: Float32Array }>; fb: Float32Array } | null = null
  private tc: { predict: (patches: number[][][][]) => Promise<number[][]> } | null = null

  constructor(readonly variants: string[], readonly modelos: string | null) {}

  async init() {
    const mreq = this.modelos ? createRequire(path.join(this.modelos, 'npm', 'package.json')) : null
    if (this.variants.includes('beatthis')) {
      if (!mreq) throw new Error('beatthis necesita --modelos')
      const ort = mreq('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      const dir = path.join(this.modelos!, 'beat-this')
      const session = await ort.InferenceSession.create(path.join(dir, 'beat_this.onnx'), { executionProviders: ['wasm'], logSeverityLevel: 3 })
      const b = fs.readFileSync(path.join(dir, 'mel-filterbank.bin'))
      this.bt = {
        fb: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)),
        run: async (x) => { const o = await session.run({ spect: new ort.Tensor('float32', x, [1, BT_CHUNK, BT_MELS]) }); return { beat: o.beat.data, downbeat: o.downbeat.data } },
      }
    }
    if (this.variants.includes('tempocnn')) {
      if (!mreq) throw new Error('tempocnn necesita --modelos')
      const tf = mreq('@tensorflow/tfjs')
      const dir = path.join(this.modelos!, 'tempocnn', 'deeptemp-k16', 'deeptemp-k16-3-tfjs')
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'))
      const all = Buffer.concat(j.weightsManifest.flatMap((g: { paths: string[] }) => g.paths.map((p) => fs.readFileSync(path.join(dir, p)))))
      const model = await tf.loadGraphModel({ load: async () => ({ modelTopology: j.modelTopology, format: j.format, generatedBy: j.generatedBy, convertedBy: j.convertedBy,
        weightSpecs: j.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights), weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.length) }) })
      this.tc = { predict: async (patches) => { const x = tf.tensor4d(patches); const y = model.predict(x); const a = await y.array(); x.dispose(); y.dispose(); return a } }
    }
  }

  private essentia(): Essentia {
    if (!this.ess) { const lib = require('essentia.js'); this.ess = new lib.Essentia(lib.EssentiaWASM) as Essentia }
    return this.ess
  }

  async run(file: string, duration: number | null, style: BpmStyle | null): Promise<Record<string, Out>> {
    const res: Record<string, Out> = {}
    const v = this.variants
    const put = (name: string, raw: number | null) => {
      if (!raw) return
      res[name] = { bpm: Math.round(foldBpm(raw) * 10) / 10, key: null }
      res[name + '+genero'] = { bpm: bpmForStyle(raw, style), key: null }
    }
    const d = duration ?? 0
    const mid = (secs: number) => Math.max(0, d / 2 - secs / 2)
    if (v.includes('tono:keyfinder')) { const w = decode(file, KF_RATE, null, null); const g = w ? keyFinder(w) : null; if (g) res['tono:keyfinder'] = { bpm: null, key: g.key } }
    if (this.bt) {
      // un solo pedazo de 30 s del medio (el modelo tarda ~20 s por pedazo en una notebook)
      const y = decode(file, BT_RATE, mid(30), 30, true)
      if (y) { const r = await predict(melSpectrogram(y, this.bt.fb), this.bt.run); put('beatthis', readBeats(r.beat, r.downbeat).bpm) }
    }
    if (this.tc) {
      const y = decode(file, TC_RATE, mid(90), 90)
      if (y) {
        const fr = tempoCnnMel(y)
        const patches: number[][][][] = []
        for (let s = 0; s + 256 <= fr.length; s += 128) patches.push(Array.from({ length: 40 }, (_, b) => Array.from({ length: 256 }, (_, f) => [fr[s + f][b]])))
        if (patches.length) {
          const p = await this.tc.predict(patches)
          const mean = p[0].map((_, i) => p.reduce((a, q) => a + q[i], 0) / p.length)
          put('tempocnn', mean.indexOf(Math.max(...mean)) + 30)
        }
      }
    }
    const ess = v.filter((x) => ['degara', 'multifeature', 'percival'].includes(x.split(':')[0]) || (x.startsWith('tono:') && x !== 'tono:keyfinder'))
    if (!ess.length) return res
    const mono = decode(file, 44100, mid(90), 90)
    if (!mono) return res
    const e = this.essentia()
    const vec = e.arrayToVector(mono)
    let vec3: ReturnType<Essentia['arrayToVector']> | null = null
    let parts3: Float32Array[] = []
    if (ess.some((x) => x.includes(':3v')) && d >= 100) {
      parts3 = [0.2, 0.5, 0.8].map((at) => decode(file, 44100, Math.max(0, d * at - 15), 30)).filter((x): x is Float32Array => !!x)
      const all = new Float32Array(parts3.reduce((n, p) => n + p.length, 0))
      let o = 0
      for (const p of parts3) { all.set(p, o); o += p.length }
      vec3 = e.arrayToVector(all)
    }
    // lo que devuelve Essentia vive en su memoria: se libera enseguida (si no, se llena y se traba)
    const take = <T extends object>(o: T) => { const c = { ...o }; free(o); return c }
    try {
      for (const name of ess) {
        const [method, mod] = name.split(':')
        const bpmOf = (x: unknown) => {
          // :h256 = Percival con paso de 256 muestras (la mitad de cálculo)
          if (method === 'percival') return take(e.PercivalBpmEstimator(x, 1024, 2048, mod === 'h256' ? 256 : 128, 128, 210, 50, 44100)).bpm
          const r = e.RhythmExtractor2013(x, 208, method, 40)
          // :golpes = el tempo afinado con la posición de cada golpe en vez del número "en escalones"
          const ticks = mod === 'golpes' ? Array.from(e.vectorToArray(r.ticks)) : null
          const coarse = take(r).bpm // libera también los golpes: se leen antes
          return (ticks && tempoFromBeats(ticks)) ?? coarse
        }
        if (['degara', 'multifeature', 'percival'].includes(method)) {
          // :3v = un BPM por cada pedazo de 30 s (20 %, 50 % y 80 % del tema) y se promedian los que coinciden (tempo que varía)
          if (mod === '3v' && parts3.length === 3) {
            const each = parts3.map((p) => { const x = e.arrayToVector(p); try { return foldBpm(bpmOf(x)) } finally { free(x) } })
            const mid = each[1]
            const close = each.filter((b) => Math.abs(b - mid) / mid < 0.06)
            put(name, close.reduce((a, b) => a + b, 0) / close.length)
          } else put(name, bpmOf(vec))
        } else {
          const [profile, ...mods] = name.slice(5).split(':')
          const x = mods.includes('3v') ? vec3 ?? vec : vec
          const k = take(e.KeyExtractor(x, true, 4096, 4096, mods.includes('36') ? 36 : 12, mods.includes('5k') ? 5000 : 3500, 60, 25, 0.2, profile, 44100))
          res[name] = { bpm: null, key: `${k.key}${k.scale === 'minor' ? 'm' : ''}` }
        }
      }
    } finally { free(vec); if (vec3) free(vec3) }
    return res
  }
}
