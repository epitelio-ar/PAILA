// Tests del historial único (cambios, playlists y papelera): qué se anota y cómo se deshace.
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
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Replacer } from '@paila/core/replace'
import { Improver } from '@paila/core/improve'
import { Space } from '@paila/core/space'
import { History, type HistoryDeps } from '@paila/core/history'
import { purgeTrash, trashUsage } from '@paila/core/purge'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!

let dir: string
let lib: Library
let deps: HistoryDeps
let hist: History
let space: Space
const M = () => path.join(dir, 'M')
const id = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))![0] as number
const relOf = (fileId: number) => (lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(fileId) as { rel: string }).rel
const rootId = () => lib.roots()[0].id
const tone = (rel: string, extra: string[], meta: Record<string, string>) => {
  const out = path.join(dir, ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}
const latest = () => hist.list()[0]

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-hist-'))
  tone('M/Descargas/uno.mp3', [], { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' })
  tone('M/Descargas/dos.mp3', [], { artist: 'La Renga', title: 'Dos', album: 'Disco A', date: '1996', track: '2' })
  tone('M/Descargas/tres.mp3', [], { artist: 'Soda Stereo', title: 'Tres' })
  tone('M/Estudio/cuatro.wav', [], {})
  tone('M/Estudio/cinco.wav', [], {})
  tone('Bajadas/uno nuevo.flac', [], {})
  fs.writeFileSync(path.join(M(), 'basura.tmp'), 'temporal')
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
  deps = {
    changes: new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg),
    trash: new Trash(lib.db, rootPath, playlists),
    organizer: new Organizer(lib.db, rootPath),
    replacer: new Replacer(lib.db, rootPath, ffprobe, ffmpeg),
    improver: new Improver(lib.db),
    rootPath,
  }
  hist = new History(lib.db, deps)
  space = new Space(lib.db, () => lib.roots())
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('historial único', () => {
  it('sin nada hecho, está vacío', () => {
    expect(hist.list()).toEqual([])
  })

  it('tags: resume la tanda, muestra el detalle y se deshace desde el historial', async () => {
    const a = id('uno.mp3'), b = id('dos.mp3')
    deps.changes.stage([a, b], 'genre', 'Rock Nacional')
    await deps.changes.apply()
    const e = latest()
    expect(e).toMatchObject({ kind: 'tags', files: 2, summary: 'Se cambió el género de 2 temas', undone: false, canUndo: true, whyNot: null })
    const d = hist.detail('tags', e.id)
    expect(d.total).toBe(2)
    expect(d.rows[0]).toMatchObject({ name: 'dos.mp3', folder: 'Descargas', what: 'Género', before: null, after: 'Rock Nacional', undone: false })

    // una tanda más nueva vuelve a tocar el mismo campo de un tema: la vieja ofrece deshacer las dos (MASTERPLAN-5, etapa 4); sola, no
    deps.changes.stage([a], 'genre', 'Rock')
    deps.changes.stage([a], 'year', '1997')
    await deps.changes.apply()
    const newer = latest()
    expect(newer.summary).toBe('Se cambiaron el año y el género de «uno.mp3»')
    const old = hist.list().find((x) => x.kind === 'tags' && x.id === e.id)!
    expect(old).toMatchObject({ canUndo: true, whyNot: null })
    expect(old.cadena!.map((c) => c.id)).toEqual([newer.id])
    await expect(hist.undo('tags', e.id)).rejects.toThrow(/se deshacen juntas o no se deshace/)

    expect(await hist.undo('tags', newer.id)).toEqual({ done: 1, failed: [] })
    expect(readTags(lib.trackPath(a)!).genre).toBe('Rock Nacional')
    expect(await hist.undo('tags', e.id)).toEqual({ done: 2, failed: [] })
    expect(readTags(lib.trackPath(a)!).genre).toBeNull()
    expect(readTags(lib.trackPath(b)!).genre).toBeNull()
    const after = hist.list().find((x) => x.kind === 'tags' && x.id === e.id)!
    expect(after).toMatchObject({ undone: true, canUndo: false, whyNot: 'Ya se deshizo' })
    await expect(hist.undo('tags', e.id)).rejects.toThrow(/Ya se deshizo/)
  })

  it('organizador: dice a dónde se movieron y deshacer los devuelve', async () => {
    const a = id('uno.mp3')
    const before = relOf(a)
    const r = await deps.organizer.apply(deps.organizer.plan({ rule: '%artista%/%album%/%titulo%', dest: 'Biblioteca' }))
    expect(r.moved).toBe(3)
    const e = latest()
    expect(e).toMatchObject({ kind: 'organizar', files: 3, canUndo: true })
    expect(e.summary).toBe('Se movieron 3 temas a Biblioteca/…')
    expect(hist.detail('organizar', e.id).rows.find((x) => x.name === 'uno.mp3')).toMatchObject({ what: 'Movido', before: 'Descargas', after: 'Biblioteca/La Renga/Disco A/Uno.mp3' })
    expect(relOf(a)).toBe('Biblioteca/La Renga/Disco A/Uno.mp3')
    expect((await hist.undo('organizar', e.id)).failed).toEqual([])
    expect(relOf(a)).toBe(before)
    expect(fs.existsSync(path.join(M(), 'Descargas/uno.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(M(), 'Biblioteca'))).toBe(false) // las carpetas nuevas vacías se sacan
  })

  it('papelera: se resume con el motivo y "deshacer" restaura', async () => {
    const c = id('tres.mp3')
    await deps.trash.trash([c], 'Duplicados')
    const e = latest()
    expect(e).toMatchObject({ kind: 'papelera', files: 1, summary: 'Se mandó «tres.mp3» a la papelera (duplicados)', canUndo: true })
    expect(fs.existsSync(path.join(M(), 'Descargas/tres.mp3'))).toBe(false)
    expect(await hist.undo('papelera', e.id)).toEqual({ done: 1, failed: [] })
    expect(fs.existsSync(path.join(M(), 'Descargas/tres.mp3'))).toBe(true)
    expect(hist.list().find((x) => x.kind === 'papelera')!.undone).toBe(true)
  })

  it('limpieza de Espacio: archivos que no son música, se restauran', async () => {
    await space.trashFiles([{ rootId: rootId(), rel: 'basura.tmp' }])
    const e = latest()
    expect(e).toMatchObject({ kind: 'limpieza', files: 1, summary: 'Se mandó «basura.tmp» (no es música) a la papelera', canUndo: true })
    expect(fs.existsSync(path.join(M(), 'basura.tmp'))).toBe(false)
    expect(await hist.undo('limpieza', e.id)).toEqual({ done: 1, failed: [] })
    expect(fs.readFileSync(path.join(M(), 'basura.tmp'), 'utf8')).toBe('temporal')
  })

  it('reemplazo: no se deshace si el tema está en la papelera; después sí', async () => {
    const a = id('uno.mp3')
    await deps.replacer.replace(a, path.join(dir, 'Bajadas/uno nuevo.flac'), { keepTags: true, keepCover: false, sameName: false })
    const e = latest()
    expect(e).toMatchObject({ kind: 'reemplazo', files: 1, summary: 'Se reemplazó «uno.mp3» por «uno nuevo.flac»', canUndo: true })
    const t = await deps.trash.trash([a], 'Prueba')
    const blocked = hist.list().find((x) => x.kind === 'reemplazo')!
    expect(blocked.canUndo).toBe(false)
    expect(blocked.whyNot).toMatch(/papelera/)
    await deps.trash.restore(t.batchId!)
    expect(await hist.undo('reemplazo', e.id)).toEqual({ done: 1, failed: [] })
    expect(relOf(a)).toBe('Descargas/uno.mp3')
    expect(fs.existsSync(path.join(M(), 'Descargas/uno.mp3'))).toBe(true)
  })

  it('WAV → FLAC: toda la corrida es una sola tanda y se deshace entera', async () => {
    const ids = [id('cuatro.wav'), id('cinco.wav')]
    const r = await space.wavToFlac(ids, (i) => lib.trackPath(i), deps.replacer, ffmpeg, path.join(dir, 'tmp'))
    expect(r.converted).toBe(2)
    const e = latest()
    expect(e).toMatchObject({ kind: 'conversion', files: 2, summary: 'Se pasaron 2 temas de WAV a FLAC', canUndo: true })
    expect(hist.list().filter((x) => x.kind === 'conversion')).toHaveLength(1)
    expect(hist.detail('conversion', e.id).rows.map((x) => x.after).sort()).toEqual(['cinco.flac', 'cuatro.flac'])
    expect(await hist.undo('conversion', e.id)).toEqual({ done: 2, failed: [] })
    expect(ids.map(relOf).sort()).toEqual(['Estudio/cinco.wav', 'Estudio/cuatro.wav'])
    expect(fs.existsSync(path.join(M(), 'Estudio/cuatro.wav'))).toBe(true)
    expect(hist.list().find((x) => x.kind === 'conversion')!.undone).toBe(true)
  })

  it('Mejorar playlist: se ve y se deshace', async () => {
    const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
    const list = pl.create('Para el viernes')
    const b = id('dos.mp3'), c = id('tres.mp3')
    pl.addTracks(list, [b])
    deps.improver.apply([{ playlistId: list, currentId: b, betterId: c }])
    const e = latest()
    expect(e).toMatchObject({ kind: 'playlist', files: 1, summary: 'En la playlist «Para el viernes» se cambió 1 tema por una versión mejor', canUndo: true })
    expect(await hist.undo('playlist', e.id)).toEqual({ done: 1, failed: [] })
    expect(pl.trackIds(list)).toEqual([b])
  })

  it('ordena del más nuevo al más viejo y avisa si el disco no está conectado', async () => {
    const all = hist.list()
    expect(all.length).toBeGreaterThanOrEqual(8)
    for (let i = 1; i < all.length; i++) expect(all[i - 1].at >= all[i].at).toBe(true)
    // con todo deshecho no hay nada para deshacer; con una tanda nueva y el disco desconectado, tampoco
    await deps.trash.trash([id('dos.mp3')], 'Duplicados')
    const off = new History(lib.db, { ...deps, rootPath: () => null })
    expect(off.list()[0]).toMatchObject({ kind: 'papelera', canUndo: false, whyNot: 'El disco de estos temas no está conectado' })
  })

  it('después de vaciar la papelera, lo que estaba ahí ya no se puede deshacer y dice desde cuándo', async () => {
    await space.trashFiles([{ rootId: rootId(), rel: 'basura.tmp' }])
    const a = id('uno.mp3')
    await deps.replacer.replace(a, path.join(dir, 'Bajadas/uno nuevo.flac'), { keepTags: true, keepCover: false, sameName: true })
    expect(purgeTrash(lib.db, () => lib.roots(), trashUsage(lib.db, () => lib.roots()).folders.map((f) => f.key)).failed).toEqual([])
    const all = hist.list()
    for (const k of ['papelera', 'limpieza', 'reemplazo'] as const) {
      expect(all.find((x) => x.kind === k && !x.undone)).toMatchObject({ canUndo: false, whyNot: expect.stringMatching(/^Ya no se puede: se vació la papelera el \d\d\/\d\d\/\d{4}/) })
    }
    // el vaciado tiene su propio renglón (prueba con la app, 22/10: antes solo quedaba como nota en cada tanda), arriba de todo
    const v = all.filter((x) => x.kind === 'vaciado')
    expect(v).toHaveLength(1)
    expect(all[0]).toBe(v[0])
    expect(v[0]).toMatchObject({ canUndo: false, undone: false, summary: expect.stringMatching(/^Se vació la papelera: se borraron para siempre \d+ archivos$/) })
    const d = hist.detail('vaciado', v[0].id)
    expect(d.total).toBe(v[0].files)
    expect(d.rows.map((r) => r.what)).toEqual(expect.arrayContaining(['Limpieza de Espacio', 'Original de un reemplazo o conversión']))
    await expect(hist.undo('vaciado', v[0].id)).rejects.toThrow(/no se puede deshacer/)
    expect(fs.existsSync(path.join(M(), 'Descargas/uno.flac'))).toBe(true) // lo que está en la biblioteca no se toca
  })
})
