// Correr Beat This! para la grilla (Fase F). El modelo (191 MB) y onnxruntime-web viajan con PAILA (resources/modelos; con `models_dir` se puede
// usar otra carpeta, MIT), con `beat-this/` (beat_this.onnx + mel-filterbank.bin) y
// `npm/node_modules/onnxruntime-web`. Con el procesador (WebAssembly); con la placa de video corre en una ventana oculta
// (apps/paila/electron/beatgpu.ts).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { BT_CHUNK, BT_MELS, type BeatModel } from './beatthis'
import { textos } from '@paila/shared/idioma'

// Qué falta en la carpeta de modelos (se muestra en Rekordbox y cabina → grilla; nadie compara el texto).
const T = textos({
  sinCarpeta: { es: 'No elegiste la carpeta de modelos.', en: "You haven't chosen the models folder." },
  falta: { es: (f: string) => `No está ${f} en la carpeta de modelos.`, en: (f: string) => `${f} isn't in the models folder.` },
  sinOrt: { es: 'No está onnxruntime-web en la carpeta de modelos (npm/node_modules).', en: "onnxruntime-web isn't in the models folder (npm/node_modules)." },
})

export interface BeatThis { model: BeatModel; fb: Float32Array; provider: string }

/** Qué falta en la carpeta de modelos para usar Beat This! (null = está todo). */
export function beatThisMissing(dir: string | null): string | null {
  if (!dir) return T.sinCarpeta
  if (!fs.existsSync(path.join(dir, 'beat-this', 'beat_this.onnx'))) return T.falta('beat-this/beat_this.onnx')
  if (!fs.existsSync(path.join(dir, 'beat-this', 'mel-filterbank.bin'))) return T.falta('beat-this/mel-filterbank.bin')
  if (!fs.existsSync(path.join(dir, 'npm', 'node_modules', 'onnxruntime-web', 'package.json'))) return T.sinOrt
  return null
}

/** Carga el modelo. `threads`: hilos del procesador para el modelo (WebAssembly). */
export async function loadBeatThis(dir: string, opts: { threads?: number } = {}): Promise<BeatThis> {
  const missing = beatThisMissing(dir)
  if (missing) throw new Error(missing)
  const req = createRequire(path.join(dir, 'npm', 'package.json'))
  const ort = req('onnxruntime-web')
  ort.env.wasm.numThreads = Math.max(1, opts.threads ?? 1)
  const session = await ort.InferenceSession.create(path.join(dir, 'beat-this', 'beat_this.onnx'), { executionProviders: ['wasm'], logSeverityLevel: 3 })
  const b = fs.readFileSync(path.join(dir, 'beat-this', 'mel-filterbank.bin'))
  return {
    provider: `wasm×${ort.env.wasm.numThreads}`,
    fb: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)),
    model: async (x) => {
      const o = await session.run({ spect: new ort.Tensor('float32', x, [1, BT_CHUNK, BT_MELS]) })
      return { beat: o.beat.data as Float32Array, downbeat: o.downbeat.data as Float32Array }
    },
  }
}
