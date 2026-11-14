// Tests de playlists (core/playlists.ts): crear, anidar, ordenar, quitar temas y reglas.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let pl: Playlists
const id = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))![0] as number

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-pl-'))
  fs.mkdirSync(path.join(dir, 'M'))
  for (const n of ['a.mp3', 'b.mp3', 'c.mp3']) execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-metadata', `title=Tema ${n}`, '-metadata', n === 'c.mp3' ? 'genre=Cumbia' : 'genre=House', path.join(dir, 'M', n)])
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('playlists', () => {
  it('crea carpetas y listas, agrega sin repetir y reordena', () => {
    const folder = pl.create('Fechas', 'folder')
    const l = pl.create('Sábado', 'list', folder)
    expect(() => pl.create('x', 'list', l)).toThrow(/carpeta/)
    expect(pl.addTracks(l, [id('a.mp3'), id('b.mp3'), id('a.mp3')])).toBe(2)
    expect(pl.addTracks(l, [id('c.mp3')])).toBe(1)
    pl.moveTrack(l, id('c.mp3'), 0)
    expect(pl.trackIds(l)).toEqual([id('c.mp3'), id('a.mp3'), id('b.mp3')])
    pl.removeTracks(l, [id('a.mp3')])
    expect(pl.trackIds(l)).toEqual([id('c.mp3'), id('b.mp3')])
    expect(pl.trackIds(folder)).toEqual([id('c.mp3'), id('b.mp3')])
    expect(pl.tree().find((n) => n.id === l)!.count).toBe(2)
    expect(pl.playlistsOf(id('b.mp3')).map((p) => p.name)).toEqual(['Sábado'])
    expect(() => pl.move(folder, l)).toThrow()
    pl.remove(folder)
    expect(pl.tree()).toEqual([])
    expect(lib.tracks()).toHaveLength(3) // borrar la playlist no toca los temas
  })

  it('playlists inteligentes', () => {
    expect(pl.smart({ genre: 'house' })).toHaveLength(2)
    expect(pl.smart({ genre: 'cumbia' })).toEqual([id('c.mp3')])
    expect(pl.smart({ text: 'Tema a.mp3' })).toEqual([id('a.mp3')])
    expect(pl.smart({ addedDays: 1 })).toHaveLength(3)
    expect(pl.smart({ gradeMin: 'A+' })).toHaveLength(0) // nada analizado todavía
    const s = pl.create('Cumbia', 'smart', null, { genre: 'cumbia' })
    expect(pl.trackIds(s)).toEqual([id('c.mp3')])
    expect(() => pl.addTracks(s, [id('a.mp3')])).toThrow(/comunes/)
    pl.remove(s)
  })

  it('exporta a .m3u8 y vuelve a importar', () => {
    const l = pl.create('Para exportar')
    pl.addTracks(l, [id('b.mp3'), id('a.mp3')])
    const out = path.join(dir, 'lista.m3u8')
    expect(pl.exportM3u8(l, out)).toBe(2)
    const text = fs.readFileSync(out, 'utf8')
    expect(text.startsWith('#EXTM3U')).toBe(true)
    expect(text).toContain('b.mp3')
    const rel = path.join(dir, 'rel.m3u8')
    pl.exportM3u8(l, rel, { relative: true })
    expect(fs.readFileSync(rel, 'utf8')).toContain(path.join('M', 'b.mp3'))
    const imp = pl.importM3u(out, 'Importada')
    expect(imp.found).toBe(2)
    expect(imp.missing).toEqual([])
    expect(pl.trackIds(imp.id)).toEqual([id('b.mp3'), id('a.mp3')])
    fs.writeFileSync(out, '#EXTM3U\nC:/no/existe.mp3\n')
    expect(pl.importM3u(out).missing).toEqual(['C:/no/existe.mp3'])
  })
})
