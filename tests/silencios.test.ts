// Tests de los silencios largos al principio y al final (masterplan 3, punto 3; core/analysis/silence.ts y core/silencepass.ts):
// cuántos segundos de cada lado, sin confundir una intro suave, un clic suelto o un fade-out con silencio; la pasada liviana
// para los temas ya analizados y el problema informativo.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { analyzeFile, type RawAnalysis } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { analyzeSilence, silenceFlags, silenceOf, SILENCE_VERSION } from '@paila/core/analysis/silence'
import { withSilenceFlags } from '@paila/core/silencepass'
import { PROBLEM_TESTS } from '@paila/shared/trackinfo'
import type { Track } from '@paila/shared/types'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string

/** Arma un FLAC estéreo con pedazos: silencio, tono fuerte (el seno de lavfi: −21 dBFS de nivel medio), tono más suave
 *  (cuántos dB menos), clic o tono con fade-out. */
type Piece = ['silencio', number] | ['tono', number] | ['suave', number, number] | ['clic'] | ['fade', number]
function make(name: string, pieces: Piece[]): string {
  const out = path.join(dir, name)
  const inputs: string[] = []
  const labels: string[] = []
  pieces.forEach((p, i) => {
    const src = p[0] === 'silencio' ? `anullsrc=r=44100:cl=stereo:d=${p[1]}`
      : p[0] === 'clic' ? 'sine=frequency=3000:sample_rate=44100:duration=0.01'
        : `sine=frequency=440:sample_rate=44100:duration=${p[1]}`
    inputs.push('-f', 'lavfi', '-i', src)
    const vol = p[0] === 'suave' ? `,volume=${p[2]}dB` : p[0] === 'fade' ? `,afade=t=out:st=0:d=${p[1]}` : ''
    labels.push(`[${i}:a]aformat=sample_fmts=fltp:channel_layouts=stereo${vol}[p${i}]`)
  })
  const graph = `${labels.join(';')};${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1[o]`
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[o]', out])
  return out
}
const full = (file: string, duration: number) =>
  analyzeFile({ ffmpeg, file, ext: 'flac', lossless: true, sampleRate: 44100, bits: 16, channels: 2, duration, withDj: false, withPrints: false })

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-silencios-')) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('la cuenta, sin audio', () => {
  const on = 1e-2, off = 1e-9 // energía de un bloque de 50 ms: −20 dB y −90 dB
  const blocks = (...runs: [number, number][]) => runs.flatMap(([e, n]) => Array(n).fill(e))
  it('segundos de silencio de cada lado, en décimas', () => {
    expect(silenceOf(blocks([off, 60], [on, 100], [off, 140]))).toEqual({ start: 3, end: 7, silent: false })
    expect(silenceOf(blocks([on, 100]))).toEqual({ start: 0, end: 0, silent: false })
  })
  it('un clic suelto en el silencio no lo corta; un golpe con más sonido al lado, sí', () => {
    expect(silenceOf(blocks([off, 20], [on, 1], [off, 40], [on, 100])).start).toBe(3.1) // 61 bloques de 50 ms, en décimas
    expect(silenceOf(blocks([off, 20], [on, 1], [off, 2], [on, 100])).start).toBe(1)
  })
  it('un fade lento (más de 1,5 s entre −80 y −60 dB) ya está sonando: solo cuenta lo de abajo de −80 (corrida del 22/10)', () => {
    const db = (x: number) => 10 ** (x / 10)
    const ramp = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => db(from + ((to - from) * i) / (n - 1)))
    // "Rubia tarada" (Sumo): arranca a −80 y sube durante 2,4 s; antes contaba 2,4 s de silencio
    expect(silenceOf([...ramp(-79, -61, 48), ...blocks([on, 100])]).start).toBe(0)
    // "Paja brava" (La Renga): 2 s de casi nada y después un fade-in de 3 s
    expect(silenceOf([...blocks([db(-100), 40]), ...ramp(-79, -61, 60), ...blocks([on, 100])]).start).toBe(2)
    // un fade-out largo al final: solo lo que queda debajo de −80
    expect(silenceOf([...blocks([on, 100]), ...ramp(-61, -79, 80), ...blocks([db(-100), 60])]).end).toBe(3)
    // un arranque de golpe (menos de 1,5 s entre los dos umbrales) cuenta entero
    expect(silenceOf([...blocks([off, 60]), ...ramp(-79, -61, 10), ...blocks([on, 100])]).start).toBe(3.5)
  })
  it('todo en silencio', () => {
    expect(silenceOf(blocks([off, 40]))).toEqual({ start: 2, end: 2, silent: true })
    expect(silenceFlags({ start: 2, end: 2, silent: true })).toEqual([])
  })
  it('se avisa desde 2 s al principio y 5 s al final; las demás marcas quedan', () => {
    expect(silenceFlags({ start: 1.9, end: 4.9, silent: false })).toEqual([])
    expect(silenceFlags({ start: 2, end: 5, silent: false })).toEqual(['silence_start', 'silence_end'])
    expect(withSilenceFlags('clipping,silence_end', { start: 3, end: 0, silent: false })).toBe('clipping,silence_start')
    expect(withSilenceFlags('silence_start', { start: 0, end: 0, silent: false })).toBeNull()
  })
  it('el problema del Centro de problemas', () => {
    expect(PROBLEM_TESTS.silence({ flags: 'mono,silence_end' } as Track)).toBe(true)
    expect(PROBLEM_TESTS.silence({ flags: 'mono' } as Track)).toBe(false)
  })
})

