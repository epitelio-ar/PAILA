// Deshacer deja el archivo como estaba aunque la base lo haya leído distinto (core/changes.ts). Lo encontró la corrida
// supervisada de la Fase C sobre la copia completa (20/10/2026): "Cada día" (bien en el archivo, "Cada d�a" en la base)
// volvía roto, y WAV sin artista en sus tags quedaban con el artista que la base había leído de otra zona.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'
import { findFfprobe } from '@paila/core/probe'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-antes-'))
  fs.mkdirSync(path.join(dir, 'M'))
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-metadata', 'title=Cada día', '-metadata', 'artist=Luca Prodan', path.join(dir, 'M', 'a.mp3')])
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('deshacer vuelve a lo que tenía el archivo', () => {
  it('aunque la base tuviera otra lectura del tag', async () => {
    const id = (lib.db.prepare('SELECT id FROM files').get() as { id: number }).id
    lib.db.prepare("UPDATE files SET title = 'Cada d�a', artist = 'Otro' WHERE id = ?").run(id) // como la leyó mal ffprobe
    const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
    ch.stageMany([{ id, field: 'title', value: 'Cada día (versión)' }, { id, field: 'artist', value: 'Sumo' }])
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    const file = lib.trackPath(id)!
    expect(readTags(file)).toMatchObject({ title: 'Cada día (versión)', artist: 'Sumo' })
    await ch.undo(r.batchId!)
    expect(readTags(file)).toMatchObject({ title: 'Cada día', artist: 'Luca Prodan' })
  })
})
