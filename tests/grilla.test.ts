// Tests de la grilla y los cues sugeridos (core/analysis/grid.ts, cues.ts, beatthis.ts): golpes sintéticos, sin audio.
import { describe, expect, it } from 'vitest'
import { fitGrid, gridBeats, nearestBeat, shiftGrid } from '@paila/core/analysis/grid'
import { suggestCues } from '@paila/core/analysis/cues'
import { beatThisWindows } from '@paila/core/analysis/beatthis'

/** Golpes cada 60/bpm desde `start`, con un poco de temblor y algunos que faltan o sobran. */
function beats(bpm: number, start: number, seconds: number, opts: { jitter?: number; dropEvery?: number; extraEvery?: number } = {}): number[] {
  const p = 60 / bpm, out: number[] = []
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5 }
  for (let k = 0; start + k * p < seconds; k++) {
    if (opts.dropEvery && k % opts.dropEvery === 3) continue
    out.push(start + k * p + (opts.jitter ?? 0) * rnd())
    if (opts.extraEvery && k % opts.extraEvery === 5) out.push(start + (k + 0.5) * p) // un contratiempo suelto
  }
  return out
}

describe('grilla', () => {
  it('un tema a 126 BPM parejo da 126,00 y cae en el lugar, aunque falten y sobren golpes', () => {
    const g = fitGrid(beats(126, 0.3, 240, { jitter: 0.012, dropEvery: 9, extraEvery: 17 }))!
    expect(g.bpm).toBe(126)
    expect(g.variable).toBe(false)
    expect(g.segments).toHaveLength(1)
    const p = 60 / 126
    // en cualquier momento del tema la grilla queda a menos de 3 ms de un golpe real
    for (const t of [10, 100, 230]) expect(Math.abs(nearestBeat(g.segments, 0.3 + Math.round((t - 0.3) / p) * p)!.offset)).toBeLessThan(0.003)
  })

  it('un BPM que no es redondo (123,57) no se redondea', () => {
    const g = fitGrid(beats(123.57, 0.1, 200, { jitter: 0.004 }))!
    expect(Math.abs(g.bpm - 123.57)).toBeLessThan(0.02)
  })

  it('corrige la demora del detector', () => {
    const g = fitGrid(beats(120, 1, 120).map((x) => x + 0.005), { latency: 0.005 })!
    expect(Math.abs(nearestBeat(g.segments, 1)!.offset)).toBeLessThan(0.001)
  })

  it('si el bombo cae en el medio, la grilla se corre medio golpe (el detector siguió el contratiempo)', () => {
    const p = 60 / 124
    const offbeats = beats(124, 0.2 + p / 2, 180) // el detector marcó los hi-hats
    const kick = (t: number) => (Math.abs(((t - 0.2) / p) - Math.round((t - 0.2) / p)) < 0.02 ? 1 : 0)
    const g = fitGrid(offbeats, { bassAt: kick })!
    expect(Math.abs(nearestBeat(g.segments, 0.2 + 40 * p)!.offset)).toBeLessThan(0.002)
  })

  it('el 1 del compás sale de los primeros de compás de Beat This!', () => {
    const p = 0.5
    const b = beats(120, 0, 120)
    const g = fitGrid(b, { downbeats: b.filter((_, i) => i % 4 === 2) })!
    const at = gridBeats(g.segments, 0, 10)
    expect(at.find((x) => Math.abs(x.time - 2 * p) < 0.01)!.beat).toBe(1)
    expect(at.find((x) => Math.abs(x.time - 3 * p) < 0.01)!.beat).toBe(2)
  })

  it('el 1 del compás sin Beat This!: donde sube la energía al empezar una frase', () => {
    const p = 0.5, b = beats(120, 0, 128)
    // energía que sube cada 32 golpes, empezando en el golpe 1 (índice 1, 33, 65…)
    const energy = (t: number) => { const k = Math.round(t / p); return 1 + Math.floor((k - 1) / 32) % 2 }
    const g = fitGrid(b, { beatEnergy: energy })!
    expect(gridBeats(g.segments, 0, 2).find((x) => Math.abs(x.time - p) < 0.01)!.beat).toBe(1)
  })

  it('un tema tocado en vivo (tempo que se mueve) va compás por compás', () => {
    const out: number[] = []
    let t = 0.5
    for (let k = 0; k < 400; k++) { out.push(t); t += 60 / (96 + 8 * Math.sin(k / 40)) }
    const g = fitGrid(out)!
    expect(g.variable).toBe(true)
    expect(g.segments.length).toBeGreaterThan(50)
    expect(g.segments.every((s) => s.beat === 1)).toBe(true)
  })

  it('con muy pocos golpes no inventa grilla', () => { expect(fitGrid([1, 1.5, 2])).toBeNull() })

  it('correr la grilla (desfase de los MP3) suma a cada tramo', () => {
    expect(shiftGrid([{ start: 0.1, bpm: 120, beat: 1 }], 0.0251)).toEqual([{ start: 0.125, bpm: 120, beat: 1 }])
  })
})

