// Tests de las pasadas que rehacen una parte del análisis (core/reanalysis.ts): la nota de calidad con el motor nuevo
// (sin tocar BPM, tono ni huellas) y el BPM puesto en el rango de cada género (sin decodificar).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import type { AnalyzeJob, RawAnalysis } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { applyBpmStyles, BPM_STYLES_SETTING, DJ_VERSION, QUALITY_VERSION } from '@paila/core/reanalysis'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string
let lib: Library

function tone(rel: string) {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', out])
}

// un FLAC de 32 kHz que el motor viejo había marcado F ("MP3 disfrazado"); sin año, desde el 22/10 es D (viene de algo comprimido)
const raw32k = (withDj: boolean): RawAnalysis => ({
  cutoff: { cutoff: 16000, drop: 0, cdEdgeDrop: null, frames: 100, spectrum: [1, 2], formatLimit: true },
  hires: null, effBits: null, flicker: null, lufs: -9, lra: 5, truePeak: -0.5, samplePeak: -0.6, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1,
  decodeErrors: 0, meta: {}, mp3: null, dj: withDj ? { bpm: 170, key: 'Am', camelot: '8A', keyStrength: 0.8, danceability: 1.5 } : null, ms: 5,
  prints: { audioMd5: null, chromaprint: null, size: null, mtime: null },
})

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-reanalysis-'))
  tone('Cumbia/Los Palmeras - La Suavecita.flac')
  tone('Rock/Sumo - Mejor no hablar.flac')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
})

afterAll(() => {
  lib.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const row = (name: string) => lib.db.prepare(`SELECT a.* FROM analysis a JOIN files f ON f.id = a.file_id WHERE f.rel_path LIKE ?`).get(`%${name}%`) as Record<string, unknown>

describe('pasadas que rehacen una parte del análisis', () => {
  it('análisis nuevo: BPM en el rango del género (carpeta Cumbia: 170 → 85) y bpm_base en el general', async () => {
    const runner: AnalysisRunner = { full: async (j) => raw32k(j.withDj), prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }) }
    await lib.analyze(runner, ffmpeg, 1)
    expect(row('Suavecita')).toMatchObject({ bpm: 85, bpm_base: 170, quality_v: QUALITY_VERSION, grade: 'D' })
    expect(row('Sumo')).toMatchObject({ bpm: 170, bpm_base: 170 })
  })

  it('nota de un motor viejo → se vuelve a medir solo la calidad, conservando BPM, tono y "BPM dudoso"', async () => {
    lib.db.prepare("UPDATE analysis SET quality_v = NULL, grade = 'F', flags = 'fake_lossless,bpm_doubtful', is_label = 'MP3 de ~128 kbps disfrazado'").run()
    expect(lib.pendingQuality()).toBe(2)
    expect(lib.insights().quality).toBe(2)
    const jobs: AnalyzeJob[] = []
    const runner: AnalysisRunner = { full: async (j) => { jobs.push(j); return raw32k(j.withDj) }, prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }) }
    await lib.analyze(runner, ffmpeg, 1)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => j.withDj === false && j.withPrints === false)).toBe(true)
    const r = row('Suavecita')
    expect(r).toMatchObject({ grade: 'D', quality_v: QUALITY_VERSION, bpm: 85, music_key: 'Am' })
    expect(String(r.flags).split(',').sort()).toEqual(['bpm_doubtful', 'low_samplerate', 'maybe_transcoded', 'mono']) // el tono de prueba es mono
    expect(lib.pendingQuality()).toBe(0)
  })

  it('tema de Música sin BPM ni tono (no salieron en el primer análisis) → la pasada los completa, una sola vez', async () => {
    // en la base real había 1.259 así (docs/archivo/pruebas/2026-10-20-analisis-2.md)
    lib.db.prepare("UPDATE analysis SET bpm = NULL, bpm_base = NULL, music_key = NULL, camelot = NULL, dj_v = NULL, bpm_source = NULL WHERE file_id = (SELECT id FROM files WHERE rel_path LIKE '%Sumo%')").run()
    expect(lib.pendingQuality()).toBe(1)
    const jobs: AnalyzeJob[] = []
    const runner: AnalysisRunner = { full: async (j) => { jobs.push(j); return raw32k(j.withDj) }, prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }) }
    await lib.analyze(runner, ffmpeg, 1)
    expect(jobs.map((j) => j.withDj)).toEqual([true])
    expect(row('Sumo')).toMatchObject({ music_key: 'Am', camelot: '8A', bpm: 170, bpm_source: 'mixto', dj_v: DJ_VERSION })
    expect(row('Suavecita').bpm).toBe(85) // el otro no se tocó
    expect(lib.pendingQuality()).toBe(0)
  })

  it('cambiar los rangos vuelve a poner el BPM sin decodificar, y se puede volver atrás', () => {
    lib.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(BPM_STYLES_SETTING, JSON.stringify([{ name: 'Rock', words: ['rock'], min: 60 }]))
    expect(applyBpmStyles(lib.db)).toBe(2) // la cumbia vuelve al rango general (170) y el rock queda en 60–120 (85)
    expect(row('Suavecita').bpm).toBe(170)
    expect(row('Sumo').bpm).toBe(85)
    lib.db.prepare('DELETE FROM settings WHERE key = ?').run(BPM_STYLES_SETTING)
    expect(applyBpmStyles(lib.db)).toBe(2)
    expect(row('Suavecita').bpm).toBe(85)
    expect(row('Sumo').bpm).toBe(170)
  })
})

