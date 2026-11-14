// Restos arriba del corte (comparación con Fakin' The Funk, 23/10/2026, docs/pruebas/2026-10-23-fakin-the-funk.md): un MP3 de
// 128 pasado a 320 o a un formato sin pérdida deja chispas sueltas arriba de su corte. En el promedio de potencia esas chispas
// pesaban como el sonido y PAILA medía el corte arriba de ellas (B en vez de F). Archivos sintéticos hechos con ffmpeg.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { grade, type GradeInput } from '@paila/core/analysis/grade'
import type { RawAnalysis } from '@paila/core/analysis/analyze'
import { SpectrumAccumulator, findCutoff } from '@paila/core/analysis/fft'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string
const p = (n: string) => path.join(dir, n)
const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
// el sonido hasta 16 kHz y, de a ratos (0,15 s cada 2 s), ráfagas sueltas entre 16,8 y 19,8 kHz: los restos de un MP3 chico
const SCRAPS = (a: number) => "anoisesrc=d=40:c=pink:r=44100:a=0.3,firequalizer=gain='if(lt(f,16000),0,-100)':accuracy=20[b];" +
  `anoisesrc=d=40:c=white:r=44100:a=${a}:seed=7,highpass=f=16800:poles=2,highpass=f=16800:poles=2,lowpass=f=19800:poles=2,` +
  "volume='if(lt(mod(t,2),0.15),1,0)':eval=frame[s];[b][s]amix=inputs=2:normalize=0"
