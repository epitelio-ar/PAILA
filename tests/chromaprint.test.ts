// Tests de la huella acústica (core/analysis/chromaprint.ts): calcular, codificar y comparar huellas del sonido.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { chromaprint, chromaFilter, decodeFingerprint, encodeFingerprint, fingerprintSimilarity } from '@paila/core/analysis/chromaprint'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const fixtures = path.join(__dirname, 'fixtures', 'chromaprint')

/** Decodifica como lo hace el análisis: mono, 16 bits, 11.025 Hz, con el remuestreo de fpcalc. */
function pcm(file: string, pre: string[] = [], channels = 1): Int16Array {
  const b = execFileSync(ffmpeg, ['-v', 'error', ...pre, '-i', file, '-af', chromaFilter(channels), '-f', 's16le', '-'], { maxBuffer: 1 << 28 })
  return new Int16Array(b.buffer, b.byteOffset, b.length >> 1)
}

describe('huella acústica (Chromaprint)', () => {
  it('da exactamente la misma huella que el fpcalc oficial', () => {
    const fp = chromaprint(pcm(path.join(fixtures, 'test.mp3')))
    const ref = fs.readFileSync(path.join(fixtures, 'test.mp3.fpcalc.out'), 'utf8').match(/FINGERPRINT=(.*)/)![1].trim().split(',').map(Number)
    expect(Array.from(fp)).toEqual(ref)
  })

  it('comprime y descomprime en el formato de AcoustID (vectores de Chromaprint)', () => {
    const text = 'AQAAEwkjrUmSJQpUHflR9mjSJMdZpcO_Imdw9dCO9Clu4_wQPvhCB01w6xAtXNcAp5RASgDBhDSCGGIAcwA'
    const fp = decodeFingerprint(text)
    expect(fp.length).toBe(19)
    expect(fp[0] | 0).toBe(-587455133)
    expect(fp[1] | 0).toBe(-591649759)
    expect(encodeFingerprint(fp)).toBe(text)
    expect(encodeFingerprint([])).toBe('AQAAAA')
    expect(decodeFingerprint('AQAAAA').length).toBe(0)
    // valores con saltos grandes de bits (los "excepcionales" de 5 bits)
    const odd = Uint32Array.from([1 << 31, 0xffffffff, 0, 1 << 8, 7, 0x80000001])
    expect(Array.from(decodeFingerprint(encodeFingerprint(odd)))).toEqual(Array.from(odd))
  })

  it('reconoce el mismo tema en otro formato y calidad, y distingue uno distinto', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-cp-'))
    try {
      const make = (name: string, src: string, args: string[]) => {
        const out = path.join(dir, name)
        execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, ...args, out])
        return out
      }
      // Algo con armonía cambiante (la huella mira las notas): dos acordes que se alternan, 24 s.
      const music = "aevalsrc='0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)+0.1*sin(2*PI*523*t)*gte(mod(t,5),2.5)':s=22050:d=24"
      const other = "aevalsrc='0.3*sin(2*PI*(294+98*gte(mod(t,3),1))*t)+0.2*sin(2*PI*370*t)*lt(mod(t,2),1)':s=22050:d=24"
      const flac = make('a.flac', music, [])
      const mp3 = make('a.mp3', music, ['-b:a', '128k'])
      const quiet = make('a-bajo.wav', music, ['-af', 'volume=0.5'])
      const diff = make('b.flac', other, [])
      const a = chromaprint(pcm(flac)), b = chromaprint(pcm(mp3)), c = chromaprint(pcm(quiet)), d = chromaprint(pcm(diff))
      expect(fingerprintSimilarity(a, b)).toBeGreaterThan(0.9)
      expect(fingerprintSimilarity(a, c)).toBeGreaterThan(0.95)
      expect(fingerprintSimilarity(a, d)).toBeLessThan(0.75)
      // cortado 3 s al principio: se encuentra corriendo una huella contra la otra
      const cut = chromaprint(pcm(flac, ['-ss', '3']))
      expect(fingerprintSimilarity(a, cut)).toBeGreaterThan(0.9)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

// Comparación con el fpcalc oficial: solo si se indica dónde está (no viene con PAILA; se baja aparte de
// github.com/acoustid/chromaprint/releases). Ejemplo: PAILA_FPCALC=C:\fpcalc\fpcalc.exe npm test
describe.skipIf(!process.env.PAILA_FPCALC)('igual que fpcalc (PAILA_FPCALC)', () => {
  it('mono, estéreo y 5.1 dan la misma huella que fpcalc', async () => {
    const { analyzePrints } = await import('@paila/core/analysis/analyze')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-fpcalc-'))
    try {
      const src = "aevalsrc='0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)|0.3*sin(2*PI*(330+55*gte(mod(t,3),1.5))*t)':s=44100:d=30"
      const cases: [string, number, string[]][] = [
        ['mono.flac', 1, ['-ac', '1']], ['estereo.mp3', 2, ['-b:a', '192k']], ['estereo.wav', 2, []], ['cinco-uno.flac', 6, ['-af', 'pan=5.1|FL=c0|FR=c1|FC=0.5*c0+0.5*c1|LFE=0*c0|BL=c0|BR=c1']],
      ]
      for (const [name, channels, args] of cases) {
        const file = path.join(dir, name)
        execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, ...args, file])
        const ref = execFileSync(process.env.PAILA_FPCALC!, ['-raw', file]).toString().match(/FINGERPRINT=(.*)/)![1].trim().split(',').map(Number)
        const mine = decodeFingerprint((await analyzePrints({ ffmpeg, file, channels })).chromaprint!)
        if (channels <= 2) expect(Array.from(mine), name).toEqual(ref)
        else expect(fingerprintSimilarity(mine, ref), name).toBeGreaterThan(0.97) // con más canales, la mezcla de ffmpeg es casi igual
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
