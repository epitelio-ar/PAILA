// Tests de Carpetas → Playlists (core/folderplaylists.ts): analizar carpetas y crear una playlist por cada una.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { analyzeFolders, createFromFolders, nameFromDir } from '@paila/core/folderplaylists'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
const tone = (rel: string, meta: Record<string, string>) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-fp-'))
  for (let i = 1; i <= 4; i++) tone(`Rock/La Renga/1996 - Disco/0${i} t.mp3`, { artist: 'La Renga', album: 'Disco', title: `T${i}`, track: String(i) })
  for (let i = 1; i <= 5; i++) tone(`Fechas/2024 - Fiesta de Septiembre/f${i}.mp3`, { artist: `Artista ${i}`, album: `Album ${i}`, title: `F${i}` })
  for (let i = 1; i <= 3; i++) tone(`Descargas/d${i}.mp3`, {})
  tone('suelto.mp3', { artist: 'X', title: 'Y' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Carpetas → Playlists', () => {
  it('nombres de playlist', () => {
    expect(nameFromDir('Fechas/2024 - Fiesta de Septiembre')).toBe('Fiesta de Septiembre')
    expect(nameFromDir('Fechas/Sábado')).toBe('Sábado')
  })
  it('distingue álbumes, playlists y dudosas', () => {
    const p = analyzeFolders(lib.db)
    const kind = (d: string) => p.find((x) => x.dir === d)?.kind
    expect(kind('Rock/La Renga/1996 - Disco')).toBe('album')
    expect(kind('Fechas/2024 - Fiesta de Septiembre')).toBe('playlist')
    expect(kind('Descargas')).toBe('dudosa')
    expect(p.some((x) => x.dir === '')).toBe(false) // lo suelto en la raíz no es carpeta
    expect(p[0].kind).toBe('playlist') // las playlists primero
  })
  it('crea las playlists elegidas, en orden, sin duplicar al repetir', () => {
    const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
    const props = analyzeFolders(lib.db).filter((x) => x.kind === 'playlist')
    const r = createFromFolders(lib.db, pl, props)
    expect(r).toEqual({ created: 1, tracks: 5 })
    const node = pl.tree().find((n) => n.name === 'Fiesta de Septiembre')!
    expect(node.count).toBe(5)
    expect(createFromFolders(lib.db, pl, props)).toEqual({ created: 0, tracks: 0 })
  })
})