// sano: el sonido llega arriba de todo y además tiene golpes de agudos de a ratos (platillos)
const HATS = 'anoisesrc=d=40:c=pink:r=44100:a=0.3[b];' +
  "anoisesrc=d=40:c=white:r=44100:a=0.2:seed=3,highpass=f=8000:poles=2,volume='if(lt(mod(t,0.5),0.05),1,0)':eval=frame[s];[b][s]amix=inputs=2:normalize=0"

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-restos-'))
  // fuertes: en el promedio de potencia tapan el corte (solo el promedio en dB lo encuentra)
  ff('-filter_complex', SCRAPS(0.02), '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', p('restos.flac'))
  // más bajas: dejan el escalón plano de los restos de un MP3 chico (como el 010 de la comparación)
  ff('-filter_complex', SCRAPS(0.004), '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '320k', p('restos320.mp3'))
  ff('-filter_complex', HATS, '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', p('platillos.flac'))
  ff('-filter_complex', HATS, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '320k', p('platillos320.mp3'))
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const FLAC: Omit<GradeInput, 'ext'> = { codec: 'flac', lossless: true, kbps: 900, sampleRate: 44100, bits: 16, channels: 2 }
const MP3: Omit<GradeInput, 'ext'> = { codec: 'mp3', lossless: false, kbps: 320, sampleRate: 44100, bits: null, channels: 2 }
async function verdict(name: string, info: Omit<GradeInput, 'ext'>) {
  const ext = path.extname(name).slice(1)
  const raw = await analyzeFile({ ffmpeg, file: p(name), ext, lossless: info.lossless, sampleRate: info.sampleRate, bits: info.bits, channels: 2, duration: 40, withDj: false, withPrints: false })
  return { raw, v: grade({ ...info, ext }, raw) }
}

describe('restos arriba del corte', () => {
  it('FLAC hecho de un MP3 chico con chispas arriba: el corte es donde termina el sonido (16 kHz) → F', async () => {
    const { raw, v } = await verdict('restos.flac', FLAC)
    expect(raw.cutoff.cutoff).toBeLessThan(16800)
    expect(raw.cutoff.scraps).toBe(true)
    expect(raw.cutoff.ceiling).toBeGreaterThan(19000)
    expect(v.grade).toBe('F')
    expect(v.flags).toContain('fake_lossless')
  })
  it('MP3 "320" con el sonido hasta 16 kHz y chispas arriba → inflado', async () => {
    const { raw, v } = await verdict('restos320.mp3', MP3)
    expect(raw.cutoff.cutoff).toBeLessThan(16800)
    expect(v.flags).toContain('upscaled')
    expect(v.grade).toBe('F')
  })
  it('sano con platillos de a ratos (llega arriba de todo): no hay restos, sigue A / B', async () => {
    const f = await verdict('platillos.flac', FLAC)
    expect(f.raw.cutoff.scraps).toBeUndefined()
    expect(f.v.grade).toBe('A')
    const m = await verdict('platillos320.mp3', MP3)
    expect(m.raw.cutoff.scraps).toBeUndefined()
    expect(m.v.grade).toBe('B')
  })
})

describe('el promedio en dB (findCutoff)', () => {
  // espectro armado a mano: 2048 franjas, sonido parejo hasta `body` Hz; arriba, `spikes` cuadros de cada 20 con chispas
  function acc(body: number, spikes: number, spikeDb = -20) {
    const a = new SpectrumAccumulator(4096)
    const binHz = 44100 / 4096
    for (let f = 0; f < 200; f++) {
      const on = f % 20 < spikes
      for (let k = 0; k < 2048; k++) {
        const hz = k * binHz
        const db = hz < body ? 0 : on && hz < 20000 ? spikeDb : -130
        const pw = 10 ** (db / 10)
        a.power[k] += pw
        a.logPower[k] += db
      }
      a.frames++
    }
    return a
  }
  it('sin pérdida: chispas en 1 de cada 20 cuadros no corren el corte (16 kHz, con restos hasta 20 kHz)', () => {
    const c = findCutoff(acc(16000, 1), 44100, { lossless: true })
    expect(c.cutoff).toBeGreaterThan(15500)
    expect(c.cutoff).toBeLessThan(16500)
    expect(c.scraps).toBe(true)
    expect(c.ceiling).toBeGreaterThan(19500)
  })
  it('chispas de a ratos que no dejan un escalón de 25 dB: en un MP3 es normal (sigue la pared de arriba); sin pérdida, no', () => {
    // un MP3 genuino guarda los agudos de arriba de 16 kHz de a ratos: eso no es un corte
    const lossy = findCutoff(acc(16000, 4, -10), 44100)
    expect(lossy.cutoff).toBeGreaterThan(19500)
    expect(lossy.scraps).toBeUndefined()
    const lossless = findCutoff(acc(16000, 4, -10), 44100, { lossless: true })
    expect(lossless.cutoff).toBeLessThan(16500)
    expect(lossless.scraps).toBe(true)
  })
  it('con pérdida: chispas que no dejan un escalón plano (están casi siempre) no cambian nada', () => {
    const c = findCutoff(acc(16000, 19, -10), 44100, { lossless: false })
    expect(c.scraps).toBeUndefined()
  })
  it('el número suelto sigue valiendo como la frecuencia del formato (32 kHz)', () => {
    const c = findCutoff(acc(15000, 0), 44100, 32000)
    expect(c.formatLimit).toBe(true)
  })
})

// Nota a partir de mediciones de la comparación (sin decodificar)
const raw = (cutoff: Partial<RawAnalysis['cutoff']>): RawAnalysis => ({
  cutoff: { cutoff: 18400, drop: 20, cdEdgeDrop: null, frames: 500, spectrum: [], ...cutoff }, hires: null, effBits: null, flicker: null,
  lufs: -12, lra: 6, truePeak: -1, samplePeak: -1, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, meta: {}, mp3: null, dj: null,
  prints: { audioMd5: null, chromaprint: null, size: null, mtime: null }, ms: 1,
})
const mp3 = (kbps: number): GradeInput => ({ codec: 'mp3', ext: 'mp3', lossless: false, kbps, sampleRate: 44100, bits: null, channels: 2 })

describe('lo que se aprendió de la comparación', () => {
  it('el 010 (MP3 "320", sonido hasta 16,6 kHz y chispas hasta 20,2) → F, y explica los restos', () => {
    const v = grade(mp3(320), raw({ cutoff: 16613, drop: 31, sharp: 31, fall: 40, step16: -2, scraps: true, ceiling: 20155 }))
    expect(v.grade).toBe('F')
    expect(v.is).toBe('MP3 de ~128 kbps (inflado a 320)')
    expect(v.why.join(' ')).toMatch(/restos sueltos que llegan hasta 20,2 kHz/)
  })
  it('un MP3 de 128 genuino se mide entre 15,4 y 16,2 kHz: es "de ~128", no "de ~96"', () => {
    const v = grade(mp3(128), raw({ cutoff: 15429, drop: 40, sharp: 35, fall: 60 }))
    expect(v.is).toBe('MP3 de ~128 kbps')
    expect(v.why.join(' ')).toMatch(/lo esperable para 128 kbps/)
    // inflado a 192 desde uno de esos: "de ~128", como dice Fakin' The Funk (antes decía ~96)
    expect(grade(mp3(192), raw({ cutoff: 15267, drop: 40, sharp: 35, fall: 60 })).is).toBe('MP3 de ~128 kbps (inflado a 192)')
  })
})

describe('espectros reales (tests/fixtures/espectros-restos.json: el promedio de potencia y en dB, 2048 franjas)', () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'espectros-restos.json'), 'utf8')) as Record<string, { frames: number; db: number[]; log: number[] }>
  const accOf = (s: { frames: number; db: number[]; log: number[] }) => {
    const a = new SpectrumAccumulator(4096)
    s.db.forEach((d, k) => { a.power[k] = 10 ** (d / 10) * s.frames; a.logPower[k] = s.log[k] * s.frames })
    a.frames = s.frames
    return a
  }
  it('010 de la comparación (MP3 "320" de slider.kz): corta en ~16,6 kHz, restos hasta ~20 kHz', () => {
    const c = findCutoff(accOf(real['010']), 44100, { lossless: false })
    expect(c.cutoff).toBeGreaterThan(16300)
    expect(c.cutoff).toBeLessThan(16900)
    expect(c.scraps).toBe(true)
    expect(c.ceiling).toBeGreaterThan(19800)
  })
  it('error de la corrida amplia (WAV de YouTube, 13,8 kHz): el promedio en dB suaviza la pared; vale la forma más de golpe → F, no "corte suave"', () => {
    const c = findCutoff(accOf(real['4089']), 44100, { lossless: true })
    expect(c.cutoff).toBeLessThan(14500)
    expect(c.sharp).toBeGreaterThan(12)
    const v = grade({ ...FLAC, codec: 'pcm_s16le', ext: 'wav' }, raw(c))
    expect(v.grade).toBe('F')
    expect(v.flags).not.toContain('as_recorded')
  })
})
