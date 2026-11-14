// Respaldo liviano y escritura segura (decisión del 24/10; core/ops/delta.ts, core/changes-write.ts): por cada formato,
// cambiar tags, tapa y comentario → el audio no cambia → el respaldo guarda solo unos KB → deshacer deja el archivo byte a byte
// igual al original. Además: dos tandas seguidas, un archivo que cambió después (vuelve con los tags de antes), los respaldos
// completos de la 0.5.3 (siguen sirviendo para deshacer) y el freno cuando el respaldo crece más de lo previsto.
// Solo archivos sintéticos en carpetas temporales.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { pcmHash } from '@paila/core/audiohash'
import { readComment, readCover, readTags } from '@paila/core/tagio'
import { BackupFull, StepBackup, listBackups, planBackup, restoreBackup, trashBackups } from '@paila/core/ops/backup'
import { readDelta } from '@paila/core/ops/delta'

// para simular que el sonido cambia al escribir: la huella del temporal (en _PAILA/escribiendo) sale distinta
const ctl = vi.hoisted(() => ({ lie: false }))
vi.mock('@paila/core/audiohash', async (orig) => {
  const real = await orig<typeof import('@paila/core/audiohash')>()
  return { pcmHash: async (ff: string, file: string) => (ctl.lie && /escribiendo/.test(file) ? 'otro sonido' : real.pcmHash(ff, file)) }
})

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()
let dir: string, lib: Library, changes: Changes, png: string
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const sha1 = (p: string) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')
const coverJson = (p: string) => JSON.stringify({ mime: 'image/png', data: fs.readFileSync(p).toString('base64') })
const work = () => { try { return fs.readdirSync(M('_PAILA/escribiendo')) } catch { return [] } }

