// Análisis completo de un archivo. Corre dentro de un worker (es pesado).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { Readable } from 'node:stream'
import { lowPriority } from '../lowpriority'
import { T } from './errores.textos'
import { SpectrumAccumulator, findCutoff, type CutoffResult } from './fft'
import { FlickerMeter } from './flicker'
import { SilenceMeter, type SilenceResult } from './silence'
import { readMp3Info, type Mp3Info } from './mp3info'
import { countDecodeErrors, countDropped } from './decodeerrors'
import { findGaps, type Gap } from './gaps'
import { analyzeDj, preciseVotes, type DjResult, type PreciseVotes } from './dj'
import { CHROMA_MAX_SECONDS, CHROMA_SAMPLE_RATE, Chromaprinter, chromaFilter, encodeFingerprint } from './chromaprint'

export interface AnalyzeJob {
  ffmpeg: string
  file: string
  ext: string
  lossless: boolean
  sampleRate: number | null
  bits: number | null
  channels: number | null
  duration: number | null
  withDj: boolean // BPM y tono (no para grabaciones de sets de una hora)
  withPrints?: boolean // las dos huellas (por defecto sí; la pasada que solo rehace la calidad no las necesita)
}

export interface RawAnalysis {
  cutoff: CutoffResult
  hires: CutoffResult | null // análisis a la frecuencia original (solo archivos de más de 48 kHz)
  flicker: number | null // cuánto "titilan" los agudos (huecos del espectrograma, core/analysis/flicker.ts)
  effBits: number | null // bits reales en archivos de más de 16 bits
  lufs: number | null
  lra: number | null
  truePeak: number | null
  samplePeak: number
  clipEvents: number
  stereoCorr: number | null
  sideRatio: number | null // energía del lado (L-R) sobre el centro: ~0 = estéreo falso
  decodeErrors: number
  /** Los huecos: cuadros que no se pudieron leer, dónde y cuánto duran (core/analysis/gaps.ts). Sin el dato, null. */
  gaps?: Gap[] | null
  /** Silencio al principio y al final (core/analysis/silence.ts). */
  silence?: SilenceResult | null
  /** Las etiquetas del archivo como las muestra ffmpeg al abrirlo (claves en minúscula): el programa que lo armó, el link de
   *  donde se bajó… Son pistas para la nota de calidad (core/analysis/clues.ts). */
  meta: Record<string, string>
  mp3: Mp3Info | null
  dj: DjResult | null
  prints: Prints
  ms: number
}

/**
 * Las dos huellas de un tema, sacadas de la misma lectura que el resto del análisis.
 * - audioMd5: huella del sonido (MD5 del audio decodificado a PCM de 32 bits, igual que `pcmHash`). Sirve para comprobar
 *   que guardar tags no tocó el audio. Vale solo mientras el archivo tenga el tamaño y la fecha anotados (`size`, `mtime`).
 * - chromaprint: huella acústica (Chromaprint/AcoustID, primeros 120 s, comprimida). Sirve para reconocer el mismo tema
 *   con otro nombre, formato o calidad, y para preguntarle a AcoustID qué tema es.
 * Cualquiera de las dos queda en null si no se pudo calcular (archivo que ffmpeg no lee entero, que cambió mientras se leía…).
 */
export interface Prints { audioMd5: string | null; chromaprint: string | null; size: number | null; mtime: number | null }

const SR = 44100
const N = 4096
const DJ_WINDOW_S = 90

/**
 * ffmpeg con prioridad baja y un solo hilo: el análisis usa lo que sobra del CPU y nunca le gana
 * a lo que el usuario está haciendo (la interfaz, el reproductor u otros programas).
 */
