// Tempo a partir de dónde cae cada golpe: más fino que contar en cuadros de 10–20 ms (que da BPM "en escalones", por
// ejemplo 140,1 o 172,3 cuando el tema va a 139 o a 174). Lo usan el BPM de degara y Beat This!.

/**
 * BPM de una lista de golpes (en segundos). La mediana de los intervalos elige el tempo; para afinarlo se toman los
 * tramos de golpes seguidos con ese intervalo (±12 %) y se divide lo que duran por cuántos golpes tienen. null si hay
 * muy pocos golpes parejos.
 */
export function tempoFromBeats(beats: ArrayLike<number>): number | null {
  const b = Array.from(beats).filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  const gaps = b.slice(1).map((x, i) => x - b[i]).filter((x) => x > 0.2 && x < 2)
  if (gaps.length < 8) return null
  const ioi = [...gaps].sort((x, y) => x - y)[gaps.length >> 1]
  let span = 0, count = 0, from = 0
  for (let i = 1; i <= b.length; i++) {
    const ok = i < b.length && Math.abs(b[i] - b[i - 1] - ioi) < ioi * 0.12
    if (!ok) { if (i - 1 - from >= 4) { span += b[i - 1] - b[from]; count += i - 1 - from } from = i }
  }
  return Math.round((60 / (count ? span / count : ioi)) * 10) / 10
}
