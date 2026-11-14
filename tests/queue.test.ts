// Tests de la cola de análisis (core/queue.ts): qué se analiza, en qué orden y cómo se guardan los resultados.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { analyzeBpm, analyzeFile, analyzePrints, type AnalyzeJob, type RawAnalysis } from '@paila/core/analysis/analyze'
import { pcmHash } from '@paila/core/audiohash'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { MAX_TRIES } from '@paila/core/readguard'
import { each } from '@paila/core/queue'
import { LibraryJob } from '@paila/core/libraryjob'
import { Slots } from '@paila/core/analysis/slots'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

let dir: string
let lib: Library

function tone(rel: string) {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', out])
}

const fakeRaw = (bpm: number | null, doubtful = false): RawAnalysis => ({
  cutoff: { cutoff: 22000, drop: 0, cdEdgeDrop: null, frames: 100, spectrum: [1, 2] },
  hires: null, effBits: null, lufs: -9, lra: 5, truePeak: -0.5, samplePeak: -0.6, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1,
  decodeErrors: 0, mp3: null, dj: bpm ? { bpm, key: 'Am', camelot: '8A', keyStrength: 0.8, danceability: 1.5, bpmDoubtful: doubtful, bpmOther: doubtful ? 130 : null } : null, ms: 5,
  prints: { audioMd5: 'f'.repeat(32), chromaprint: 'AQAAAA', size: 1, mtime: 1 },
})

/** Simula los workers: anota qué se pidió y en qué orden. */
function fakeRunner(doubtful = false) {
  const calls: AnalyzeJob[] = []
  const printCalls: string[] = []
  const runner: AnalysisRunner = {
    full: async (job) => { calls.push(job); return fakeRaw(job.withDj ? 120 : null, doubtful) },
    prints: async (job) => { printCalls.push(job.file); return { audioMd5: null, chromaprint: null, size: null, mtime: null } },
  }
  return { runner, calls, printCalls }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-queue-'))
  tone('Sets/Set en vivo.mp3')
  tone('Musica/Artista - Tema.mp3')
  tone('Musica/Otro - Tema.flac')
  tone('Samples/Loop_124bpm_Am.wav')
  tone('Amigos/Demo.mp3')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [
    { rel: '', kind: 'musica' }, { rel: 'Sets', kind: 'sets' }, { rel: 'Samples', kind: 'produccion' }, { rel: 'Amigos', kind: 'proyectos' },
  ])
  await lib.scan()
})

