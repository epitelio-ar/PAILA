// Tests del análisis de calidad y DJ (core/analysis): nota del tema, detección de calidad falsa, BPM y tono.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { grade } from '@paila/core/analysis/grade'
import { djFromName, foldBpm } from '@paila/core/analysis/dj'
import { probe, findFfprobe } from '@paila/core/probe'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string

const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
const NOISE = (sr: number, d = 40) => ['-f', 'lavfi', '-i', `anoisesrc=d=${d}:c=pink:r=${sr}:a=0.3`]

async function verdict(name: string) {
  const file = path.join(dir, name)
  const m = await probe(ffprobe, file)
  const ext = path.extname(file).slice(1)
  const lossless = ['flac', 'wav', 'aiff', 'alac'].includes(m.codec || '') || (m.codec || '').startsWith('pcm_')
  const raw = await analyzeFile({ ffmpeg, file, ext, lossless, sampleRate: m.sampleRate, bits: m.bits, channels: m.channels, duration: m.duration, withDj: true })
  return { raw, v: grade({ codec: m.codec, ext, lossless, kbps: m.kbps, sampleRate: m.sampleRate, bits: m.bits, channels: m.channels }, raw) }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-analysis-'))
  const p = (n: string) => path.join(dir, n)
  ff(...NOISE(44100), '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', p('real.flac'))
  ff('-i', p('real.flac'), '-c:a', 'libmp3lame', '-b:a', '128k', p('m128.mp3'))
  ff('-i', p('m128.mp3'), '-c:a', 'flac', p('falso.flac'))
  ff('-i', p('m128.mp3'), '-c:a', 'libmp3lame', '-b:a', '320k', p('inflado.mp3'))
  ff('-i', p('real.flac'), '-c:a', 'libmp3lame', '-b:a', '320k', p('m320.mp3'))
  ff(...NOISE(96000), '-ac', '2', '-sample_fmt', 's32', '-c:a', 'flac', p('hires.flac'))
  ff('-i', p('real.flac'), '-af', 'aresample=96000', '-sample_fmt', 's32', '-c:a', 'flac', p('hires-falso.flac'))
  ff('-i', p('real.flac'), '-c:a', 'pcm_s24le', p('24falso.wav'))
  ff('-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t\\,60/128)\\,0.03)\\,sin(2*PI*1000*t)\\,0)':d=60:s=44100", '-ac', '2', '-c:a', 'flac', p('click128.flac'))
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('calidad', () => {
  it('FLAC real → A', async () => {
    const { v } = await verdict('real.flac')
    expect(v.grade).toBe('A')
    expect(v.is).toBe('Calidad CD real')
  })
  it('FLAC hecho de un MP3 128 → F, lossless falso', async () => {
    const { v, raw } = await verdict('falso.flac')
    expect(raw.cutoff.cutoff).toBeLessThan(17500)
    expect(v.grade).toBe('F')
    expect(v.flags).toContain('fake_lossless')
  })
  it('MP3 128 re-codificado a 320 → inflado', async () => {
    const { v } = await verdict('inflado.mp3')
    expect(v.flags).toContain('upscaled')
    expect(v.grade).toBe('F')
  })
  it('MP3 320 real → B, y lee la cabecera LAME', async () => {
    const { v, raw } = await verdict('m320.mp3')
    expect(v.grade).toBe('B')
    expect(raw.mp3?.encoder).toMatch(/LAME|Lavc/)
    expect(raw.mp3?.vbrMethod).toBe('CBR')
  })
  it('hi-res real → A+', async () => {
    const { v } = await verdict('hires.flac')
    expect(v.grade).toBe('A+')
  })
  it('CD estirado a 96 kHz → hi-res falso', async () => {
    const { v } = await verdict('hires-falso.flac')
    expect(v.grade).toBe('A')
    expect(v.flags).toContain('fake_hires')
  })
  it('16 bits rellenado a 24 → 24 bits falso', async () => {
    const { v, raw } = await verdict('24falso.wav')
    expect(raw.effBits).toBe(16)
    expect(v.flags).toContain('fake_24bit')
  })
  it('mide volumen y estéreo', async () => {
    const { raw } = await verdict('real.flac')
    expect(raw.lufs).not.toBeNull()
    expect(raw.stereoCorr).not.toBeNull()
  })
})

describe('DJ', () => {
  it('detecta 128 BPM en un metrónomo', async () => {
    const { raw } = await verdict('click128.flac')
    expect(raw.dj?.bpm).toBeGreaterThan(126)
    expect(raw.dj?.bpm).toBeLessThan(130)
  })
  it('pliega BPM a la mitad o el doble', () => {
    expect(foldBpm(64)).toBe(128)
    expect(foldBpm(256)).toBe(128)
  })
  it('lee BPM y tono del nombre de un sample', () => {
    expect(djFromName('VOCALS 130BPM CMajor DEM4')).toMatchObject({ bpm: 130, key: 'C', camelot: '8B' })
    expect(djFromName('Loop_124bpm_Am.wav')).toMatchObject({ bpm: 124, key: 'Am', camelot: '8A' })
    expect(djFromName('VOCALS 150BPM GMinor')).toMatchObject({ bpm: 150, key: 'Gm', camelot: '6A' })
    expect(djFromName('Kick 01.wav')).toMatchObject({ bpm: null, key: null })
  })
})
