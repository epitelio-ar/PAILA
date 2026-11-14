// El proceso de la grilla visto desde la app (core/analysis/gridproc.ts) y el orden de la pasada (core/gridrun.ts). Del punto 1
// real del 24/10: con la grilla de un mix de 77 minutos corriendo como hilo del proceso principal, la app dejó de responder y las
// 4 escrituras de una tanda no terminaron. Ahora es un proceso aparte: si se cierra o se traba, ese tema falla con su motivo y
// el próximo arranca otro; y los temas larguísimos van al final.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GridRunner, type GridPort } from '@paila/core/analysis/gridproc'
import type { GridWorkerIn, GridWorkerOut } from '@paila/core/analysis/gridworker'
import type { GridAnalysis } from '@paila/core/analysis/gridscan'
import { openDb } from '@paila/core/db'
import { DjData } from '@paila/core/djdata'
import { LONG_MINUTES, gridPlan } from '@paila/core/gridrun'

/** Un proceso de mentira: anota lo que recibe y deja contestar desde el test. */
function fakePort() {
  const got: GridWorkerIn[] = []
  let onMsg: (m: GridWorkerOut) => void = () => {}
  let onExit: () => void = () => {}
  const port = { killed: false, got, say: (m: GridWorkerOut) => onMsg(m), exit: () => onExit() }
  const p: GridPort = { post: (m) => got.push(m), onMessage: (cb) => { onMsg = cb }, onExit: (cb) => { onExit = cb }, kill: () => { port.killed = true } }
  return { port, p }
}
const job = { ffmpeg: 'ffmpeg', file: 'x.wav', engine: 'gpu' as const, modelsDir: null, windows: 3 }
const result = { method: 'beatthis', grid: null, cues: [] } as unknown as GridAnalysis
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('el proceso de la grilla', () => {
  it('le contesta los pedazos con la placa de video y devuelve la grilla', async () => {
    const f = fakePort()
    const r = new GridRunner(() => f.p, async (spect) => ({ beat: spect.subarray(0, 2), downbeat: spect.subarray(2, 4) }))
    const out = r.run(job)
    const sent = f.port.got[0] as Extract<GridWorkerIn, { type: 'job' }>
    expect(sent).toMatchObject({ type: 'job', file: 'x.wav', engine: 'gpu' })
    f.port.say({ type: 'model', id: sent.id, req: 7, spect: new Float32Array([1, 2, 3, 4]) })
    await wait(5)
    expect(f.port.got[1]).toMatchObject({ type: 'logits', req: 7, beat: new Float32Array([1, 2]), downbeat: new Float32Array([3, 4]) })
    f.port.say({ type: 'done', id: sent.id, result })
    await expect(out).resolves.toBe(result)
    r.close()
  })

  it('si el proceso se cierra con un tema (un mix enorme, un archivo dañado), ese tema falla con su motivo y el próximo arranca otro', async () => {
    const ports = [fakePort(), fakePort()]
    let n = 0
    const r = new GridRunner(() => ports[n++].p, async () => { throw new Error('no') })
    const a = r.run(job)
    ports[0].port.exit()
    await expect(a).rejects.toThrow(/se cerró/)
    const b = r.run({ ...job, file: 'y.wav' })
    expect(n).toBe(2)
    const sent = ports[1].port.got[0] as Extract<GridWorkerIn, { type: 'job' }>
    ports[1].port.say({ type: 'done', id: sent.id, error: 'No tiene un pulso parejo' })
    await expect(b).rejects.toThrow('No tiene un pulso parejo')
    r.close()
  })

  it('si pasa mucho sin dar señales, lo cierra y saltea el tema; mientras avise que sigue vivo, lo espera', async () => {
    const f = fakePort()
    const r = new GridRunner(() => f.p, async () => ({ beat: new Float32Array(), downbeat: new Float32Array() }), { stallMs: 150, checkMs: 10 })
    await expect(r.run(job)).rejects.toThrow(/sin avanzar/)
    expect(f.port.killed).toBe(true)
    const g = fakePort()
    const r2 = new GridRunner(() => g.p, async () => ({ beat: new Float32Array(), downbeat: new Float32Array() }), { stallMs: 150, checkMs: 10 })
    const out = r2.run(job)
    const id = (g.port.got[0] as Extract<GridWorkerIn, { type: 'job' }>).id
    for (let i = 0; i < 8; i++) { await wait(50); g.port.say({ type: 'alive', id }) } // 400 ms, avisando cada 50
    g.port.say({ type: 'done', id, result })
    await expect(out).resolves.toBe(result)
    expect(g.port.killed).toBe(false)
    r2.close()
  })
})

describe('«Saltear este»', () => {
  it('el tema en curso queda sin grilla con su motivo, se cierra ese proceso y el próximo arranca otro', async () => {
    const ports = [fakePort(), fakePort()]
    let n = 0
    const r = new GridRunner(() => ports[n++].p, async () => ({ beat: new Float32Array(), downbeat: new Float32Array() }))
    expect(r.skip()).toBe(false) // no hay nada en curso
    const a = r.run(job)
    expect(r.skip()).toBe(true)
    await expect(a).rejects.toThrow('Lo salteaste: quedó sin grilla')
    expect(ports[0].port.killed).toBe(true)
    const b = r.run({ ...job, file: 'y.wav' })
    const sent = ports[1].port.got[0] as Extract<GridWorkerIn, { type: 'job' }>
    expect(sent.file).toBe('y.wav')
    ports[1].port.say({ type: 'done', id: sent.id, result })
    await expect(b).resolves.toBe(result)
    r.close()
  })
})

describe('el orden de la pasada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-grilla-cola-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it(`los temas de más de ${LONG_MINUTES} minutos van al final, de más corto a más largo`, () => {
    const db = openDb(path.join(dir, 'paila.db'))
    try {
      db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('A', 'SSD', 'D:\\'); INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'Música', 'x')")
      const add = db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration) VALUES (?, 1, ?, 1, 1, 'musica', 'wav', ?)")
      add.run(1, 'mix de 77 minutos.wav', 4621); add.run(2, 'tema.mp3', 240); add.run(3, 'set de media hora.wav', 1800); add.run(4, 'otro.mp3', 300)
      const plan = gridPlan(db, new DjData(db, () => null), null, 'gpu')
      expect(plan.todo).toEqual([2, 4, 3, 1])
      expect(plan.tracks).toBe(4)
    } finally { db.close() }
  })

  it('los Sets no entran en la pasada de toda la Música (y se dice cuántos); en una playlist elegida, sí', () => {
    const db = openDb(path.join(dir, 'sets.db'))
    try {
      db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('A', 'SSD', 'D:\\'); INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'Música', 'x')")
      const add = db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration) VALUES (?, 1, ?, 1, 1, ?, 'wav', ?)")
      add.run(1, 'Sets/mix de 77 minutos.wav', 'sets', 4621); add.run(2, 'tema.mp3', 'musica', 240); add.run(3, 'Sets/otro set.wav', 'sets', 3600)
      const dj = new DjData(db, () => null)
      const toda = gridPlan(db, dj, null, 'gpu')
      expect([toda.todo, toda.setsOut]).toEqual([[2], 2])
      const lista = gridPlan(db, dj, [1, 2], 'gpu')
      expect([lista.todo, lista.setsOut]).toEqual([[2, 1], 0])
    } finally { db.close() }
  })
})
