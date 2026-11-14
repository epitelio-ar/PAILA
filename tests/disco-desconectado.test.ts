// Tests del disco que se desconecta en medio del análisis (core/readguard.ts), de lo que pasó el 21/10/2026: se
// desenchufó el SSD con la pasada precisa andando y PAILA marcó 946 temas como hechos sin leerlos. Ahora, en cada pasada
// (completa, huellas, calidad, precisa y la grilla): si la carpeta no está, el análisis se pausa solo con el aviso, no
// marca nada y sigue solo cuando vuelve; un archivo que no está se saltea sin marcar; solo un error del archivo cuenta,
// después de MAX_TRIES intentos. También: la reparación de la base (migración v25), el vigilante de discos y el tiempo estimado.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import type { RawAnalysis } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { MAX_TRIES, driveOf } from '@paila/core/readguard'
import { RootsWatch } from '@paila/core/rootswatch'
import { gridPass } from '@paila/core/gridrun'
import { EtaMeter } from '@paila/shared/eta'
import type { RootInfo } from '@paila/shared/types'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const N = 8
let dir: string
let lib: Library
const music = () => path.join(dir, 'M')
const away = () => path.join(dir, 'M-desenchufado')

const raw = (): RawAnalysis => ({
  cutoff: { cutoff: 22050, drop: 0, cdEdgeDrop: null, frames: 100, spectrum: [1, 2] }, hires: null, effBits: null, flicker: null,
  lufs: -9, lra: 5, truePeak: -0.5, samplePeak: -0.6, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, mp3: null, ms: 5,
  dj: { bpm: 124, key: 'Am', camelot: '8A', keyStrength: 0.8, danceability: 1.5, bpmDoubtful: false, bpmOther: null },
  prints: { audioMd5: 'a'.repeat(32), chromaprint: 'AQAAAA', size: 1, mtime: 1 },
})
const printsOk = () => ({ audioMd5: 'b'.repeat(32), chromaprint: 'AQAAAA', size: 1, mtime: 1 })

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-disco-'))
  fs.mkdirSync(music(), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(music(), 'tema-0.flac')])
  for (let i = 1; i < N; i++) fs.copyFileSync(path.join(music(), 'tema-0.flac'), path.join(music(), `tema-${i}.flac`))
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  lib.diskPollMs = 30
  await lib.addRoot(music(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
})

afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

beforeEach(() => { if (fs.existsSync(away())) fs.renameSync(away(), music()) })

const count = (where: string) => (lib.db.prepare(`SELECT COUNT(*) AS n FROM analysis WHERE ${where}`).get() as { n: number }).n
const until = async (ok: () => boolean, ms = 5000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error('no pasó'); await new Promise((r) => setTimeout(r, 10)) } }

/**
 * Un runner de mentira que "lee" el archivo: si la carpeta no está, falla como ffmpeg (No such file or directory). En la
 * lectura número `at`, la carpeta desaparece (se renombra, como desenchufar el disco) y esa lectura falla.
 */
function unplugAt(at: number) {
  let n = 0
  const read = <T>(file: string, ok: () => T): T => {
    if (++n === at) fs.renameSync(music(), away())
    if (!fs.existsSync(file)) throw new Error(`${file}: No such file or directory`)
    return ok()
  }
  const runner: AnalysisRunner = {
    full: async (j) => read(j.file, raw),
    prints: async (j) => read(j.file, printsOk),
    precise: async (j) => read(j.file, () => ({ beatsBpm: 124, keys: ['8A', '8A', '8A'] })),
  }
  return { runner, reads: () => n }
}

/** Corre el análisis, espera a que se pause por el disco, mira que no se haya marcado nada de más, y lo vuelve a conectar. */
async function unplugDuring(pendingSql: string, doneSql: string) {
  const { runner } = unplugAt(4)
  const before = count(doneSql)
  const run = lib.analyze(runner, ffmpeg, 1)
  await until(() => lib.status.paused)
  expect(lib.status.waitingDisk).toBe(music()) // el disco está: falta la carpeta (con el disco afuera sería "D:")
  if (process.platform === 'win32') expect(driveOf('D:\\Música')).toBe('D:')
  expect(driveOf('/Volumes/SSD EXTERNO/Música')).toBe('/Volumes/SSD EXTERNO')
  expect(lib.status.pauseReason).toMatch(/No se encuentra la carpeta .* sigue solo cuando vuelva; no se marcó nada/)
  // con el disco afuera: solo quedaron hechos los 3 que se leyeron antes, y ninguno con error
  await new Promise((r) => setTimeout(r, 150))
  expect(count(doneSql) - before).toBeLessThanOrEqual(3)
  expect(count('error IS NOT NULL')).toBe(0)
  expect(lib.status.errors).toBe(0)
  // vuelve el disco: sigue solo y termina todo
  fs.renameSync(away(), music())
  const s = await run
  expect(s.paused).toBe(false)
  expect(s.waitingDisk).toBeNull()
  expect(s.errors).toBe(0)
  expect(count(pendingSql)).toBe(0)
  expect(count('error IS NOT NULL')).toBe(0)
}

