// Tests de extensiones de archivo mal puestas (core/extensions.ts): detectarlas y proponer el nombre correcto.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'
import { extensionFix, sniff, suspicious } from '@paila/core/extensions'
import { tidy, toProposals } from '@paila/core/tidy'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

describe('cómo se corrige el nombre', () => {
  it('si el título contiene ".mp3" (disco ".mp3" de Emilia) se conserva y se agrega la extensión real', () => {
    expect(extensionFix('CA/Emilia, TINI - La_Original.mp3', 'WAV', 'Emilia, TINI - La_Original.mp3 (Official Video)'))
      .toEqual({ real: 'WAV', ext: 'wav', base: 'Emilia, TINI - La_Original.mp3' })
    expect(extensionFix('Emilia - Jagger.mp3', 'WAV', 'Jagger.mp3')).toMatchObject({ base: 'Emilia - Jagger.mp3' })
  })
  it('si no, se reemplaza la extensión', () => {
    expect(extensionFix('V/Cerrone - Give me Love (Official Audio).mp3', 'M4A/MP4', null)).toEqual({ real: 'M4A/MP4', ext: 'm4a', base: null })
    expect(extensionFix('Mp3 Lovers - Tema.mp3', 'FLAC', 'Mp3 Lovers')).toMatchObject({ ext: 'flac', base: null }) // "Mp3" sin punto no cuenta
  })
  it('no propone nada si la extensión ya sirve', () => {
    expect(extensionFix('a.flac', 'FLAC', null)).toBeNull()
    expect(extensionFix('a.aif', 'AIFF', null)).toBeNull()
    expect(extensionFix('a.opus', 'OGG', null)).toBeNull()
  })
  it('solo sospecha cuando el códec no es el de la extensión', () => {
    expect(suspicious('mp3', 'pcm_s16le')).toBe(true)
    expect(suspicious('mp3', 'aac')).toBe(true)
    expect(suspicious('mp3', 'mp3')).toBe(false)
    expect(suspicious('wav', 'pcm_s24le')).toBe(false)
    expect(suspicious('mp3', null)).toBe(false)
  })
})

