// Partes del tema (MASTERPLAN-3, punto 3): con la energía de cada compás en tres bandas (graves = bombo y bajo, medios y
// agudos), dónde arranca de verdad, dónde explota, dónde baja y dónde empieza a terminar. Mira frases de 4 y 8 compases y
// sobre todo los graves: en lo que se baila, el break es cuando se va el bombo. Puro, sin audio.

/** Lo que suena en un compás: potencia media (lineal) de todo y de cada banda. */
export interface BarBands { all: number; low: number; mid: number; high: number }

export type PartRole = 'inicio' | 'drop' | 'break' | 'salida'
export interface Part { role: PartRole; bar: number; time: number }

const db = (x: number) => 10 * Math.log10(x + 1e-12)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0 }

/** Cada compás en dB debajo de lo más fuerte del tema (el percentil 95 de cada banda), con un piso de −40. */
function relative(bars: BarBands[]) {
  const keys = ['all', 'low', 'mid', 'high'] as const
  const out = keys.map((k) => {
    const v = bars.map((b) => db(b[k]))
    const top = pct(v, 0.95)
    return v.map((x) => Math.max(-40, x - top))
  })
  return { all: out[0], low: out[1], mid: out[2], high: out[3] }
}

/**
 * Las partes de un tema. `bars`: lo que suena en cada compás desde `firstBar` (s), cada `barLen` (s). Devuelve el inicio
 * siempre (si suena algo) y, en temas de 32 compases o más, el drop, el break y la salida cuando se distinguen.
 */
export function songParts(bars: BarBands[], firstBar: number, barLen: number): Part[] {
  const at = (bar: number, role: PartRole): Part => ({ role, bar, time: Math.round((firstBar + bar * barLen) * 1000) / 1000 })
  if (!bars.length) return []
  const r = relative(bars)
  // intensidad de cada compás: sobre todo graves (bombo y bajo) y el volumen de todo
  const inten = bars.map((_, i) => 0.5 * r.low[i] + 0.35 * r.all[i] + 0.15 * r.high[i])
  const start = Math.max(0, r.all.findIndex((x) => x > -30))
  const out: Part[] = [at(start, 'inicio')]
  const n = bars.length
  if (n - start < 32) return out
  // fin real: el último compás que suena
  let last = n - 1
  while (last > start && r.all[last] <= -30) last--
  const body = inten.slice(start, last + 1)
  const full = pct(body, 0.8) // "a pleno": lo que suena el 20 % más fuerte del tema
  const win = (a: number, b: number, xs: number[]) => mean(xs.slice(Math.max(start, a), Math.min(last + 1, b)))
  // los cambios se buscan cada 4 compases contados desde el inicio
  const step = 4
  const cands: number[] = []
  for (let b = start + 8; b + 8 <= last + 1; b += step) cands.push(b)
  // de un cambio que ya pasó el umbral, el punto donde el cambio es más fuerte (4 compases más adelante, si ahí cambia más):
  // así el corte cae donde de verdad entra o se va el bombo y no una frase de 4 antes
  const sharpest = (b: number, score: (x: number) => number) => { while (cands.includes(b + step) && score(b + step) > score(b)) b += step; return b }
  // drop: el primer cambio a pleno (las 8 que siguen cerca del tope) que sube fuerte desde las 8 de antes, sobre todo en graves
  const upScore = (b: number) => win(b, b + 8, inten) - win(b - 8, b, inten) + (win(b, b + 8, r.low) - win(b - 8, b, r.low)) / 2
  let drop: number | null = null
  for (const b of cands) {
    const up = win(b, b + 8, inten) - win(b - 8, b, inten), upLow = win(b, b + 8, r.low) - win(b - 8, b, r.low)
    if (win(b, b + 8, inten) >= full - 2 && (up >= 3 || upLow >= 6)) { drop = sharpest(b, upScore); break }
  }
  if (drop != null) out.push(at(drop, 'drop'))
  // break: después de algo a pleno, donde baja fuerte (se va el bombo) y más adelante vuelve
  const downScore = (b: number) => win(b - 8, b, inten) - win(b, b + 8, inten) + (win(b - 8, b, r.low) - win(b, b + 8, r.low)) / 2
  const from = drop ?? start + 16
  for (const b of cands) {
    if (b <= from) continue
    const before = win(b - 8, b, inten), after = win(b, b + 8, inten)
    const downLow = win(b - 8, b, r.low) - win(b, b + 8, r.low)
    const comesBack = Math.max(...cands.filter((c) => c >= b + 8).map((c) => win(c, c + 8, inten)), -99) >= full - 2
    if (before >= full - 3 && (before - after >= 4 || downLow >= 8) && comesBack) { out.push(at(sharpest(b, downScore), 'break')); break }
  }
  // salida: desde dónde ya no vuelve a pleno (la última frase de 8 a pleno termina ahí). Si el tema sigue a pleno hasta el
  // final, la frase de 8 que empieza al menos 16 compases antes del final: por ahí se empieza a mezclar el que sigue.
  let outBar: number | null = null
  for (let b = Math.floor((last + 1 - start) / step) * step + start; b >= start + 16; b -= step) {
    if (win(b - 8, b, inten) >= full - 2) { outBar = b; break }
  }
  if (outBar == null || outBar > last - 8) outBar = start + Math.floor((last + 1 - 16 - start) / 8) * 8
  if (outBar > (drop ?? start) && !out.some((p) => p.bar === outBar)) out.push(at(outBar, 'salida'))
  return out.sort((a, b) => a.bar - b.bar)
}
