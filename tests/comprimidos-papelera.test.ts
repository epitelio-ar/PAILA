// "Mandar el comprimido a la papelera" (decisión del autor del 23/10; core/archive/papelera.ts): cuando TODO lo de adentro de
// un ZIP o RAR ya está afuera, se manda a la papelera de PAILA con vista previa, Historial y restaurar. Nunca un sample pack,
// nada se borra, un rar partido va entero y un corte en el medio se resuelve al abrir. Solo archivos sintéticos.
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Archives } from '@paila/core/archives'
import { ArchiveExtract } from '@paila/core/archive/extract'
import { ArchiveTrash } from '@paila/core/archive/papelera'
import { purgeTrash, trashUsage } from '@paila/core/purge'
import { History, type HistoryDeps } from '@paila/core/history'
import { OpJournal } from '@paila/core/journal'
import { recover } from '@paila/core/recovery'
import { makeZip } from '@paila/core/zip'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const FIX = path.join(__dirname, 'fixtures', 'comprimidos')
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')

let dir: string, M: string, tono: string, lib: Library, arch: Archives, ex: ArchiveExtract, tr: ArchiveTrash, hist: History
const rootPath = (id: number) => lib.roots().find((r) => r.id === id && r.available)?.path ?? null
const byName = (n: string) => arch.list().find((a) => a.name === n)!
const trashDirs = () => (fs.existsSync(path.join(M, '_PAILA', 'papelera')) ? fs.readdirSync(path.join(M, '_PAILA', 'papelera')).filter((n) => /_zip-\d+_/.test(n)) : [])
/** El tono con unos bytes de más: cada tema de prueba pesa distinto, así uno no cuenta como "ya está afuera" por otro. */
const tema = (extra: number) => Buffer.concat([fs.readFileSync(tono), Buffer.alloc(extra)])
/** Un ZIP con un tema y, al lado, el mismo tema ya "abierto" afuera. */
async function abierto(zip: string, nombre: string, extra: number) {
  fs.writeFileSync(path.join(M, 'Discos', zip), makeZip([{ name: nombre, data: tema(extra) }]))
  fs.mkdirSync(path.join(M, 'Discos', `${zip} afuera`), { recursive: true })
  fs.writeFileSync(path.join(M, 'Discos', `${zip} afuera`, nombre), tema(extra))
  await lib.scan()
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-zip-papelera-'))
  M = path.join(dir, 'Música')
  fs.mkdirSync(path.join(M, 'Discos'), { recursive: true })
  fs.mkdirSync(path.join(M, 'Producción'), { recursive: true })
  for (const n of ['partes.part1.rar', 'partes.part2.rar', 'partes.part3.rar', 'clave.rar']) fs.copyFileSync(path.join(FIX, n), path.join(M, 'Discos', n))
  tono = path.join(dir, 'tono.mp3')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-b:a', '192k', tono])
  fs.writeFileSync(path.join(M, 'Discos', 'Trap Drum Kit.zip'), makeZip([{ name: 'Kit/808s/808 1.wav', data: 'x' }, { name: 'Kit/Kicks/kick.wav', data: 'y' }]))
  fs.writeFileSync(path.join(M, 'Producción', 'cosas.zip'), makeZip([{ name: 'a.mp3', data: tema(3) }]))
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }, { rel: 'Producción', kind: 'produccion' }])
  await lib.scan()
  arch = new Archives(lib.db, rootPath)
  ex = new ArchiveExtract(arch, rootPath)
  tr = new ArchiveTrash(arch, rootPath)
  hist = new History(lib.db, { rootPath, archives: ex, archiveTrash: tr, improver: { batches: () => [] } } as unknown as HistoryDeps)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Mandar el comprimido a la papelera', () => {
  it('solo si TODO lo de adentro ya está afuera; nunca un sample pack ni uno con clave', async () => {
    fs.writeFileSync(path.join(M, 'Discos', 'Mitad.zip'), makeZip([{ name: 'Mitad uno.mp3', data: tema(5) }, { name: 'Mitad dos.mp3', data: 'otro audio que no está afuera' }]))
    fs.mkdirSync(path.join(M, 'Discos', 'Mitad afuera'), { recursive: true })
    fs.writeFileSync(path.join(M, 'Discos', 'Mitad afuera', 'Mitad uno.mp3'), tema(5))
    await lib.scan()
    expect(byName('Mitad.zip')).toMatchObject({ audio: 2, outside: 1 })
    expect(() => tr.plan(byName('Mitad.zip').id)).toThrow(/Todavía hay temas que no están afuera/)
    expect(() => tr.plan(byName('Trap Drum Kit.zip').id)).toThrow(/sample pack/)
    expect(() => tr.plan(byName('cosas.zip').id)).toThrow(/sample pack/) // está en una carpeta de producción: aunque esté "afuera"
    expect(() => tr.plan(byName('clave.rar').id)).toThrow()
  })

  it('vista previa sin tocar nada; en modo "solo mirar" no manda nada a la papelera', async () => {
    await abierto('Abierto.zip', 'Tema abierto.mp3', 17)
    const p = tr.plan(byName('Abierto.zip').id)
    expect(p).toMatchObject({ archiveRel: 'Discos/Abierto.zip', audio: 1, outside: 1 })
    expect(p.files.map((f) => f.rel)).toEqual(['Discos/Abierto.zip'])
    process.env.PAILA_SOLO_LECTURA = '1'
    try { await expect(tr.apply(p)).rejects.toThrow(/solo para mirar/) } finally { delete process.env.PAILA_SOLO_LECTURA }
    expect(fs.existsSync(path.join(M, 'Discos', 'Abierto.zip'))).toBe(true)
    expect(trashDirs()).toEqual([])
  })

  it('si cambió algo desde la vista previa (lo de afuera o el comprimido), no toca nada', async () => {
    const p = tr.plan(byName('Abierto.zip').id)
    const outsideCopy = path.join(M, 'Discos', 'Abierto.zip afuera', 'Tema abierto.mp3')
    fs.renameSync(outsideCopy, path.join(dir, 'guardado.mp3')) // alguien se llevó el tema de afuera: ya no está todo afuera
    await lib.scan()
    await expect(tr.apply(p)).rejects.toThrow(/Todavía hay temas/)
    fs.renameSync(path.join(dir, 'guardado.mp3'), outsideCopy)
    await lib.scan()
    const q = tr.plan(byName('Abierto.zip').id)
    fs.appendFileSync(path.join(M, 'Discos', 'Abierto.zip'), 'x') // el comprimido cambió
    await expect(tr.apply(q)).rejects.toThrow()
    expect(fs.existsSync(path.join(M, 'Discos', 'Abierto.zip'))).toBe(true)
    expect(trashDirs()).toEqual([])
    fs.writeFileSync(path.join(M, 'Discos', 'Abierto.zip'), makeZip([{ name: 'Tema abierto.mp3', data: tema(17) }]))
    await lib.scan()
  })

  it('lo manda a la papelera de PAILA (no se borra), queda en el Historial y se restaura', async () => {
    const f = path.join(M, 'Discos', 'Abierto.zip')
    const before = md5(f)
    const r = await tr.apply(tr.plan(byName('Abierto.zip').id))
    expect(r).toMatchObject({ done: 1, failed: [] })
    expect(r.bytes).toBeGreaterThan(0)
    expect(fs.existsSync(f)).toBe(false)
    const [folder] = trashDirs()
    expect(md5(path.join(M, '_PAILA', 'papelera', folder, 'Discos', 'Abierto.zip'))).toBe(before)
    expect(byName('Abierto.zip')).toBeUndefined() // sale de la lista
    const e = hist.list().find((x) => x.kind === 'comprimido-papelera')!
    expect(e).toMatchObject({ files: 1, canUndo: true, undone: false })
    expect(e.summary).toContain('«Abierto.zip»')
    expect(hist.detail('comprimido-papelera', e.id).rows.map((x) => x.name)).toEqual(['Abierto.zip'])
    await lib.scan() // el escaneo no lo "encuentra" en la papelera (_PAILA no se recorre)
    expect(byName('Abierto.zip')).toBeUndefined()
    expect(trashUsage(lib.db, () => lib.roots()).folders.find((x) => x.folder === folder)).toMatchObject({ kind: 'comprimido', files: 1 })
    expect(await hist.undo('comprimido-papelera', e.id)).toEqual({ done: 1, failed: [] })
    expect(md5(f)).toBe(before)
    expect(trashDirs()).toEqual([])
    expect(byName('Abierto.zip')).toBeDefined()
    expect(hist.list().find((x) => x.kind === 'comprimido-papelera')).toMatchObject({ undone: true, canUndo: false })
  })

  it('un rar partido va entero: sus tres partes, juntas y de vuelta', async () => {
    const partes = ['partes.part1.rar', 'partes.part2.rar', 'partes.part3.rar'].map((n) => path.join(M, 'Discos', n))
    const sums = partes.map(md5)
    await ex.apply(ex.plan(byName('partes.part1.rar').id))
    await lib.scan()
    expect(byName('partes.part1.rar')).toMatchObject({ audio: 2, outside: 2 })
    const p = tr.plan(byName('partes.part1.rar').id)
    expect(p.files.map((x) => x.rel).sort()).toEqual(['Discos/partes.part1.rar', 'Discos/partes.part2.rar', 'Discos/partes.part3.rar'])
    expect(await tr.apply(p)).toMatchObject({ done: 3, failed: [] })
    expect(partes.some((x) => fs.existsSync(x))).toBe(false)
    const e = hist.list().find((x) => x.kind === 'comprimido-papelera' && !x.undone)!
    expect(e).toMatchObject({ files: 3, canUndo: true })
    expect(await hist.undo('comprimido-papelera', e.id)).toEqual({ done: 3, failed: [] })
    expect(partes.map(md5)).toEqual(sums)
    expect(trashDirs()).toEqual([])
  })

  it('si una parte no se puede mover, las otras vuelven y el rar queda como estaba', async () => {
    const names = ['partes.part1.rar', 'partes.part2.rar', 'partes.part3.rar']
    const sums = names.map((n) => md5(path.join(M, 'Discos', n)))
    const p = tr.plan(byName('partes.part1.rar').id)
    const part3 = path.join(M, 'Discos', 'partes.part3.rar')
    const real = fs.renameSync
    let hit = 0
    fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => { if (String(a) === part3 && !hit++) throw Object.assign(new Error('EBUSY: archivo en uso'), { code: 'EBUSY' }); return real(a, b) }) as typeof fs.renameSync
    let r
    try { r = await tr.apply(p) } finally { fs.renameSync = real }
    expect(r.done).toBe(0)
    expect(r.failed.length).toBeGreaterThan(0)
    expect(names.map((n) => md5(path.join(M, 'Discos', n)))).toEqual(sums)
    expect(byName('partes.part1.rar')).toBeDefined()
  })

  it('al vaciar la papelera, lo que ya se borró no se puede restaurar y lo dice', async () => {
    expect((await tr.apply(tr.plan(byName('Abierto.zip').id))).done).toBe(1)
    const e = hist.list().find((x) => x.kind === 'comprimido-papelera' && !x.undone)!
    const keys = trashUsage(lib.db, () => lib.roots()).folders.filter((x) => x.kind === 'comprimido').map((x) => x.key)
    expect(purgeTrash(lib.db, () => lib.roots(), keys).failed).toEqual([])
    const after = hist.list().find((x) => x.kind === 'comprimido-papelera' && x.id === e.id)!
    expect(after).toMatchObject({ canUndo: false })
    expect(after.whyNot).toMatch(/se vació la papelera/)
  })

  it('un corte en medio: si ya llegó a la papelera se anota; si no, sigue en su lugar', async () => {
    const j = new OpJournal(lib.db)
    const src1 = path.join(M, 'Discos', 'Corte1.zip'), dst1 = path.join(M, '_PAILA', 'papelera', 'x', 'Discos', 'Corte1.zip')
    const src2 = path.join(M, 'Discos', 'Corte2.zip'), dst2 = path.join(M, '_PAILA', 'papelera', 'x', 'Discos', 'Corte2.zip')
    fs.mkdirSync(path.dirname(dst1), { recursive: true })
    fs.writeFileSync(dst1, 'uno'); fs.writeFileSync(src2, 'dos') // el 1 llegó; el 2 no
    const id = byName('clave.rar').id, rootId = byName('clave.rar').rootId
    const data = (rel: string) => ({ batch: 98, archiveId: id, rootId, rel, trashRel: `_PAILA/papelera/x/${rel}`, size: 3, mtime: 1 })
    j.begin({ op: 'zip-papelera', rootId: null, src: src1, dst: dst1, data: data('Discos/Corte1.zip') })
    j.begin({ op: 'zip-papelera', rootId: null, src: src2, dst: dst2, data: data('Discos/Corte2.zip') })
    const rep = await recover(lib.db, { rootPath, ffmpeg })
    expect(rep.items.map((i) => i.result).sort()).toEqual(['completado', 'no-hecho'])
    expect(fs.existsSync(src2)).toBe(true)
    expect(hist.detail('comprimido-papelera', 98).rows.map((x) => x.name)).toEqual(['Corte1.zip'])
  })
})
