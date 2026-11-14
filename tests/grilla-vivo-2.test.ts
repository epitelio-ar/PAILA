// Tests del 1 del compás en los temas tocados muy sueltos (masterplan 3, punto 3; docs/pruebas/2026-10-22-silencios-y-grillas.md),
// con los golpes reales que marcó Beat This! (tests/fixtures/grilla). "Firme": los primeros de compás de Beat This! con el compás
// de antes y el de después del mismo largo; donde Beat This! duda (público, intros libres), no sirve de referencia.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fitGrid, gridBeats, nearestBeat, type Grid } from '@paila/core/analysis/grid'
import { piecesDisagree, runsOfThree, tempoJump } from '@paila/core/analysis/gridbars'
import { BEATTHIS_LATENCY, beatThisGrid, envelopes } from '@paila/core/analysis/gridscan'
import { isPista, trackSeconds } from '@paila/core/gridrun'

interface Golpes { tema: string; dur: number; windows: [number, number][]; sparse: { beats: number[]; downbeats: number[] }; whole: { beats: number[]; downbeats: number[] } }
const golpes = (n: string): Golpes => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'grilla', `${n}.json`), 'utf8'))
/** Lo mismo que hace la app (3 pedazos y, si hace falta, el tema entero); `entero`: si escuchó el tema entero. */
const app = async (g: Golpes) => {
  const env = envelopes(new Float32Array(Math.round(g.dur * 22050)), 22050)
  let entero = false
  const grid = (await beatThisGrid(g.dur, env, g.windows, async (ws) => { if (ws !== g.windows) entero = true; return ws === g.windows ? g.sparse : g.whole }, true)).grid!
  return { grid, entero }
}
/** Qué parte de los primeros de compás firmes de Beat This! cae en un 1 de la grilla. */
function firme(g: Golpes, grid: Grid): number {
  const db = g.whole.downbeats.map((x) => x - BEATTHIS_LATENCY), bt = g.whole.beats.map((x) => x - BEATTHIS_LATENCY)
  const ones = gridBeats(grid.segments, 0, g.dur).filter((b) => b.beat === 1).map((b) => b.time)
  const len = (i: number) => bt.filter((x) => x >= db[i - 1] - 0.03 && x < db[i] - 0.03).length
  const firm = db.filter((_, i) => i > 0 && i < db.length - 1 && len(i) === len(i + 1) && (len(i) === 3 || len(i) === 4))
  return firm.filter((d) => ones.some((o) => Math.abs(o - d) < 0.07)).length / firm.length
}
/** Qué parte de los golpes de Beat This! entre dos momentos cae a menos de 40 ms de la grilla. */
const pulso = (g: Golpes, grid: Grid, from = 0, to = Infinity) => {
  const xs = g.whole.beats.map((x) => x - BEATTHIS_LATENCY).filter((x) => x >= from && x < to)
  return xs.filter((x) => Math.abs(nearestBeat(grid.segments, x)!.offset) < 0.04).length / xs.length
}

describe('los 4 temas muy sueltos (masterplan 3, punto 3)', () => {
  it('"Quiero llegar" (Santaolalla, en vivo): arranca con 95 compases de 3 y sigue en 4; el 1 cae bien en los dos (antes 43 %)', async () => {
    const g = golpes('quiero-llegar')
    const { grid } = await app(g)
    expect(firme(g, grid)).toBeGreaterThan(0.95)
    // al principio, cada tramo es un compás de 3 golpes que empieza en 1
    const [s0, s1] = grid.segments
    expect(s0.beat).toBe(1); expect(s1.beat).toBe(1)
    expect((s1.start - s0.start) / (60 / s0.bpm)).toBeCloseTo(3, 0)
  })

  it('"La Sed Verdadera" (Pescado Rabioso): a los 130 s pasa de 73 a 100 BPM y la grilla la sigue (antes se quedaba en 74)', async () => {
    const g = golpes('sed-verdadera')
    const { grid } = await app(g)
    expect(pulso(g, grid, 140, 160)).toBeGreaterThan(0.4) // antes 0,15
    expect(grid.segments.filter((s) => s.start > 145).every((s) => s.bpm > 90)).toBe(true)
  })

  it('"Pura suerte" (en vivo, Obras 1991): Beat This! se pasa medio golpe al contratiempo y la grilla de alrededor no se tuerce', async () => {
    const g = golpes('pura-suerte')
    const { grid } = await app(g)
    // antes, entre los 79 y los 89 s había tramos a 96, 97, 105 y 106 BPM para "unir" el corrimiento (hasta 240 ms afuera)
    const near = grid.segments.filter((s) => s.start > 79 && s.start < 89)
    expect(near.every((s) => Math.abs(s.bpm - 101) < 2)).toBe(true)
    expect(firme(g, grid)).toBeGreaterThan(0.95)
  })

  it('"Roadhouse blues" (en vivo, Obras 1989): donde Beat This! marca compases parejos, el 1 cae bien', async () => {
    const g = golpes('roadhouse')
    expect(firme(g, (await app(g)).grid)).toBeGreaterThan(0.97)
  })
})

