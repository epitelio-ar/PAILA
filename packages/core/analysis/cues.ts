// Cue points sugeridos (Fase F): con la energía de cada compás, dónde arranca el tema, dónde entra todo (el "drop"), dónde
// baja (el "break", antes o después del drop) y dónde empieza la salida, siempre al principio de una frase de 8 compases. Puro, sin audio.

export type CueRole = 'inicio' | 'drop' | 'break' | 'salida'

export interface CueSuggestion { role: CueRole; time: number; bar: number }

/** Como los llama Rekordbox (decidido el 22/10). */
export const CUE_NAMES: Record<CueRole, string> = { inicio: 'Intro', drop: 'Drop', break: 'Break', salida: 'Outro' }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * `bars`: energía de cada compás (0–1), `firstBar`: dónde empieza el primer compás (s), `barLen`: cuánto dura (s).
 * Las frases van de 8 en 8 compases desde el primero. Un cambio cuenta si las 8 que siguen tienen al menos 35 % más (o
 * menos) energía que las 8 de antes. Temas de menos de 24 compases: solo el inicio.
 */
export function suggestCues(bars: number[], firstBar: number, barLen: number): CueSuggestion[] {
  const at = (bar: number, role: CueRole): CueSuggestion => ({ role, bar, time: Math.round((firstBar + bar * barLen) * 1000) / 1000 })
  // el inicio: el primer compás que suena (salta el silencio del principio)
  const startBar = Math.max(0, bars.findIndex((e) => e > 0.05))
  const out: CueSuggestion[] = [at(startBar, 'inicio')]
  if (bars.length < 24) return out
  const top = Math.max(...bars)
  let drop: number | null = null
  for (let b = 8; b + 8 <= bars.length; b += 8) {
    const before = mean(bars.slice(b - 8, b)), after = mean(bars.slice(b, b + 8))
    if (after > before * 1.35 && after > 0.7 * top) { drop = b; break }
  }
  if (drop != null && drop > startBar) out.push(at(drop, 'drop'))
  // el break: la primera frase donde baja fuerte, antes o después del drop (hay temas que arrancan con todo y paran)
  for (let b = Math.max(16, startBar + 8); b + 8 <= bars.length - 8; b += 8) {
    const before = mean(bars.slice(b - 8, b)), after = mean(bars.slice(b, b + 8))
    if (after < before * 0.65 && before > 0.6 * top) { out.push(at(b, 'break')); break }
  }
  out.sort((x, y) => x.bar - y.bar)
  // la salida: la última frase desde la que la energía ya no vuelve a subir al nivel del tema (o 32 compases antes del final)
  const body = mean(bars.slice(startBar))
  let outBar = Math.max(startBar + 8, Math.floor((bars.length - 32) / 8) * 8)
  for (let b = Math.floor((bars.length - 8) / 8) * 8; b >= 16; b -= 8) {
    if (mean(bars.slice(b - 8, b)) >= body * 0.9) { outBar = b; break }
  }
  if (outBar < bars.length - 4 && !out.some((c) => c.bar === outBar)) out.push(at(outBar, 'salida'))
  return out
}