describe('con audio de verdad', () => {
  it('3 s de silencio, el tema y 6 s de silencio: igual en el análisis completo y en la pasada liviana', async () => {
    const f = make('hueco.flac', [['silencio', 3], ['tono', 4], ['silencio', 6]])
    const a = (await full(f, 13)).silence!
    const b = await analyzeSilence({ ffmpeg, file: f, duration: 13 })
    for (const s of [a, b]) {
      expect(s.start).toBeCloseTo(3, 1)
      expect(s.end).toBeCloseTo(6, 0)
      expect(silenceFlags(s)).toEqual(['silence_start', 'silence_end'])
    }
  }, 60_000)

  it('una intro suave (−45 dBFS) no es silencio; un clic de vinilo en el silencio no lo corta', async () => {
    const suave = make('suave.flac', [['suave', 4, -24], ['tono', 3]])
    expect((await analyzeSilence({ ffmpeg, file: suave, duration: 7 })).start).toBe(0)
    const clic = make('clic.flac', [['silencio', 1], ['clic'], ['silencio', 2], ['tono', 3]])
    expect((await analyzeSilence({ ffmpeg, file: clic, duration: 6 })).start).toBeGreaterThan(2.9)
  }, 60_000)

  it('un fade-out largo no es silencio: solo cuenta lo que ya no se oye', async () => {
    const f = make('fade.flac', [['tono', 3], ['fade', 8], ['silencio', 1]])
    const s = await analyzeSilence({ ffmpeg, file: f, duration: 12 })
    expect(s.end).toBeLessThan(2)
    expect(silenceFlags(s)).toEqual([])
  }, 60_000)

  it('un tema largo se lee solo del principio y del final', async () => {
    const f = make('largo.flac', [['silencio', 2.5], ['tono', 200], ['silencio', 7]])
    const s = await analyzeSilence({ ffmpeg, file: f, duration: 209.5 })
    expect(s.start).toBeCloseTo(2.5, 1)
    expect(s.end).toBeCloseTo(7, 0)
  }, 60_000)
})

describe('pasada liviana en la biblioteca', () => {
  let lib: Library
  const raw: RawAnalysis = {
    cutoff: { cutoff: 22050, drop: 0, cdEdgeDrop: null, frames: 100, spectrum: [1, 2] }, hires: null, effBits: null, flicker: null,
    lufs: -9, lra: 5, truePeak: -0.5, samplePeak: -0.6, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, mp3: null, ms: 5,
    dj: null, meta: {}, prints: { audioMd5: null, chromaprint: null, size: null, mtime: null },
  }
  const row = () => lib.db.prepare('SELECT s.silence_start, s.silence_end, s.silence_v, a.flags FROM analysis a LEFT JOIN silence s ON s.file_id = a.file_id').get() as Record<string, unknown>

  beforeAll(async () => {
    fs.mkdirSync(path.join(dir, 'M'))
    make(path.join('M', 'Artista - Tema.flac'), [['silencio', 3], ['tono', 4], ['silencio', 1]])
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    await lib.scan()
  })
  afterAll(() => lib.close())

  it('los ya analizados (sin silencios) se miden una vez, sin tocar las otras marcas', async () => {
    const calls: string[] = []
    const runner: AnalysisRunner = {
      full: async () => raw, prints: async () => raw.prints,
      silence: async (j) => { calls.push(path.basename(j.file)); return analyzeSilence(j) },
    }
    // un análisis de antes de los silencios: sin las columnas, con una marca de calidad
    await lib.analyze({ full: runner.full, prints: runner.prints }, ffmpeg, 1)
    lib.db.prepare("UPDATE analysis SET flags = 'clipping'").run()
    lib.db.prepare('DELETE FROM silence').run()
    expect(lib.pendingSilence()).toBe(1)
    await lib.analyze(runner, ffmpeg, 1)
    expect(calls).toEqual(['Artista - Tema.flac'])
    expect(row()).toMatchObject({ silence_v: SILENCE_VERSION, flags: 'clipping,silence_start' })
    expect(Number(row().silence_start)).toBeCloseTo(3, 1)
    expect(lib.pendingSilence()).toBe(0)
    expect(lib.getAnalysis(1)).toMatchObject({ silenceStart: expect.any(Number), silenceEnd: expect.any(Number) })
    await lib.analyze(runner, ffmpeg, 1)
    expect(calls).toHaveLength(1)
  }, 60_000)

  it('el análisis completo ya trae los silencios: la pasada liviana no hace falta', async () => {
    lib.db.prepare('UPDATE analysis SET quality_v = NULL').run()
    const calls: string[] = []
    const runner: AnalysisRunner = {
      full: async () => ({ ...raw, silence: { start: 0.5, end: 8, silent: false } }), prints: async () => raw.prints,
      silence: async (j) => { calls.push(j.file); return analyzeSilence(j) },
    }
    await lib.analyze(runner, ffmpeg, 1)
    expect(calls).toEqual([])
    expect(row()).toMatchObject({ silence_start: 0.5, silence_end: 8, silence_v: SILENCE_VERSION, flags: 'silence_end' })
  }, 60_000)
})