describe('cues sugeridos', () => {
  it('marca inicio, entra todo, break y salida en principios de frase', () => {
    // intro baja 16 compases, todo 32, break 16, todo 32, salida baja 16
    const bars = [...Array(16).fill(0.4), ...Array(32).fill(1), ...Array(16).fill(0.3), ...Array(32).fill(1), ...Array(16).fill(0.35)]
    const c = suggestCues(bars, 0.5, 2)
    expect(c.map((x) => [x.role, x.bar])).toEqual([['inicio', 0], ['drop', 16], ['break', 48], ['salida', 96]])
    expect(c[1].time).toBe(32.5)
  })

  it('salta el silencio del principio', () => {
    const c = suggestCues([0, 0, ...Array(30).fill(0.8)], 0, 2)
    expect(c[0]).toMatchObject({ role: 'inicio', bar: 2 })
  })
})

describe('pedazos de Beat This!', () => {
  it('reparte los pedazos de 29,5 s hasta el 80 % del tema', () => {
    expect(beatThisWindows(20)).toEqual([[0, 20]])
    expect(beatThisWindows(300, 2)).toEqual([[0, 29.5], [210.5, 29.5]])
    expect(beatThisWindows(300, 3).map((w) => w[0])).toEqual([0, 105.3, 210.5])
  })
})

// Errores de la corrida supervisada del 21/10 (docs/archivo/pruebas/2026-10-21-rekordbox-pro.md), uno por test.
describe('corrida supervisada 21/10', () => {
  it('"Sld" (125 BPM parejo): golpes de 3 pedazos con un arranque raro no dan una grilla "variable" con saltos', () => {
    const p = 60 / 125
    // 3 pedazos de Beat This! (en cuadros de 20 ms); el primero con golpes de más en la intro
    const q = (x: number) => Math.round(x * 50) / 50
    const win = (from: number) => Array.from({ length: 61 }, (_, i) => q(3.85 + Math.ceil((from - 3.85) / p) * p + i * p))
    const intro = Array.from({ length: 40 }, (_, i) => q(0.3 + i * 0.37))
    const g = fitGrid([...intro, ...win(4), ...win(157), ...win(314)], { sparse: true })!
    expect(g.variable).toBe(false)
    expect(g.bpm).toBe(125)
  })

  it('una grilla compás por compás no salta por el temblor de cada golpe (cuadros de 20 ms)', () => {
    const q = (x: number) => Math.round(x * 50) / 50
    const out: number[] = []
    let t = 0.5
    for (let k = 0; k < 400; k++) { out.push(q(t)); t += 60 / (100 + 6 * Math.sin(k / 50)) }
    const g = fitGrid(out)!
    expect(g.variable).toBe(true)
    // entre compases vecinos el BPM cambia poco: lo que cambia el tempo de verdad (hasta ~0,5) y no más (antes saltaba ±1,3)
    const jumps = g.segments.slice(1).map((s, i) => Math.abs(s.bpm - g.segments[i].bpm))
    expect(Math.max(...jumps)).toBeLessThan(0.8)
  })

  it('"Sorry": el break que está antes del "entra todo" también se marca', () => {
    // todo arriba 88 compases, break 24, vuelve todo, salida
    const bars = [...Array(88).fill(0.95), ...Array(24).fill(0.4), ...Array(104).fill(1), ...Array(8).fill(0.1)]
    const c = suggestCues(bars, 0, 1.9)
    expect(c.map((x) => [x.role, x.bar])).toEqual([['inicio', 0], ['break', 88], ['drop', 112], ['salida', 216]])
  })
})
