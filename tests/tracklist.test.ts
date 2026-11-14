// Tests del motor del tracklist de sets (core/tracklist.ts, core/tracklist-build.ts, core/setlists-scan.ts) con huellas
// inventadas: un set armado con pedazos de temas de una biblioteca chica, con la respuesta conocida. Sin audio: rápidos.
import { describe, expect, it } from 'vitest'
import { encodeFingerprint } from '@paila/core/analysis/chromaprint'
import { SoundIndex, indexParams, type LibraryPrints } from '@paila/core/soundindex'
import { FRAMES_PER_SECOND } from '@paila/core/soundmatch'
import { clock, findHits, rateGrid, silentSpans, stretchPrint } from '@paila/core/tracklist'
import { buildTracklist, entryPoint } from '@paila/core/tracklist-build'
import { refiner, scanSet, twins } from '@paila/core/setlists'
import type { SetHit } from '@paila/core/tracklist'

const FPS = FRAMES_PER_SECOND
const LIB_FRAMES = 968 // los primeros 120 s, como guarda el análisis

/** Números al azar con semilla. */
function rand(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s ^ (s >>> 15)) >>> 0 }
}
/**
 * Una huella inventada que se parece a una de verdad: cada cuadro cambia unos pocos bits del anterior (el sonido cambia
 * de a poco), y dos temas distintos se parecen como dos temas cualquiera (~50 % de bits iguales).
 */
function randomPrint(n: number, seed: number): Uint32Array {
  const r = rand(seed)
  const out = new Uint32Array(n)
  let v = r()
  for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) v ^= 1 << (r() % 32); out[i] = v >>> 0 }
  return out
}
/** Ruido: cambia un `p` de los bits (otra calidad, la mezcla del DJ). */
function noisy(fp: Uint32Array, p: number, seed = 7): Uint32Array {
  const r = rand(seed)
  const out = Uint32Array.from(fp)
  for (let i = 0; i < fp.length; i++) for (let b = 0; b < 32; b++) if (r() / 2 ** 32 < p) out[i] ^= 1 << b
  return out
}
const concat = (...parts: Uint32Array[]) => { const out = new Uint32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }

/** Una biblioteca chica: 25 temas de ~5 min; el índice con sus primeros 120 s (como la de verdad). */
const tracks = new Map<number, Uint32Array>()
for (let id = 1; id <= 25; id++) tracks.set(id, randomPrint(2400, id * 7919))
tracks.set(26, tracks.get(1)!) // el mismo audio que el 1 en otro archivo (un duplicado)
function library(ids = [...tracks.keys()]): LibraryPrints {
  const b = SoundIndex.builder(indexParams(ids.length))
  for (const id of ids) b.add({ id, chromaprint: encodeFingerprint(tracks.get(id)!.subarray(0, LIB_FRAMES)) })
  return { index: b.finish(), fingerprint: (id) => tracks.get(id)?.subarray(0, LIB_FRAMES) ?? null, duration: (id) => (tracks.has(id) ? 2400 / FPS : null) }
}
const lib = library()
const T = (id: number) => tracks.get(id)!

