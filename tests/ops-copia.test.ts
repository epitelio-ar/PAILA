// Motor único (masterplan 4, 4B.4): lo que PAILA escribe afuera de tu Música (core/ops/copy.ts) pasa por el mismo camino que
// todo: chequeos previos de toda la tanda, diario, copia temporal al lado, verificar, ponerla en su lugar de una vez y un
// renglón en el Historial. Y los chequeos nuevos de adónde va a parar algo de tu Música (sample packs, PIONEER, Ableton).
// Solo archivos sintéticos en carpetas temporales.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { OpLock } from '@paila/core/oplock'
import { OpJournal } from '@paila/core/journal'
import { guardWith, precheck } from '@paila/core/ops/checks'
import { CopyOut, copyStep, keepCopy, tmpOf } from '@paila/core/ops/copy'
import type { Step } from '@paila/core/ops/types'
import { recover } from '@paila/core/recovery'
import { DEFAULT_EXPORT, Exporter } from '@paila/core/export'
import { exportM3uLists } from '@paila/core/m3uexport'
import { Playlists } from '@paila/core/playlists'
import { History } from '@paila/core/history'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Replacer } from '@paila/core/replace'
import { Improver } from '@paila/core/improve'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()
let dir: string, lib: Library, hist: History, playlists: Playlists
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const OUT = (rel: string) => path.join(dir, 'USB', ...rel.split('/'))
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
const tone = (rel: string, meta: Record<string, string> = {}) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
}
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const openRows = () => (lib.db.prepare('SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL').get() as { n: number }).n
const logged = () => lib.db.prepare('SELECT batch, kind, dst, size, backup FROM copies_log ORDER BY id').all() as { batch: number; kind: string; dst: string; size: number; backup: string | null }[]
const move = (src: string, dst: string, op: Step['op'] = 'organizar'): Step => ({ kind: 'mover', op, rootId: 1, fileId: idOf(src), src, dst, data: null })
/** Una letra de unidad que no está en esta compu (para "el pendrive se desenchufó"). */
const missingDrive = () => 'ZYXWVUTSRQPONMLKJIHG'.split('').map((l) => `${l}:\\`).find((d) => !fs.existsSync(d))

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-copia-'))
  for (const n of ['a', 'b', 'c']) tone(`Sueltos/${n}.mp3`, { artist: 'Fulano', title: n.toUpperCase() })
  tone('Samples/kick.mp3')
  fs.mkdirSync(M('PIONEER/rekordbox'), { recursive: true })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }, { rel: 'PIONEER', kind: 'excluir' }])
  await lib.scan()
  playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
  hist = new History(lib.db, {
    changes: new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg),
    trash: new Trash(lib.db, rootPath, playlists),
    organizer: new Organizer(lib.db, rootPath),
    replacer: new Replacer(lib.db, rootPath, ffprobe, ffmpeg),
    improver: new Improver(lib.db),
    rootPath,
  })
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('chequeos previos de una copia hacia afuera', () => {
  it('con el candado registrado, una copia tampoco corre sin tomarlo', async () => {
    const lock = new OpLock()
    guardWith(lib.db, lock)
    const steps = [copyStep({ rootId: null, fileId: null, src: null, dst: OUT('x.mp3') })]
    expect(precheck(lib.db, steps, { rootPath }).fatal).toMatch(/candado/)
    expect(await lock.run('test', () => precheck(lib.db, steps, { rootPath }).fatal)).toBeNull()
    guardWith(lib.db, { busy: 'test' } as OpLock) // el resto corre "con el candado tomado"
  })
  it.skipIf(process.platform !== 'win32' || !missingDrive())('si el disco de destino no está (el pendrive se desenchufó), no arranca nada', () => {
    const c = precheck(lib.db, [copyStep({ rootId: null, fileId: null, src: null, dst: path.join(missingDrive()!, 'Lista', 'a.mp3') })], { rootPath })
    expect(c.fatal).toBe('El disco de destino no está conectado. No se tocó nada')
  })
  it('si no alcanza el lugar en el destino, no arranca nada y dice cuánto falta', () => {
    const c = precheck(lib.db, [copyStep({ rootId: null, fileId: null, src: null, dst: OUT('a.mp3'), bytes: 1e15 })], { rootPath })
    expect(c.fatal).toMatch(/^Falta espacio en el disco: hacen falta .* GB y quedan .* GB libres/)
  })
  it('copiar un sample pack afuera sí se puede (no se mueve ni se renombra)', () => {
    const c = precheck(lib.db, [copyStep({ rootId: 1, fileId: idOf('Samples/kick.mp3'), src: 'Samples/kick.mp3', dst: OUT('kick.mp3') })], { rootPath })
    expect(c.failed).toEqual([])
    expect(c.ok).toHaveLength(1)
  })
  it('dos copias al mismo nombre: la segunda se saltea con el motivo', () => {
    const c = precheck(lib.db, [
      copyStep({ rootId: null, fileId: null, src: null, dst: OUT('mismo.mp3') }),
      copyStep({ rootId: null, fileId: null, src: null, dst: OUT('MISMO.mp3') }),
    ], { rootPath })
    expect(c.failed.map((f) => f.error)).toEqual(['Otro archivo de esta tanda va al mismo lugar'])
  })
})