describe('corregir extensiones en la biblioteca', () => {
  let dir: string
  let lib: Library
  let ch: Changes
  const row = (end: string) => lib.tracks().find((r) => String(r[2]).endsWith(end))
  const make = (name: string, args: string[], fmt: string) => {
    const tmp = path.join(dir, `tmp.${fmt}`)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...args, tmp])
    fs.renameSync(tmp, path.join(dir, 'M', name))
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-ext-'))
    fs.mkdirSync(path.join(dir, 'M'))
    make('Emilia, TINI - La_Original.mp3', ['-metadata', 'title=Emilia, TINI - La_Original.mp3 (Official Video)'], 'wav')
    make('Cerrone - Give me Love.mp3', ['-c:a', 'aac'], 'm4a')
    make('Bien.mp3', [], 'mp3')
    make('adts.aac', ['-c:a', 'aac'], 'aac')
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    await lib.scan()
    ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
  })
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('reconoce el formato real por los primeros bytes (un AAC suelto no es MP3)', () => {
    expect(sniff(path.join(dir, 'M', 'Emilia, TINI - La_Original.mp3'))).toBe('WAV')
    expect(sniff(path.join(dir, 'M', 'Cerrone - Give me Love.mp3'))).toBe('M4A/MP4')
    expect(sniff(path.join(dir, 'M', 'Bien.mp3'))).toBe('MP3')
    expect(sniff(path.join(dir, 'M', 'adts.aac'))).not.toBe('MP3')
  })

  it('no deja escribir tags mientras la extensión miente, y explica cómo arreglarlo', async () => {
    ch.stage([row('Cerrone - Give me Love.mp3')![0] as number], 'genre', 'Disco')
    const r = await ch.apply()
    expect(r.failed[0].error).toMatch(/por dentro es M4A.*Extensiones equivocadas/)
    ch.discard()
  })

  it('propone, aplica y deshace; después ya se pueden escribir tags', async () => {
    const rep = tidy(lib.db, ['extension'], (i) => lib.trackPath(i))
    expect(rep.steps[0].tracks).toBe(2) // Emilia y Cerrone; "Bien.mp3" no
    ch.stageMany(toProposals(rep.changes))
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(fs.existsSync(path.join(dir, 'M', 'Emilia, TINI - La_Original.mp3.wav'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M', 'Cerrone - Give me Love.m4a'))).toBe(true)
    expect(row('Cerrone - Give me Love.m4a')![4]).toBe('m4a') // la columna de formato también

    const cerrone = row('Cerrone - Give me Love.m4a')![0] as number
    ch.stage([cerrone], 'genre', 'Disco')
    const t = await ch.apply()
    expect(t.failed).toEqual([])
    expect(readTags(lib.trackPath(cerrone)!).genre).toBe('Disco')
    await ch.undo(t.batchId!)

    await ch.undo(r.batchId!)
    expect(fs.existsSync(path.join(dir, 'M', 'Emilia, TINI - La_Original.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M', 'Cerrone - Give me Love.mp3'))).toBe(true)
    expect(row('Cerrone - Give me Love.mp3')![4]).toBe('mp3')
  })

  it('extensión y tags en la misma tanda se deshacen juntos (el nombre de antes miente: los tags van antes de renombrar)', async () => {
    // pasó en la corrida del 21/10/2026 con el M4A de Cerrone que se llamaba .mp3
    const cerrone = row('Cerrone - Give me Love.mp3')![0] as number
    // la librería no lee un .mp3 que por dentro es M4A: se leen los tags desde una copia con la extensión verdadera
    const tagsOf = (f: string) => { const t = path.join(dir, 'leer.m4a'); fs.copyFileSync(f, t); try { return readTags(t) } finally { fs.rmSync(t) } }
    const before = tagsOf(lib.trackPath(cerrone)!)
    ch.stage([cerrone], 'extension', 'm4a')
    ch.stage([cerrone], 'genre', 'Disco')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(path.join(dir, 'M', 'Cerrone - Give me Love.m4a')).genre).toBe('Disco')
    const u = await ch.undo(r.batchId!)
    expect(u.failed).toEqual([])
    expect(fs.existsSync(path.join(dir, 'M', 'Cerrone - Give me Love.mp3'))).toBe(true)
    expect(tagsOf(path.join(dir, 'M', 'Cerrone - Give me Love.mp3'))).toEqual(before)
    expect(row('Cerrone - Give me Love.mp3')![4]).toBe('mp3')
  })

  it('reacomoda los M4A fragmentados de YouTube sin recodificar y les guarda los tags (verificado por huella)', async () => {
    const tmp = path.join(dir, 'tmp-frag.m4a')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', tmp])
    fs.renameSync(tmp, path.join(dir, 'M', 'yt.m4a'))
    await lib.scan()
    const { isFragmentedMp4 } = await import('@paila/core/extensions')
    expect(isFragmentedMp4(path.join(dir, 'M', 'yt.m4a'))).toBe(true)
    expect(isFragmentedMp4(path.join(dir, 'M', 'Bien.mp3'))).toBe(false)
    const file = path.join(dir, 'M', 'yt.m4a')
    const { pcmHash } = await import('@paila/core/audiohash')
    const before = await pcmHash(ffmpeg, file)
    ch.stage([row('yt.m4a')![0] as number], 'genre', 'Disco')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(isFragmentedMp4(file)).toBe(false)
    expect(readTags(file).genre).toBe('Disco')
    expect(await pcmHash(ffmpeg, file)).toBe(before)
    expect(fs.readdirSync(path.join(dir, 'M')).some((f) => f.includes('reacomodado'))).toBe(false)
    expect((await ch.undo(r.batchId!)).failed).toEqual([])
    expect(readTags(file).genre).toBeNull()
    expect(await pcmHash(ffmpeg, file)).toBe(before)
  })

  it('los sample packs no se tocan', () => {
    const id = row('Bien.mp3')![0] as number
    lib.db.prepare("UPDATE files SET kind = 'produccion' WHERE id = ?").run(id)
    expect(() => ch.stage([id], 'extension', 'wav')).toThrow(/sample packs/)
    lib.db.prepare("UPDATE files SET kind = 'musica' WHERE id = ?").run(id)
  })
})
