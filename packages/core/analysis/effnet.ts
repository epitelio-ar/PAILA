// Estilo por el sonido (MASTERPLAN-3, punto 3) con Discogs-EffNet (MTG-UPF, 2022; licencia no comercial: se baja aparte,
// no viaja con PAILA). Acá va lo que hace PAILA alrededor del modelo, sin dependencias: el espectrograma que espera
// (igual al TensorflowInputMusiCNN de Essentia: 16 kHz, cuadros de 512 cada 256, 96 bandas mel de Slaney, log10(1+10000·x)),
// los pedazos de 128 cuadros (~4 s) y qué estilos sugerir. El modelo ONNX se corre afuera (core/analysis/effnetrun.ts).
import { getFft } from './fft'
import { idioma } from '@paila/shared/idioma'

export const EF_RATE = 16000
const N = 512, HOP = 256, BANDS = 96
export const EF_PATCH = 128 // cuadros por pedazo
const PATCH_HOP = 62

let fbCache: Float64Array | null = null
/** El banco de filtros: 96 triángulos en la escala mel de Slaney entre 0 y 8 kHz, de área 1 (como Essentia, "unit_tri"). */
function filterbank(): Float64Array {
  if (fbCache) return fbCache
  const mel = (f: number) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27))
  const hz = (m: number) => (m < 15 ? (m * 200) / 3 : 1000 * Math.exp(((m - 15) * Math.log(6.4)) / 27))
  const top = mel(EF_RATE / 2)
  const pts = Array.from({ length: BANDS + 2 }, (_, i) => hz((i * top) / (BANDS + 1)))
  const bins = N / 2 + 1
  const fb = new Float64Array(bins * BANDS)
  for (let k = 0; k < bins; k++) {
    const f = (k * EF_RATE) / N
    for (let b = 0; b < BANDS; b++) {
      const lo = pts[b], c = pts[b + 1], hi = pts[b + 2]
      let w = 0
      if (f > lo && f < c) w = (f - lo) / (c - lo)
      else if (f >= c && f < hi) w = (hi - f) / (hi - c)
      fb[k * BANDS + b] = (w * 2) / (hi - lo)
    }
  }
  return (fbCache = fb)
}

/** El espectrograma de EffNet de un pedazo de audio mono a 16 kHz: [cuadros × 96]. */
export function effnetMel(y: Float32Array): Float32Array {
  const fft = getFft(N), fb = filterbank()
  const frames = y.length >= N ? Math.floor((y.length - N) / HOP) + 1 : 0
  const out = new Float32Array(frames * BANDS)
  const re = new Float64Array(N), im = new Float64Array(N), pw = new Float64Array(N / 2 + 1)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = y[f * HOP + i] * fft.win[i]; im[i] = 0 }
    fft.run(re, im)
    for (let k = 0; k <= N / 2; k++) pw[k] = re[k] * re[k] + im[k] * im[k]
    for (let b = 0; b < BANDS; b++) {
      let s = 0
      for (let k = 0; k <= N / 2; k++) s += pw[k] * fb[k * BANDS + b]
      out[f * BANDS + b] = Math.log10(1 + 10000 * s)
    }
  }
  return out
}

/** Los pedazos de 128 cuadros (cada 62, como Essentia) de un espectrograma, juntos para pasarlos al modelo de una vez. */
export function effnetPatches(mel: Float32Array): { x: Float32Array; n: number } {
  const frames = mel.length / BANDS
  const starts: number[] = []
  for (let s = 0; s + EF_PATCH <= frames; s += PATCH_HOP) starts.push(s)
  const x = new Float32Array(starts.length * EF_PATCH * BANDS)
  starts.forEach((s, k) => x.set(mel.subarray(s * BANDS, (s + EF_PATCH) * BANDS), k * EF_PATCH * BANDS))
  return { x, n: starts.length }
}

/**
 * Dónde escucha (segundos `[desde, cuánto]`): `n` pedazos de `len` s repartidos entre el 10 % y el 90 % del tema, para no
 * pasar el tema entero por el modelo. Temas cortos: entero.
 */
export function effnetWindows(duration: number, n = 4, len = 20): [number, number][] {
  if (duration <= n * len * 1.2) return [[0, duration]]
  const a = duration * 0.1, b = duration * 0.9 - len
  return Array.from({ length: n }, (_, i) => [Math.round((a + ((b - a) * i) / Math.max(1, n - 1)) * 10) / 10, len] as [number, number])
}

/** El promedio, pedazo por pedazo, de lo que dice el modelo (`w` valores por pedazo). */
export function meanRows(d: ArrayLike<number>, n: number): Float64Array {
  const w = d.length / Math.max(1, n), out = new Float64Array(w)
  for (let k = 0; k < n; k++) for (let c = 0; c < w; c++) out[c] += d[k * w + c] / n
  return out
}

/**
 * Desde qué probabilidad PAILA sugiere el estilo. Corrida supervisada del 23/10 (220 temas de la Música): con 0,5 o más
 * sugiere en 1 de cada 5 temas y acierta el estilo en 9 de cada 10 (el género grande, en todos); por debajo, los errores
 * son seguidos (docs/pruebas/2026-10-23-partes-energia-estilo.md).
 */
export const STYLE_SURE = 0.5

/** El género grande de Discogs, en castellano (en inglés se muestra el de Discogs tal cual). Solo se muestra: al tag va el estilo. */
const GENRES: Record<string, string> = {
  Electronic: 'Electrónica', Latin: 'Latina', Rock: 'Rock', Pop: 'Pop', 'Hip Hop': 'Hip hop', 'Funk / Soul': 'Funk / Soul',
  Jazz: 'Jazz', Classical: 'Clásica', Reggae: 'Reggae', Blues: 'Blues', 'Folk, World, & Country': 'Folclore y del mundo',
  'Stage & Screen': 'Cine y TV', 'Non-Music': 'No es música', "Children's": 'Infantil', 'Brass & Military': 'Bandas',
}

export interface SoundStyle { style: string; genre: string; p: number }

/** El estilo que se sugiere ("Latin---Reggaeton" → Reggaeton, Latina), solo si el modelo está muy seguro. */
export function soundStyle(styles: [string, number][] | null | undefined, sure = STYLE_SURE): SoundStyle | null {
  const top = styles?.[0]
  if (!top || top[1] < sure) return null
  const [g, s] = top[0].split('---')
  return { style: s ?? g, genre: idioma() === 'en' ? g : GENRES[g] ?? g, p: top[1] }
}
