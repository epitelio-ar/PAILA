// BPM, tono y energía. Usa Essentia (essentia.js, AGPL) en WebAssembly.
import { createRequire } from 'node:module'
import { foldBpm } from './bpmrange'
import { tempoFromBeats } from './beats'

const require = createRequire(import.meta.url)

interface EssentiaLike {
  arrayToVector(a: Float32Array): unknown
  vectorToArray(v: unknown): Float32Array
  RhythmExtractor2013(v: unknown, maxTempo: number, method: string, minTempo: number): { bpm: number; ticks: unknown }
  PercivalBpmEstimator(v: unknown, frameSize: number, frameSizeOSS: number, hopSize: number, hopSizeOSS: number, maxBPM: number, minBPM: number, sampleRate: number): { bpm: number }
  KeyExtractor(v: unknown, avgDetuning: boolean, frameSize: number, hopSize: number, hpcpSize: number, maxFreq: number,
    maxPeaks: number, minFreq: number, pcpThreshold: number, profile: string, sampleRate: number): { key: string; scale: string; strength: number }
  Danceability(v: unknown): { danceability: number }
}

let essentia: EssentiaLike | null = null
function getEssentia(): EssentiaLike {
  if (!essentia) {
    const lib = require('essentia.js')
    essentia = new lib.Essentia(lib.EssentiaWASM) as EssentiaLike
  }
  return essentia
}

// Rueda Camelot: la notación que usan Rekordbox y Mixed In Key para mezclar en armonía.
const CAMELOT_MINOR: Record<string, string> = { 'G#': '1A', Ab: '1A', 'D#': '2A', Eb: '2A', 'A#': '3A', Bb: '3A', F: '4A', C: '5A', G: '6A', D: '7A', A: '8A', E: '9A', B: '10A', 'F#': '11A', Gb: '11A', 'C#': '12A', Db: '12A' }
const CAMELOT_MAJOR: Record<string, string> = { B: '1B', 'F#': '2B', Gb: '2B', Db: '3B', 'C#': '3B', Ab: '4B', 'G#': '4B', Eb: '5B', 'D#': '5B', Bb: '6B', 'A#': '6B', F: '7B', C: '8B', G: '9B', D: '10B', A: '11B', E: '12B' }

function toCamelot(key: string, scale: 'major' | 'minor'): string | null {
  return (scale === 'minor' ? CAMELOT_MINOR : CAMELOT_MAJOR)[key] ?? null
}

// Llevar el BPM al rango (el clásico error de "mitad o doble"): core/analysis/bpmrange.ts, también por género.
export { foldBpm } from './bpmrange'

/** `bpmDoubtful`: los dos métodos no coinciden (ni al doble ni a la mitad); `bpmOther`: lo que dio el otro. */
export interface DjResult {
  bpm: number | null; key: string | null; camelot: string | null; keyStrength: number | null; danceability: number | null
  bpmDoubtful?: boolean; bpmOther?: number | null
}

/**
 * BPM con dos métodos de Essentia (Fase E, banco contra una colección real de Rekordbox, docs/archivo/pruebas/2026-10-20-analisis-2.md):
 * `degara` casi siempre elige bien entre el doble y la mitad, y Percival acierta más el número fino. Se toma el de Percival
 * (o su doble o mitad) que quede a menos de 6 % del de degara: 81,4 % iguales ±1 contra 79,1 % de degara solo. Si ninguno
 * queda cerca, vale degara y el tema queda como "BPM dudoso" (en esos casos se acierta solo 1 de cada 6).
 */
export function combineBpm(degara: number, percival: number | null): { bpm: number; doubtful: boolean } {
  if (!percival || !Number.isFinite(percival) || percival <= 0) return { bpm: degara, doubtful: false }
  const best = [percival, percival * 2, percival / 2].map((v) => ({ v, d: Math.abs(Math.log(v / degara)) })).sort((a, b) => a.d - b.d)[0]
  return best.d < Math.log(1.06) ? { bpm: best.v, doubtful: false } : { bpm: degara, doubtful: true }
}

// Tono: perfil "edmm" de Essentia hasta 5 kHz (62,1 % exacto contra Rekordbox; "edma" hasta 3,5 kHz, el de antes: 58,3 %).
export const KEY_PROFILE = 'edmm'
const KEY_MAX_HZ = 5000

/**
 * Libera la memoria de WebAssembly de lo que devuelve Essentia (vectores). Si no, cada tema dejaba ~60 MB ocupados en el
 * worker hasta que reventaba ("JS heap out of memory", 20/10/2026, docs/archivo/pruebas/2026-10-intensidad.md).
 */
export function free(...xs: unknown[]) {
  for (const x of xs) {
    if (!x || typeof x !== 'object') continue
    const del = (x as { delete?: () => void }).delete
    if (typeof del === 'function') { try { del.call(x) } catch { /* ya liberado */ } continue }
    for (const v of Object.values(x)) if (v && typeof v === 'object' && typeof (v as { delete?: unknown }).delete === 'function') free(v)
  }
}