describe('tracklist: qué suena en el set y desde cuándo', () => {
  // A desde el principio (185 s) → B salteando la intro (desde 37 s) → 87 s de algo que no está → C a +4 % con master tempo
  const A = T(3).subarray(0, 1500), B = T(8).subarray(300, 1700), U = randomPrint(700, 424242)
  const C = stretchPrint(T(12).subarray(0, 1400), 1 / 1.04) // más rápido: menos cuadros por segundo del tema
  const set = noisy(concat(A, B, U, C), 0.06)
  const seconds = set.length / FPS
  const at = { B: A.length / FPS, U: (A.length + B.length) / FPS, C: (A.length + B.length + U.length) / FPS }

  it('encuentra cada tema, en orden, con el minuto en que entra', async () => {
    const hits = await findHits(lib, set)
    const list = buildTracklist(hits, seconds, (id) => lib.duration(id), undefined, refiner(lib, set))
    const found = list.filter((e) => e.fileId != null && e.confidence !== 'baja')
    expect(found.map((e) => e.fileId)).toEqual([3, 8, 12])
    expect(found[0].start).toBeLessThan(3)
    expect(Math.abs(found[1].start - at.B)).toBeLessThan(6) // salteó la intro: entra donde suena, no 37 s antes
    expect(Math.abs(found[2].start - at.C)).toBeLessThan(6)
  })

  it('dice a qué velocidad sonaba un tema acelerado con master tempo', async () => {
    const list = buildTracklist(await findHits(lib, set), seconds, (id) => lib.duration(id))
    expect(list.find((e) => e.fileId === 12)!.rate).toBeCloseTo(1.04, 1)
    expect(list.find((e) => e.fileId === 3)!.rate).toBeCloseTo(1, 1)
  })

  it('el tramo que no está en la biblioteca queda "sin reconocer"', async () => {
    const list = buildTracklist(await findHits(lib, set), seconds, () => 185, undefined, refiner(lib, set)) // los temas duran lo que suenan acá
    const gap = list.find((e) => e.fileId == null)
    expect(gap).toBeTruthy()
    expect(gap!.start).toBeGreaterThan(at.U - 20)
    expect(gap!.heardUntil).toBeLessThan(at.C + 20)
  })

  it('el mismo audio en dos archivos sale una sola vez (con el otro como duplicado)', async () => {
    const list = buildTracklist(await findHits(lib, set), seconds, (id) => lib.duration(id), (a, b) => b - a) // prefiere el id más alto
    const a = list.filter((e) => e.fileId === 3 || e.alsoIds.includes(3))
    expect(a).toHaveLength(1)
    const one = list.filter((e) => e.fileId === 1 || e.fileId === 26)
    expect(one).toHaveLength(0) // el 1 no suena en este set
  })

  it('un tema duplicado en la biblioteca: se muestra el preferido y el otro queda en "otros archivos"', async () => {
    const s2 = noisy(concat(T(1).subarray(0, 1300), T(5).subarray(0, 1300)), 0.05)
    const list = buildTracklist(await findHits(lib, s2), s2.length / FPS, (id) => lib.duration(id), (a, b) => b - a)
    const e = list.find((x) => x.fileId === 26 || x.fileId === 1)!
    expect(e.fileId).toBe(26)
    expect(e.alsoIds).toContain(1)
  })

  it('no inventa temas en un set que no tiene nada de la biblioteca', async () => {
    const other = randomPrint(4000, 99)
    const list = buildTracklist(await findHits(lib, other), other.length / FPS, (id) => lib.duration(id))
    expect(list.filter((e) => e.fileId != null && e.confidence !== 'baja')).toEqual([])
    expect(list).toHaveLength(1) // todo el set: un solo tramo sin reconocer
  })

  it('los tramos sin ninguna ventana reconocida (para la segunda pasada)', async () => {
    const spans = silentSpans(await findHits(lib, set), seconds)
    expect(spans.some((s) => s.from <= at.U + 20 && s.to >= at.C - 20)).toBe(true)
  })
})

describe('tracklist: temas de la carpeta del set escuchados enteros', () => {
  it('reconoce un tema que el DJ puso desde la mitad (fuera de los primeros 120 s)', async () => {
    const D = T(15), set = noisy(concat(randomPrint(500, 5), D.subarray(1200, 2300)), 0.05)
    const seconds = set.length / FPS
    const read = async () => new Uint32Array(0)
    const without = buildTracklist(await scanSet(lib, set, seconds, read), seconds, (id) => lib.duration(id))
    expect(without.some((e) => e.fileId === 15 && e.confidence !== 'baja')).toBe(false)
    const long = [{ fileId: 15, fp: D, duration: 2400 / FPS }]
    const hits = await scanSet(lib, set, seconds, read, { long })
    const h = hits.filter((x) => x.fileId === 15)
    expect(h.length).toBeGreaterThan(5)
    expect(Math.abs(h[0].pos - (1200 + (h[0].at - 500 / FPS) * FPS) / FPS)).toBeLessThan(2) // el segundo de verdad dentro del tema
    const list = buildTracklist(hits, seconds, (id) => lib.duration(id), undefined, refiner(lib, set, long))
    const e = list.find((x) => x.fileId === 15)!
    expect(Math.abs(e.start - 500 / FPS)).toBeLessThan(6)
  })
})

