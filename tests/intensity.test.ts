// Tests de la intensidad del análisis: el limitador que cambia en el momento (core/analysis/slots.ts), el plan de cada modo
// (core/analysis/intensity.ts), el grupo de workers que se agranda y se achica, y la cola que lo sigue sin cortar temas.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Slots } from '@paila/core/analysis/slots'
import { plan, threadsFor, RESERVE_MB, WORKER_MB } from '@paila/core/analysis/intensity'
import { WorkerPool, type AnalysisRunner } from '@paila/core/analysis/pool'
import type { RawAnalysis } from '@paila/core/analysis/analyze'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dirs: string[] = []
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

describe('modos', () => {
  it('Tranqui = un cuarto, Normal = la mitad, A fondo = todos menos uno', () => {
    expect([threadsFor('tranqui', 8), threadsFor('normal', 8), threadsFor('fondo', 8)]).toEqual([2, 4, 7])
    expect([threadsFor('tranqui', 2), threadsFor('normal', 2), threadsFor('fondo', 2)]).toEqual([1, 1, 1])
    expect(threadsFor('normal', 32)).toBe(8) // Normal sigue con el tope de antes
  })

  const lots = 16_000
  it('A fondo a batería pasa a Normal; Tranqui a batería se pausa', () => {
    expect(plan({ mode: 'fondo', threads: 8, onBattery: true, freeMb: lots, running: 0 })).toMatchObject({ effective: 'normal', workers: 4, paused: false })
    expect(plan({ mode: 'fondo', threads: 8, onBattery: false, freeMb: lots, running: 0 })).toMatchObject({ effective: 'fondo', workers: 7 })
    expect(plan({ mode: 'tranqui', threads: 8, onBattery: true, freeMb: lots, running: 0 })).toMatchObject({ effective: 'tranqui', workers: 2, paused: true })
    expect(plan({ mode: 'normal', threads: 8, onBattery: true, freeMb: lots, running: 0 }).paused).toBe(false)
  })

  it('con poca memoria libre, menos temas a la vez (contando la que ya usan los que andan)', () => {
    const free = RESERVE_MB + 2 * WORKER_MB
    expect(plan({ mode: 'fondo', threads: 8, onBattery: false, freeMb: free, running: 0 })).toMatchObject({ workers: 2, limitedByMemory: true })
    expect(plan({ mode: 'fondo', threads: 8, onBattery: false, freeMb: free, running: 3 })).toMatchObject({ workers: 5 })
    expect(plan({ mode: 'normal', threads: 8, onBattery: false, freeMb: 100, running: 0 }).workers).toBe(1) // nunca menos de uno
  })
})

describe('Slots', () => {
  it('al achicar no corta lo que está en curso; al agrandar arrancan los que esperaban', async () => {
    const s = new Slots(3)
    for (let i = 0; i < 3; i++) expect(await s.acquire()).toBe(true)
    s.resize(1)
    let got = false
    void s.acquire().then(() => { got = true })
    s.release(); s.release()
    await sleep(5)
    expect(got).toBe(false) // quedan 1 en curso y el tope es 1
    s.release()
    await sleep(5)
    expect(got).toBe(true)
    s.resize(4)
    expect(await s.acquire()).toBe(true)
    expect(s.busy).toBe(2)
  })

  it('cerrar despierta a los que esperan, sin darles lugar', async () => {
    const s = new Slots(1)
    await s.acquire()
    const waiting = s.acquire()
    s.close()
    expect(await waiting).toBe(false)
  })

  it('derive sigue al de arriba (la mitad para el BPM preciso)', () => {
    const s = new Slots(7)
    const half = s.derive((n) => Math.ceil(n / 2))
    expect(half.size).toBe(4)
    s.resize(2)
    expect(half.size).toBe(1)
  })
})

describe('WorkerPool', () => {
  it('se agranda y se achica entre trabajos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-resize-'))
    dirs.push(dir)
    const script = path.join(dir, 'w.cjs')
    // responde con su número de hilo después de un rato
    fs.writeFileSync(script, "const {parentPort,threadId}=require('node:worker_threads');parentPort.on('message',()=>setTimeout(()=>parentPort.postMessage({ok:true,result:threadId}),30))")
    const pool = new WorkerPool(script, 1)
    const job = () => pool.prints({ ffmpeg: 'x', file: 'a', channels: 1 })
    expect(new Set(await Promise.all([job(), job(), job()])).size).toBe(1)
    pool.resize(3)
    expect(new Set(await Promise.all([job(), job(), job()])).size).toBe(3)
    expect(pool.size).toBe(3)
    pool.resize(1)
    await sleep(50)
    expect(pool.size).toBe(1) // los que sobraban estaban libres: se cerraron
    await Promise.all([job(), job()])
    expect(pool.size).toBe(1)
    await pool.close()
  })

  it('reemplaza un worker que quedó con demasiada memoria', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-recycle-'))
    dirs.push(dir)
    const script = path.join(dir, 'w.cjs')
    // dice usar 5 GB: después de cada tema el grupo lo cambia por uno nuevo
    fs.writeFileSync(script, "const {parentPort,threadId}=require('node:worker_threads');parentPort.on('message',()=>parentPort.postMessage({ok:true,result:threadId,mb:5000}))")
    const pool = new WorkerPool(script, 1)
    const job = () => pool.prints({ ffmpeg: 'x', file: 'a', channels: 1 })
    const a = await job(), b = await job()
    expect(a).not.toBe(b)
    expect(pool.size).toBeLessThanOrEqual(1)
    await pool.close()
  })
})

describe('cola con intensidad cambiante', () => {
  it('cambia cuántos temas a la vez en el medio, sin cortar ninguno', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-intens-'))
    dirs.push(dir)
    for (let i = 0; i < 16; i++) {
      const out = path.join(dir, 'M', `Artista - Tema ${i}.mp3`)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 20}:duration=0.3`, out])
    }
    const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    try {
      await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
      await lib.scan()
      let now = 0, peak = 0, done = 0
      const peaks: number[] = []
      const raw = { cutoff: { cutoff: 22000, drop: 0, cdEdgeDrop: null, frames: 1, spectrum: [] }, hires: null, effBits: null, lufs: -9, lra: 5, truePeak: 0, samplePeak: 0,
        clipEvents: 0, stereoCorr: 1, sideRatio: 0, decodeErrors: 0, mp3: null, dj: null, ms: 1, prints: { audioMd5: null, chromaprint: null, size: null, mtime: null } } as RawAnalysis
      const slots = new Slots(1)
      // "A fondo" nunca pide más temas a la vez que núcleos tiene la PC (la revisión de GitHub corre con 2)
      const fondo = Math.min(4, os.availableParallelism())
      const runner: AnalysisRunner = {
        full: async () => {
          now++; peak = Math.max(peak, now)
          await sleep(20)
          now--; done++
          if (done === 4) { peaks.push(peak); peak = 0; slots.resize(fondo) } // a mitad de camino: "A fondo"
          if (done === 12) { peaks.push(peak); peak = 0; slots.resize(2) } // y de vuelta a menos
          return raw
        },
        prints: async () => raw.prints,
      }
      const s = await lib.analyze(runner, ffmpeg, slots)
      peaks.push(peak)
      expect(s.errors).toBe(0)
      expect(done).toBe(16)
      expect(peaks[0]).toBe(1)
      expect(peaks[1]).toBe(fondo)
      expect(peaks[2]).toBeLessThanOrEqual(fondo) // los que estaban en curso terminan; después, de a 2
      expect(lib.pendingAnalysis()).toBe(0)
    } finally { lib.close() }
  })
})