describe('adónde va a parar algo de tu Música', () => {
  it('nada se mete adentro de un sample pack ni de PIONEER; deshacer y restaurar sí vuelven a donde estaban', () => {
    const c = precheck(lib.db, [
      move('Sueltos/a.mp3', 'Samples/Fulano/a.mp3'),
      move('Sueltos/b.mp3', 'PIONEER/b.mp3'),
      move('Sueltos/c.mp3', 'Fulano/c.mp3'),
      move('Sueltos/a.mp3', 'Samples/a.mp3', 'restaurar'),
    ], { rootPath })
    expect(c.failed.map((f) => [f.step.dst, f.error])).toEqual([
      ['Samples/Fulano/a.mp3', 'Iría a parar a una carpeta de sample packs: ahí PAILA no mete nada'],
      ['PIONEER/b.mp3', 'Iría a parar a una carpeta que PAILA no toca (PIONEER o un proyecto de Ableton)'],
    ])
    expect(c.ok.map((s) => s.dst)).toEqual(['Fulano/c.mp3', 'Samples/a.mp3'])
  })
})

describe('copiar afuera: diario → copia temporal → verificar → a su lugar → Historial', () => {
  it('copia entera, deja el diario vacío, anota la tanda y nunca pisa', async () => {
    const out = new CopyOut(lib.db, 'pendrive', OUT(''))
    const src = M('Sueltos/a.mp3'), dst = OUT('Prueba/a.mp3')
    const size = await out.file({ fileId: idOf('Sueltos/a.mp3'), src, dst }, (tmp) => fs.copyFileSync(src, tmp), fs.statSync(src).size)
    expect(size).toBe(fs.statSync(src).size)
    expect(fs.readFileSync(dst).equals(fs.readFileSync(src))).toBe(true)
    expect(fs.existsSync(tmpOf(dst))).toBe(false)
    expect(openRows()).toBe(0)
    expect(logged().at(-1)).toMatchObject({ batch: out.batch, kind: 'pendrive', dst, size })
    // ya hay algo con ese nombre: no lo pisa, y lo que estaba queda igual
    await expect(out.file({ src, dst }, (tmp) => fs.writeFileSync(tmp, 'otra cosa'))).rejects.toThrow(/no lo pisa/)
    expect(fs.readFileSync(dst).equals(fs.readFileSync(src))).toBe(true)
    expect(openRows()).toBe(0)
  })
  it('si la copia no queda igual o falla en el medio, no queda nada a medias', async () => {
    const out = new CopyOut(lib.db, 'pendrive', OUT(''))
    const dst = OUT('Prueba/b.mp3')
    await expect(out.file({ dst }, (tmp) => fs.writeFileSync(tmp, 'corta'), 999)).rejects.toThrow('La copia no quedó igual')
    await expect(out.file({ dst }, () => { throw new Error('ffmpeg se cayó') })).rejects.toThrow('ffmpeg se cayó')
    await expect(out.file({ dst }, (tmp) => fs.writeFileSync(tmp, ''))).rejects.toThrow('La copia quedó vacía')
    expect(fs.existsSync(dst)).toBe(false)
    expect(fs.existsSync(tmpOf(dst))).toBe(false)
    expect(openRows()).toBe(0)
  })
  it('reemplazar un archivo de otro programa: primero la copia de lo de antes, después de una vez', () => {
    const dst = OUT('Traktor/coleccion.nml')
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, 'lo de antes')
    const backup = keepCopy(dst, OUT('Traktor/PAILA-respaldos/20261024-120000'))
    new CopyOut(lib.db, 'traktor', dst).write({ dst, replace: true, backup }, 'lo nuevo')
    expect(fs.readFileSync(dst, 'utf8')).toBe('lo nuevo')
    expect(fs.readFileSync(backup!, 'utf8')).toBe('lo de antes')
    expect(logged().at(-1)).toMatchObject({ kind: 'traktor', backup })
  })
})

