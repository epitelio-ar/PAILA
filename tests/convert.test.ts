// Tests de convertir lo que Rekordbox no lee (core/convert.ts): conversión de formato conservando tags y playlists.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe, probe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { readTags } from '@paila/core/tagio'
import { Replacer } from '@paila/core/replace'
import { convertForDj, djUnreadable } from '@paila/core/convert'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string
let lib: Library
let rep: Replacer
let pl: Playlists
let list: number
const row = (end: string) => lib.tracks().find((r) => String(r[2]).endsWith(end))
const make = (rel: string, args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', ...args, path.join(dir, 'M', rel)])

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-conv-'))
  fs.mkdirSync(path.join(dir, 'M/Rock'), { recursive: true }); fs.mkdirSync(path.join(dir, 'M/Samples'))
  make('Rock/01 Buscando.wma', ['-c:a', 'wmav2', '-b:a', '128k', '-metadata', 'title=Buscando', '-metadata', 'artist=Las Pelotas'])
  make('Rock/Tema.ogg', ['-c:a', 'libvorbis', '-metadata', 'title=Tema Ogg'])
  make('Rock/Bien.mp3', [])
  make('Samples/loop.ogg', ['-c:a', 'libvorbis'])
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  list = pl.create('Rock nacional')
  pl.addTracks(list, [row('01 Buscando.wma')![0] as number])
  rep = new Replacer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null, ffprobe, ffmpeg)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('convertir lo que Rekordbox no lee', () => {
  it('encuentra WMA y OGG de la Música, no los samples ni lo que ya se lee', () => {
    expect(djUnreadable(lib.db).map((u) => u.rel).sort()).toEqual(['Rock/01 Buscando.wma', 'Rock/Tema.ogg'])
  })

  it('pasa a MP3 320 conservando tags, nombre y playlists; el original va a la papelera y se puede deshacer', async () => {
    const id = row('01 Buscando.wma')![0] as number
    const r = await convertForDj(lib.db, djUnreadable(lib.db).map((u) => u.id), 'mp3', (i) => lib.trackPath(i), rep, ffmpeg, ffprobe, path.join(dir, 'work'))
    expect(r.failed).toEqual([])
    expect(r.converted).toBe(2)
    const mp3 = path.join(dir, 'M/Rock/01 Buscando.mp3')
    expect(fs.existsSync(mp3)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Rock/01 Buscando.wma'))).toBe(false)
    expect(readTags(mp3)).toMatchObject({ title: 'Buscando', artist: 'Las Pelotas' })
    const m = await probe(ffprobe, mp3)
    expect(m.codec).toBe('mp3')
    expect(m.kbps).toBeGreaterThanOrEqual(310)
    expect(row('01 Buscando.mp3')![0]).toBe(id) // mismo tema para PAILA
    expect(lib.db.prepare('SELECT file_id FROM playlist_items WHERE playlist_id = ?').all(list)).toEqual([{ file_id: id }])
    expect(djUnreadable(lib.db)).toEqual([])
    const papelera = fs.readdirSync(path.join(dir, 'M/_PAILA/papelera'), { recursive: true }) as string[]
    expect(papelera.some((f) => f.endsWith('01 Buscando.wma'))).toBe(true)

    const last = rep.list().find((x) => x.fileId === id)!
    rep.undo(last.id)
    expect(fs.existsSync(path.join(dir, 'M/Rock/01 Buscando.wma'))).toBe(true)
    expect(row('01 Buscando.wma')![0]).toBe(id)
  })

  it('o a FLAC, sin pérdida extra', async () => {
    const r = await convertForDj(lib.db, djUnreadable(lib.db).map((u) => u.id), 'flac', (i) => lib.trackPath(i), rep, ffmpeg, ffprobe, path.join(dir, 'work'))
    expect(r.failed).toEqual([])
    const m = await probe(ffprobe, path.join(dir, 'M/Rock/01 Buscando.flac'))
    expect(m.codec).toBe('flac')
  })
})
