// Test de memoria del BPM y el tono (core/analysis/dj.ts): Essentia no puede dejar memoria ocupada tema tras tema.
// El 20/10/2026 cada tema dejaba ~60 MB en el worker y a los ~30 temas reventaba ("JS heap out of memory").
import { describe, expect, it } from 'vitest'
import { analyzeDj } from '@paila/core/analysis/dj'

describe('BPM y tono sin pérdida de memoria', () => {
  it('analizar 10 temas no deja la memoria creciendo', () => {
    // 100 s de un pulso a ~120 BPM
    const mono = new Float32Array(44100 * 100).map((_, i) => Math.sin(i / 20) * (i % 22050 < 2000 ? 1 : 0.1))
    const first = analyzeDj(mono)
    const before = process.memoryUsage().rss
    for (let i = 0; i < 10; i++) expect(analyzeDj(mono)).toEqual(first) // con la pérdida, 10 temas ya eran ~600 MB
    const grew = (process.memoryUsage().rss - before) / 1e6
    expect(grew).toBeLessThan(200) // con la pérdida eran ~600 MB (20 temas: ~1.300 MB)
    expect(first.bpm).toBeGreaterThan(100)
  }, 300_000)
})
