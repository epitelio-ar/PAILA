// Tests de la energía a tu oído y del estilo por el sonido (MASTERPLAN-3, punto 3; core/energia.ts, core/energiamarcas.ts,
// core/analysis/effnet.ts y core/stylepass.ts): el espectrograma igual al de Essentia, qué estilo se sugiere, el ajuste a las
// marcas, la pasada de estilos en la biblioteca (con un modelo de mentira: el de la UPF no viaja con PAILA) y que un modelo
// roto no deje la Música entera dada por escuchada.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import type { RawAnalysis } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { EF_RATE, effnetMel, effnetPatches, effnetWindows, soundStyle, STYLE_SURE } from '@paila/core/analysis/effnet'
import { energyFeatures, energyFrom, energyOf, fitEnergy, SOUND_MODEL, trackEnergy } from '@paila/core/energia'
import { calibrate, markCandidates, marksState, MIN_MARKS, recomputeEnergy, resetCalibration, setMark } from '@paila/core/energiamarcas'
import { STYLE_VERSION, stylePass } from '@paila/core/stylepass'
import { Slots } from '@paila/core/analysis/slots'
import { EFFNET_FILES, effnetMissing, effnetToDownload } from '@paila/core/analysis/effnetrun'
import { ponerIdioma } from '@paila/shared/idioma'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-energia-')) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('el espectrograma de EffNet', () => {
  it('es el mismo que el TensorflowInputMusiCNN de Essentia (cuadro por cuadro)', () => {
    const lib = require('essentia.js')
    const es = new lib.Essentia(lib.EssentiaWASM)
    const y = new Float32Array(512 * 3).map((_, i) => 0.3 * Math.sin(i * 0.37) + 0.2 * Math.sin(i * 0.05) + 0.05 * Math.sin(i * 1.9))
    const mine = effnetMel(y)
    const v = es.arrayToVector(y.subarray(256, 768))
    const ref: number[] = Array.from(es.vectorToArray(es.TensorflowInputMusiCNN(v).bands))
    const row = Array.from(mine.subarray(96, 192))
    expect(Math.max(...row.map((x, i) => Math.abs(x - ref[i])))).toBeLessThan(1e-3)
  })
  it('un tono de 1 kHz cae en las bandas del medio, y los pedazos son de 128 cuadros cada 62', () => {
    const y = new Float32Array(EF_RATE * 5).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / EF_RATE))
    const mel = effnetMel(y)
    const first = Array.from(mel.subarray(0, 96))
    const top = first.indexOf(Math.max(...first))
    expect(top).toBeGreaterThan(30); expect(top).toBeLessThan(50)
    const frames = mel.length / 96
    expect(effnetPatches(mel).n).toBe(Math.floor((frames - 128) / 62) + 1)
  })
  it('escucha 4 pedazos de 20 s entre el 10 % y el 90 %; un tema corto, entero', () => {
    expect(effnetWindows(60)).toEqual([[0, 60]])
    const ws = effnetWindows(300)
    expect(ws).toHaveLength(4)
    expect(ws[0][0]).toBe(30); expect(ws[3][0] + ws[3][1]).toBeLessThanOrEqual(270)
  })
})

describe('qué estilo se sugiere', () => {
  it('solo si está muy seguro, con el género grande en castellano', () => {
    expect(soundStyle([['Latin---Reggaeton', 0.81], ['Hip Hop---Trap', 0.3]])).toEqual({ style: 'Reggaeton', genre: 'Latina', p: 0.81 })
    expect(soundStyle([['Folk, World, & Country---Canzone Napoletana', 0.3]])).toBeNull() // "La bestia pop", 23/10
    expect(soundStyle([['Rock---Punk', STYLE_SURE]])?.genre).toBe('Rock')
    expect(soundStyle(null)).toBeNull()
  })
})

