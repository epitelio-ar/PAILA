// Lo común de la grilla (core/analysis/grid.ts y gridbars.ts): los tipos que van a Rekordbox y las cuentas chicas. Puro.

/** Un tramo de la grilla, como el TEMPO de rekordbox.xml: desde `start` (segundos) los golpes van cada 60/bpm; `beat` = 1–4. */
export interface GridSegment { start: number; bpm: number; beat: number }

export interface Grid {
  /** BPM de la grilla (con 2 decimales, como Rekordbox). */
  bpm: number
  /** Tramos (uno solo si el tempo es parejo). */
  segments: GridSegment[]
  /** Cuánto se apartan los golpes de la grilla (mediana, en milisegundos): bajo = grilla firme. */
  errorMs: number
  /** El tempo cambia (tocado en vivo, temas viejos): la grilla va compás por compás. */
  variable: boolean
  /** Cuánto se corre una grilla recta en los tramos de 4 compases (el 75 % de los tramos se corre menos; ms). */
  driftMs?: number
}

export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0 }
export const round3 = (x: number) => Math.round(x * 1000) / 1000

/** Ajuste por mínimos cuadrados de t = a + b·k. */
export function fitLine(ks: number[], ts: number[]): { a: number; b: number } {
  const n = ks.length
  const mk = ks.reduce((s, x) => s + x, 0) / n, mt = ts.reduce((s, x) => s + x, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (ks[i] - mk) * (ts[i] - mt); den += (ks[i] - mk) ** 2 }
  const b = den ? num / den : 0
  return { a: mt - b * mk, b }
}
