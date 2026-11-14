// Tests del candado de operaciones (core/oplock.ts): dos tareas pesadas sobre los archivos no corren a la vez.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OpLock } from '@paila/core/oplock'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Space } from '@paila/core/space'
import { Changes } from '@paila/core/changes'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')

describe('candado de operaciones', () => {
  it('no deja correr dos operaciones a la vez y dice qué se está haciendo', async () => {
    const lock = new OpLock()
    let release!: () => void
    const first = lock.run('moviendo archivos', () => new Promise<void>((r) => { release = r }))
    expect(lock.busy).toBe('moviendo archivos')
    await expect(lock.run('escaneando', async () => 1)).rejects.toThrow(/moviendo archivos/)
    release(); await first
    expect(lock.busy).toBeNull()
    expect(await lock.run('escaneando', async () => 2)).toBe(2)
  })
  it('se libera aunque la operación falle', async () => {
    const lock = new OpLock()
    await expect(lock.run('x', async () => { throw new Error('falló') })).rejects.toThrow('falló')
    expect(lock.busy).toBeNull()
  })
})

describe('el escaneo respeta el candado y las reglas se controlan al aplicar', () => {
  let dir: string
  let lib: Library
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-lock-'))
    fs.mkdirSync(path.join(dir, 'M/Samples/Pack'), { recursive: true }); fs.mkdirSync(path.join(dir, 'M/Rock'))
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(dir, 'M/Rock/tema.mp3')])
    fs.writeFileSync(path.join(dir, 'M/Samples/Pack/leeme.txt'), 'del pack')
    lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
    await lib.scan()
  })
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('no escanea mientras se mueven archivos', async () => {
    let release!: () => void
    const op = lib.ops.run('moviendo archivos', () => new Promise<void>((r) => { release = r }))
    await expect(lib.scan()).rejects.toThrow(/moviendo archivos/)
    release(); await op
    expect((await lib.scan()).phase).toMatch(/Listo/)
  })

  it('la limpieza de Espacio no toca samples, ni _PAILA, ni rutas con ".."', async () => {
    const space = new Space(lib.db, () => lib.roots())
    const rootId = lib.roots()[0].id
    const r = await space.trashFiles([{ rootId, rel: 'Samples/Pack/leeme.txt' }, { rootId, rel: '_PAILA/papelera/x.txt' }, { rootId, rel: '../afuera.txt' }])
    expect(r.moved).toBe(0)
    expect(r.failed.map((f) => f.error)).toEqual([expect.stringMatching(/samples/), 'Ruta no válida', 'Ruta no válida'])
    expect(fs.existsSync(path.join(dir, 'M/Samples/Pack/leeme.txt'))).toBe(true)
  })

  it('si la carpeta pasa a ser de samples después de proponer un renombre, no se renombra', async () => {
    const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
    const id = lib.tracks()[0][0] as number
    ch.stage([id], 'filename', 'Nombre nuevo')
    lib.db.prepare("UPDATE files SET kind = 'produccion' WHERE id = ?").run(id)
    const r = await ch.apply()
    expect(r.failed[0].error).toMatch(/sample packs/)
    expect(fs.existsSync(path.join(dir, 'M/Rock/tema.mp3'))).toBe(true)
    lib.db.prepare("UPDATE files SET kind = 'musica' WHERE id = ?").run(id)
    ch.discard()
  })
})

// Cerrar PAILA en medio de Organizar (corte con la app, 22/10): se cerraba igual, sin avisar, y la tanda quedaba a medias.
// La app pregunta mientras haya algo que no conviene cortar; escanear sí se puede cortar (se retoma solo).
describe('cerrar con algo a medias', () => {
  it('dice qué no conviene cortar, deja cortar un escaneo, y espera a que se libere', async () => {
    const lock = new OpLock()
    expect(lock.unsafeToClose).toBeNull()
    let soltar!: () => void
    const p = lock.run('cambiando archivos', () => new Promise<void>((r) => { soltar = r }))
    expect(lock.unsafeToClose).toBe('cambiando archivos')
    expect(await lock.free(50, 10)).toBe(false) // sigue ocupado
    setTimeout(() => soltar(), 30)
    expect(await lock.free(2000, 10)).toBe(true)
    await p
    expect(lock.unsafeToClose).toBeNull()
    let fin!: () => void
    const s = lock.run('escaneando la biblioteca', () => new Promise<void>((r) => { fin = r }), { cuttable: true })
    expect(lock.busy).toBe('escaneando la biblioteca')
    expect(lock.unsafeToClose).toBeNull()
    fin(); await s
  })
})
