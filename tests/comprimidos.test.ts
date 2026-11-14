// ZIP y RAR en la biblioteca (masterplan 3, punto 4; core/archives.ts, core/archive/analyze.ts y extract.ts): el escaneo los
// anota sin descomprimir, los sample packs quedan marcados, se escucha y analiza de a un tema, "Sacar al lado" va al
// Historial y se deshace (a la papelera de PAILA), el comprimido nunca cambia, en modo "solo mirar" no se escribe nada y un
// corte en el medio se resuelve al abrir. Solo archivos sintéticos en carpetas temporales.
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Archives, samplePack } from '@paila/core/archives'
import { readArchives } from '@paila/core/archive/analyze'
import { ArchiveExtract, STAGING } from '@paila/core/archive/extract'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { History, type HistoryDeps } from '@paila/core/history'
import { OpJournal } from '@paila/core/journal'
import { recover } from '@paila/core/recovery'
import { makeZip } from '@paila/core/zip'
import type { AnalysisRunner } from '@paila/core/analysis/pool'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const FIX = path.join(__dirname, 'fixtures', 'comprimidos')
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const direct = { full: analyzeFile, prints: () => Promise.reject(new Error('no')) } as unknown as AnalysisRunner

let dir: string, M: string, lib: Library, arch: Archives, ex: ArchiveExtract, hist: History
const rootPath = (id: number) => lib.roots().find((r) => r.id === id && r.available)?.path ?? null
const byName = (n: string) => arch.list().find((a) => a.name === n)!

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-comprimidos-'))
  M = path.join(dir, 'Música')
  fs.mkdirSync(path.join(M, 'Discos'), { recursive: true })
  fs.mkdirSync(path.join(M, 'Producción', 'Kits'), { recursive: true })
  fs.copyFileSync(path.join(FIX, 'disco.rar'), path.join(M, 'Discos', 'disco.rar'))
  for (const n of ['partes.part1.rar', 'partes.part2.rar', 'partes.part3.rar']) fs.copyFileSync(path.join(FIX, n), path.join(M, 'Discos', n))
  fs.copyFileSync(path.join(FIX, 'clave.rar'), path.join(M, 'Discos', 'clave.rar'))
  // un tema de verdad (8 s) en un zip sin carpeta adentro, y un drum kit
  const tone = path.join(dir, 'tono.mp3')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-metadata', 'artist=Sumo', '-metadata', 'title=Mejor no hablar', '-b:a', '192k', tone])
  fs.writeFileSync(path.join(M, 'Discos', 'Suelto.zip'), makeZip([{ name: 'Sumo - Mejor no hablar.mp3', data: fs.readFileSync(tone) }, { name: '__MACOSX/._x', data: 'basura' }]))
  fs.writeFileSync(path.join(M, 'Discos', 'Trap Drum Kit.zip'), makeZip([{ name: 'Kit/808s/808 1.wav', data: 'x' }, { name: 'Kit/Kicks/kick.wav', data: 'y' }]))
  fs.writeFileSync(path.join(M, 'Producción', 'Kits', 'cosas.zip'), makeZip([{ name: 'a.wav', data: 'z' }]))
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', path.join(M, 'Discos', 'suelto.mp3')])
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }, { rel: 'Producción', kind: 'produccion' }])
  await lib.scan()
  arch = new Archives(lib.db, rootPath)
  ex = new ArchiveExtract(arch, rootPath)
  hist = new History(lib.db, { rootPath, archives: ex, improver: { batches: () => [] } } as unknown as HistoryDeps)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('el escaneo', () => {
  it('anota los ZIP y RAR (la primera parte de uno partido) sin sumar sus temas a la biblioteca', () => {
    expect(arch.list().map((a) => a.rel).sort()).toEqual(['Discos/Suelto.zip', 'Discos/Trap Drum Kit.zip', 'Discos/clave.rar', 'Discos/disco.rar', 'Discos/partes.part1.rar', 'Producción/Kits/cosas.zip'])
    expect((lib.db.prepare('SELECT rel_path AS r FROM files').all() as { r: string }[]).map((x) => x.r)).toEqual(['Discos/suelto.mp3'])
    expect(byName('disco.rar')).toMatchObject({ format: 'rar', status: 'ok', files: 4, audio: 2, samplePack: false, available: true })
    expect(byName('partes.part1.rar')).toMatchObject({ volumes: 3, audio: 2, status: 'ok' })
    expect(byName('clave.rar')).toMatchObject({ status: 'clave', audio: 0 })
    expect(byName('Suelto.zip')).toMatchObject({ files: 1, audio: 1 }) // sin la basura de __MACOSX
  })

  it('los sample packs quedan marcados: por la carpeta de producción, por el nombre o por lo que tienen', () => {
    expect(byName('cosas.zip')).toMatchObject({ samplePack: true, note: expect.stringContaining('producción') })
    expect(byName('Trap Drum Kit.zip')).toMatchObject({ samplePack: true })
    expect(() => ex.plan(byName('Trap Drum Kit.zip').id)).toThrow(/sample pack/)
  })

  it('un disco cuyo nombre tiene "Construction" o "Kit" no es un sample pack (repaso de criterios del 24/10)', () => {
    expect(samplePack('Discos/Depeche Mode - Construction Time Again.zip', 'musica', ['01 Love In Itself.mp3'])).toBeNull()
    expect(samplePack('Discos/Kit - Kitsch.rar', 'musica', ['01.mp3'])).toBeNull()
    expect(samplePack('Discos/Techno Construction Kit Vol 2.zip', 'musica', ['a.wav'])).not.toBeNull()
    expect(samplePack('Discos/Trap Drum Kit.zip', 'musica', ['a.wav'])).not.toBeNull()
  })

  it('"ya está afuera": mismo tamaño y formato, o el mismo nombre con unos bytes más (le escribieron tags)', async () => {
    const out = path.join(M, 'Discos', 'Abierto')
    fs.mkdirSync(out)
    // "Divididos - El 38" en la Música real: sacado del rar y con 128 bytes más de tags (corrida del 23/10)
    fs.writeFileSync(path.join(out, 'Sumo - Mejor no hablar.mp3'), Buffer.concat([fs.readFileSync(path.join(dir, 'tono.mp3')), Buffer.alloc(128)]))
    await lib.scan()
    expect(byName('Suelto.zip').outside).toBe(1)
    expect(arch.entries(byName('Suelto.zip').id)[0].outside).toBe(true)
    fs.rmSync(out, { recursive: true })
    await lib.scan()
    expect(byName('Suelto.zip').outside).toBe(0)
  })

  it('un comprimido que ya no está queda marcado; si cambia, se vuelve a listar', async () => {
    const f = path.join(M, 'Discos', 'otro.zip')
    fs.writeFileSync(f, makeZip([{ name: 'a.mp3', data: 'a' }]))
    await lib.scan()
    expect(byName('otro.zip').files).toBe(1)
    fs.writeFileSync(f, makeZip([{ name: 'a.mp3', data: 'a' }, { name: 'b.flac', data: 'b' }]))
    await lib.scan()
    expect(byName('otro.zip').files).toBe(2)
    fs.rmSync(f)
    await lib.scan()
    expect(byName('otro.zip')).toBeUndefined()
  })
})