function spawnLow(ffmpeg: string, args: string[], extraPipes = 0) {
  const p = spawn(ffmpeg, ['-threads', '1', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', ...Array(extraPipes).fill('pipe')] })
  lowPriority(p.pid)
  return p
}

// Ramas que se agregan a la misma decodificación para sacar las huellas (ver `Prints`). La del MD5 convierte a PCM de
// 32 bits igual que `pcmHash` (da exactamente el mismo número); la de Chromaprint deja el audio como lo prepara fpcalc.
const printBranches = (channels: number | null) =>
  `[ph]anull[pho];[pc]${chromaFilter(channels)},atrim=end_sample=${CHROMA_MAX_SECONDS * CHROMA_SAMPLE_RATE}[pco]`
const printOutputs = (md5Pipe: number, chromaPipe: number) => ['-map', '[pho]', '-c:a', 'pcm_s32le', '-f', 'md5', `pipe:${md5Pipe}`, '-map', '[pco]', '-f', 's16le', `pipe:${chromaPipe}`]

/** Junta lo que sale por las ramas de huellas. `done(ok)` las cierra: sin ok (ffmpeg falló) la huella del sonido no vale. */
function collectPrints(md5Out: Readable, chromaOut: Readable) {
  let md5Text = ''
  md5Out.on('data', (d) => { md5Text += d })
  const cp = new Chromaprinter()
  let odd: number | null = null
  chromaOut.on('data', (chunk: Buffer) => {
    if (cp.full) return
    let b = chunk
    if (odd !== null) { b = Buffer.concat([Buffer.from([odd]), chunk]); odd = null }
    if (b.length & 1) { odd = b[b.length - 1]; b = b.subarray(0, b.length - 1) }
    // copia alineada: el Buffer puede empezar en una posición impar
    cp.feed(new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)))
  })
  return (ok: boolean): Omit<Prints, 'size' | 'mtime'> => {
    const fp = cp.finish()
    return { audioMd5: ok ? md5Text.match(/MD5=([0-9a-f]{32})/i)?.[1]?.toLowerCase() ?? null : null, chromaprint: fp.length ? encodeFingerprint(fp) : null }
  }
}

/** Tamaño y fecha del archivo, para saber después si la huella del sonido sigue valiendo. */
function statOf(file: string): { size: number; mtime: number } | null {
  try { const st = fs.statSync(file); return { size: st.size, mtime: st.mtimeMs } } catch { return null }
}

/** Si el archivo cambió mientras se leía, la huella del sonido no corresponde a ninguno de los dos estados: se descarta. */
function stamp(p: Omit<Prints, 'size' | 'mtime'>, before: { size: number; mtime: number } | null, file: string): Prints {
  const after = statOf(file)
  const same = before && after && before.size === after.size && before.mtime === after.mtime
  return same ? { ...p, size: before.size, mtime: before.mtime } : { ...p, audioMd5: null, size: null, mtime: null }
}