describe('el disco se desconecta en medio de una pasada', () => {
  it('análisis completo: pausa, no guarda errores y sigue al volver', async () => {
    lib.db.prepare('DELETE FROM analysis').run()
    await unplugDuring('0', 'grade IS NOT NULL')
    expect(count('grade IS NOT NULL')).toBe(N)
  })

  it('huellas: no las anota como intentadas', async () => {
    lib.db.prepare('UPDATE analysis SET audio_md5 = NULL, chromaprint = NULL, prints_at = NULL').run()
    await unplugDuring('prints_at IS NULL', "audio_md5 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'")
    expect(count("audio_md5 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'")).toBe(N)
  })

  it('calidad: no la marca como revisada', async () => {
    lib.db.prepare('UPDATE analysis SET quality_v = 1, grade = NULL').run()
    lib.db.prepare("UPDATE analysis SET grade = 'B'").run()
    await unplugDuring('COALESCE(quality_v, 1) < 2', 'quality_v >= 2')
  })

  it('precisa: no marca precise_v sin leer el tema (lo del 21/10)', async () => {
    lib.db.prepare('UPDATE analysis SET precise_v = NULL, flags = NULL').run()
    await unplugDuring('precise_v IS NULL', 'precise_v IS NOT NULL')
    expect(count("flags LIKE '%dj_precise%'")).toBe(N)
    expect(lib.pendingPrecise()).toBe(0)
  })

  it('si lo detienen mientras espera el disco, corta sin marcar nada', async () => {
    lib.db.prepare('UPDATE analysis SET precise_v = NULL, flags = NULL').run()
    const { runner } = unplugAt(2)
    const run = lib.analyze(runner, ffmpeg, 1)
    await until(() => lib.status.paused)
    lib.stop()
    const s = await run
    expect(s.phase).toMatch(/detenido/)
    expect(count('precise_v IS NOT NULL')).toBeLessThanOrEqual(1)
    expect(lib.pendingPrecise()).toBeGreaterThanOrEqual(N - 1)
  })

  it('si el usuario ya lo había pausado, al volver el disco sigue en pausa', async () => {
    lib.db.prepare('UPDATE analysis SET precise_v = NULL, flags = NULL').run()
    const { runner } = unplugAt(2)
    const run = lib.analyze(runner, ffmpeg, 1)
    await until(() => !!lib.status.waitingDisk)
    lib.resume() // el usuario aprieta Seguir con el disco afuera…
    lib.pause() // …y después Pausar
    fs.renameSync(away(), music())
    await until(() => !lib.status.waitingDisk)
    expect(lib.status.paused).toBe(true)
    lib.resume()
    await run
    expect(lib.pendingPrecise()).toBe(0)
  })
})

describe('archivos que faltan y errores del archivo', () => {
  it('un archivo que no está (con la carpeta presente) se saltea sin marcar y avisa', async () => {
    lib.db.prepare('UPDATE analysis SET precise_v = NULL, flags = NULL').run()
    const gone = path.join(music(), 'tema-5.flac')
    fs.renameSync(gone, gone + '.aparte')
    try {
      const s = await lib.analyze(unplugAt(0).runner, ffmpeg, 2)
      expect(s.errors).toBe(0)
      expect(s.paused).toBe(false)
      expect(lib.pendingPrecise()).toBe(1)
      expect(s.warnings.join(' ')).toMatch(/1 tema no estaba en su carpeta/)
    } finally { fs.renameSync(gone + '.aparte', gone) }
  })

  it('un error del archivo: se prueba MAX_TRIES veces y recién ahí se anota; uno que falla una vez se salva', async () => {
    lib.db.prepare('UPDATE analysis SET precise_v = NULL, flags = NULL').run()
    const tries = new Map<string, number>()
    const runner: AnalysisRunner = {
      full: async () => raw(), prints: async () => printsOk(),
      precise: async (j) => {
        const b = path.basename(j.file)
        tries.set(b, (tries.get(b) ?? 0) + 1)
        if (b === 'tema-2.flac') throw new Error('archivo dañado')
        if (b === 'tema-3.flac' && tries.get(b) === 1) throw new Error('El proceso de análisis se cerró')
        return { beatsBpm: 124, keys: ['8A', '8A', '8A'] }
      },
    }
    const s = await lib.analyze(runner, ffmpeg, 2)
    expect(tries.get('tema-2.flac')).toBe(MAX_TRIES)
    expect(tries.get('tema-3.flac')).toBe(2)
    expect(s.errors).toBe(1)
    expect(lib.pendingPrecise()).toBe(0) // el dañado quedó anotado como intentado
    expect(count("flags LIKE '%dj_precise%'")).toBe(N - 1)
  })
})

