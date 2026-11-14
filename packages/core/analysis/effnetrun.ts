// Correr Discogs-EffNet (estilo por el sonido, MASTERPLAN-3 punto 3) en el worker del análisis: el modelo NO viaja con
// PAILA (licencia no comercial de la UPF): se baja aparte a `<datos>/modelos/discogs-effnet` (apps/paila/electron/ipc/estilo.ts).
// onnxruntime-web es el mismo que usa Beat This! (carpeta de modelos, `npm/node_modules`). Escucha unos pedazos del tema
// (core/analysis/effnet.ts) y devuelve los estilos más probables y lo que oye para la energía (agresivo, tranquilo…).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { decodeMono } from './gridscan'
import { EF_PATCH, EF_RATE, effnetMel, effnetPatches, effnetWindows, meanRows } from './effnet'
import type { EnergyMoods } from '../energia'
import { textos } from '@paila/shared/idioma'

// Qué falta para escuchar el estilo y por qué no se pudo (se muestran; si falta bajar el modelo, la pantalla lo sabe por
// `effnetToDownload`, no por el texto).
const T = textos({
  bajar: { es: 'Falta bajar el modelo de estilos.', en: 'The style model still needs to be downloaded.' },
  sinOrt: { es: 'No está onnxruntime-web en la carpeta de modelos (npm/node_modules).', en: "onnxruntime-web isn't in the models folder (npm/node_modules)." },
  corto: { es: 'El tema es demasiado corto para escuchar el estilo', en: 'The track is too short to hear its style' },
})

export const EFFNET_DIR = 'discogs-effnet'
const BANDS = 96

/** Los archivos del modelo, con su tamaño y su huella (se verifican al bajarlos). Fuente: essentia.upf.edu/models. */
export const EFFNET_FILES: { file: string; url: string; bytes: number; sha256: string }[] = [
  { file: 'discogs-effnet-bsdynamic-1.onnx', url: 'feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx', bytes: 18027718, sha256: 'a280825b334797cf677939db8cd5762c0392aedd0ca6415dbc1cd083f045e43c' },
  { file: 'discogs-effnet-bsdynamic-1.json', url: 'feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.json', bytes: 14986, sha256: 'a2e85b2e7372d5f8e0f35bdd6aeae1139f101087d183d0b2fb60b0ea0f01a0ff' },
  { file: 'mood_aggressive-discogs-effnet-1.onnx', url: 'classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1.onnx', bytes: 514107, sha256: 'de36550b5d1660791ad732ed6de6ebfdc3e65dcf50b928b2578ddf103dbfb400' },
  { file: 'mood_relaxed-discogs-effnet-1.onnx', url: 'classification-heads/mood_relaxed/mood_relaxed-discogs-effnet-1.onnx', bytes: 514101, sha256: '8ba6515a1e5943a72b3b475e3a25fc7a2ff04142c3eaa6aa0716fca371efdfff' },
  { file: 'mood_party-discogs-effnet-1.onnx', url: 'classification-heads/mood_party/mood_party-discogs-effnet-1.onnx', bytes: 514097, sha256: 'c50ac2106ec2f209dd04ad48756582df0e3f3512235310d1a4a3fcc453745f04' },
  { file: 'danceability-discogs-effnet-1.onnx', url: 'classification-heads/danceability/danceability-discogs-effnet-1.onnx', bytes: 514101, sha256: '9ce9b8c44f1dd5df5ffc124e5d41d67acf254232c1b90c7e057e079ab7cead73' },
  { file: 'engagement_regression-discogs-effnet-1.onnx', url: 'classification-heads/engagement/engagement_regression-discogs-effnet-1.onnx', bytes: 513626, sha256: '9551a6c162c9803aef5ce4e4d29a2e4fae99b5bfdc95dae9dd8fe5335e0fb567' },
]
export const EFFNET_BASE_URL = 'https://essentia.upf.edu/models/'

/** Las cabezas que se usan para la energía y qué columna de cada una (el orden de sus clases en el .json de la UPF). */
const HEADS: { key: keyof EnergyMoods; file: string; col: number }[] = [
  { key: 'mood_aggressive', file: 'mood_aggressive-discogs-effnet-1.onnx', col: 0 }, // aggressive, not_aggressive
  { key: 'mood_relaxed', file: 'mood_relaxed-discogs-effnet-1.onnx', col: 1 }, // non_relaxed, relaxed
  { key: 'mood_party', file: 'mood_party-discogs-effnet-1.onnx', col: 1 }, // non_party, party
  { key: 'danceability', file: 'danceability-discogs-effnet-1.onnx', col: 0 }, // danceable, not_danceable
  { key: 'engagement_regression', file: 'engagement_regression-discogs-effnet-1.onnx', col: 0 },
]