/** Pasada principal: todo el tema a 44,1 kHz estéreo, con el medidor EBU R128 de ffmpeg en el camino. */
function mainPass(job: AnalyzeJob): Promise<Omit<RawAnalysis, 'hires' | 'effBits' | 'mp3' | 'dj' | 'ms'> & { mono: Float32Array; dropped: number }> {
  // Una sola decodificación con tres salidas: el audio para medir calidad, BPM y tono (pipe 1), la huella del sonido
  // (pipe 3) y el audio para la huella acústica (pipe 4).
  const withPrints = job.withPrints !== false
  const quality = 'ebur128=peak=true:framelog=quiet,aresample=44100,aformat=sample_fmts=flt:channel_layouts=stereo[mo]'
  const graph = withPrints ? `[0:a:0]asplit=3[m][ph][pc];[m]${quality};${printBranches(job.channels)}` : `[0:a:0]${quality}`
  const args = ['-hide_banner', '-nostats', '-nostdin', '-i', job.file, '-filter_complex', graph,
    '-map', '[mo]', '-f', 'f32le', 'pipe:1', ...(withPrints ? printOutputs(3, 4) : [])]
  const st0 = statOf(job.file)
  return new Promise((resolve, reject) => {
    const p = spawnLow(job.ffmpeg, args, withPrints ? 2 : 0)
    const prints = withPrints ? collectPrints(p.stdio[3] as Readable, p.stdio[4] as Readable) : () => ({ audioMd5: null, chromaprint: null })
    const acc = new SpectrumAccumulator(N)
    const flicker = new FlickerMeter(SR)
    const silence = new SilenceMeter()
    const frame = new Float32Array(N)
    let fpos = 0
    let leftover: Buffer = Buffer.alloc(0)
    let sLL = 0, sRR = 0, sLR = 0, sSide = 0, sMid = 0
    let peak = 0, clipRun = 0, clipEvents = 0, n = 0, frameCount = 0

    // Ventana para BPM/tono: 90 s del medio del tema.
    const dur = job.duration || 0
    const winStart = Math.max(0, Math.floor((dur / 2 - DJ_WINDOW_S / 2) * SR))
    const winLen = job.withDj ? Math.min(DJ_WINDOW_S * SR, Math.max(0, Math.floor(dur * SR) - winStart) || DJ_WINDOW_S * SR) : 0
    const mono = new Float32Array(winLen)
    let monoLen = 0

    p.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      const usable = buf.length - (buf.length % 8)
      const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable))
      for (let o = 0; o < f.length; o += 2) {
        const l = f[o], r = f[o + 1]
        sLL += l * l; sRR += r * r; sLR += l * r
        const m = (l + r) * 0.5, s = (l - r) * 0.5
        sMid += m * m; sSide += s * s
        const a = Math.max(Math.abs(l), Math.abs(r))
        if (a > peak) peak = a
        if (a >= 0.9999) { if (++clipRun === 3) clipEvents++ } else clipRun = 0
        if (n >= winStart && monoLen < winLen) mono[monoLen++] = m
        frame[fpos++] = m
        flicker.push(m)
        silence.push(l, r)
        if (fpos === N) {
          // Para ahorrar CPU se analiza un cuadro de cada dos: alcanza para el promedio.
          if ((frameCount++ & 1) === 0) acc.add(frame)
          fpos = 0
        }
        n++
      }
      leftover = buf.subarray(usable)
    })
    let stderr = ''
    let head = '' // el principio, con las etiquetas (el resto se recorta si es muy largo)
    p.stderr.on('data', (d) => { if (head.length < 40_000) head += d; stderr += d; if (stderr.length > 200_000) stderr = stderr.slice(-100_000) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (n === 0) return reject(new Error(lastLine(stderr) || T.ffmpegCodigo(code)))
      const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
      const num = (re: RegExp) => { const m = summary.match(re); return m ? Number(m[1]) : null }
      const decodeErrors = countDecodeErrors(stderr, job.file)
      const cutoff = findCutoff(acc, SR, { formatRate: job.sampleRate, lossless: job.lossless })
      resolve({
        cutoff,
        flicker: flicker.jitter(cutoff.cutoff),
        lufs: num(/I:\s+(-?[\d.]+) LUFS/),
        lra: num(/LRA:\s+(-?[\d.]+) LU/),
        truePeak: num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
        samplePeak: Math.round(20 * Math.log10(peak || 1e-9) * 10) / 10,
        clipEvents,
        stereoCorr: job.channels === 1 || !sLL || !sRR ? null : Math.round((sLR / Math.sqrt(sLL * sRR)) * 1000) / 1000,
        sideRatio: job.channels === 1 || !sMid ? null : sSide / sMid,
        decodeErrors,
        dropped: countDropped(stderr),
        silence: silence.result(),
        meta: inputMeta(head),
        mono: mono.subarray(0, monoLen),
        prints: stamp(prints(code === 0), st0, job.file),
      })
    })
  })
}

/** Archivos de más de 48 kHz o más de 16 bits: 20 s a la frecuencia original, en enteros de 32 bits. */
function nativePass(job: AnalyzeJob): Promise<{ hires: CutoffResult | null; effBits: number | null }> {
  const sr = job.sampleRate || SR
  const start = job.duration && job.duration > 40 ? Math.floor(job.duration * 0.3) : 0
  // Sin mezclar canales: la mezcla misma "inventaría" bits y arruinaría la prueba de 24 bits.
  const ch = Math.max(1, job.channels || 2)
  const args = ['-v', 'error', '-nostdin', '-ss', String(start), '-t', '20', '-i', job.file, '-map', '0:a:0', '-f', 's32le', 'pipe:1']
  return new Promise((resolve) => {
    const p = spawnLow(job.ffmpeg, args)
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', () => resolve({ hires: null, effBits: null }))
    p.on('close', () => {
      const buf = Buffer.concat(chunks)
      const count = buf.length >> 2
      if (!count) return resolve({ hires: null, effBits: null })
      // Un "24 bits" que en realidad es 16 tiene los bits 8–15 siempre en cero.
      let low = 0
      for (let i = 0; i < count; i++) low |= buf.readInt32LE(i * 4) & 0xff00
      const effBits = (job.bits || 16) > 16 ? (low ? 24 : 16) : null
      let hires: CutoffResult | null = null
      if (sr > 48000) {
        const n = sr > 100000 ? 16384 : 8192
        const acc = new SpectrumAccumulator(n)
        const frame = new Float64Array(n)
        const frames = Math.floor(count / ch)
        for (let off = 0; off + n <= frames; off += n) {
          for (let i = 0; i < n; i++) frame[i] = buf.readInt32LE((off + i) * ch * 4) / 2147483648 // primer canal
          acc.add(frame)
        }
        hires = findCutoff(acc, sr)
      }
      resolve({ hires, effBits })
    })
  })
}

