// Respaldo de archivos por paso (motor único; core/ops/backup.ts; masterplan 3, punto 1.1; liviano desde el 24/10): antes de
// cambiar lo de adentro de un archivo, se guarda lo que cambia (verificado: rearma el original); si falta lugar, no arranca
// nada, y si lo guardado no rearma el original, ese archivo no se toca. El Historial dice dónde quedó; se borran solo a mano.
// Los formatos uno por uno, el freno y los respaldos completos viejos: tests/respaldo-liviano.test.ts. Solo archivos sintéticos.
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
import { readTags } from '@paila/core/tagio'
import { readDelta } from '@paila/core/ops/delta'
import { listBackups, restoreBackup, setBackupDir, trashBackups, trashedBackups } from '@paila/core/ops/backup'
import { purgeTrash, trashLimit, trashSummary, trashUsage } from '@paila/core/purge'
import { History } from '@paila/core/history'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Replacer } from '@paila/core/replace'
import { Improver } from '@paila/core/improve'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()
let dir: string, lib: Library, changes: Changes, hist: History
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const relOf = (id: number) => (lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id) as { rel: string }).rel
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
const tone = (rel: string, meta: Record<string, string>) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
}
const files = (d: string) => (fs.readdirSync(d, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(d, f)).isFile()).map((f) => f.split(path.sep).join('/')).sort()

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-respaldo-'))
  for (const n of ['a', 'b', 'c']) tone(`Disco/${n}.mp3`, { artist: 'Fulano', title: n.toUpperCase(), genre: 'Rock' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  const playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
  hist = new History(lib.db, { changes, trash: new Trash(lib.db, rootPath, playlists), organizer: new Organizer(lib.db, rootPath), replacer: new Replacer(lib.db, rootPath, ffprobe, ffmpeg), improver: new Improver(lib.db), rootPath })
})
afterEach(() => { vi.restoreAllMocks(); setBackupDir(lib.db, null) })
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('respaldo antes de escribir', () => {
  it('la vista previa dice cuántos archivos, cuánto ocupa y dónde va; renombrar solo no se respalda', () => {
    changes.stage([idOf('Disco/a.mp3'), idOf('Disco/b.mp3')], 'genre', 'Pop')
    changes.stage([idOf('Disco/c.mp3')], 'filename', 'c renombrado')
    const p = changes.backupPlan()
    expect(p).toMatchObject({ files: 2, problem: null, warning: null, dirs: [path.join(M(''), '_PAILA', 'respaldos')] })
    // lo que va a ocupar: los metadatos de cada uno, no los archivos enteros
    expect(p.bytes).toBeGreaterThan(0)
    expect(p.bytes).toBeLessThan((fs.statSync(M('Disco/a.mp3')).size + fs.statSync(M('Disco/b.mp3')).size) / 2)
    changes.discard()
  })
  it('guarda lo que cambia de cada uno (con la huella del de antes), al lado de la música, y el Historial dice dónde quedó', async () => {
    const before = fs.readFileSync(M('Disco/a.mp3'))
    changes.stage([idOf('Disco/a.mp3'), idOf('Disco/b.mp3')], 'genre', 'Pop')
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    const [b] = listBackups(lib.db)
    expect(b).toMatchObject({ op: 'tags', ref: r.batchId, files: 2, complete: true, exists: true, light: true })
    expect(path.dirname(b.dir)).toBe(path.join(M(''), '_PAILA', 'respaldos'))
    expect(path.basename(b.dir)).toMatch(/^tags-\d{8}-\d{6}$/)
    // un solo archivo por tanda (cambios.paila), con la posición de cada tema anotada
    expect(files(b.dir)).toEqual(['cambios.paila'])
    const at = (lib.db.prepare('SELECT pos FROM backup_files WHERE backup_id = ? AND rel = ?').get(b.id, 'Disco/a.mp3') as { pos: number }).pos
    expect(readDelta(path.join(b.dir, 'cambios.paila'), at).header.old).toEqual({ size: before.length, sha1: crypto.createHash('sha1').update(before).digest('hex') })
    expect(b.bytes).toBeLessThan(before.length / 4)
    expect(readTags(M('Disco/a.mp3')).genre).toBe('Pop')
    expect(hist.list().find((e) => e.kind === 'tags' && e.id === r.batchId)!.backups).toEqual([{ id: b.id, dir: b.dir, files: 2, bytes: b.bytes, op: 'tags', exists: true, light: true }])
    // el escaneo no los toma como temas (están en _PAILA)
    const n = (lib.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
    await lib.scan()
    expect((lib.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n).toBe(n)
    // deshacer también vuelve a escribir: su propio respaldo antes
    await changes.undo(r.batchId!)
    expect(listBackups(lib.db)[0]).toMatchObject({ op: 'deshacer-tags', ref: r.batchId, files: 2 })
    expect(readTags(M('Disco/a.mp3')).genre).toBe('Rock')
    expect(fs.readFileSync(M('Disco/a.mp3')).equals(before)).toBe(true) // byte a byte como estaba
  })
  it('si falta lugar para el respaldo, avisa y no toca nada', async () => {
    const real = fs.statfsSync
    vi.spyOn(fs, 'statfsSync').mockImplementation(((p: fs.PathLike) => ({ ...real(p), bavail: 1, bsize: 1 })) as typeof fs.statfsSync)
    changes.stage([idOf('Disco/a.mp3')], 'genre', 'Jazz')
    expect(changes.backupPlan().problem).toMatch(/^Falta lugar: hacen falta .* y quedan .* libres/)
    const n = listBackups(lib.db).length
    await expect(changes.apply()).rejects.toThrow(/Falta lugar/)
    expect(readTags(M('Disco/a.mp3')).genre).toBe('Rock')
    expect(changes.list()).toHaveLength(1) // sigue pendiente
    expect(listBackups(lib.db)).toHaveLength(n)
    changes.discard()
  })
  it('si lo guardado no rearma el original, ese archivo no se toca y no queda nada a medias', async () => {
    // los bytes de antes que se guardan en el respaldo salen arruinados (ceros); el encabezado (las 3 primeras escrituras), bien
    const realOpen = fs.openSync, realWrite = fs.writeSync
    const bad = new Map<number, number>()
    vi.spyOn(fs, 'openSync').mockImplementation(((f: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      const fd = realOpen(f, flags, mode)
      if (String(f).endsWith('cambios.paila') && flags === 'a') bad.set(fd, 0)
      return fd
    }) as typeof fs.openSync)
    vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, b: Buffer, ...r: number[]) => {
      const k = bad.get(fd)
      if (k != null) bad.set(fd, k + 1)
      return realWrite(fd, k != null && k >= 3 && Buffer.isBuffer(b) ? Buffer.alloc(b.length, 0x55) : b, ...r)
    }) as unknown as typeof fs.writeSync)
    const before = fs.readFileSync(M('Disco/b.mp3'))
    changes.stage([idOf('Disco/b.mp3')], 'genre', 'Jazz')
    const r = await changes.apply()
    expect(r.failed.map((f) => f.error)).toEqual(['El respaldo liviano no rearma el original: no se tocó nada'])
    expect(fs.readFileSync(M('Disco/b.mp3')).equals(before)).toBe(true)
    expect(fs.readdirSync(M('_PAILA/escribiendo'))).toEqual([]) // ni el temporal
    expect(changes.list()).toHaveLength(1) // sigue pendiente
    changes.discard()
  })
  it('con otra carpeta elegida, van ahí', async () => {
    const otra = path.join(dir, 'Respaldos elegidos')
    setBackupDir(lib.db, otra)
    changes.stage([idOf('Disco/c.mp3')], 'genre', 'Folk')
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    const b = listBackups(lib.db)[0]
    expect(path.dirname(b.dir)).toBe(otra)
    expect(files(b.dir)).toEqual(['cambios.paila'])
    expect((lib.db.prepare('SELECT rel FROM backup_files WHERE backup_id = ?').get(b.id) as { rel: string }).rel).toBe(relOf(idOf('Disco/c.mp3')))
  })
})

