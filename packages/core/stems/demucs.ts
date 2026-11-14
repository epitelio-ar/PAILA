// Separar en 4 (batería, bajo, resto y voz) con HT-Demucs v4 (Meta, licencia MIT) exportado a ONNX en un solo archivo
// (adowu/htdemucs-onnx, MIT; los pesos en fp16). El modelo trae adentro su STFT: entra el sonido y salen las 4 partes. Va de a
// pedazos de 7,8 s que se pisan un cuarto y se juntan con un fundido (como su infer.py), salvo en el principio y el final del
// tema, que no se funden contra nada. Probado el 31/10 con un tema real: las 4 partes sumadas dan el original a 29,7 dB, y
// un minuto de tema tarda ~70 s en 4 hilos.
import type { Stereo } from '../analysis/stems'

/** Muestras por pedazo: 7,8 s a 44,1 kHz (lo fija el modelo). */
export const DEMUCS_N = 343980
const OV = DEMUCS_N >> 2, STEP = DEMUCS_N - OV
/** Las partes, en el orden en que salen del modelo. */
export const DEMUCS_PARTES = ['bateria', 'bajo', 'resto', 'voz'] as const
export type DemucsParte = typeof DEMUCS_PARTES[number]

/** El modelo: recibe un pedazo [1, 2, N] (izquierdo y después derecho) y devuelve [1, 4, 2, N]. */
export type DemucsModel = (mix: Float32Array) => Promise<Float32Array>

/** Cuántos pedazos lleva un tema de `n` muestras (para el avance). */
export const demucsChunks = (n: number) => Math.max(1, Math.ceil(Math.max(0, n - OV) / STEP))

/** El fundido de un pedazo: sube en el primer cuarto y baja en el último, salvo contra el principio o el final del tema. */
function peso(k: number, len: number, primero: boolean, ultimo: boolean): number {
  if (k < OV && !primero) return k / (OV - 1)
  if (k >= len - OV && !ultimo && len === DEMUCS_N) return (len - 1 - k) / (OV - 1)
  return 1
}

/** Separa [L, R] en las 4 partes. `onChunk(hechos, total)` después de cada pedazo; `cancelled` corta entre pedazos. */
export async function demucsSeparate(model: DemucsModel, L: Float32Array, R: Float32Array, o: { onChunk?: (done: number, total: number) => void; cancelled?: () => boolean } = {}): Promise<Record<DemucsParte, Stereo>> {
  const n = L.length, total = demucsChunks(n)
  const out = DEMUCS_PARTES.map(() => [new Float32Array(n), new Float32Array(n)] as Stereo)
  const suma = new Float32Array(n)
  for (let c = 0; c < total; c++) {
    if (o.cancelled?.()) throw new Error('cancelado')
    const a = c * STEP, len = Math.min(DEMUCS_N, n - a)
    const mix = new Float32Array(2 * DEMUCS_N)
    mix.set(L.subarray(a, a + len), 0); mix.set(R.subarray(a, a + len), DEMUCS_N)
    const r = await model(mix)
    const primero = c === 0, ultimo = a + len >= n
    for (let k = 0; k < len; k++) {
      const w = peso(k, len, primero, ultimo)
      suma[a + k] += w
      for (let p = 0; p < 4; p++) for (let ch = 0; ch < 2; ch++) out[p][ch][a + k] += r[(p * 2 + ch) * DEMUCS_N + k] * w
    }
    o.onChunk?.(c + 1, total)
  }
  for (const st of out) for (const ch of st) for (let i = 0; i < n; i++) ch[i] /= Math.max(suma[i], 1e-8)
  return Object.fromEntries(DEMUCS_PARTES.map((p, i) => [p, out[i]])) as Record<DemucsParte, Stereo>
}

/**
 * Máxima calidad (htdemucs_ft, StemSplitio/htdemucs-ft-onnx, MIT): cuatro modelos especialistas, uno por parte, con la misma
 * entrada y salida que el de un archivo; de cada uno se toma solo su parte. Se cargan de a uno (cada uno pesa 316 MB): pasa
 * el tema entero, se guarda su parte, se suelta y sigue el otro. Tarda unas cuatro veces más.
 */
export interface DemucsBag { cargar(i: number): Promise<{ run: DemucsModel; soltar(): Promise<void> }> }
export async function demucsBagSeparate(bag: DemucsBag, L: Float32Array, R: Float32Array, o: { onChunk?: (done: number, total: number) => void; cancelled?: () => boolean } = {}): Promise<Record<DemucsParte, Stereo>> {
  const out = {} as Record<DemucsParte, Stereo>
  for (const [i, parte] of DEMUCS_PARTES.entries()) {
    const m = await bag.cargar(i)
    try {
      const r = await demucsSeparate(m.run, L, R, { cancelled: o.cancelled, onChunk: (d, t) => o.onChunk?.(i * t + d, 4 * t) })
      out[parte] = r[parte]
    } finally { await m.soltar() }
  }
  return out
}