/**
 * Las etiquetas del archivo de entrada, del encabezado que escribe ffmpeg ("Input #0 … Metadata: encoder : Lavf58…"), del
 * archivo y de su pista de audio. Los valores de varias líneas siguen con ": " sin clave.
 */
export function inputMeta(stderr: string): Record<string, string> {
  const start = stderr.indexOf('Input #0')
  if (start < 0) return {}
  const end = stderr.slice(start).search(/\n(?:Output #0|Stream mapping|Press \[q\])/)
  const out: Record<string, string> = {}
  let last: string | null = null
  for (const line of stderr.slice(start, end > 0 ? start + end : undefined).split(/\r?\n/)) {
    const m = line.match(/^ {4,}([^:]*?)\s*: (.*)$/)
    if (!m) { last = null; continue }
    const key = m[1].trim().toLowerCase()
    if (!key && last) out[last] += `\n${m[2]}`
    else if (key && !(key in out)) { out[key] = m[2].slice(0, 500); last = key }
  }
  return out
}

const lastLine = (s: string) => s.trim().split('\n').filter((l) => !/^\s*(Input|Output|Stream|Duration|Metadata|  )/.test(l)).pop() || ''

export async function analyzeFile(job: AnalyzeJob): Promise<RawAnalysis> {
  const t0 = Date.now()
  const needNative = job.lossless && ((job.sampleRate || 0) > 48000 || (job.bits || 16) > 16)
  const [main, native] = await Promise.all([mainPass(job), needNative ? nativePass(job) : Promise.resolve({ hires: null, effBits: null })])
  const { mono, dropped, ...rest } = main
  // solo si al leerlo faltaron cuadros: una segunda lectura con el tiempo de cada uno, para decir dónde
  const gaps = dropped > 0 ? await findGaps(job.ffmpeg, job.file, job.duration) : []
  let dj: DjResult | null = null
  if (job.withDj && mono.length) {
    try { dj = analyzeDj(mono) } catch { dj = null }
  }
  return {
    ...rest,
    hires: native.hires,
    effBits: native.effBits,
    gaps,
    mp3: job.ext === 'mp3' ? readMp3Info(job.file) : null,
    dj,
    ms: Date.now() - t0,
  }
}

export interface PrintsJob { ffmpeg: string; file: string; channels: number | null }

/**
 * Solo las huellas (sin calidad ni BPM): para los temas que se analizaron antes de que existieran. Es una decodificación
 * sin medidor de volumen ni FFT de calidad, así que tarda bastante menos que el análisis completo.
 */
export function analyzePrints(job: PrintsJob): Promise<Prints> {
  const graph = `[0:a:0]asplit=2[ph][pc];${printBranches(job.channels)}`
  const args = ['-v', 'error', '-nostdin', '-i', job.file, '-filter_complex', graph, ...printOutputs(1, 3)]
  const st0 = statOf(job.file)
  return new Promise((resolve, reject) => {
    const p = spawnLow(job.ffmpeg, args, 1)
    const prints = collectPrints(p.stdout, p.stdio[3] as Readable)
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += d; if (stderr.length > 100_000) stderr = stderr.slice(-50_000) })
    p.on('error', reject)
    p.on('close', (code) => {
      const r = stamp(prints(code === 0), st0, job.file)
      if (!r.audioMd5 && !r.chromaprint) reject(new Error(lastLine(stderr) || T.ffmpegCodigo(code)))
      else resolve(r)
    })
  })
}

export interface PreciseJob { ffmpeg: string; file: string; duration: number | null }

/** Pasada precisa: decodifica solo los 90 s del medio (los mismos que la rápida) y junta los votos (core/analysis/dj.ts). */
export function analyzePrecise(job: PreciseJob): Promise<PreciseVotes> {
  const start = Math.max(0, Math.floor((job.duration || 0) / 2 - DJ_WINDOW_S / 2))
  const args = ['-v', 'error', '-nostdin', '-ss', String(start), '-t', String(DJ_WINDOW_S), '-i', job.file, '-map', '0:a:0', '-vn',
    '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1']
  return new Promise((resolve, reject) => {
    const p = spawnLow(job.ffmpeg, args)
    const chunks: Buffer[] = []
    let stderr = ''
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.stderr.on('data', (d) => { stderr += d })
    p.on('error', reject)
    p.on('close', () => {
      const buf = Buffer.concat(chunks)
      if (buf.length < 4) return reject(new Error(lastLine(stderr) || T.noSeLeyo))
      const mono = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
      try { resolve(preciseVotes(mono)) } catch (e) { reject(e) }
    })
  })
}