/** `mono` a 44,1 kHz (alcanza con 60–120 s del medio del tema). */
export function analyzeDj(mono: Float32Array): DjResult {
  if (mono.length < 44100 * 10) return { bpm: null, key: null, camelot: null, keyStrength: null, danceability: null }
  const e = getEssentia()
  // un solo vector para todos los cálculos (la misma señal), y se libera todo al terminar
  const v = e.arrayToVector(mono)
  let rhythm: { bpm: number }, perc: { bpm: number }, k: { key: string; scale: string; strength: number }, d: { danceability: number }
  try {
    rhythm = e.RhythmExtractor2013(v, 208, 'degara', 40)
    perc = e.PercivalBpmEstimator(v, 1024, 2048, 128, 128, 210, 50, 44100)
    k = e.KeyExtractor(v, true, 4096, 4096, 12, KEY_MAX_HZ, 60, 25, 0.2, KEY_PROFILE, 44100)
    d = e.Danceability(v)
  } finally { free(v) }
  free(rhythm, perc, k, d)
  const deg = foldBpm(rhythm.bpm)
  const both = deg ? combineBpm(deg, foldBpm(perc.bpm)) : null // los dos en el rango general, como en el banco
  const bpm = both ? foldBpm(both.bpm) : 0
  const scale = k.scale === 'minor' ? 'minor' : 'major'
  return {
    bpm: bpm ? Math.round(bpm * 10) / 10 : null,
    bpmDoubtful: !!both?.doubtful,
    bpmOther: both?.doubtful && perc.bpm > 0 ? Math.round(foldBpm(perc.bpm) * 10) / 10 : null,
    key: `${k.key}${scale === 'minor' ? 'm' : ''}`,
    camelot: toCamelot(k.key, scale),
    keyStrength: Math.round(k.strength * 100) / 100,
    danceability: Math.round(d.danceability * 100) / 100,
  }
}

/** Los perfiles de tono que votan en la pasada precisa (además del de la rápida, edmm hasta 5 kHz). */
const VOTE_PROFILES: [string, number][] = [['edmm', 3500], ['edma', 3500], ['bgate', 3500]]

/** Lo que mide la pasada precisa: el tempo afinado con la posición de cada golpe y el tono con otros tres perfiles. */
export interface PreciseVotes { beatsBpm: number | null; keys: (string | null)[] }

/**
 * Segunda opinión (pasada precisa en segundo plano, MASTERPLAN-2 6.2): no cambia el BPM ni el tono, dice cuánto se
 * confía en ellos. Contra una colección real de Rekordbox: cuando el tempo de los golpes confirma, el BPM está bien 82 % de las
 * veces (si no, 20 %); cuando 3 de los 4 perfiles coinciden, el tono está bien 72 % (si no, 31 %).
 */
export function preciseVotes(mono: Float32Array): PreciseVotes {
  if (mono.length < 44100 * 10) return { beatsBpm: null, keys: [] }
  const e = getEssentia()
  const v = e.arrayToVector(mono)
  try {
    const r = e.RhythmExtractor2013(v, 208, 'degara', 40)
    const ticks = Array.from(e.vectorToArray(r.ticks))
    free(r)
    const t = tempoFromBeats(ticks)
    const keys = VOTE_PROFILES.map(([profile, hz]) => {
      const k = e.KeyExtractor(v, true, 4096, 4096, 12, hz, 60, 25, 0.2, profile, 44100)
      free(k)
      return toCamelot(k.key, k.scale === 'minor' ? 'minor' : 'major')
    })
    return { beatsBpm: t ? Math.round(foldBpm(t) * 10) / 10 : null, keys }
  } finally { free(v) }
}

/** Energía orientativa de 1 a 10 (vive en core/energia.ts, con la calibrada). */
export { energyOf } from '../energia'

/** BPM y tono escritos en el nombre de un sample ("Loop_124bpm_Am.wav", "VOCALS 130BPM CMajor"). */
export function djFromName(name: string): { bpm: number | null; key: string | null; camelot: string | null } {
  const bpmM = name.match(/(\d{2,3})\s*-?\s*bpm/i) || name.match(/bpm\s*-?\s*(\d{2,3})/i)
  const bpm = bpmM ? Number(bpmM[1]) : null
  const keyM = name.match(/(?:^|[\s_\-(\[])([A-G])\s?(#|b|sharp|flat)?\s?(maj(?:or)?|min(?:or)?|m)?(?=$|[\s_\-)\].])/i)
  let key: string | null = null, camelot: string | null = null
  if (keyM && (keyM[3] || /key/i.test(name) || bpmM)) {
    const root = keyM[1].toUpperCase() + (keyM[2] ? (/^(#|sharp)$/i.test(keyM[2]) ? '#' : 'b') : '')
    const minor = !!keyM[3] && /^m(in)?/i.test(keyM[3]) && !/^maj/i.test(keyM[3])
    key = root + (minor ? 'm' : '')
    camelot = toCamelot(root, minor ? 'minor' : 'major')
  }
  return { bpm: bpm && bpm >= 50 && bpm <= 220 ? bpm : null, key, camelot }
}
