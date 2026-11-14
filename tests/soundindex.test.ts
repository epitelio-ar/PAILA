// Tests del índice de huellas (core/soundindex.ts) con huellas sintéticas: encuentra copias con ruido y corridas, versiones
// que comparten un pedazo, temas repetitivos (techno), y no junta temas distintos. Sin audio: corre en milisegundos.
import { describe, expect, it } from 'vitest'
import { encodeFingerprint } from '@paila/core/analysis/chromaprint'
import { SoundIndex, indexParams, keysOf } from '@paila/core/soundindex'
import { alignAt, bestAlignment } from '@paila/core/soundmatch'
import { soundRelation } from '@paila/core/duplicates'

// números al azar repetibles
let seed = 7
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const u32 = () => (rnd() * 2 ** 32) >>> 0

/** Una "canción": cada cuadro cambia algunos bits del anterior (como la huella real, que cambia de a poco). */
function song(frames = 960): Uint32Array {
  const fp = new Uint32Array(frames)
  let v = u32()
  for (let i = 0; i < frames; i++) { for (let b = 0; b < 32; b++) if (rnd() < 0.12) v ^= 1 << b; fp[i] = v >>> 0 }
  return fp
}
/** Otra copia del mismo audio en peor calidad: cada bit se da vuelta con probabilidad p (los "inestables" más seguido). */
const STABLE = [3, 19, 27, 29, 31, 26, 28, 30, 2, 21, 18, 1, 15, 7, 20, 9, 25, 11, 14, 23, 0, 6, 8, 24, 5, 10, 17, 22, 13, 4, 16, 12]
function noisy(fp: Uint32Array, worst = 0.25, shift = 0): Uint32Array {
  const out = new Uint32Array(fp.length - Math.max(0, shift))
  for (let i = 0; i < out.length; i++) {
    let v = fp[i + Math.max(0, shift)]
    STABLE.forEach((b, rank) => { if (rnd() < 0.02 + (worst - 0.02) * (rank / 31)) v ^= 1 << b })
    out[i] = v >>> 0
  }
  return out
}
/** Un loop repetitivo: pocos valores distintos que se repiten (techno minimalista). */
function loop(frames = 960): Uint32Array {
  const bar = song(16)
  return Uint32Array.from({ length: frames }, (_, i) => bar[i % 16])
}

const entry = (id: number, fp: Uint32Array) => ({ id, chromaprint: encodeFingerprint(fp) })
const pairOf = (idx: SoundIndex, a: number, b: number) => idx.pairs().find((p) => {
  const x = idx.ids[p.a], y = idx.ids[p.b]
  return (x === a && y === b) || (x === b && y === a)
})

describe('índice de huellas', () => {
  it('encuentra la misma canción en otra calidad y corrida, y no junta canciones distintas', () => {
    const songs = Array.from({ length: 300 }, () => song())
    const a = songs[0]
    const entries = songs.map((s, i) => entry(i + 1, s))
    const late = noisy(a, 0.2, 12) // empieza 1,5 s después: late[i] ~ a[i + 12]
    entries.push(entry(1001, noisy(a, 0.3))) // MP3 128 del tema 1
    entries.push(entry(1002, late))
    const idx = SoundIndex.build(entries)
    const p1 = pairOf(idx, 1, 1001)!, p2 = pairOf(idx, 1, 1002)!
    expect(p1).toBeTruthy()
    expect(p2).toBeTruthy()
    // el índice da el corrimiento aproximado (±1 cuadro); la comparación bit a bit lo deja exacto
    expect(Math.abs(Math.abs(p2.offset) - 12)).toBeLessThanOrEqual(1)
    expect(bestAlignment(a, late, -Math.abs(p2.offset)).offset).toBe(-12)
    // ningún otro par: las 300 canciones son distintas
    const others = idx.pairs().filter((p) => ![1, 1001, 1002].includes(idx.ids[p.a]) || ![1, 1001, 1002].includes(idx.ids[p.b]))
    expect(others).toEqual([])
    // y bit a bit dicen "el mismo audio" (con la misma duración)
    const fb = noisy(a, 0.3)
    expect(soundRelation(bestAlignment(a, fb, 0), 200, 200, a.length, fb.length)).toBe('same')
    expect(alignAt(a, songs[1], 0).sim).toBeLessThan(0.7)
  })

  it('los temas con pocos votos (claves que coinciden de casualidad) se descartan sin cambiar ningún par', () => {
    // pairs() cuenta los votos de cada tema y ordena solo los de los que llegan al mínimo: tiene que dar lo mismo que
    // mirar todos (mínimo 1) y quedarse con los que llegan
    const songs = Array.from({ length: 200 }, () => song())
    const entries = songs.map((s, i) => entry(i + 1, s))
    for (let k = 0; k < 20; k++) entries.push(entry(500 + k, noisy(songs[k * 7], 0.15 + k / 100, k % 5)))
    const idx = SoundIndex.build(entries, { bits: 18, sampleBits: 2 }) // clave corta: muchas coincidencias de casualidad
    const all = idx.pairs(1)
    expect(all.filter((p) => p.votes < 4).length).toBeGreaterThan(100)
    for (const min of [2, 4, 6]) expect(idx.pairs(min)).toEqual(all.filter((p) => p.votes >= min))
  })

  it('encuentra versiones que comparten un pedazo corrido (extended con intro más larga)', () => {
    const radio = song(960)
    // la extended tiene 40 s de intro propia y después el mismo audio (más ruido de otra codificación)
    const extended = new Uint32Array(960)
    extended.set(song(320), 0)
    extended.set(noisy(radio, 0.15).subarray(0, 640), 320)
    const idx = SoundIndex.build([entry(1, radio), entry(2, extended), ...Array.from({ length: 50 }, (_, i) => entry(10 + i, song()))])
    const p = pairOf(idx, 1, 2)!
    expect(p).toBeTruthy()
    const [x, y] = idx.ids[p.a] === 1 ? [radio, extended] : [extended, radio]
    const al = bestAlignment(x, y, p.offset)
    expect(Math.abs(al.offset)).toBe(320)
    // otra duración: no es el mismo audio, es una versión (nunca se propone tirarla)
    expect(soundRelation(al, 210, 330, x.length, y.length)).toBe('version')
  })

  it('un loop repetitivo (pocos valores distintos) igual deja claves y encuentra su copia corrida', () => {
    const l = loop()
    expect(keysOf(l, 0xffffffff, 2).keys.length).toBeGreaterThan(4)
    // la misma copia, empezando 3 cuadros después (otro corte del mismo archivo, como las copias "(1)" del navegador)
    const idx = SoundIndex.build([entry(1, l), entry(2, l.slice(3)), ...Array.from({ length: 50 }, (_, i) => entry(10 + i, song()))])
    expect(pairOf(idx, 1, 2)).toBeTruthy()
    // Una copia en peor calidad de un tema muy percusivo: tests/duplicados-pedazos.test.ts (techno muy percusivo).
  })

  it('busca una huella de afuera (la Bandeja) contra el índice', () => {
    const songs = Array.from({ length: 100 }, () => song())
    const idx = SoundIndex.build(songs.map((s, i) => entry(i + 1, s)))
    const hits = idx.query(noisy(songs[41], 0.25, 5))
    expect(idx.ids[hits[0].b]).toBe(42)
    expect(idx.query(song())).toEqual([])
  })

  it('la clave se alarga con la biblioteca para seguir distinguiendo', () => {
    expect(indexParams(1500).bits).toBeLessThan(indexParams(100_000).bits)
    expect(indexParams(100_000)).toEqual({ bits: 24, sampleBits: 3 })
  })
})