describe('migración v30 (calidad que decide sola, 22/10/2026)', () => {
  it('deja al día los MP3 y AAC sin volver a leerlos; los sin pérdida, los de corte suave y los dañados se vuelven a medir', () => {
    const root = (lib.db.prepare('SELECT id FROM roots').get() as { id: number }).id
    const add = (rel: string, ext: string, codec: string | null, flags: string | null) => {
      const id = Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec) VALUES (?, ?, 1, 1, 'musica', ?, ?)").run(root, rel, ext, codec).lastInsertRowid)
      lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, flags, quality_v) VALUES (?, 1, 1, 1, 'x', 'B', ?, 2)").run(id, flags)
      return id
    }
    const ids = {
      mp3: add('v30/a.mp3', 'mp3', 'mp3', null), aac: add('v30/b.m4a', 'm4a', 'aac', 'clipping'),
      soft: add('v30/c.mp3', 'mp3', 'mp3', 'soft_cutoff'), damaged: add('v30/d.mp3', 'mp3', 'mp3', 'damaged'),
      flac: add('v30/e.flac', 'flac', 'flac', null), wav: add('v30/f.wav', 'wav', 'pcm_s16le', null), alac: add('v30/g.m4a', 'm4a', 'alac', null),
    }
    lib.db.prepare('PRAGMA user_version = 29').run()
    lib.close()
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    const qv = (id: number) => (lib.db.prepare('SELECT quality_v FROM analysis WHERE file_id = ?').get(id) as { quality_v: number }).quality_v
    expect(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, qv(id)]))).toEqual({ mp3: 4, aac: 4, soft: 2, damaged: 2, flac: 2, wav: 2, alac: 2 }) // v38 deja al día los con pérdida sin escalón; la v44 los pasa a 5 y la v46 los vuelve a 4 para releer toda la Música
    for (const id of Object.values(ids)) { lib.db.prepare('DELETE FROM analysis WHERE file_id = ?').run(id); lib.db.prepare('DELETE FROM files WHERE id = ?').run(id) }
  })
})