describe('la energía', () => {
  const row = (lufs: number, dance = 1.3, bpm = 120) => ({ lufs, lra: 6, danceability: dance, bpm, spectrum: null })
  it('sin el modelo ni marcas es la de siempre; con lo que oyó el modelo, la de fábrica nueva', () => {
    expect(trackEnergy(row(-8), null, null)).toBe(energyOf(-8, 1.3, 120))
    const calm = { mood_aggressive: 0.02, mood_relaxed: 0.9, mood_party: 0.05, danceability: 0.1, engagement_regression: 0.5 }
    const hard = { mood_aggressive: 0.8, mood_relaxed: 0.1, mood_party: 0.3, danceability: 0.99, engagement_regression: 0.95 }
    // un disco viejo y bajito pero furioso le gana a un tema fuerte y tranquilo (lo que fallaba con "Jijiji" y "Given Up")
    expect(trackEnergy(row(-14), hard, null)!).toBeGreaterThan(trackEnergy(row(-8), calm, null)!)
    expect(trackEnergy({ ...row(-8), lufs: null }, null, null)).toBeNull()
  })
  it('el ajuste aprende de las marcas y no se sale de 1 a 10', () => {
    // marcas que dependen solo del volumen: el ajuste tiene que ordenar por volumen
    const rows = Array.from({ length: 20 }, (_, i) => row(-20 + i * 0.7))
    const truth = rows.map((r) => Math.round(1 + ((r.lufs + 20) / 14) * 9))
    const m = fitEnergy(rows.map((r) => energyFeatures(r)), truth)
    const pred = rows.map((r) => energyFrom(energyFeatures(r), m))
    expect(pred[0]).toBeLessThan(pred[19])
    expect(pred.every((p) => p >= 1 && p <= 10)).toBe(true)
    expect(pred.filter((p, i) => Math.abs(p - truth[i]) <= 1).length).toBeGreaterThanOrEqual(16)
    expect(energyFrom(energyFeatures(row(-8)), SOUND_MODEL)).toBeGreaterThanOrEqual(1)
  })
})

