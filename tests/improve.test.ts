// Tests de mejorar una playlist (core/improve.ts): buscar mejores versiones de los temas de baja calidad.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Improver } from '@paila/core/improve'
import { analyzeFile } from '@paila/core/analysis/analyze'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let pl: Playlists
let imp: Improver
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const tone = (rel: string, extra: string[], meta: Record<string, string>) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-imp-'))
  const m = { artist: 'La Renga', title: 'Hablando de la Libertad' }
  tone('Fiesta/libertad.mp3', ['-b:a', '64k'], m) // la mala, en la carpeta-playlist
  tone('Biblioteca/libertad.flac', [], m) // la buena
  tone('Fiesta/otro.mp3', [], { artist: 'Otro', title: 'Sin mejor' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  // se analiza para tener nota (con el motor real)
  await lib.analyze({ full: analyzeFile }, ffmpeg, 2)
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  imp = new Improver(lib.db)
}, 120_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('mejorar playlist', () => {
  it('propone la versión mejor, la cambia en su lugar y se deshace', () => {
    const l = pl.create('Fiesta')
    pl.addTracks(l, [id('otro.mp3'), id('libertad.mp3')])
    const props = imp.propose(l, pl.trackIds(l))
    expect(props).toHaveLength(1)
    expect(props[0]).toMatchObject({ currentId: id('libertad.mp3'), betterId: id('libertad.flac') })
    const r = imp.apply(props)
    expect(r.swaps).toBe(1)
    expect(pl.trackIds(l)).toEqual([id('otro.mp3'), id('libertad.flac')]) // mismo lugar en la lista
    expect(imp.propose(l, pl.trackIds(l))).toEqual([]) // ya no hay nada mejor
    expect(imp.batches()[0]).toMatchObject({ swaps: 1, undone: false, playlistName: 'Fiesta' })
    expect(imp.undo(r.batchId!)).toBe(1)
    expect(pl.trackIds(l)).toEqual([id('otro.mp3'), id('libertad.mp3')])
    expect(imp.batches()[0].undone).toBe(true)
  })
  it('no propone si la mejor versión ya está en la misma lista', () => {
    const l = pl.create('Con las dos')
    pl.addTracks(l, [id('libertad.mp3'), id('libertad.flac')])
    expect(imp.propose(l, pl.trackIds(l))).toEqual([])
  })
})
