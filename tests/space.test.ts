// Tests de la pantalla Espacio (core/space.ts): cuánto ocupa cada carpeta y qué se puede liberar.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Space, spaceTree } from '@paila/core/space'
import { Replacer } from '@paila/core/replace'
import { Organizer } from '@paila/core/organizer'
import { readTags } from '@paila/core/tagio'
import { purgeTrash, trashUsage } from '@paila/core/purge'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
/** ¿Está `rel` dentro de alguna tanda de la papelera? (las carpetas de tanda llevan fecha, hora y un código al azar) */
const inTrash = (root: string, rel: string) => fs.existsSync(path.join(root, '_PAILA/papelera')) && (fs.readdirSync(path.join(root, '_PAILA/papelera'), { recursive: true }) as string[]).some((f) => f.split(path.sep).join('/').endsWith('/' + rel))

let dir: string
let lib: Library
let space: Space
const tone = (rel: string, extra: string[] = [], meta: Record<string, string> = {}) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-space-'))
  tone('Disco/uno.wav', [], { artist: 'La Renga', title: 'Uno' })
  tone('Disco/dos.mp3')
  tone('Otro/tres.flac')
  fs.writeFileSync(path.join(dir, 'M/Disco/cover.jpg'), 'x'); fs.writeFileSync(path.join(dir, 'M/Disco/Thumbs.db'), 'xxxx'); fs.writeFileSync(path.join(dir, 'M/Disco/foto suelta.jpg'), 'yy')
  fs.writeFileSync(path.join(dir, 'M/Otro/clip.mp4'), 'v'.repeat(1000)); fs.writeFileSync(path.join(dir, 'M/Otro/pack.zip'), 'z')
  fs.mkdirSync(path.join(dir, 'M/Vacia'))
  fs.mkdirSync(path.join(dir, 'M/Samples')); fs.writeFileSync(path.join(dir, 'M/Samples/basura.tmp'), 'nope')
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  await lib.scan()
  space = new Space(lib.db, () => lib.roots())
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('espacio', () => {
  it('arma el árbol con tamaños por carpeta, nota y formato', () => {
    const t = spaceTree(lib.db)
    expect(t.c).toBe(3)
    expect(t.ch!.map((x) => x.n).sort()).toEqual(['Disco', 'Otro'])
    const disco = t.ch!.find((x) => x.n === 'Disco')!
    expect(disco.c).toBe(2)
    expect(disco.b).toBe(disco.ch!.reduce((s, x) => s + x.b, 0))
    expect(Object.keys(disco.f).sort()).toEqual(['mp3', 'wav'])
    expect(disco.ch![0].b).toBeGreaterThanOrEqual(disco.ch![1].b) // ordenado de mayor a menor
  })

  it('encuentra lo que no es música y respeta samples y tapas', () => {
    const j = space.junk()
    const rels = j.files.map((f) => f.rel).sort()
    expect(rels).toEqual(['Disco/Thumbs.db', 'Disco/foto suelta.jpg', 'Otro/clip.mp4', 'Otro/pack.zip'])
    expect(j.byKind.video).toMatchObject({ count: 1, bytes: 1000 })
    expect(j.emptyDirs.map((d) => d.rel)).toEqual(['Vacia']) // con su disco, para poder sacarlas (core/emptydirs.ts)
    expect(rels.some((r) => r.includes('cover') || r.includes('Samples'))).toBe(false)
  })

  it('manda lo que no es música a la papelera, nunca un tema, y se deshace', async () => {
    const org = new Organizer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null)
    const rootId = lib.roots()[0].id
    const r = await space.trashFiles([{ rootId, rel: 'Otro/clip.mp4' }, { rootId, rel: 'Disco/uno.wav' }])
    expect(r.moved).toBe(1)
    expect(r.failed[0].error).toMatch(/tema de la biblioteca/)
    expect(fs.existsSync(path.join(dir, 'M/Otro/clip.mp4'))).toBe(false)
    expect(inTrash(path.join(dir, 'M'), 'Otro/clip.mp4')).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Disco/uno.wav'))).toBe(true)
    expect((await org.undo(r.batchId!)).failed).toEqual([])
    expect(fs.existsSync(path.join(dir, 'M/Otro/clip.mp4'))).toBe(true)
  })

  it('calcula el ahorro y convierte WAV a FLAC verificando que el audio es idéntico', async () => {
    const s = space.savings()
    expect(s.wavAiff.count).toBe(1)
    expect(s.wavAiff.saving).toBeGreaterThan(0)
    const conv = space.convertibles()
    expect(conv.map((c) => c.rel)).toEqual(['Disco/uno.wav'])
    const rep = new Replacer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null, ffprobe, ffmpeg)
    const seen: number[] = []
    const r = await space.wavToFlac(conv.map((c) => c.id), (i) => lib.trackPath(i), rep, ffmpeg, path.join(dir, 'work'), (p) => seen.push(p.done))
    expect(r.failed).toEqual([])
    expect(r.converted).toBe(1)
    expect(r.savedBytes).toBeGreaterThan(0)
    const f = path.join(dir, 'M/Disco/uno.flac')
    expect(fs.existsSync(f)).toBe(true)
    expect(readTags(f)).toMatchObject({ artist: 'La Renga', title: 'Uno' }) // tags conservados
    expect(lib.tracks().find((t) => t[2] === 'Disco/uno.flac')).toBeTruthy()
    expect(fs.existsSync(path.join(dir, 'work/shrink-1.flac'))).toBe(false) // limpia lo temporal
    expect(space.convertibles()).toEqual([])
    expect(seen[seen.length - 1]).toBe(1)
  })

  it('el WAV original y las limpiezas quedan en la papelera (ocupan lugar) hasta vaciarla; después ya no se deshacen', async () => {
    const rootId = lib.roots()[0].id
    const t = await space.trashFiles([{ rootId, rel: 'Otro/clip.mp4' }])
    const u = trashUsage(lib.db, () => lib.roots())
    const wav = u.folders.find((f) => f.kind === 'reemplazo')!
    const clip = u.folders.find((f) => f.kind === 'limpieza' && fs.existsSync(path.join(dir, 'M/_PAILA/papelera', f.folder, 'Otro/clip.mp4')))!
    expect(wav.files).toBe(1)
    expect(wav.bytes).toBeGreaterThan(fs.statSync(path.join(dir, 'M/Disco/uno.flac')).size) // el WAV sigue ocupando su lugar entero
    expect(clip.bytes).toBe(1000)
    expect(u.bytes).toBeGreaterThanOrEqual(wav.bytes + clip.bytes)

    const r = purgeTrash(lib.db, () => lib.roots(), u.folders.map((f) => f.key))
    expect(r.failed).toEqual([])
    expect(r.bytes).toBe(u.bytes)
    expect(trashUsage(lib.db, () => lib.roots())).toMatchObject({ bytes: 0, files: 0, folders: [] })
    expect(fs.existsSync(path.join(dir, 'M/Disco/uno.flac'))).toBe(true) // la biblioteca no se toca
    expect(fs.existsSync(path.join(dir, 'M/Disco/dos.mp3'))).toBe(true)

    const rep = new Replacer(lib.db, (rid) => lib.roots().find((x) => x.id === rid)?.path ?? null, ffprobe, ffmpeg)
    expect(rep.list()[0].purgedAt).toEqual(expect.any(String))
    expect(() => rep.undo(rep.list()[0].id)).toThrow(/se vació la papelera el/)
    const org = new Organizer(lib.db, (rid) => lib.roots().find((x) => x.id === rid)?.path ?? null)
    expect(org.batches().find((b) => b.batchId === t.batchId)!.purgedAt).toEqual(expect.any(String))
    expect((await org.undo(t.batchId!)).failed[0].error).toMatch(/Ya no se puede: se vació la papelera el/)
  })
})
