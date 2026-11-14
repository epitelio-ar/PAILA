// Energía del 1 al 10 (MASTERPLAN-3, punto 3): con lo que ya guarda el análisis (volumen, cuánto varía, bailable, tempo y
// brillo del espectro) y, si está el modelo de estilos (core/analysis/effnet.ts), con lo que oye: agresivo, tranquilo, de
// fiesta. Los pesos salen de temas marcados a mano (`fitEnergy`, mínimos cuadrados con freno); sin marcas, los de fábrica.
// Puro: no lee la base.

/** Lo que hace falta de un análisis (columnas de `analysis`). */
export interface EnergyRow { lufs: number | null; lra: number | null; danceability: number | null; bpm: number | null; spectrum: string | number[] | null }

/** Lo que dijo el modelo de estilos (0–1): agresivo, tranquilo, de fiesta, bailable, "engagement". */
export type EnergyMoods = Partial<Record<'mood_aggressive' | 'mood_relaxed' | 'mood_party' | 'danceability' | 'engagement_regression', number>>

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

/** El tempo en una sola octava (lo que se siente: un 70 de reggaetón es un 140 a medias). */
const feltTempo = (bpm: number | null) => { if (!bpm) return 0.5; let b = bpm; while (b < 80) b *= 2; while (b > 160) b /= 2; return clamp((b - 80) / 80) }

/**
 * Brillo: cuánto suenan los agudos (2–8 kHz) contra los medios graves (170 Hz–1 kHz), con el espectro promedio del
 * análisis (128 bandas de ~172 Hz, en dB).
 */
function brightness(spectrum: EnergyRow['spectrum']): number {
  let s: number[] | null = null
  try { s = typeof spectrum === 'string' ? JSON.parse(spectrum) : spectrum } catch { s = null }
  if (!s || s.length < 50) return 0.5
  return clamp((mean(s.slice(12, 47)) - mean(s.slice(1, 6)) + 30) / 30)
}

/** Las señales de un tema, entre 0 y 1. Sin el modelo de estilos, solo las de la base. */
export function energyFeatures(r: EnergyRow, moods?: EnergyMoods): number[] {
  const base = [
    r.lufs == null ? 0.5 : clamp((r.lufs + 20) / 14), // volumen
    r.lra == null ? 0.3 : clamp(r.lra / 15), // cuánto cambia el volumen (lo dinámico suele ser más tranquilo)
    r.danceability == null ? 0.5 : clamp((r.danceability - 0.8) / 1.4),
    feltTempo(r.bpm),
    brightness(r.spectrum),
  ]
  if (!moods) return base
  return [...base, moods.mood_aggressive ?? 0.3, moods.mood_relaxed ?? 0.5, moods.mood_party ?? 0.3, moods.danceability ?? 0.5, moods.engagement_regression ?? 0.7]
}

/**
 * Lo que sale de calibrar: `w` = la base y un peso por señal; como los mínimos cuadrados amontonan todo en el medio,
 * después se estira alrededor de `mid` (×`k`) para que use la escala como la usan las marcas.
 */
export interface EnergyModel { w: number[]; mid: number; k: number }

/** Ajusta los pesos a temas marcados (mínimos cuadrados con un freno chico para que no se dispare con pocas marcas). */
export function fitEnergy(feats: number[][], truth: number[], lambda = 0.5): EnergyModel {
  const n = (feats[0]?.length ?? 0) + 1
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0)
  feats.forEach((f, i) => {
    const x = [1, ...f]
    for (let r = 0; r < n; r++) { b[r] += x[r] * truth[i]; for (let c = 0; c < n; c++) A[r][c] += x[r] * x[c] }
  })
  for (let r = 1; r < n; r++) A[r][r] += lambda
  // Gauss con pivote
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]
    if (Math.abs(A[c][c]) < 1e-12) continue
    for (let r = 0; r < n; r++) if (r !== c) { const m = A[r][c] / A[c][c]; for (let j = c; j < n; j++) A[r][j] -= m * A[c][j]; b[r] -= m * b[c] }
  }
  const w = b.map((x, i) => (Math.abs(A[i][i]) < 1e-12 ? 0 : Math.round((x / A[i][i]) * 1000) / 1000))
  const raw = feats.map((f) => rawEnergy(f, w))
  const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) }
  // a medias: estirar del todo agranda el error de los que el modelo no entiende
  const k = sd(raw) > 1e-6 ? 1 + (Math.min(2.5, sd(truth) / sd(raw)) - 1) / 2 : 1
  return { w, mid: Math.round(mean(truth) * 1000) / 1000, k: Math.round(k * 1000) / 1000 }
}

const rawEnergy = (feats: number[], w: number[]) => feats.reduce((e, f, i) => e + (w[i + 1] ?? 0) * f, w[0] ?? 5)

/** La energía (1–10) de un tema con un modelo calibrado. */
export function energyFrom(feats: number[], m: EnergyModel): number {
  const e = m.mid + (rawEnergy(feats, m.w) - m.mid) * m.k
  return Math.max(1, Math.min(10, Math.round(e)))
}

/**
 * La energía con lo que oye el modelo de estilos, de fábrica: ajustada el 23/10 a 83 temas de la Música puntuados uno por uno
 * (provisorio hasta que la persona marque los suyos). Dejando uno afuera acierta a ±1 en el 83 % (la de volumen, bailable
 * y tempo: 69 %) (docs/pruebas/2026-10-23-partes-energia-estilo.md).
 */
export const SOUND_MODEL: EnergyModel = { w: [3.496, 0.396, -0.419, 0.47, 0.468, -0.158, 0.581, -1.696, 0.261, 0.582, 2.588], mid: 6.289, k: 1.147 }

/** Lo calibrado con las marcas de la persona (setting `energy_model`): con y sin el modelo de estilos. */
export interface EnergyCalibration { base?: EnergyModel; sound?: EnergyModel; marks: number; at: string }

/** Energía orientativa de 1 a 10 sin calibrar: volumen percibido, bailabilidad y tempo (la de siempre, de core/analysis/dj.ts). */
export function energyOf(lufs: number | null, danceability: number | null, bpm: number | null): number | null {
  if (lufs == null) return null
  const norm = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))
  const e = 0.5 * norm(lufs, -20, -6) + 0.3 * norm(danceability ?? 1, 0.8, 2.2) + 0.2 * norm(bpm ?? 110, 80, 140)
  return Math.max(1, Math.min(10, Math.round(1 + e * 9)))
}

/** La energía de un tema: con lo que oyó el modelo si está, si no con lo calibrado de la base, si no la de siempre. */
export function trackEnergy(r: EnergyRow, moods: EnergyMoods | null | undefined, cal: EnergyCalibration | null): number | null {
  if (r.lufs == null) return null
  if (moods) return energyFrom(energyFeatures(r, moods), cal?.sound ?? SOUND_MODEL)
  if (cal?.base) return energyFrom(energyFeatures(r), cal.base)
  return energyOf(r.lufs, r.danceability, r.bpm)
}
