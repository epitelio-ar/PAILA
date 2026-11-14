// Tests de exportar una playlist a carpeta o pendrive (core/export.ts): copia, nombres y orden de los temas.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { DEFAULT_EXPORT, Exporter } from '@paila/core/export'
import { readTags } from '@paila/core/tagio'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let ex: Exporter
let ids: number[]
const tone = (name: string, extra: string[], meta: Record<string, string>) =>
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), path.join(dir, 'M', name)])

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-exp-'))
  fs.mkdirSync(path.join(dir, 'M'))
  tone('a.mp3', [], { artist: 'La Renga', title: 'Uno' })
  tone('b.flac', [], { artist: 'Otro', title: 'Dos: con/raros?' })
  tone('c.ogg', ['-c:a', 'libvorbis'], { artist: 'Tercero', title: 'Tres' })
  tone('d.wav', [], { title: 'Cuatro' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
  ids = ['c.ogg', 'a.mp3', 'b.flac', 'd.wav'].map(id)
  ex = new Exporter(lib.db, (i) => lib.trackPath(i), ffmpeg)
  void Playlists
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('exportar playlist a carpeta o pendrive', () => {
  it('arma el plan: orden de la playlist, numeración, conversiones y nombres seguros', () => {
    const plan = ex.plan('Sábado: noche?', ids, { ...DEFAULT_EXPORT, dest: path.join(dir, 'USB') })
    expect(plan.items.map((i) => i.outName)).toEqual(['001 - Tercero - Tres.mp3', '002 - La Renga - Uno.mp3', '003 - Otro - Dos_ con_raros_.aiff', '004 - Cuatro.wav'])
    expect(plan.items.map((i) => i.action)).toEqual(['convert', 'copy', 'convert', 'copy'])
    expect(plan.copyCount).toBe(2); expect(plan.convertCount).toBe(2)
    expect(plan.folder.endsWith('Sábado_ noche_')).toBe(true)
    expect(plan.items[2].why).toMatch(/FLAC/)
    expect(plan.freeBytes).toBeGreaterThan(0)
    const keep = ex.plan('x', ids, { ...DEFAULT_EXPORT, dest: dir, keepFlac: true, subfolder: false })
    expect(keep.items[2]).toMatchObject({ action: 'copy', targetExt: 'flac' })
    const noConv = ex.plan('x', ids, { ...DEFAULT_EXPORT, dest: dir, convert: false })
    expect(noConv.items[0].action).toBe('copy'); expect(noConv.warnings.join(' ')).toMatch(/\.ogg/)
    const unnumbered = ex.plan('x', ids, { ...DEFAULT_EXPORT, dest: dir, numbered: false })
    expect(unnumbered.items[0].outName).toBe('Tercero - Tres.mp3')
  })

  it('copia y convierte de verdad, escribe el .m3u8, no toca la biblioteca y se puede repetir', async () => {
    const plan = ex.plan('Mi lista', ids, { ...DEFAULT_EXPORT, dest: path.join(dir, 'USB') })
    const seen: number[] = []
    const r = await ex.run(plan, (p) => seen.push(p.done))
    expect(r.failed).toEqual([])
    expect(r.copied).toBe(2); expect(r.converted).toBe(2)
    const out = (n: string) => path.join(plan.folder, n)
    expect(fs.existsSync(out('001 - Tercero - Tres.mp3'))).toBe(true)
    execFileSync(ffmpeg, ['-v', 'error', '-i', out('003 - Otro - Dos_ con_raros_.aiff'), '-f', 'null', '-'])
    execFileSync(ffmpeg, ['-v', 'error', '-i', out('001 - Tercero - Tres.mp3'), '-f', 'null', '-'])
    expect(readTags(out('001 - Tercero - Tres.mp3')).artist).toBe('Tercero') // los tags viajan
    expect(fs.readFileSync(r.m3u!, 'utf8')).toBe('#EXTM3U\r\n001 - Tercero - Tres.mp3\r\n002 - La Renga - Uno.mp3\r\n003 - Otro - Dos_ con_raros_.aiff\r\n004 - Cuatro.wav\r\n')
    expect(fs.readdirSync(plan.folder).some((n) => n.endsWith('.paila-tmp'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'M/a.mp3'))).toBe(true) // el original sigue
    expect(seen[seen.length - 1]).toBe(4)
    const again = await ex.run(plan)
    expect(again.skippedExisting).toBe(4); expect(again.copied + again.converted).toBe(0) // reanuda sin rehacer
  })

  it('no pisa un archivo distinto y se puede cancelar', async () => {
    const plan = ex.plan('Otra', ids, { ...DEFAULT_EXPORT, dest: path.join(dir, 'USB2') })
    fs.mkdirSync(plan.folder, { recursive: true })
    fs.writeFileSync(path.join(plan.folder, '002 - La Renga - Uno.mp3'), 'algo distinto')
    const r = await ex.run(plan)
    expect(r.failed).toHaveLength(1)
    expect(fs.readFileSync(path.join(plan.folder, '002 - La Renga - Uno.mp3'), 'utf8')).toBe('algo distinto')
    const plan3 = ex.plan('Cancelada', ids, { ...DEFAULT_EXPORT, dest: path.join(dir, 'USB3') })
    const c = await ex.run(plan3, () => {}, () => true)
    expect(c.cancelled).toBe(true); expect(c.copied + c.converted).toBe(0)
  })
})