/** Qué falta para escuchar el estilo (null = está todo). `dir`: la carpeta del modelo; `ortDir`: la de modelos de Beat This!. */
export function effnetMissing(dir: string | null, ortDir: string | null): string | null {
  if (effnetToDownload(dir)) return T.bajar
  if (!ortDir || !fs.existsSync(path.join(ortDir, 'npm', 'node_modules', 'onnxruntime-web', 'package.json'))) return T.sinOrt
  return null
}

/** ¿Falta bajar el modelo? (lo que falta es eso, y no onnxruntime-web: la pantalla ya muestra el botón Bajar). */
export const effnetToDownload = (dir: string | null) => !dir || EFFNET_FILES.some((f) => !fs.existsSync(path.join(dir, f.file)))

export interface StyleResult {
  /** Los 10 estilos más probables ("Electronic---Techno") con su probabilidad (0–1), del más probable al menos. */
  styles: [string, number][]
  moods: EnergyMoods
}

export interface StyleModel { listen(y: Float32Array[]): Promise<StyleResult> }

type Ort = { Tensor: new (t: string, d: Float32Array, s: number[]) => unknown; InferenceSession: { create(p: string, o: unknown): Promise<Session> }; env: { wasm: { numThreads: number } } }
type Session = { inputNames: string[]; outputNames: string[]; run(f: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> }

/** Carga el modelo y las cabezas. `threads`: hilos del procesador (en el worker del análisis, 1). */
export async function loadEffnet(dir: string, ortDir: string, threads = 1): Promise<StyleModel> {
  const missing = effnetMissing(dir, ortDir)
  if (missing) throw new Error(missing)
  const ort = createRequire(path.join(ortDir, 'npm', 'package.json'))('onnxruntime-web') as Ort
  ort.env.wasm.numThreads = Math.max(1, threads)
  const open = (f: string) => ort.InferenceSession.create(path.join(dir, f), { executionProviders: ['wasm'], logSeverityLevel: 3 })
  const net = await open(EFFNET_FILES[0].file)
  const classes: string[] = JSON.parse(fs.readFileSync(path.join(dir, EFFNET_FILES[1].file), 'utf8')).classes
  const heads = await Promise.all(HEADS.map(async (h) => ({ ...h, s: await open(h.file) })))
  return {
    async listen(parts) {
      const ps = parts.map((y) => effnetPatches(effnetMel(y)))
      const n = ps.reduce((s, p) => s + p.n, 0)
      if (!n) throw new Error(T.corto)
      const pred = new Float32Array(n * classes.length), emb = new Float32Array(n * 1280)
      let k = 0
      for (const p of ps) for (let i = 0; i < p.n; i += 32) {
        const m = Math.min(32, p.n - i)
        const o = await net.run({ [net.inputNames[0]]: new ort.Tensor('float32', p.x.subarray(i * EF_PATCH * BANDS, (i + m) * EF_PATCH * BANDS), [m, EF_PATCH, BANDS]) })
        pred.set(o[net.outputNames[0]].data, k * classes.length); emb.set(o[net.outputNames[1]].data, k * 1280)
        k += m
      }
      const mean = meanRows(pred, n)
      const styles = [...mean].map((v, c) => [classes[c], Math.round(v * 1000) / 1000] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 10)
      const moods: EnergyMoods = {}
      for (const h of heads) {
        const r = await h.s.run({ [h.s.inputNames[0]]: new ort.Tensor('float32', emb, [n, 1280]) })
        moods[h.key] = Math.round(meanRows(r[h.s.outputNames[0]].data, n)[h.col] * 1000) / 1000
      }
      return { styles, moods }
    },
  }
}

export interface StyleJob { ffmpeg: string; file: string; duration: number | null; dir: string; ortDir: string }

/** Los pedazos que escucha (4 de 20 s entre el 10 % y el 90 %), leídos de a uno con ffmpeg: no decodifica el tema entero. */
export async function styleAudio(job: StyleJob): Promise<Float32Array[]> {
  const dur = job.duration ?? 0
  const ws = dur > 0 ? effnetWindows(dur) : [[0, 0] as [number, number]]
  if (ws.length === 1) return [await decodeMono(job.ffmpeg, job.file, EF_RATE)]
  return Promise.all(ws.map(([from, len]) => decodeMono(job.ffmpeg, job.file, EF_RATE, from, len)))
}

let cached: { key: string; model: Promise<StyleModel> } | null = null
/** Lo que corre el worker: carga el modelo una vez por proceso y escucha el tema. */
export async function analyzeStyle(job: StyleJob): Promise<StyleResult> {
  const key = `${job.dir}|${job.ortDir}`
  if (cached?.key !== key) cached = { key, model: loadEffnet(job.dir, job.ortDir) }
  const model = await cached.model.catch((e) => { cached = null; throw e })
  return model.listen(await styleAudio(job))
}