describe('escuchar y analizar sin abrirlo entero', () => {
  it('escuchar saca solo ese tema a la caché, igual al original', async () => {
    const e = arch.entries(byName('disco.rar').id).find((x) => x.name === '02 Dos ♥ ш 🎵.mp3')!
    const cache = path.join(dir, 'cache')
    const p = await arch.prepare(e.id, cache)
    expect(md5(p)).toBe('7394e1bd1ea612f91e4acd65ea434140')
    expect(fs.readdirSync(cache)).toHaveLength(1)
    expect(await arch.prepare(e.id, cache)).toBe(p) // la segunda vez, de la caché
  })

  it('lee tags, nota, BPM y tono de a uno y no deja nada en la carpeta temporal', async () => {
    const tmp = path.join(dir, 'leer')
    const r = await readArchives(arch, [byName('Suelto.zip').id, byName('disco.rar').id, byName('Trap Drum Kit.zip').id], { ffprobe, ffmpeg, analysis: direct, tmpDir: tmp })
    expect(r).toEqual({ archives: 2, read: 3, errors: 0 }) // el drum kit no se lee
    const t = arch.entries(byName('Suelto.zip').id)[0]
    expect(t).toMatchObject({ artist: 'Sumo', title: 'Mejor no hablar', codec: 'mp3', kbps: 192 })
    expect(t.duration).toBeCloseTo(8, 0)
    expect(t.grade).toMatch(/^[A-F]\+?$/)
    expect(fs.readdirSync(tmp)).toEqual([])
    expect(byName('Suelto.zip')).toMatchObject({ read: 1, seconds: 8 })
    // lo leído se conserva si el comprimido se vuelve a listar con el mismo tema adentro
    expect((await readArchives(arch, [byName('Suelto.zip').id], { ffprobe, ffmpeg, analysis: null, tmpDir: tmp })).read).toBe(0)
  })
})