describe('un corte en medio de una copia (PAILA se cerró de golpe)', () => {
  it('si quedó la copia temporal, la saca: lo que había en el destino queda como estaba', async () => {
    const dst = OUT('Corte/a.mp3'), tmp = tmpOf(dst)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(tmp, 'a medio copiar')
    new OpJournal(lib.db).begin({ op: 'copia', src: M('Sueltos/a.mp3'), dst, data: { batch: 900, kind: 'pendrive', dest: OUT(''), tmp, backup: null } })
    const rep = await recover(lib.db, { rootPath, ffmpeg })
    expect(fs.existsSync(tmp)).toBe(false)
    expect(fs.existsSync(dst)).toBe(false)
    expect(openRows()).toBe(0)
    expect(rep.items.at(-1)).toMatchObject({ result: 'no-hecho', op: 'Copiar afuera de tu Música (pendrive, celular u otro programa)' })
    expect(rep.items.at(-1)!.message).toMatch(/quedó a medias: se sacó/)
  })
  it('si ya estaba en su lugar (el corte fue justo antes de anotarla), se termina de anotar', async () => {
    const dst = OUT('Corte/b.mp3')
    const jid = new OpJournal(lib.db).begin({ op: 'copia', fileId: idOf('Sueltos/b.mp3'), src: M('Sueltos/b.mp3'), dst, data: { batch: 901, kind: 'celular', dest: OUT('Corte'), tmp: tmpOf(dst), backup: null } })
    fs.copyFileSync(M('Sueltos/b.mp3'), dst)
    const rep = await recover(lib.db, { rootPath, ffmpeg })
    expect(rep.items.find((i) => i.id === jid)).toMatchObject({ result: 'completado' })
    expect(logged().find((r) => r.batch === 901)).toMatchObject({ kind: 'celular', dst })
  })
})

describe('el pendrive y las listas pasan por el motor y quedan en el Historial', () => {
  it('A pendrive: copia, anota la tanda, reanuda sin rehacer y el Historial la muestra sin deshacer', async () => {
    const ex = new Exporter(lib.db, (i) => lib.trackPath(i), ffmpeg)
    const ids = ['Sueltos/a.mp3', 'Sueltos/b.mp3'].map(idOf)
    const plan = ex.plan('Fiesta', ids, { ...DEFAULT_EXPORT, dest: OUT('') })
    const r = await ex.run(plan)
    expect(r).toMatchObject({ copied: 2, failed: [] })
    expect(openRows()).toBe(0)
    const e = hist.list().find((x) => x.kind === 'copia' && x.summary.includes('Fiesta'))!
    expect(e).toMatchObject({ files: 3, canUndo: false })
    expect(e.summary).toMatch(/^Se copiaron 2 temas a .*Fiesta/)
    expect(e.whyNot).toMatch(/Son copias: tu Música no se tocó/)
    expect(hist.detail('copia', e.id).rows.map((x) => x.name)).toEqual(['001 - Fulano - A.mp3', '002 - Fulano - B.mp3', 'playlist.m3u8'])
    await expect(hist.undo('copia', e.id)).rejects.toThrow(/Son copias/)
    // otra vez: lo que ya está se saltea, y la lista se pone al día
    expect(await ex.run(plan)).toMatchObject({ copied: 0, skippedExisting: 2, failed: [] })
  })
  it('las listas .m3u8 para la PC: cada una entera, la que ya estaba se pone al día', () => {
    const pl = playlists.create('Para la PC', 'list')
    playlists.addTracks(pl, [idOf('Sueltos/c.mp3')])
    fs.mkdirSync(OUT('Listas'), { recursive: true })
    fs.writeFileSync(OUT('Listas/Para la PC.m3u8'), 'vieja')
    const r = exportM3uLists(lib.db, playlists, (i) => lib.trackPath(i), [pl], { dir: OUT('Listas'), relative: false })
    expect(r.files).toEqual([{ name: 'Para la PC.m3u8', tracks: 1, missing: 0 }])
    expect(fs.readFileSync(OUT('Listas/Para la PC.m3u8'), 'utf8')).toMatch(/c\.mp3/)
    expect(hist.list().find((x) => x.kind === 'copia')!.summary).toMatch(/^Se guardaron 1 lista \.m3u8 en /)
  })
})