describe('marcas, calibrar y la pasada de estilos en la biblioteca', () => {
  let lib: Library
  const raw = (n: number): RawAnalysis => ({
    cutoff: { cutoff: 22050, drop: 0, cdEdgeDrop: null, frames: 100, spectrum: [1, 2] }, hires: null, effBits: null, flicker: null,
    lufs: -18 + n, lra: 5, truePeak: -0.5, samplePeak: -0.6, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, mp3: null, ms: 5,
    dj: { bpm: 100 + n * 3, key: 'A', camelot: '11B', keyStrength: 0.8, danceability: 0.9 + n * 0.08 }, meta: {}, prints: { audioMd5: null, chromaprint: null, size: null, mtime: null },
  })
  const N = 14
  beforeAll(async () => {
    fs.mkdirSync(path.join(dir, 'M'))
    for (let i = 0; i < N; i++) execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 20}:sample_rate=16000:duration=31`, path.join(dir, 'M', `Artista ${i} - Tema ${i}.flac`)])
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    await lib.scan()
    const byName = (f: string) => Number(/Tema (\d+)/.exec(f)![1])
    await lib.analyze({ full: async (j) => raw(byName(j.file)), prints: async () => raw(0).prints }, ffmpeg, 1)
  }, 60_000)
  afterAll(() => lib.close())
  // del más bajito al más fuerte (el orden de los archivos es alfabético: Tema 10 va antes que Tema 2)
  const ids = () => (lib.db.prepare('SELECT file_id AS id FROM analysis ORDER BY lufs').all() as { id: number }[]).map((r) => r.id)
  const energies = () => (lib.db.prepare('SELECT energy FROM analysis ORDER BY lufs').all() as { energy: number }[]).map((r) => r.energy)

  it('ofrece temas de toda la escala y los marcados ya no vuelven a aparecer', () => {
    const c = markCandidates(lib.db, 6)
    expect(c.length).toBe(6)
    const levels = new Set(c.map((t) => t.paila))
    expect(levels.size).toBeGreaterThanOrEqual(4)
    setMark(lib.db, c[0].id, 7)
    expect(markCandidates(lib.db, 30).some((t) => t.id === c[0].id)).toBe(false)
    expect(marksState(lib.db).marks).toMatchObject([{ id: c[0].id, mark: 7 }])
    setMark(lib.db, c[0].id, null)
    expect(marksState(lib.db).marks).toEqual([])
  })

  it('con pocas marcas no ajusta; con suficientes, ajusta, recalcula y vuelve a la de fábrica', () => {
    const all = ids()
    setMark(lib.db, all[0], 5)
    expect(calibrate(lib.db).ok).toBe(false)
    // marcas al revés de lo que dice el volumen: el ajuste tiene que darlas vuelta
    all.forEach((id, i) => setMark(lib.db, id, 10 - Math.round((i * 9) / (N - 1))))
    expect(all.length).toBeGreaterThanOrEqual(MIN_MARKS)
    const before = energies()
    const r = calibrate(lib.db)
    expect(r).toMatchObject({ ok: true, marks: N })
    expect(r.after).toBeGreaterThan(r.before)
    const after = energies()
    expect(after[0]).toBeGreaterThan(after[N - 1])
    expect(before[0]).toBeLessThan(before[N - 1])
    expect(resetCalibration(lib.db)).toBeGreaterThan(0)
    expect(energies()).toEqual(before)
  })

  it('la pasada de estilos guarda lo que oyó y recalcula la energía; un modelo roto no da nada por escuchado', async () => {
    const models = { dir: path.join(dir, 'modelo'), ortDir: path.join(dir, 'ort') }
    // un modelo "instalado" de mentira (la pasada mira que estén los archivos; el runner de mentira no los usa)
    fs.mkdirSync(models.dir, { recursive: true }); fs.mkdirSync(path.join(models.ortDir, 'npm', 'node_modules', 'onnxruntime-web'), { recursive: true })
    fs.writeFileSync(path.join(models.ortDir, 'npm', 'node_modules', 'onnxruntime-web', 'package.json'), '{}')
    for (const f of EFFNET_FILES) fs.writeFileSync(path.join(models.dir, f.file), 'x')
    lib.styleModels = () => models
    let calls = 0
    const broken: AnalysisRunner = { full: async () => raw(0), prints: async () => raw(0).prints, style: async () => { calls++; throw new Error('modelo roto') } }
    await lib.analyze(broken, ffmpeg, 1)
    expect(calls).toBeLessThan(N)
    expect((lib.db.prepare('SELECT COUNT(*) AS n FROM sound_style').get() as { n: number }).n).toBe(0)
    const hard = { mood_aggressive: 0.9, mood_relaxed: 0.05, mood_party: 0.4, danceability: 0.99, engagement_regression: 0.97 }
    const ok: AnalysisRunner = { ...broken, style: async () => ({ styles: [['Electronic---Techno', 0.8]], moods: hard }) }
    const before = energies()
    expect(lib.pendingStyle()).toBe(N)
    await lib.analyze(ok, ffmpeg, 1)
    expect(lib.pendingStyle()).toBe(0)
    expect((lib.db.prepare('SELECT COUNT(*) AS n FROM sound_style WHERE style_v = ?').get(STYLE_VERSION) as { n: number }).n).toBe(N)
    expect(energies()[0]).toBeGreaterThan(before[0]) // el más bajito, que suena furioso, sube
    expect(lib.getAnalysis(ids()[0])?.soundStyle).toEqual({ style: 'Techno', genre: 'Electrónica', p: 0.8 })
    expect(recomputeEnergy(lib.db)).toBe(0) // ya quedó al día
    // sin modelo, la pasada no corre
    expect(await stylePass(lib, ok, ffmpeg, new Map(), new Slots(1), null)).toBe(0)
    lib.styleModels = null
    expect(lib.pendingStyle()).toBe(0)
  }, 60_000)
})

describe('qué falta para escuchar el estilo', () => {
  it('"falta bajar el modelo" va como dato (la pantalla ya muestra el botón Bajar), no buscando "bajar" en el texto', () => {
    const m = path.join(dir, 'modelo-de-estilos')
    fs.mkdirSync(m, { recursive: true })
    expect(effnetToDownload(null)).toBe(true)
    expect(effnetToDownload(m)).toBe(true)
    expect(effnetMissing(m, null)).toMatch(/bajar el modelo/)
    for (const f of EFFNET_FILES) fs.writeFileSync(path.join(m, f.file), '')
    expect(effnetToDownload(m)).toBe(false)
    expect(effnetMissing(m, null)).toMatch(/onnxruntime-web/) // esto sí se muestra
  })
  it('en inglés, el género grande sale como en Discogs', () => {
    ponerIdioma('en')
    try { expect(soundStyle([['Latin---Reggaeton', 0.9]])).toEqual({ style: 'Reggaeton', genre: 'Latin', p: 0.9 }) } finally { ponerIdioma('es') }
    expect(soundStyle([['Latin---Reggaeton', 0.9]])!.genre).toBe('Latina')
  })
})