describe('grilla recta con el 1 que se corre', () => {
  it('"Juguetes perdidos" (en vivo, parejo): en los pedazos el 1 cae en otro golpe, así que se escucha entero y la grilla recta lleva puntos donde el 1 se corre (antes 60 %)', async () => {
    const g = golpes('juguetes')
    expect(fitGrid(g.sparse.beats, { downbeats: g.sparse.downbeats, latency: BEATTHIS_LATENCY, sparse: true })).toBeNull()
    const { grid, entero } = await app(g)
    expect(entero).toBe(true)
    expect(grid.variable).toBe(false)
    expect(grid.segments.length).toBeGreaterThan(2)
    expect(new Set(grid.segments.map((s) => s.bpm)).size).toBe(1) // el mismo BPM: solo vuelve a empezar en 1
    expect(firme(g, grid)).toBeGreaterThan(0.95)
  })

  it('"Andrea" (Pibes Chorros, BPM redondo): se escucha entero y gana el 1 de la mayor parte del tema, sin puntos extra', async () => {
    const g = golpes('andrea')
    const { grid, entero } = await app(g)
    expect(entero).toBe(true)
    expect(grid.segments).toHaveLength(1)
    expect(firme(g, grid)).toBeGreaterThan(0.55) // antes 42 %: ganaba el de los pedazos
  })

  it('lo electrónico y lo parejo sigue igual: un solo punto, sin escuchar entero', async () => {
    for (const n of ['trigonometry', 'pogo', 'astilleros']) {
      const { grid, entero } = await app(golpes(n))
      expect(entero).toBe(false)
      expect(grid.segments).toHaveLength(1)
    }
  })
})

describe('cuánto tarda (medido el 22/10 con la placa de video: 40 temas en 718 s; la cuenta de antes daba 393 s)', () => {
  it('lo de pista casi nunca se escucha entero; el rock y lo en vivo, casi siempre', () => {
    expect(isPista('Techno', 'x/tema.mp3')).toBe(true)
    expect(isPista(null, 'Electronica/House/1.Afro House/tema.wav')).toBe(true)
    expect(isPista('Rock', 'Rock/La Renga/tema.mp3')).toBe(false)
    expect(isPista(null, 'Patricio Rey/Recitales/tema.flac')).toBe(false)
    // un tema de 5 minutos: unos 12 s si es de pista, unos 21 s si no (antes: 10,5 s para los dos)
    expect(trackSeconds('gpu', 5, true)).toBeCloseTo(12.2, 0)
    expect(trackSeconds('gpu', 5, false)).toBeCloseTo(20.95, 0)
    // con el procesador no se escucha entero: no cambia
    expect(trackSeconds('cpu', 5, false)).toBe(trackSeconds('cpu', 5, true))
  })
})

describe('las reglas, sin audio', () => {
  it('compases de 3: desde 8 seguidos (o de 6, uno que Beat This! no marcó); menos es un tropiezo', () => {
    expect(runsOfThree([0, 3, 6, 9, 15, 18, 21, 24, 27, 31, 35])).toEqual([{ from: 0, to: 27 }])
    expect(runsOfThree([0, 3, 6, 9, 13, 16, 19, 23])).toEqual([])
  })
  it('cambio de tempo: golpes parejos a otro tempo; el doble o la mitad no cuentan', () => {
    const at = (gap: number) => Array.from({ length: 12 }, (_, i) => i * gap)
    expect(tempoJump(at(0.6), 11, 0.82)).toBeCloseTo(0.6, 2)
    expect(tempoJump(at(0.41), 11, 0.82)).toBeNull() // la mitad: Beat This! marcando corcheas
    expect(tempoJump(at(0.8), 11, 0.82)).toBeNull() // el mismo tempo
  })
  it('pedazos que no están de acuerdo en el 1', () => {
    const b = 0.5
    const piece = (from: number, ph: number) => Array.from({ length: 8 }, (_, i) => from + (ph + i * 4) * b)
    expect(piecesDisagree([...piece(0, 0), ...piece(60, 0)], 0, b)).toBe(false)
    expect(piecesDisagree([...piece(0, 0), ...piece(60, 2)], 0, b)).toBe(true)
  })
})