describe('Sacar al lado', () => {
  it('la vista previa: la carpeta de adentro va al lado, sin la basura; no toca nada', () => {
    const p = ex.plan(byName('disco.rar').id)
    expect(p.folderRel).toBe('Discos/Disco Ñandú')
    expect(p.items.map((i) => i.rel).sort()).toEqual(['Discos/Disco Ñandú/01 Uno ñandú.mp3', 'Discos/Disco Ñandú/02 Dos ♥ ш 🎵.mp3', 'Discos/Disco Ñandú/cover.jpg', 'Discos/Disco Ñandú/leeme.txt'])
    expect(fs.existsSync(path.join(M, 'Discos', 'Disco Ñandú'))).toBe(false)
    // sin carpeta adentro: una con el nombre del comprimido
    expect(ex.plan(byName('Suelto.zip').id).items.map((i) => i.rel)).toEqual(['Discos/Suelto/Sumo - Mejor no hablar.mp3'])
  })

  it('en modo "solo mirar" no escribe nada, ni la carpeta de trabajo', async () => {
    process.env.PAILA_SOLO_LECTURA = '1'
    try { await expect(ex.apply(ex.plan(byName('disco.rar').id))).rejects.toThrow(/solo para mirar/) } finally { delete process.env.PAILA_SOLO_LECTURA }
    expect(fs.existsSync(path.join(M, '_PAILA'))).toBe(false)
  })

  it('saca, queda en el Historial, el comprimido no cambia, y deshacer lo manda a la papelera de PAILA', async () => {
    const before = md5(path.join(M, 'Discos', 'disco.rar'))
    const r = await ex.apply(ex.plan(byName('disco.rar').id))
    expect(r).toMatchObject({ done: 4, failed: [], folder: 'Discos/Disco Ñandú' })
    expect(md5(path.join(M, 'Discos', 'Disco Ñandú', '02 Dos ♥ ш 🎵.mp3'))).toBe('7394e1bd1ea612f91e4acd65ea434140')
    expect(md5(path.join(M, 'Discos', 'disco.rar'))).toBe(before)
    expect(fs.existsSync(path.join(M, ...STAGING.split('/')))).toBe(false) // la carpeta de trabajo no queda
    const e = hist.list().find((x) => x.kind === 'comprimido')!
    expect(e).toMatchObject({ files: 4, canUndo: true, undone: false })
    expect(e.summary).toContain('«disco.rar»')
    await lib.scan()
    expect(byName('disco.rar')).toMatchObject({ outside: 2, extractedTo: 'Discos/Disco Ñandú' })
    // otra vez: lo que ya está afuera, igual, no se repite
    expect(ex.plan(byName('disco.rar').id).items).toEqual([])
    const u = await ex.undo(e.id)
    expect(u).toEqual({ done: 4, failed: [] })
    expect(fs.existsSync(path.join(M, 'Discos', 'Disco Ñandú'))).toBe(false)
    const trashed = fs.readdirSync(path.join(M, '_PAILA', 'papelera'))
    expect(trashed).toHaveLength(1)
    expect(fs.readdirSync(path.join(M, '_PAILA', 'papelera', trashed[0], 'Discos', 'Disco Ñandú')).length).toBe(4)
    expect(hist.list().find((x) => x.kind === 'comprimido')).toMatchObject({ undone: true, canUndo: false })
    expect(md5(path.join(M, 'Discos', 'disco.rar'))).toBe(before)
  })

  it('deshacer no se lleva lo que cambiaste después de sacarlo', async () => {
    const r = await ex.apply(ex.plan(byName('Suelto.zip').id))
    const f = path.join(M, 'Discos', 'Suelto', 'Sumo - Mejor no hablar.mp3')
    fs.appendFileSync(f, 'tag nuevo')
    const u = await ex.undo(r.batch)
    expect(u.done).toBe(0)
    expect(u.failed[0].error).toMatch(/Lo cambiaste/)
    expect(fs.existsSync(f)).toBe(true)
  })

  it('un corte en medio de sacar: lo que llegó se anota, lo que quedó en la carpeta de trabajo se saca', async () => {
    const stage = path.join(M, ...STAGING.split('/'), 'x')
    fs.mkdirSync(stage, { recursive: true })
    const a = path.join(stage, 'a.mp3'), b = path.join(stage, 'b.mp3')
    fs.writeFileSync(a, 'a'); fs.writeFileSync(b, 'b')
    const dstA = path.join(M, 'Discos', 'Corte', 'a.mp3'), dstB = path.join(M, 'Discos', 'Corte', 'b.mp3')
    fs.mkdirSync(path.dirname(dstA), { recursive: true }); fs.renameSync(a, dstA) // a llegó; b no
    const j = new OpJournal(lib.db)
    const data = (rel: string) => ({ batch: 99, archiveId: byName('disco.rar').id, archiveRel: 'Discos/disco.rar', rootId: byName('disco.rar').rootId, rel })
    j.begin({ op: 'abrir', rootId: null, src: a, dst: dstA, data: data('Discos/Corte/a.mp3') })
    j.begin({ op: 'abrir', rootId: null, src: b, dst: dstB, data: data('Discos/Corte/b.mp3') })
    const rep = await recover(lib.db, { rootPath, ffmpeg })
    expect(rep.items.map((i) => i.result).sort()).toEqual(['completado', 'no-hecho'])
    expect(fs.existsSync(b)).toBe(false) // la copia de PAILA a medias no queda
    expect(fs.existsSync(dstA)).toBe(true)
    expect(hist.detail('comprimido', 99).rows.map((x) => x.name)).toEqual(['a.mp3'])
  })
})