describe('tracklist: errores de la corrida supervisada del 22/10', () => {
  const hit = (at: number, fileId: number, pos: number, contrast = 0.1, matched = 12): SetHit => ({ at, fileId, pos, rate: 1, matched, contrast })

  it('dos temas distintos que suenan flojo en las mismas ventanas no se juntan como "otros archivos"', () => {
    // el 3 y el 8 aparecen en las mismas 4 ventanas (como Janeret y Babasónicos en el set de 77 min): son temas distintos
    const hits = [0, 10, 20, 30].flatMap((at, i) => [hit(at + 100, 3, 40 + i * 10, 0.2, 25), hit(at + 100, 8, 70 + i * 10)])
    const sin = buildTracklist(hits, 600, () => 300)
    expect(sin.filter((e) => e.fileId != null)).toHaveLength(1) // sin comparar las huellas, se juntaban
    const con = buildTracklist(hits, 600, () => 300, undefined, undefined, twins(lib))
    expect(con.filter((e) => e.fileId != null).map((e) => e.fileId).sort()).toEqual([3, 8])
    // el mismo audio en dos archivos sí se junta
    const dup = [0, 10, 20].flatMap((at) => [hit(at, 1, at + 5, 0.3, 28), hit(at, 26, at + 5, 0.3, 28)])
    expect(buildTracklist(dup, 300, () => 300, undefined, undefined, twins(lib)).filter((e) => e.fileId != null)).toHaveLength(1)
  })

  it('el mismo tema con otro nombre de archivo ("85h_(Original Mix)" y "Trickfinger - 85H [2015]") se junta aunque las huellas no alcancen', () => {
    const titles: Record<number, string> = { 3: '85h_(Original Mix)', 8: '85H [2015]', 12: 'Otra cosa' }
    const same = twins(lib, undefined, (id) => titles[id] ?? null)
    expect(same(3, 8, 0, 0)).toBe(true)
    expect(same(3, 12, 0, 0)).toBe(false)
  })

  it('un dudoso no tapa lo que no se reconoce (mix de Tomorrowland: no quedaba ningún tramo sin reconocer)', () => {
    const hits = [hit(20, 3, 10, 0.09, 9), hit(900, 8, 5, 0.3, 28), hit(910, 8, 15, 0.3, 28), hit(920, 8, 25, 0.3, 28)]
    const list = buildTracklist(hits, 1200, () => 400)
    expect(list.find((e) => e.fileId === 3)!.confidence).toBe('baja')
    const gap = list.find((e) => e.fileId == null && e.start < 900)
    expect(gap).toBeTruthy()
    expect(gap!.heardUntil - gap!.start).toBeGreaterThan(600)
  })
})

describe('tracklist: piezas sueltas', () => {
  it('la entrada exacta: para atrás mientras suene igual', () => {
    const E = T(20), set = noisy(concat(randomPrint(800, 3), E.subarray(200, 1400)), 0.05)
    const entry = 800 / FPS, anchor = entry - 200 / FPS
    expect(Math.abs(entryPoint(set, E, anchor, 1, entry + 20)! - entry)).toBeLessThan(3)
    // desde el principio del tema: llega a su 0:00
    const s2 = noisy(concat(randomPrint(400, 4), E.subarray(0, 900)), 0.05)
    expect(Math.abs(entryPoint(s2, E, 400 / FPS, 1, 400 / FPS + 40)! - 400 / FPS)).toBeLessThan(1)
  })

  it('estirar la huella, las velocidades y el reloj', () => {
    const fp = randomPrint(100, 1)
    expect(stretchPrint(fp, 1)).toBe(fp)
    expect(stretchPrint(fp, 1.1).length).toBe(110)
    expect(rateGrid(0.04, 0.02)).toEqual([0.96, 0.98, 1.02, 1.04])
    expect(clock(65)).toBe('1:05')
    expect(clock(3725)).toBe('1:02:05')
  })
})
