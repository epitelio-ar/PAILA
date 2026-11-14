// Tests de las partes del tema (MASTERPLAN-3, punto 3; core/analysis/partes.ts): con un tema armado compás por compás
// (intro sin bombo, drop, break sin bombo, vuelta a pleno y salida), dónde caen el inicio, el drop, el break y la salida.
import { describe, expect, it } from 'vitest'
import { songParts, type BarBands } from '@paila/core/analysis/partes'

const bar = (low: number, mid: number, high: number): BarBands => ({ low, mid, high, all: low + mid + high })
const FULL = bar(1, 0.5, 0.2), NOKICK = bar(0.01, 0.4, 0.15), QUIET = bar(0.001, 0.05, 0.02), SILENT = bar(0, 0, 0)
const song = (...parts: [BarBands, number][]) => parts.flatMap(([b, n]) => Array.from({ length: n }, () => ({ ...b })))
const roles = (bars: BarBands[]) => Object.fromEntries(songParts(bars, 0, 2).map((p) => [p.role, p.bar]))

describe('partes del tema', () => {
  it('un tema de pista: intro, drop, break, vuelta y salida, en el compás donde cambia', () => {
    expect(roles(song([NOKICK, 16], [FULL, 32], [NOKICK, 16], [FULL, 32], [QUIET, 16]))).toEqual({ inicio: 0, drop: 16, break: 48, salida: 96 })
  })
  it('el silencio del principio no es el inicio', () => {
    expect(roles(song([SILENT, 2], [NOKICK, 16], [FULL, 40]))).toMatchObject({ inicio: 2, drop: 18 })
  })
  it('el corte cae donde cambia de verdad aunque no sea múltiplo de 8 (Gypsy Woman entra en el compás 20)', () => {
    expect(roles(song([NOKICK, 20], [FULL, 48]))).toMatchObject({ drop: 20 })
  })
  it('un tema a pleno hasta el final igual tiene salida, 16 compases antes', () => {
    const r = roles(song([NOKICK, 8], [FULL, 56]))
    expect(r.salida).toBeLessThanOrEqual(64 - 16)
    expect(r.salida).toBeGreaterThan(r.drop)
  })
  it('un tema corto o sin cambios: solo el inicio', () => {
    expect(roles(song([FULL, 20]))).toEqual({ inicio: 0 })
    expect(songParts([], 0, 2)).toEqual([])
  })
})