describe('reparación al abrir (migración v25)', () => {
  it('vuelve a poner como pendientes los que la precisa marcó sin resultado, y nada más', async () => {
    lib.db.prepare("UPDATE analysis SET precise_v = 1, flags = 'clipping,dj_precise,bpm_ok'").run()
    const ids = (lib.db.prepare('SELECT file_id FROM analysis ORDER BY file_id').all() as { file_id: number }[]).map((r) => r.file_id)
    lib.db.prepare("UPDATE analysis SET flags = 'clipping' WHERE file_id = ?").run(ids[0])
    lib.db.prepare('UPDATE analysis SET flags = NULL WHERE file_id = ?').run(ids[1])
    lib.db.prepare("UPDATE analysis SET flags = 'dj_precise_x' WHERE file_id = ?").run(ids[2])
    lib.db.prepare("UPDATE analysis SET error = 'F:\\x.flac: No such file or directory' WHERE file_id = ?").run(ids[3])
    lib.db.prepare('PRAGMA user_version = 24').run()
    lib.close()
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    lib.diskPollMs = 30
    const pv = (id: number) => (lib.db.prepare('SELECT precise_v FROM analysis WHERE file_id = ?').get(id) as { precise_v: number | null } | undefined)?.precise_v
    expect(pv(ids[0])).toBeNull()
    expect(pv(ids[1])).toBeNull()
    expect(pv(ids[2])).toBeNull()
    expect(pv(ids[3])).toBeUndefined() // el análisis con "No such file" se borró: se vuelve a analizar
    expect(pv(ids[4])).toBe(1)
    expect((lib.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBeGreaterThanOrEqual(25)
  })
})

describe('grilla', () => {
  it('si se va el disco, espera y repite el mismo tema; no lo da por fallado', async () => {
    let here = true
    const calls: number[] = []
    let waited = 0
    const res = await gridPass(lib.db, { saveGrid: () => {}, saveSuggested: () => {} } as never, [1, 2, 3], () => (here ? 'x.flac' : null),
      async () => {
        calls.push(calls.length)
        if (calls.length === 2) { here = false; throw new Error('No such file or directory') }
        return { method: 'degara', grid: { bpm: 124 }, cues: [] } as never
      }, () => {}, () => false,
      { ok: () => here, wait: async () => { waited++; here = true; return true } })
    expect(waited).toBe(1)
    expect(res.failed).toEqual([])
    expect(res.done).toBe(3)
  })
})

describe('vigilante de discos (el puntito de la barra lateral)', () => {
  it('avisa cuando un disco se va y cuando vuelve', () => {
    let available = true
    const roots = (): RootInfo[] => [{ id: 1, path: 'D:\\Música', volumeLabel: 'SSD', volumeSerial: 'x', available, rules: [] }]
    const seen: { avail: boolean; back: number[] }[] = []
    const w = new RootsWatch(roots, (r, back) => seen.push({ avail: r[0].available, back }))
    expect(w.check()).toBe(false)
    available = false
    expect(w.check()).toBe(true)
    available = true
    w.check()
    expect(seen).toEqual([{ avail: false, back: [] }, { avail: true, back: [1] }])
  })
})

describe('tiempo estimado', () => {
  it('sale del promedio suavizado, no del último instante', () => {
    const m = new EtaMeter()
    // 10 por minuto durante 3 minutos, después un tirón de 5 temas en 1 segundo
    for (let s = 0; s <= 180; s += 6) m.add(s * 1000, s / 6)
    m.add(181_000, 35)
    const e = m.estimate(100)
    expect(e.perMinute).toBeGreaterThan(9)
    expect(e.perMinute).toBeLessThan(14)
    expect(e.minutes).toBeGreaterThan(7)
  })

  it('con errores en cadena no promete nada', () => {
    const m = new EtaMeter()
    for (let s = 0; s <= 40; s++) m.add(s * 1000, s * 50, s * 49)
    const e = m.estimate(2000)
    expect(e.doubtful).toBe(true)
    expect(e.minutes).toBeNull()
  })

  it('no dice "menos de 1 min" con medio minuto mirando y muchos por hacer', () => {
    const m = new EtaMeter()
    for (let s = 0; s <= 30; s++) m.add(s * 1000, s * 20)
    expect(m.estimate(1100).minutes).toBeNull() // 1.200 por minuto: daría 55 s, pero solo se vieron 600
    expect(m.estimate(100).minutes).toBeLessThan(1)
  })

  it('el tiempo en pausa no baja el ritmo', () => {
    const m = new EtaMeter()
    for (let s = 0; s <= 60; s += 5) m.add(s * 1000, s)
    m.gap()
    m.add(600_000, 60)
    for (let s = 605; s <= 660; s += 5) m.add(s * 1000, 60 + (s - 600))
    expect(m.estimate(60).perMinute).toBeGreaterThan(50)
  })
})
