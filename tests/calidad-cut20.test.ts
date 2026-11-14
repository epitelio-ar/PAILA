// El corte de golpe en ~20 kHz en un sin pérdida, en tres casos (decisión del 23/10/2026, tras la comparación con Fakin' The
// Funk: docs/pruebas/2026-10-23-fakin-the-funk.md). Los tres son B; cambia el sello, el filtro y el porqué:
//   1. con evidencia de que el corte es del disco (un programa para CD, una tienda) → "Como fue grabado";
//   2. en seco entre 19,4 y 19,7 kHz, sin evidencia (justo donde corta un MP3 de ~256) → "Puede venir de un MP3";
//   3. en otra frecuencia, sin evidencia → sin sello (B "Suena completo").
import { describe, expect, it } from 'vitest'
import { grade, type GradeInput } from '@paila/core/analysis/grade'
import type { RawAnalysis } from '@paila/core/analysis/analyze'
import type { Clues } from '@paila/core/analysis/clues'
import { PROBLEM_TESTS } from '@paila/shared/trackinfo'
import type { Track } from '@paila/shared/types'
import { selloDe } from '../apps/paila/ui/src/sellos'

const raw = (cutoff: Partial<RawAnalysis['cutoff']>, more: Partial<RawAnalysis> = {}): RawAnalysis => ({
  cutoff: { cutoff: 20000, drop: 40, cdEdgeDrop: null, frames: 500, spectrum: [], ...cutoff }, hires: null, effBits: null, flicker: 1.5,
  lufs: -12, lra: 6, truePeak: -1, samplePeak: -1, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, meta: {}, mp3: null, dj: null,
  prints: { audioMd5: null, chromaprint: null, size: null, mtime: null }, ms: 1, ...more,
})
const flac: GradeInput = { codec: 'flac', ext: 'flac', lossless: true, kbps: 900, sampleRate: 44100, bits: 16, channels: 2 }
const aiff: GradeInput = { ...flac, codec: 'pcm_s16be', ext: 'aiff' }
const nm = (text: string, year: number | null = null): Clues => ({ names: [{ text, from: 'archivo' }], year })
const track = (flags: string[], ext = 'flac'): Track => ({
  id: 1, rootId: 1, rel: `x.${ext}`, kind: 'musica', ext, codec: ext, sampleRate: 44100, bits: 16, channels: 2, kbps: 900, duration: 200,
  artist: 'A', albumArtist: null, title: 'T', album: null, track: null, year: null, genre: null, size: 1, mtime: 1, error: null,
  grade: 'B', isLabel: null, flags: flags.join(','), effKbps: 1411, cutoff: 19500, lufs: null, bpm: null, musicKey: null, camelot: null,
  energy: null, missing: null, tempo: null,
})

describe('el corte de golpe en ~20 kHz, en tres casos', () => {
  it('1. con evidencia (sacado de un CD con XLD) → "Como fue grabado", aunque corte en 19,5 kHz', () => {
    const v = grade(flac, raw({ cutoff: 19509, sharp: 27, fall: 39, step16: 1 }, { meta: { encoder: 'X Lossless Decoder 20151214' } }), nm('09 - Hold the Line.flac', 1978))
    expect(v.grade).toBe('B')
    expect(v.flags).toEqual(['cut20', 'cut20_trusted'])
    expect(v.why.join(' ')).toMatch(/del disco o del master/)
    const t = track(v.flags)
    expect(PROBLEM_TESTS.as_recorded(t)).toBe(true)
    expect(PROBLEM_TESTS.mp3like(t)).toBe(false)
    expect(selloDe(t)?.texto).toBe('Como fue grabado')
  })
  it('2. en seco en 19,5 kHz sin evidencia (el AIFF 183 de la comparación) → "Puede venir de un MP3", B, con las dos posibilidades', () => {
    const v = grade(aiff, raw({ cutoff: 19509, sharp: 27, fall: 39, step16: 1 }, { flicker: 1.12 }), nm('Minimal - Tema.aiff', 2022))
    expect(v.grade).toBe('B')
    expect(v.flags).toEqual(['cut20', 'cut20_mp3like'])
    const why = v.why.join(' ')
    expect(why).toMatch(/unos 256 kbps/)
    expect(why).toMatch(/Puede ser el master/)
    expect(why).toMatch(/un MP3 que alguien pasó a AIFF/)
    expect(why).toMatch(/NAPIA o la Bandeja/)
    const t = track(v.flags, 'aiff')
    expect(PROBLEM_TESTS.mp3like(t)).toBe(true)
    expect(PROBLEM_TESTS.as_recorded(t)).toBe(false)
    const s = selloDe(t)!
    expect([s.texto, s.tono]).toEqual(['Puede venir de un MP3', 'info'])
    expect(s.ayuda).toMatch(/Si querés el original sin pérdida, buscalo con NAPIA o la Bandeja/)
    // los bordes: 19,4 y 19,7 kHz entran; 19,8 no (otra frecuencia: caso 3); 19,3 ya es un MP3 de ~192 disfrazado (F)
    for (const [hz, sale] of [[19400, true], [19700, true], [19800, false]] as const)
      expect(grade(flac, raw({ cutoff: hz, sharp: 27, fall: 39, step16: 1 })).flags.includes('cut20_mp3like')).toBe(sale)
    expect(grade(flac, raw({ cutoff: 19300, sharp: 27, fall: 39, step16: 1 })).grade).toBe('F')
  })
  it('3. en otra frecuencia sin evidencia ("Roxanne", 20,4 kHz) → B "Suena completo", sin sello ni filtro', () => {
    const v = grade(flac, raw({ cutoff: 20392, sharp: 31, fall: 53, step16: 0 }, { flicker: 1.94 }), nm('The Police - Roxanne.flac'))
    expect([v.grade, v.is]).toEqual(['B', 'Suena completo (llega a 20,4 kHz)'])
    expect(v.flags).toEqual(['cut20'])
    expect(v.why.join(' ')).toMatch(/Así cortan algunos CD y masters con filtro/)
    const t = track(v.flags)
    expect(PROBLEM_TESTS.as_recorded(t)).toBe(false)
    expect(PROBLEM_TESTS.mp3like(t)).toBe(false)
    expect(selloDe(t)).toBeNull()
  })
  it('el corte suave (vinilo, master viejo) sigue con su sello "Como fue grabado"', () => {
    const v = grade(flac, raw({ cutoff: 18357, sharp: 8, fall: 30, step16: 1 }, { flicker: 1.44 }))
    expect(v.flags).toEqual(['as_recorded'])
    expect(selloDe(track(v.flags))?.texto).toBe('Como fue grabado')
  })
})