describe('migración v31 (FLAC "dañados" por el tag viejo de MP3 al final, 22/10/2026)', () => {
  it('vuelve a medir los dañados que no son MP3; los MP3 dañados y los sanos quedan como estaban', () => {
    const root = (lib.db.prepare('SELECT id FROM roots').get() as { id: number }).id
    const add = (rel: string, ext: string, codec: string, flags: string | null) => {
      const id = Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec) VALUES (?, ?, 1, 1, 'musica', ?, ?)").run(root, rel, ext, codec).lastInsertRowid)
      lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, flags, quality_v) VALUES (?, 1, 1, 1, 'x', 'F', ?, 3)").run(id, flags)
      return id
    }
    const ids = { flac: add('v31/a.flac', 'flac', 'flac', 'damaged'), mp3: add('v31/b.mp3', 'mp3', 'mp3', 'damaged,low_bitrate'), sano: add('v31/c.flac', 'flac', 'flac', null) }
    lib.db.prepare('PRAGMA user_version = 30').run()
    lib.close()
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    const qv = (id: number) => (lib.db.prepare('SELECT quality_v FROM analysis WHERE file_id = ?').get(id) as { quality_v: number }).quality_v
    expect(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, qv(id)]))).toEqual({ flac: 2, mp3: 4, sano: 3 }) // v38: el MP3 sin escalón queda al día del motor 4; el FLAC sano se vuelve a medir
    for (const id of Object.values(ids)) { lib.db.prepare('DELETE FROM analysis WHERE file_id = ?').run(id); lib.db.prepare('DELETE FROM files WHERE id = ?').run(id) }
  })
})

describe('migración v38 (restos arriba del corte, comparación con Fakin’ The Funk, 23/10/2026)', () => {
  it('vuelve a medir los sin pérdida (también los de corte en 20 kHz, para su sello nuevo) y los con pérdida con un escalón en el espectro guardado; el resto queda al día', () => {
    const root = (lib.db.prepare('SELECT id FROM roots').get() as { id: number }).id
    // 128 franjas de ~172 Hz: parejo hasta `step` Hz, 30 dB menos hasta `top` y nada arriba (sin `step`: parejo hasta `top`)
    const spec = (top: number, step?: number) => JSON.stringify(Array.from({ length: 128 }, (_, i) => { const hz = i * 172.27; return hz >= top ? -90 : step && hz >= step ? -30 : 0 }))
    const add = (rel: string, ext: string, codec: string, cutoff: number, spectrum: string | null) => {
      const id = Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec) VALUES (?, ?, 1, 1, 'musica', ?, ?)").run(root, rel, ext, codec).lastInsertRowid)
      lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, cutoff, spectrum, quality_v) VALUES (?, 1, 1, 1, 'x', 'B', ?, ?, 3)").run(id, cutoff, spectrum)
      return id
    }
    const ids = {
      // el 010 de la comparación: sonido hasta 16,6 kHz y restos hasta 20,2
      restos: add('v38/a.mp3', 'mp3', 'mp3', 20155, spec(20155, 16600)),
      sano: add('v38/b.mp3', 'mp3', 'mp3', 20155, spec(20155)),
      sinEspectro: add('v38/c.mp3', 'mp3', 'mp3', 20155, null),
      flac: add('v38/d.flac', 'flac', 'flac', 22050, spec(22050)),
      // un sin pérdida con el corte de golpe en 19,5 kHz (cut20 de antes): se vuelve a medir y recibe cut20_mp3like o cut20_trusted
      cut20: add('v38/e.flac', 'flac', 'flac', 19509, spec(19509)),
    }
    lib.db.prepare('PRAGMA user_version = 37').run()
    lib.close()
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    const qv = (id: number) => (lib.db.prepare('SELECT quality_v FROM analysis WHERE file_id = ?').get(id) as { quality_v: number }).quality_v
    expect(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, qv(id)]))).toEqual({ restos: 3, sano: 4, sinEspectro: 4, flac: 3, cut20: 3 }) // los que v38 deja al día: la v44 los pasa a 5 y la v46 los vuelve a 4 (se relee toda la Música)
    expect(QUALITY_VERSION).toBe(5)
    for (const id of Object.values(ids)) { lib.db.prepare('DELETE FROM analysis WHERE file_id = ?').run(id); lib.db.prepare('DELETE FROM files WHERE id = ?').run(id) }
  })
})
