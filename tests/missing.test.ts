// Tests de temas desaparecidos: el escaneo nunca borra, y lo que vuelve (movido o renombrado) se reconecta solo.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { TRACK_FIELDS } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let pl: Playlists
let list: number
const M = (...p: string[]) => path.join(dir, 'M', ...p)
const tone = (rel: string, f: number, d = 2) => { fs.mkdirSync(path.dirname(M(rel)), { recursive: true }); execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${d}`, M(rel)]) }
const row = (id: number) => lib.db.prepare('SELECT id, rel_path AS rel, missing_at AS missing FROM files WHERE id = ?').get(id) as { id: number; rel: string; missing: string | null }
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const inList = () => (lib.db.prepare('SELECT file_id FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(list) as { file_id: number }[]).map((r) => r.file_id)

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-missing-'))
  tone('Rock/La Renga - Hablando de la libertad.mp3', 300)
  tone('Rock/Callejeros - Rehen.mp3', 400, 3)
  tone('Cumbia/Damas Gratis - Se te ve la tanga.mp3', 500, 4)
  tone('Cumbia/Los Palmeras - Bombón asesino.mp3', 600, 5)
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  list = pl.create('Fiesta')
  pl.addTracks(list, (lib.db.prepare('SELECT id FROM files ORDER BY rel_path').all() as { id: number }[]).map((r) => r.id))
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('temas desaparecidos: el escaneo nunca borra', () => {
  it('si una carpeta no se puede leer (disco que se desconecta), no marca nada ni toca las playlists', async () => {
    const real = fsp.readdir
    const spy = vi.spyOn(fsp, 'readdir').mockImplementation(((p: fs.PathLike, o: unknown) => {
      if (String(p).includes('Rock')) return Promise.reject(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }))
      return (real as (p: fs.PathLike, o: unknown) => Promise<unknown>)(p, o)
    }) as typeof fsp.readdir)
    try {
      const s = await lib.scan()
      expect(s.removed).toBe(0)
      expect(s.phase).toMatch(/no se pudieron leer/)
    } finally { spy.mockRestore() }
    expect(inList()).toHaveLength(4)
    expect((lib.db.prepare('SELECT COUNT(*) n FROM files WHERE missing_at IS NOT NULL').get() as { n: number }).n).toBe(0)
  })

  it('un tema borrado queda desaparecido (con su playlist) y vuelve solo si reaparece', async () => {
    const id = idOf('Cumbia/Los Palmeras - Bombón asesino.mp3')
    const keep = path.join(dir, 'guardado.mp3')
    fs.renameSync(M('Cumbia/Los Palmeras - Bombón asesino.mp3'), keep)
    const s = await lib.scan()
    expect(s.removed).toBe(1)
    expect(s.phase).toMatch(/desaparecidos/)
    expect(row(id).missing).not.toBeNull()
    expect(inList()).toContain(id)
    expect(lib.trackCount()).toBe(3)
    expect(lib.pendingAnalysis()).toBe(3) // no se intenta analizar lo que no está
    fs.renameSync(keep, M('Cumbia/Los Palmeras - Bombón asesino.mp3'))
    await lib.scan()
    expect(row(id).missing).toBeNull()
    expect(inList()).toEqual(expect.arrayContaining([id]))
  })

  it('un tema movido de carpeta es el mismo tema (no se duplica y conserva la playlist)', async () => {
    const id = idOf('Rock/Callejeros - Rehen.mp3')
    fs.mkdirSync(M('Biblioteca/Callejeros'), { recursive: true })
    fs.renameSync(M('Rock/Callejeros - Rehen.mp3'), M('Biblioteca/Callejeros/Callejeros - Rehen.mp3'))
    const before = (lib.db.prepare('SELECT COUNT(*) n FROM files').get() as { n: number }).n
    const s = await lib.scan()
    expect(s.phase).toMatch(/1 reconectados/)
    expect(row(id)).toMatchObject({ rel: 'Biblioteca/Callejeros/Callejeros - Rehen.mp3', missing: null })
    expect((lib.db.prepare('SELECT COUNT(*) n FROM files').get() as { n: number }).n).toBe(before)
    expect(inList()).toContain(id)
  })

  it('un tema renombrado en el Explorador también se reconoce (mismo tamaño y duración)', async () => {
    const id = idOf('Rock/La Renga - Hablando de la libertad.mp3')
    fs.renameSync(M('Rock/La Renga - Hablando de la libertad.mp3'), M('Rock/01 - Hablando de la libertad.mp3'))
    await lib.scan()
    expect(row(id)).toMatchObject({ rel: 'Rock/01 - Hablando de la libertad.mp3', missing: null })
    expect(inList()).toContain(id)
    expect((lib.db.prepare('SELECT COUNT(*) n FROM files WHERE missing_at IS NOT NULL').get() as { n: number }).n).toBe(0)
  })

  it('los desaparecidos se ven en la tabla, marcados', async () => {
    const id = idOf('Cumbia/Damas Gratis - Se te ve la tanga.mp3')
    fs.rmSync(M('Cumbia/Damas Gratis - Se te ve la tanga.mp3'))
    await lib.scan()
    const t = lib.tracks().find((r) => r[0] === id)!
    expect(t[TRACK_FIELDS.indexOf('missing')]).not.toBeNull() // columna "missing"
  })
})