describe('borrar respaldos: van a la papelera de PAILA, se recuperan, y solo Vaciar papelera los borra', () => {
  it('la carpeta pasa a _PAILA/papelera, se ve en la papelera, se recupera, y Vaciar papelera la borra de verdad', () => {
    const roots = () => lib.roots().map((r) => ({ id: r.id, path: r.path }))
    const all = listBackups(lib.db)
    const one = all[all.length - 1]
    expect(trashBackups(lib.db, [one.id], roots())).toMatchObject({ moved: 1, bytes: one.bytes, failed: [] })
    expect(fs.existsSync(one.dir)).toBe(false)
    expect(listBackups(lib.db).find((b) => b.id === one.id)).toBeUndefined()
    const [t] = trashedBackups(lib.db)
    expect(t).toMatchObject({ id: one.id, dir: one.dir, exists: true })
    expect(path.relative(M(''), t.trashDir!).split(path.sep).slice(0, 2)).toEqual(['_PAILA', 'papelera'])
    const folder = path.basename(path.dirname(t.trashDir!))
    expect(folder).toMatch(/_respaldo-tags_/)
    // en Espacio → Papelera, con su nombre
    const inTrash = () => trashUsage(lib.db, () => lib.roots()).folders.find((f) => f.folder === folder)
    expect(inTrash()).toMatchObject({ kind: 'respaldo', label: expect.stringMatching(/^Respaldos que mandaste a la papelera/) })
    // el resumen (barra lateral, Inicio): cuánto es de respaldos; en un disco grande no avisa, en uno chico sí (5 % del disco)
    const s = trashSummary(lib.db, () => lib.roots())
    expect(s.backups).toBe(inTrash()!.bytes)
    expect(s).toMatchObject({ bytes: s.backups + s.tracks + s.other, warn: false })
    const real = fs.statfsSync
    vi.spyOn(fs, 'statfsSync').mockImplementation(((p: fs.PathLike) => ({ ...real(p), blocks: 1000, bsize: 1 })) as typeof fs.statfsSync)
    expect(trashSummary(lib.db, () => lib.roots())).toMatchObject({ warn: true, limit: 50 })
    vi.restoreAllMocks()
    expect([trashLimit(2e12), trashLimit(50e9), trashLimit(null)]).toEqual([5e9, 2.5e9, 5e9])
    // se recupera: vuelve a su lugar, a la lista y a servir para deshacer
    restoreBackup(lib.db, one.id)
    expect(fs.existsSync(one.dir)).toBe(true)
    expect(listBackups(lib.db).find((b) => b.id === one.id)).toBeTruthy()
    expect(trashedBackups(lib.db)).toEqual([])
    expect(inTrash()).toBeUndefined()
    // otra vez a la papelera: Vaciar papelera (lo único que borra de verdad) se lo lleva, y ya no se puede recuperar
    trashBackups(lib.db, [one.id], roots())
    const again = trashedBackups(lib.db)[0]
    const f2 = trashUsage(lib.db, () => lib.roots()).folders.find((f) => f.folder === path.basename(path.dirname(again.trashDir!)))!
    expect(purgeTrash(lib.db, () => lib.roots(), [f2.key]).failed).toEqual([])
    expect(fs.existsSync(again.trashDir!)).toBe(false)
    expect(trashedBackups(lib.db)).toEqual([])
    expect(() => restoreBackup(lib.db, one.id)).toThrow('Ya no está: se vació la papelera')
  })
  it('nunca algo que no tenga forma de respaldo (una carpeta de música, o algo adentro fuera de _PAILA)', () => {
    lib.db.prepare("INSERT INTO backups (op, dir, files, bytes, created_at, complete) VALUES ('tags', ?, 0, 0, ?, 1)").run(M('Disco'), new Date().toISOString())
    const bad = listBackups(lib.db).find((b) => b.dir === M('Disco'))!
    expect(trashBackups(lib.db, [bad.id], lib.roots().map((r) => ({ id: r.id, path: r.path }))).failed.map((f) => f.error)).toEqual(['Esa carpeta no es un respaldo de PAILA: no se toca'])
    expect(fs.existsSync(M('Disco/a.mp3'))).toBe(true)
  })
})
