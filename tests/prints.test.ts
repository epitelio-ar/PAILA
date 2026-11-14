// Huellas del análisis integral: una sola lectura de cada tema saca la huella del sonido (MD5 del PCM) y la acústica
// (Chromaprint); guardar tags usa la huella guardada como "antes" y decodifica una sola vez.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as audiohash from '@paila/core/audiohash'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import { decodeFingerprint, fingerprintSimilarity } from '@paila/core/analysis/chromaprint'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { MAX_TRIES } from '@paila/core/readguard'

// Se cuentan las decodificaciones de "Guardar" (pcmHash) sin cambiar lo que hacen.
vi.mock('@paila/core/audiohash', async (orig) => {
  const m = await orig<typeof import('@paila/core/audiohash')>()
  return { ...m, pcmHash: vi.fn(m.pcmHash) }
})
const pcmHash = audiohash.pcmHash as unknown as ReturnType<typeof vi.fn> & typeof audiohash.pcmHash

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }

let dir: string
let lib: Library
let ch: Changes
const id = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))![0] as number
const prints = (name: string) => lib.db.prepare('SELECT audio_md5 AS md5, audio_size AS size, audio_mtime AS mtime, chromaprint, prints_at FROM analysis WHERE file_id = ?')
  .get(id(name)) as { md5: string | null; size: number | null; mtime: number | null; chromaprint: string | null; prints_at: string | null }

// Algo con notas que cambian (para que la huella acústica tenga de qué agarrarse), 25 s.
const MUSIC = "aevalsrc='0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)':s=44100:d=25"
const make = (name: string, args: string[]) => {
  const out = path.join(dir, 'M', name)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', MUSIC, ...args, out])
  return out
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-prints-'))
  fs.mkdirSync(path.join(dir, 'M'))
  make('uno.mp3', ['-ac', '2', '-b:a', '192k'])
  make('uno.flac', ['-ac', '2'])
  make('dos.wav', ['-ac', '2', '-af', 'volume=0.7'])
  for (let i = 0; i < 5; i++) make(`par${i}.flac`, ['-ac', '1', '-af', `volume=${0.5 + i / 10}`])
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
}, 120_000)

afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })
beforeEach(() => { pcmHash.mockClear() })

describe('una sola lectura saca las dos huellas', () => {
  it('la huella del sonido es la misma que la de Guardar (pcmHash), con el tamaño y la fecha del archivo', async () => {
    for (const name of ['uno.mp3', 'uno.flac', 'dos.wav']) {
      const p = prints(name), file = lib.trackPath(id(name))!
      expect(p.md5).toBe(await audiohash.pcmHash(ffmpeg, file))
      expect(p.size).toBe(fs.statSync(file).size)
      expect(p.mtime).toBe(fs.statSync(file).mtimeMs)
      expect(p.prints_at).not.toBeNull()
    }
    expect(lib.pendingPrints()).toBe(0)
  })

  it('la huella acústica reconoce el mismo tema en MP3 y en FLAC', () => {
    const a = decodeFingerprint(prints('uno.mp3').chromaprint!), b = decodeFingerprint(prints('uno.flac').chromaprint!)
    expect(a.length).toBeGreaterThan(150) // ~8 por segundo
    expect(fingerprintSimilarity(a, b)).toBeGreaterThan(0.9)
  })

  it('la pasada liviana (solo huellas) da exactamente lo mismo que el análisis completo', async () => {
    const file = lib.trackPath(id('uno.mp3'))!
    const p = await analyzePrints({ ffmpeg, file, channels: 2 })
    expect(p.audioMd5).toBe(prints('uno.mp3').md5)
    expect(p.chromaprint).toBe(prints('uno.mp3').chromaprint)
  })
})