afterAll(() => {
  lib.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const byName = (name: string) => {
  const row = lib.tracks().find((r) => String(r[2]).endsWith(name))!
  return { id: row[0] as number, grade: row[21], flags: row[23], bpm: row[27], camelot: row[29] }
}

describe('cola de análisis', () => {
  it('analiza en orden de prioridad, sin decodificar samples y sin BPM en sets', async () => {
    expect(lib.pendingAnalysis()).toBe(5)
    const { runner, calls, printCalls } = fakeRunner()
    const s = await lib.analyze(runner, ffmpeg, 1)
    expect(s.job).toBe('analysis')
    expect(s.errors).toBe(0)
    const order = calls.map((c) => path.basename(c.file))
    // Dentro de Música el orden depende de cómo terminó el escaneo (en paralelo): solo importa que vaya primero.
    expect(order.slice(0, 2).sort()).toEqual(['Artista - Tema.mp3', 'Otro - Tema.flac'])
    expect(order.slice(2)).toEqual(['Demo.mp3', 'Set en vivo.mp3'])
    expect(calls.find((c) => c.file.includes('Set en vivo'))!.withDj).toBe(false)
    expect(calls.find((c) => c.ext === 'flac')!.lossless).toBe(true)

    const sample = byName('Loop_124bpm_Am.wav')
    expect(sample.grade).toBeNull()
    expect(sample.bpm).toBe(124)
    expect(sample.camelot).toBe('8A')

    // BPM de una sola lectura (dos métodos combinados, sin segunda pasada desde la Fase E)
    expect(byName('Artista - Tema.mp3').bpm).toBe(120)
    expect(byName('Artista - Tema.mp3').flags).not.toContain('bpm_doubtful')
    expect(byName('Demo.mp3').bpm).toBe(120)
    expect(lib.getAnalysis(byName('Artista - Tema.mp3').id)!.bpmSource).toBe('mixto')
    expect(lib.pendingAnalysis()).toBe(0)
    // Las huellas salieron de la misma lectura: no hace falta la pasada liviana.
    expect(printCalls).toEqual([])
    expect(lib.pendingPrints()).toBe(0)
  })

  it('no repite lo ya analizado y retoma lo que cambió', async () => {
    const again = fakeRunner()
    await lib.analyze(again.runner, ffmpeg, 1)
    expect(again.calls).toHaveLength(0)

    const f = path.join(dir, 'M', 'Musica', 'Artista - Tema.mp3')
    fs.appendFileSync(f, Buffer.alloc(10))
    await lib.scan()
    expect(lib.pendingAnalysis()).toBe(1)
    const changed = fakeRunner(true)
    await lib.analyze(changed.runner, ffmpeg, 1)
    expect(changed.calls).toHaveLength(1)
    // Los dos métodos no coinciden (120 y 130): queda marcado como BPM dudoso, con lo que dio el otro.
    expect(byName('Artista - Tema.mp3').flags).toContain('bpm_doubtful')
    expect(byName('Artista - Tema.mp3').bpm).toBe(120)
    expect(lib.getAnalysis(byName('Artista - Tema.mp3').id)!.bpmFast).toBe(130)
  })

  it('un archivo que no se puede analizar se prueba MAX_TRIES veces y recién ahí queda con su error', async () => {
    lib.db.prepare('UPDATE analysis SET version = 0').run()
    const seen: string[] = []
    const runner: AnalysisRunner = {
      full: async (job) => { seen.push(path.basename(job.file)); if (job.file.endsWith('Otro - Tema.flac')) throw new Error('roto'); return fakeRaw(job.withDj ? 120 : null) },
      prints: async () => { throw new Error('no debería llamarse') },
    }
    const s = await lib.analyze(runner, ffmpeg, 1)
    expect(seen.filter((x) => x === 'Otro - Tema.flac')).toHaveLength(MAX_TRIES)
    expect(s.errors).toBe(1)
    expect(lib.getAnalysis(byName('Otro - Tema.flac').id)!.error).toBe('roto')
    expect(lib.getAnalysis(byName('Demo.mp3').id)!.error).toBeNull()
    expect(lib.pendingAnalysis()).toBe(0)
  })

  it('se puede detener: lo cortado queda pendiente, sin error', async () => {
    const id = byName('Demo.mp3').id
    lib.db.prepare('UPDATE analysis SET version = 0, error = NULL').run()
    const seen: string[] = []
    let stopping = false
    const runner: AnalysisRunner = {
      full: async (job) => { seen.push(path.basename(job.file)); lib.stop(); stopping = lib.status.stopping; throw new Error('Detenido') },
      prints: async () => { throw new Error('no debería llamarse') },
    }
    const s = await lib.analyze(runner, ffmpeg, 1)
    expect(s.phase).toMatch(/detenido/)
    // la app decide por el dato, no por el texto (que cambia con el idioma): "Deteniendo…" y si sigue con el análisis
    expect(stopping).toBe(true)
    expect(s.outcome).toBe('stopped')
    expect(s.stopping).toBe(false)
    expect(seen).toHaveLength(1)
    expect(lib.getAnalysis(byName(seen[0]).id)!.error).toBeNull()
    expect(lib.pendingAnalysis()).toBeGreaterThanOrEqual(1)
    expect(lib.getAnalysis(id)!.grade).not.toBeNull() // no llegó a tocarlo
  })

  it('funciona con el motor real', async () => {
    lib.db.prepare('DELETE FROM analysis').run()
    const s = await lib.analyze({ full: analyzeFile, bpm: analyzeBpm, prints: analyzePrints }, ffmpeg, 2)
    expect(s.errors).toBe(0)
    const a = lib.getAnalysis(byName('Otro - Tema.flac').id)!
    expect(a.grade).toBeTruthy()
    expect(a.says).toMatch(/FLAC/)
    expect(a.lufs).not.toBeNull()
    // la huella del sonido salió de la misma lectura y coincide con la de Guardar
    const md5 = (lib.db.prepare('SELECT audio_md5 AS m FROM analysis WHERE file_id = ?').get(byName('Otro - Tema.flac').id) as { m: string }).m
    expect(md5).toBe(await pcmHash(ffmpeg, path.join(dir, 'M', 'Musica', 'Otro - Tema.flac')))
  })
})

// Corte real con la app (22/10): la pausa del análisis no corta lo que ya se está leyendo, y "cambiar archivos" esperaba 2,5 s
// fijos. La pasada precisa de un tema largo seguía leyéndolo y Deshacer desde el Historial fallaba con EBUSY.
describe('pausar antes de tocar archivos', () => {
  it('espera a que se suelten los temas que ya se estaban leyendo, y no arranca otros', async () => {
    const job = new LibraryJob()
    job.begin('analysis', 'test')
    const started: number[] = [], finished: number[] = []
    const run = each(job as unknown as Library, [1, 2, 3, 4, 5, 6], new Slots(2), async (n) => {
      started.push(n)
      await new Promise((r) => setTimeout(r, 300)) // un tema largo en la pasada precisa
      finished.push(n)
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(job.reading).toBe(2)
    job.pause()
    const t0 = Date.now()
    expect(await job.idle(5000, 10)).toBe(true)
    expect(Date.now() - t0).toBeGreaterThan(150) // esperó a los dos que estaban leyendo
    expect(job.reading).toBe(0)
    expect(finished.sort()).toEqual([1, 2])
    await new Promise((r) => setTimeout(r, 100))
    expect(started.length).toBe(2) // en pausa no arranca ninguno nuevo
    job.resume()
    await run
    expect(finished.length).toBe(6)
  })
  it('con un tope de tiempo, avisa que todavía queda alguno leyendo', async () => {
    const job = new LibraryJob()
    job.reading = 1
    expect(await job.idle(60, 10)).toBe(false)
  })
})

// Corrida con la app (22/10): la lista de cada pasada se arma al empezar; si mientras tanto PAILA movía un tema (Organizar,
// papelera), el análisis leía la ruta vieja y avisaba "se movió o se borró por fuera de PAILA".
describe('temas que PAILA movió mientras el análisis esperaba', () => {
  it('lee el movido en su lugar nuevo, saltea el que fue a la papelera y no avisa nada raro', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-queue-mov-'))
    const M = (rel: string) => path.join(d, 'M', ...rel.split('/'))
    for (const rel of ['A/uno.mp3', 'A/dos.mp3', 'A/tres.mp3']) {
      fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', M(rel)])
    }
    const l = new Library(path.join(d, 'paila.db'), findFfprobe())
    try {
      await l.addRoot(M(''), [{ rel: '', kind: 'musica' }])
      await l.scan()
      const id = (rel: string) => (l.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
      const files: string[] = []
      let first = true, movido = '', tirado = ''
      const runner: AnalysisRunner = {
        full: async (job) => {
          files.push(path.basename(path.dirname(job.file)) + '/' + path.basename(job.file))
          if (first) {
            first = false
            // lo que haría Organizar y la papelera con el análisis en pausa, con los dos que todavía no se leyeron
            ;[movido, tirado] = ['uno.mp3', 'dos.mp3', 'tres.mp3'].filter((n) => n !== path.basename(job.file))
            fs.mkdirSync(M('B'), { recursive: true })
            fs.renameSync(M(`A/${movido}`), M(`B/${movido}`))
            l.db.prepare('UPDATE files SET rel_path = ? WHERE id = ?').run(`B/${movido}`, id(`A/${movido}`))
            fs.mkdirSync(M('_PAILA/papelera/t'), { recursive: true })
            fs.renameSync(M(`A/${tirado}`), M(`_PAILA/papelera/t/${tirado}`))
            l.db.prepare('UPDATE files SET trashed_at = ? WHERE id = ?').run(new Date().toISOString(), id(`A/${tirado}`))
          }
          return fakeRaw(120)
        },
        prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }),
      }
      const s = await l.analyze(runner, ffmpeg, 1)
      expect(files).toHaveLength(2)
      expect(files[1]).toBe(`B/${movido}`) // el movido, en su lugar nuevo; el tirado, ni se intentó
      expect(s.warnings.filter((w) => /por fuera de PAILA/.test(w))).toEqual([])
      expect(s.probed).toBe(s.toProbe)
    } finally { l.close(); fs.rmSync(d, { recursive: true, force: true }) }
  })
})

// Corte con la app (22/10): desde que Organizar no congela la app, el análisis podía arrancar en medio de Organizar (arranca
// solo, 3 s después de abrir) y leer temas que se estaban moviendo: 2 quedaron sin mover.
describe('el análisis no arranca mientras PAILA cambia archivos', () => {
  it('espera a que termine la operación y recién ahí lee', async () => {
    const { runner, calls } = fakeRunner()
    lib.db.prepare('DELETE FROM analysis').run()
    let soltar!: () => void
    const op = lib.ops.run('cambiando archivos', () => new Promise<void>((r) => { soltar = r }))
    const a = lib.analyze(runner, ffmpeg, 1)
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toHaveLength(0)
    expect(lib.status.running).toBe(false)
    soltar(); await op
    await a
    expect(calls.length).toBeGreaterThan(0)
  })
})
