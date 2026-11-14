// Tests de los procesos largos (core/jobs.ts): avance, resumen final, fallas y descarte.
import { describe, expect, it } from 'vitest'
import { Jobs, type JobState } from '@paila/core/jobs'

describe('procesos largos', () => {
  it('informa el avance, termina con un resumen y se puede descartar', async () => {
    const seen: JobState[][] = []
    const jobs = new Jobs((l) => seen.push(JSON.parse(JSON.stringify(l))))
    const r = await jobs.run('x', 'Probando', async (h) => { h.update({ total: 4 }); for (let i = 1; i <= 4; i++) h.update({ done: i, current: `tema ${i}` }); return 42 }, (v) => `listo ${v}`)
    expect(r).toBe(42)
    const j = jobs.list()[0]
    expect(j).toMatchObject({ kind: 'x', running: false, done: 4, total: 4, summary: 'listo 42', failed: false })
    expect(j.finishedAt).not.toBeNull()
    expect(seen[0][0].running).toBe(true) // se avisó al empezar
    expect(seen[seen.length - 1][0].running).toBe(false) // y al terminar
    jobs.dismiss('x')
    expect(jobs.list()).toEqual([])
  })

  it('no duplica un proceso del mismo tipo que ya corre (por ejemplo al volver a la pantalla y apretar de nuevo)', async () => {
    const jobs = new Jobs(() => {})
    let release!: () => void
    const first = jobs.run('mb', 'Buscando', () => new Promise<void>((res) => { release = res }))
    expect(jobs.isRunning('mb')).toBe(true)
    await expect(jobs.run('mb', 'Buscando', async () => {})).rejects.toThrow(/Ya hay un proceso/)
    await expect(jobs.run('otro', 'Otro', async () => 1)).resolves.toBe(1) // otro tipo sí puede
    release(); await first
    expect(jobs.isRunning('mb')).toBe(false)
    await expect(jobs.run('mb', 'Buscando', async () => 2)).resolves.toBe(2) // y ya se puede de nuevo
  })

  it('se cancela y lo avisa en el resumen; un error queda como "falló"', async () => {
    const jobs = new Jobs(() => {})
    const p = jobs.run('c', 'Largo', async (h) => { while (!h.cancelled()) await new Promise((r) => setTimeout(r, 5)); return 'x' })
    await new Promise((r) => setTimeout(r, 20))
    jobs.cancelRequest('c')
    expect(jobs.list()[0].cancelling).toBe(true)
    await p
    expect(jobs.list()[0].summary).toMatch(/^Cancelado/)
    await expect(jobs.run('e', 'Roto', async () => { throw new Error('se rompió') })).rejects.toThrow('se rompió')
    expect(jobs.list().find((j) => j.kind === 'e')).toMatchObject({ failed: true, summary: 'se rompió', running: false })
  })
})

// Cerrar PAILA con algo a medias (22/10): "Frenar y cerrar" pide Cancelar a todo lo que está corriendo.
describe('cancelar todo al cerrar', () => {
  it('pide Cancelar a los que corren y no toca los que ya terminaron', async () => {
    const jobs = new Jobs(() => {})
    await jobs.run('listo', 'Ya terminó', async () => 1)
    const corridas: string[] = []
    const largo = (k: string) => jobs.run(k, k, async (h) => { while (!h.cancelled()) await new Promise((r) => setTimeout(r, 5)); corridas.push(k) })
    const a = largo('organize'), b = largo('export')
    jobs.cancelAll()
    await Promise.all([a, b])
    expect(corridas.sort()).toEqual(['export', 'organize'])
    expect(jobs.list().find((j) => j.kind === 'organize')!.summary).toMatch(/^Cancelado/)
    expect(jobs.list().find((j) => j.kind === 'listo')!.summary).not.toMatch(/Cancelado/)
  })

  it('dos búsquedas que usan el mismo servicio se ponen en fila solas, a la vista, y la de la fila se puede cancelar', async () => {
    // prueba con personas, 28/10: Géneros, MusicBrainz y Tapas daban error ("esperá a que termine") en vez de esperar
    const jobs = new Jobs(() => {})
    let release!: () => void
    const order: string[] = []
    const names = jobs.run('names', 'Buscando nombres oficiales', () => new Promise<void>((res) => { order.push('names'); release = res }), undefined, { uses: ['MusicBrainz', 'Discogs'] })
    const genres = jobs.run('genres', 'Buscando géneros', async () => { order.push('genres'); return 'g' }, undefined, { uses: ['Discogs'] })
    const covers = jobs.run('covers', 'Buscando tapas', async () => { order.push('covers'); return 'c' }, undefined, { uses: ['MusicBrainz'] })
    const other = jobs.run('lastfm', 'Solo Last.fm', async () => { order.push('lastfm'); return 1 }, undefined, { uses: ['Last.fm'] })
    await other // lo que usa otro servicio no espera
    const st = (k: string) => jobs.list().find((j) => j.kind === k)!
    expect(st('genres')).toMatchObject({ running: true, waiting: { job: 'Buscando nombres oficiales', service: 'Discogs' } })
    expect(st('covers').waiting).toMatchObject({ service: 'MusicBrainz' })
    expect(jobs.isRunning('genres')).toBe(true) // en fila cuenta como en marcha (no se duplica)
    expect(jobs.isWorking('genres')).toBe(false)
    jobs.cancelRequest('covers') // cancelar en la fila: no llega a correr
    await expect(covers).resolves.toBeUndefined()
    expect(st('covers')).toMatchObject({ running: false, waiting: null, failed: false, summary: 'Cancelado antes de empezar.' })
    release(); await names
    await expect(genres).resolves.toBe('g') // y arrancó sola al terminar la primera
    expect(order).toEqual(['names', 'lastfm', 'genres'])
    expect(st('genres').waiting).toBeNull()
  })
})
