// Tests de la pasada precisa en segundo plano (core/precise.ts): cuenta votos (otros métodos y Deezer), marca confirmado o
// dudoso sin cambiar valores, corre una sola vez por tema y se vuelve a pedir cuando cambian el BPM y el tono.
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
import { preciseFlags, PRECISE_VERSION } from '@paila/core/precise'
import { Deezer } from '@paila/core/online/sources'
import { OnlineCache } from '@paila/core/online/http'
import { deezerVerdict } from '@paila/core/online/deezerbpm'
import { preciseVotes } from '@paila/core/analysis/dj'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string
let lib: Library

function tone(rel: string) {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', out])
}
const raw = (withDj: boolean): RawAnalysis => ({
  cutoff: { cutoff: 22050, drop: 0, cdEdgeDrop: null, frames: 100, spectrum: [1, 2] }, hires: null, effBits: null, flicker: null,
  lufs: -9, lra: 5, truePeak: -0.5, samplePeak: -0.6, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, mp3: null, ms: 5,
  dj: withDj ? { bpm: 124, key: 'Am', camelot: '8A', keyStrength: 0.8, danceability: 1.5, bpmDoubtful: false, bpmOther: null } : null,
  prints: { audioMd5: null, chromaprint: null, size: null, mtime: null },
})

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-precise-'))
  tone('House/Artista - Tema.flac')
  tone('House/Otro - Cosa.flac')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  lib.db.prepare("UPDATE files SET artist = 'Artista', title = 'Tema' WHERE rel_path LIKE '%Artista%'").run()
})

afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const row = (name: string) => lib.db.prepare('SELECT a.* FROM analysis a JOIN files f ON f.id = a.file_id WHERE f.rel_path LIKE ?').get(`%${name}%`) as Record<string, unknown>
// solo las marcas de BPM y tono (el tono de prueba es mono: tiene también la marca "mono")
const flags = (name: string) => String(row(name).flags ?? '').split(',').filter((f) => f && f !== 'mono').sort()

describe('votos', () => {
  it('BPM confirmado con 3 votos (los dos de la rápida + los golpes); tono confirmado con 3 de 4 perfiles', () => {
    expect(preciseFlags({ base: 124, camelot: '8A', flags: null }, 124.3, ['8A', '8A', '9A'], null).sort()).toEqual(['bpm_ok', 'dj_precise', 'key_ok'])
  })
  it('BPM dudoso de la rápida: con los golpes no alcanza (2 votos); Deezer que confirma suma el tercero', () => {
    expect(preciseFlags({ base: 124, camelot: '8A', flags: 'bpm_doubtful' }, 124, ['5A'], null)).not.toContain('bpm_ok')
    expect(preciseFlags({ base: 124, camelot: '8A', flags: 'bpm_doubtful' }, 124, ['5A'], 124.5)).toContain('bpm_ok')
  })
  it('ningún otro perfil da el mismo tono → dudoso; no toca las marcas de calidad', () => {
    expect(preciseFlags({ base: 124, camelot: '8A', flags: 'clipping,bpm_ok' }, null, ['3B', '5A', '11A'], null).sort()).toEqual(['clipping', 'dj_precise', 'key_doubtful'])
  })
  it('Deezer: confirma, doble, mitad o distinto', () => {
    expect(deezerVerdict(84, 84.5)).toBe('confirma')
    expect(deezerVerdict(84, 168.8)).toBe('doble')
    expect(deezerVerdict(170, 85)).toBe('mitad')
    expect(deezerVerdict(120, 100)).toBe('distinto')
    expect(deezerVerdict(120, null)).toBeNull()
  })
})

describe('pasada precisa', () => {
  it('corre después de la rápida, una vez por tema, con Deezer de segunda opinión; no cambia BPM ni tono', async () => {
    const calls: string[] = []
    const urls: string[] = []
    // Deezer de mentira: encuentra "Artista - Tema" (1 s) y dice 124,1 BPM
    const fakeFetch = (async (url: string) => {
      urls.push(url)
      const body = url.includes('/search') ? { data: [{ id: 7, title: 'Tema', duration: 1, artist: { name: 'Artista' } }] } : { bpm: 124.1, gain: -9 }
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() }
    }) as unknown as typeof fetch
    lib.secondOpinion = () => ({ dz: new Deezer(fakeFetch, 0), cache: new OnlineCache(lib.db) })
    const runner: AnalysisRunner = {
      full: async (j) => raw(j.withDj), prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }),
      precise: async (j) => { calls.push(path.basename(j.file)); return { beatsBpm: 140, keys: ['8A', '3B', '8A'] } }, // los golpes no confirman
    }
    expect(lib.pendingPrecise()).toBe(0)
    await lib.analyze(runner, ffmpeg, 1)
    expect(calls.sort()).toEqual(['Artista - Tema.flac', 'Otro - Cosa.flac'])
    // "Artista - Tema": 2 votos de la rápida + Deezer = confirmado; "Otro - Cosa" no tiene tags: sin Deezer, 2 votos
    expect(flags('Artista')).toEqual(['bpm_ok', 'dj_precise', 'key_ok'])
    expect(flags('Otro')).toEqual(['dj_precise', 'key_ok'])
    expect(row('Artista')).toMatchObject({ bpm: 124, camelot: '8A', precise_v: PRECISE_VERSION })
    expect(urls.some((u) => u.includes('/track/7'))).toBe(true)
    expect(lib.pendingPrecise()).toBe(0)
    expect(lib.insights().precise).toBe(0)
    // la segunda vez no repite nada
    await lib.analyze(runner, ffmpeg, 1)
    expect(calls).toHaveLength(2)
  })

  it('la calidad se rehace y las marcas de BPM y tono quedan; si se recalcula el BPM, la precisa se vuelve a pedir', async () => {
    lib.db.prepare('UPDATE analysis SET quality_v = NULL').run()
    const runner: AnalysisRunner = { full: async (j) => raw(j.withDj), prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }) }
    await lib.analyze(runner, ffmpeg, 1)
    expect(flags('Artista')).toEqual(['bpm_ok', 'dj_precise', 'key_ok'])
    lib.db.prepare('UPDATE analysis SET dj_v = 1').run()
    lib.secondOpinion = null
    await lib.analyze(runner, ffmpeg, 1) // sin `precise` en el runner: la pasada precisa no corre
    expect(row('Artista').precise_v).toBeNull()
    expect(flags('Artista')).toEqual([])
    expect(lib.pendingPrecise()).toBe(2)
  })
})

describe('votos con el motor real', () => {
  it('un pulso a 120 BPM: el tempo de los golpes da 120 y vienen los tres tonos', () => {
    const mono = new Float32Array(44100 * 60).map((_, i) => Math.sin(i / 20) * (i % 22050 < 2000 ? 1 : 0.1))
    const v = preciseVotes(mono)
    expect(v.beatsBpm).toBeGreaterThan(118)
    expect(v.beatsBpm).toBeLessThan(122)
    expect(v.keys).toHaveLength(3)
  }, 120_000)
})