// formato → cómo lo arma ffmpeg (con tags; los que llevan tapa, con una de 300×300)
const FORMATS: { name: string; rel: string; args: string[]; cover: boolean }[] = [
  { name: 'MP3 con ID3v2.3', rel: 'F/v23.mp3', args: ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3'], cover: true },
  { name: 'MP3 con ID3v2.4 y el tag viejo del final', rel: 'F/v24.mp3', args: ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '4', '-write_id3v1', '1'], cover: true },
  { name: 'FLAC', rel: 'F/a.flac', args: ['-c:a', 'flac'], cover: true },
  { name: 'M4A (AAC)', rel: 'F/a.m4a', args: ['-c:a', 'aac', '-b:a', '128k'], cover: true },
  { name: 'M4A (AAC) con el índice al principio', rel: 'F/b.m4a', args: ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'], cover: false },
  { name: 'AIFF', rel: 'F/a.aiff', args: ['-c:a', 'pcm_s16be', '-write_id3v2', '1'], cover: false },
  { name: 'WAV', rel: 'F/a.wav', args: ['-c:a', 'pcm_s16le'], cover: false },
  { name: 'OGG (Vorbis)', rel: 'F/a.ogg', args: ['-c:a', 'libvorbis'], cover: false },
  { name: 'Opus', rel: 'F/a.opus', args: ['-c:a', 'libopus'], cover: false },
]

function make(rel: string, args: string[], cover: boolean, meta: Record<string, string> = { title: 'Hola', artist: 'Fulano', genre: 'Rock' }, seconds = 8) {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  const pic = cover ? ['-i', png, '-map', '0:a', '-map', '1:v', '-c:v', 'png', '-disposition:v', 'attached_pic'] : []
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, ...pic, ...args, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-liviano-'))
  png = path.join(dir, 'tapa.png')
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=300x300', '-frames:v', '1', png])
  for (const f of FORMATS) make(f.rel, f.args, f.cover)
  for (const n of ['x', 'y', 'z', 'w']) make(`Otros/${n}.mp3`, ['-c:a', 'libmp3lame', '-b:a', '128k'], false)
  for (const n of [1, 2, 3, 4, 5, 6]) make(`Freno/${n}.mp3`, ['-c:a', 'libmp3lame', '-b:a', '128k'], false)
  // el primero, largo: tarda más en verificarse y sus tags se anotan últimos (el orden que rompía deshacer en la corrida)
  for (const n of ['a', 'b', 'c', 'd']) make(`Mezcla/${n}.mp3`, ['-c:a', 'libmp3lame', '-b:a', '128k'], false, { title: n, artist: `Artista ${n}`, album: `Disco ${n}` }, n === 'a' ? 240 : 2)
  // un MP3 con ceros sueltos entre el tag y el audio (como los dos MP3 reales de tests/changes.test.ts)
  make('Ceros/relleno.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3', '-write_xing', '0'], false)
  const z = fs.readFileSync(M('Ceros/relleno.mp3')), end = 10 + ((z[6] << 21) | (z[7] << 14) | (z[8] << 7) | z[9])
  fs.writeFileSync(M('Ceros/relleno.mp3'), Buffer.concat([z.subarray(0, end), Buffer.alloc(1044), z.subarray(end)]))
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('cada formato: cambiar → deshacer → byte a byte igual al original', () => {
  for (const f of FORMATS) {
    it(f.name, async () => {
      const id = idOf(f.rel)
      const original = fs.readFileSync(M(f.rel))
      const sound = await pcmHash(ffmpeg, M(f.rel))
      changes.stage([id], 'genre', 'Deep House Progresivo con un nombre bien largo')
      changes.stage([id], 'title', 'Otro título')
      changes.stage([id], 'comment', 'Tracklist:\n1. Uno\n2. Dos')
      if (f.cover) changes.stage([id], 'cover', coverJson(png))
      const plan = changes.backupPlan()
      expect(plan).toMatchObject({ files: 1, problem: null, warning: null })
      expect(plan.bytes).toBeLessThan(original.length / 4) // la vista previa: unos KB, no el archivo entero
      const r = await changes.apply()
      expect(r.failed).toEqual([])
      // el audio no cambió y los tags sí
      expect(await pcmHash(ffmpeg, M(f.rel))).toBe(sound)
      expect(readTags(M(f.rel)).genre).toBe('Deep House Progresivo con un nombre bien largo')
      expect(readComment(M(f.rel))).toBe('Tracklist:\n1. Uno\n2. Dos')
      // el respaldo: solo lo que cambió, con las huellas de antes y de después
      const [b] = listBackups(lib.db)
      expect(b).toMatchObject({ op: 'tags', ref: r.batchId, files: 1, complete: true, light: true })
      // todo en un solo archivo por tanda (cambios.paila), con la posición de cada tema anotada
      expect(fs.readdirSync(b.dir)).toEqual(['cambios.paila'])
      const delta = path.join(b.dir, 'cambios.paila')
      const row = lib.db.prepare('SELECT rel, pos FROM backup_files WHERE backup_id = ?').get(b.id) as { rel: string; pos: number }
      expect(row).toEqual({ rel: f.rel, pos: 0 })
      const { header } = readDelta(delta, row.pos)
      expect(header).toMatchObject({ entero: false, old: { size: original.length, sha1: crypto.createHash('sha1').update(original).digest('hex') }, new: { sha1: sha1(M(f.rel)) } })
      expect(b.bytes).toBe(fs.statSync(delta).size)
      expect(b.bytes).toBeLessThan(original.length / 4)
      expect(work()).toEqual([]) // no quedó ningún temporal
      // deshacer: idéntico al original, byte a byte
      const u = await changes.undo(r.batchId!)
      expect(u.failed).toEqual([])
      expect(fs.readFileSync(M(f.rel)).equals(original)).toBe(true)
      expect(readTags(M(f.rel)).genre).toBe('Rock')
      if (f.cover) expect(readCover(M(f.rel))).not.toBeNull()
      // deshacer también dejó su respaldo liviano
      expect(listBackups(lib.db)[0]).toMatchObject({ op: 'deshacer-tags', ref: r.batchId, files: 1, light: true })
    })
  }
})

describe('el audio no cambia nunca', () => {
  it('si al escribir el sonido cambiara, el original no se toca y no queda nada a medias', async () => {
    const id = idOf('F/a.flac'), original = fs.readFileSync(M('F/a.flac'))
    const n = (lib.db.prepare('SELECT COUNT(*) AS n FROM backup_files').get() as { n: number }).n
    changes.stage([id], 'genre', 'Jazz')
    ctl.lie = true
    try {
      const r = await changes.apply()
      expect(r.failed.map((f) => f.error)).toEqual(['El sonido cambió al guardar (la huella del audio no coincide)'])
    } finally { ctl.lie = false }
    expect(fs.readFileSync(M('F/a.flac')).equals(original)).toBe(true)
    expect(work()).toEqual([])
    expect((lib.db.prepare('SELECT COUNT(*) AS n FROM backup_files').get() as { n: number }).n).toBe(n) // ningún respaldo de un cambio que no quedó
    expect(changes.list()).toHaveLength(1) // sigue pendiente
    changes.discard()
  })
})

describe('deshacer en orden, y cuando el archivo cambió después', () => {
  it('dos tandas seguidas, deshechas de la última a la primera: vuelve idéntico', async () => {
    const id = idOf('Otros/x.mp3'), original = fs.readFileSync(M('Otros/x.mp3'))
    changes.stage([id], 'genre', 'Pop')
    const r1 = await changes.apply()
    changes.stage([id], 'title', 'Segundo')
    const r2 = await changes.apply()
    expect((await changes.undo(r2.batchId!)).failed).toEqual([])
    expect((await changes.undo(r1.batchId!)).failed).toEqual([])
    expect(fs.readFileSync(M('Otros/x.mp3')).equals(original)).toBe(true)
  })
  it('con el respaldo en la papelera de PAILA, deshacer igual vuelve los tags; recuperado, vuelve byte a byte', async () => {
    const id = idOf('Otros/w.mp3')
    const roots = lib.roots().map((r) => ({ id: r.id, path: r.path }))
    const tanda = async () => { changes.stage([id], 'genre', 'Salsa'); return (await changes.apply()).batchId! }
    const b1 = await tanda()
    trashBackups(lib.db, listBackups(lib.db).filter((b) => b.ref === b1 && b.op === 'tags').map((b) => b.id), roots)
    expect((await changes.undo(b1)).failed).toEqual([])
    expect(readTags(M('Otros/w.mp3')).genre).toBe('Rock')
    const before = fs.readFileSync(M('Otros/w.mp3'))
    const b2 = await tanda()
    const [bk] = listBackups(lib.db).filter((b) => b.ref === b2 && b.op === 'tags')
    trashBackups(lib.db, [bk.id], roots)
    restoreBackup(lib.db, bk.id)
    expect((await changes.undo(b2)).failed).toEqual([])
    expect(fs.readFileSync(M('Otros/w.mp3')).equals(before)).toBe(true)
  })
  it('si una tanda posterior sigue aplicada, deshacer la anterior vuelve a escribir los tags de antes (sin tocar lo otro)', async () => {
    const id = idOf('Otros/y.mp3')
    changes.stage([id], 'genre', 'Pop')
    const r1 = await changes.apply()
    changes.stage([id], 'title', 'Segundo')
    await changes.apply()
    expect((await changes.undo(r1.batchId!)).failed).toEqual([])
    expect(readTags(M('Otros/y.mp3'))).toMatchObject({ genre: 'Rock', title: 'Segundo' })
  })
})

describe('un MP3 que la librería de tags no abre (ceros antes del audio)', () => {
  it('el volumen parejo se arma igual (antes se caía todo el armado), se aplica sin tocar el sonido y deshacer lo deja idéntico', async () => {
    // error de la corrida supervisada (24/10): leer el volumen de antes tiraba "MPEG audio header not found" y no se armaba nada
    const file = M('Ceros/relleno.mp3'), original = fs.readFileSync(file)
    expect(() => readTags(file)).toThrow(/MPEG audio header not found/)
    const sound = await pcmHash(ffmpeg, file)
    const rg = JSON.stringify({ tg: -6.5, tp: 0.9, ag: null, ap: null })
    changes.stageMany([{ id: idOf('Ceros/relleno.mp3'), field: 'replaygain', value: rg }, { id: idOf('Otros/x.mp3'), field: 'replaygain', value: rg }])
    expect(changes.list()).toHaveLength(2)
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    expect(await pcmHash(ffmpeg, file)).toBe(sound)
    expect((await changes.undo(r.batchId!)).failed).toEqual([])
    expect(fs.readFileSync(file).equals(original)).toBe(true)
  })
})

describe('el cover.jpg de una carpeta con varios discos', () => {
  it('dos temas de la misma tanda cambian el mismo cover.jpg y Folder.jpg: deshacer los deja como estaban', async () => {
    // error de la corrida supervisada (24/10): deshacía en el orden de aplicar y quedaba la tapa del otro disco
    const jpg = (name: string, color: string, side: number) => {
      const p = path.join(dir, name)
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${side}x${side}`, '-frames:v', '1', p])
      return p
    }
    fs.copyFileSync(jpg('chica.jpg', 'yellow', 100), M('Mezcla/cover.jpg'))
    fs.copyFileSync(jpg('mini.jpg', 'gray', 50), M('Mezcla/Folder.jpg'))
    const cover0 = fs.readFileSync(M('Mezcla/cover.jpg')), folder0 = fs.readFileSync(M('Mezcla/Folder.jpg'))
    const val = (p: string) => JSON.stringify({ mime: 'image/jpeg', data: fs.readFileSync(p).toString('base64') })
    changes.stage([idOf('Mezcla/a.mp3')], 'folderCover', val(jpg('azul.jpg', 'blue', 400)))
    changes.stage([idOf('Mezcla/b.mp3')], 'folderCover', val(jpg('verde.jpg', 'green', 400)))
    changes.stage([idOf('Mezcla/c.mp3')], 'folderCover', val(jpg('rojo.jpg', 'red', 500)))
    changes.stage([idOf('Mezcla/d.mp3')], 'folderCover', val(jpg('negro.jpg', 'black', 600)))
    // y tags: sus filas se anotan después de las del cover.jpg (el caso de la corrida: el orden por tema no alcanzaba)
    changes.stage(['a', 'b', 'c', 'd'].map((n) => idOf(`Mezcla/${n}.mp3`)), 'genre', 'Cumbia')
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    expect(fs.readFileSync(M('Mezcla/cover.jpg')).equals(cover0)).toBe(false)
    expect((await changes.undo(r.batchId!)).failed).toEqual([])
    expect(fs.readFileSync(M('Mezcla/cover.jpg')).equals(cover0)).toBe(true)
    expect(fs.readFileSync(M('Mezcla/Folder.jpg')).equals(folder0)).toBe(true)
  })
})

describe('los respaldos completos de la 0.5.3 siguen sirviendo para deshacer', () => {
  it('con la copia entera de antes de la tanda, deshacer deja el archivo idéntico', async () => {
    const id = idOf('Otros/z.mp3'), original = fs.readFileSync(M('Otros/z.mp3'))
    // como lo hacía la 0.5.3: una copia entera en _PAILA/respaldos/tags-<fecha>/<ruta>
    const old = M('_PAILA/respaldos/tags-20261023-120000')
    fs.mkdirSync(path.join(old, 'Otros'), { recursive: true })
    fs.copyFileSync(M('Otros/z.mp3'), path.join(old, 'Otros', 'z.mp3'))
    changes.stage([id], 'genre', 'Cumbia')
    const r = await changes.apply()
    // esa tanda, con un respaldo completo en vez del liviano
    lib.db.prepare('UPDATE backups SET deleted_at = ? WHERE ref = ? AND op = ?').run(new Date().toISOString(), r.batchId, 'tags')
    lib.db.prepare("INSERT INTO backups (op, ref, root_id, dir, files, bytes, created_at, complete) VALUES ('tags', ?, ?, ?, 1, ?, ?, 1)")
      .run(r.batchId, lib.roots()[0].id, old, original.length, new Date().toISOString())
    expect(listBackups(lib.db).find((b) => b.dir === old)).toMatchObject({ light: false })
    expect((await changes.undo(r.batchId!)).failed).toEqual([])
    expect(fs.readFileSync(M('Otros/z.mp3')).equals(original)).toBe(true)
  })
})

describe('el lugar', () => {
  it('la vista previa avisa si el respaldo ocuparía más del 10 % de lo libre (se puede seguir) y frena si no entra', () => {
    fs.mkdirSync(M('Tapas'), { recursive: true })
    fs.writeFileSync(M('Tapas/cover.jpg'), crypto.randomBytes(10e6)) // el cover.jpg de una carpeta se copia entero
    const items = [{ rootId: lib.roots()[0].id, rel: 'Tapas/cover.jpg', whole: true }]
    const deps = { rootPath: () => M('') }
    const real = fs.statfsSync
    const freeIs = (n: number) => vi.spyOn(fs, 'statfsSync').mockImplementation(((p: fs.PathLike) => ({ ...real(p), bavail: n, bsize: 1 })) as typeof fs.statfsSync)
    freeIs(90e6)
    expect(planBackup(lib.db, items, deps)).toMatchObject({ files: 1, bytes: 10e6, problem: null, warning: expect.stringMatching(/^Ojo: el respaldo ocuparía unos 10 MB, más del 10 % de lo que queda libre/) })
    freeIs(500e6)
    expect(planBackup(lib.db, items, deps)).toMatchObject({ problem: null, warning: null })
    freeIs(55e6)
    expect(planBackup(lib.db, items, deps)).toMatchObject({ problem: expect.stringMatching(/^Falta lugar: hacen falta .* y quedan .* libres/), warning: null })
    fs.rmSync(M('Tapas'), { recursive: true })
  })
  it('si no entra, aplicar no arranca y no toca nada', async () => {
    const real = fs.statfsSync
    vi.spyOn(fs, 'statfsSync').mockImplementation(((p: fs.PathLike) => ({ ...real(p), bavail: 1, bsize: 1 })) as typeof fs.statfsSync)
    const before = fs.readFileSync(M('F/a.flac'))
    changes.stage([idOf('F/a.flac')], 'genre', 'Jazz')
    expect(changes.backupPlan().problem).toMatch(/^Falta lugar/)
    await expect(changes.apply()).rejects.toThrow(/Falta lugar/)
    expect(fs.readFileSync(M('F/a.flac')).equals(before)).toBe(true)
    expect(changes.list()).toHaveLength(1) // sigue pendiente
    changes.discard()
  })
  it('si en el medio el respaldo pasa lo previsto, se frena: lo hecho queda bien y lo demás sigue pendiente', async () => {
    const real = fs.statfsSync
    vi.spyOn(fs, 'statfsSync').mockImplementation(((p: fs.PathLike) => ({ ...real(p), bavail: 300e6, bsize: 1 })) as typeof fs.statfsSync)
    const bk = StepBackup.start(lib.db, 'tags', null, [{ rootId: lib.roots()[0].id, rel: 'Freno/1.mp3' }], { rootPath: () => M('') })
    const at = bk.target(lib.roots()[0].id)
    // el límite: el 10 % de lo libre (30 MB); este "ocupó" 40 MB
    bk.record(lib.roots()[0].id, null, 'Freno/1.mp3', { path: at, pos: 0, bytes: 40e6, kind: 'cambio', old: { size: 1, sha1: 'a' }, new: { size: 1, sha1: 'b' } })
    expect(() => bk.target(lib.roots()[0].id)).toThrow(/^Se frenó la tanda: el respaldo ya ocupa 40 MB, más de lo previsto/)
    bk.finish()
    vi.restoreAllMocks()
    // aplicando: el segundo tema que llega al límite frena la tanda
    const target = StepBackup.prototype.target
    let calls = 0
    vi.spyOn(StepBackup.prototype, 'target').mockImplementation(function (this: StepBackup, rootId: number) {
      if (++calls > 1) throw new BackupFull('Se frenó la tanda (prueba)')
      return target.call(this, rootId)
    })
    const ids = [1, 2, 3, 4, 5, 6].map((n) => idOf(`Freno/${n}.mp3`))
    changes.stage(ids, 'genre', 'Freno')
    const r = await changes.apply()
    expect(r.applied).toBe(1)
    // los que ya habían arrancado a la vez (hasta 4) se frenan con el mismo aviso; los demás ni empiezan
    expect(r.failed.length).toBeGreaterThan(0)
    expect(new Set(r.failed.map((f) => f.error))).toEqual(new Set(['Se frenó la tanda (prueba)']))
    expect(changes.list()).toHaveLength(5)
    expect(work()).toEqual([])
    changes.discard()
  })
})