describe('pasada liviana para lo analizado antes de que existieran las huellas', () => {
  it('agrega solo las huellas, sin repetir la calidad ni el BPM, y no vuelve a intentar', async () => {
    const before = prints('dos.wav')
    lib.db.prepare('UPDATE analysis SET audio_md5 = NULL, audio_size = NULL, audio_mtime = NULL, chromaprint = NULL, prints_at = NULL').run()
    expect(lib.pendingPrints()).toBe(8)
    const calls = { full: 0, prints: 0 }
    const runner: AnalysisRunner = {
      full: (j) => { calls.full++; return analyzeFile(j) },
      prints: (j) => { calls.prints++; if (j.file.endsWith('par4.flac')) throw new Error('roto'); return analyzePrints(j) },
    }
    const s = await lib.analyze(runner, ffmpeg, 2)
    expect(calls).toEqual({ full: 0, prints: 7 + MAX_TRIES }) // el que falla se prueba MAX_TRIES veces
    expect(s.errors).toBe(1)
    expect(s.phase).toBe('Listo: se agregó la huella a 8 temas')
    expect(prints('dos.wav')).toMatchObject({ md5: before.md5, chromaprint: before.chromaprint, size: before.size })
    // el que falló (después de MAX_TRIES intentos) queda anotado, sin huellas, para no reintentar en cada arranque
    expect(prints('par4.flac')).toMatchObject({ md5: null })
    expect(prints('par4.flac').prints_at).not.toBeNull()
    expect(lib.pendingPrints()).toBe(0)
  })
})

describe('guardar tags con la huella guardada', () => {
  it('decodifica una sola vez (después de escribir) y deja la huella lista para el próximo guardado', async () => {
    const file = lib.trackPath(id('uno.flac'))!
    const md5 = prints('uno.flac').md5
    ch.stage([id('uno.flac')], 'title', 'Primera')
    expect((await ch.apply()).failed).toEqual([])
    expect(pcmHash).toHaveBeenCalledTimes(1)
    expect(readTags(file).title).toBe('Primera')
    // misma huella, ahora con el tamaño y la fecha nuevos
    expect(prints('uno.flac')).toMatchObject({ md5, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs })
    expect(lib.pendingAnalysis()).toBe(0)

    pcmHash.mockClear()
    ch.stage([id('uno.flac')], 'artist', 'Segundo guardado')
    expect((await ch.apply()).failed).toEqual([])
    expect(pcmHash).toHaveBeenCalledTimes(1)
  })

  it('si el archivo cambió desde el análisis, vuelve a sacar la huella de antes', async () => {
    const file = lib.trackPath(id('dos.wav'))!
    const t = new Date(Date.now() - 60_000)
    fs.utimesSync(file, t, t) // otra fecha: la huella guardada ya no vale
    // PAILA ya lo volvió a mirar (si no, Aplicar no lo toca: tests/aplicar.test.ts), pero sin sacarle la huella de nuevo
    lib.db.prepare('UPDATE files SET mtime = ? WHERE id = ?').run(fs.statSync(file).mtimeMs, id('dos.wav'))
    ch.stage([id('dos.wav')], 'title', 'Tocado por otro programa')
    expect((await ch.apply()).failed).toEqual([])
    expect(pcmHash).toHaveBeenCalledTimes(2)
  })

  it('si la huella guardada quedó vieja (otra versión de ffmpeg), lo comprueba con la copia y la corrige', async () => {
    const file = lib.trackPath(id('uno.mp3'))!
    const good = prints('uno.mp3').md5
    lib.db.prepare('UPDATE analysis SET audio_md5 = ? WHERE file_id = ?').run('0'.repeat(32), id('uno.mp3'))
    ch.stage([id('uno.mp3')], 'title', 'Huella vieja')
    expect((await ch.apply()).failed).toEqual([])
    expect(pcmHash).toHaveBeenCalledTimes(2)
    expect(readTags(file).title).toBe('Huella vieja')
    expect(prints('uno.mp3').md5).toBe(good)
  })

  it('aplica varios archivos a la vez y anota todo en el diario', async () => {
    const names = [0, 1, 2, 3].map((i) => `par${i}.flac`)
    ch.stage(names.map(id), 'album', 'En paralelo')
    const seen: number[] = []
    const r = await ch.apply(undefined, { onProgress: (p) => seen.push(p.done) })
    expect(r.failed).toEqual([])
    expect(r.applied).toBe(4)
    for (const n of names) expect(readTags(lib.trackPath(id(n))!).album).toBe('En paralelo')
    expect(seen[seen.length - 1]).toBe(4)
    expect(pcmHash).toHaveBeenCalledTimes(4) // una por archivo
    const u = await ch.undo(r.batchId!)
    expect(u.failed).toEqual([])
    for (const n of names) expect(readTags(lib.trackPath(id(n))!).album).toBeNull()
  })
})
