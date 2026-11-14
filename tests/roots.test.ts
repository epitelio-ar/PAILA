// Tests de carpetas raíz: sacar o excluir una carpeta no borra nada, y las carpetas anidadas se manejan bien.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let pl: Playlists
let list: number
const tone = (rel: string, f: number) => { const out = path.join(dir, 'M', rel); fs.mkdirSync(path.dirname(out), { recursive: true }); execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=1`, out]) }
const visible = () => lib.tracks().map((r) => String(r[2])).sort()
const inList = () => pl.trackIds(list)

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-roots-'))
  tone('Rock/a.mp3', 300); tone('Viejo/b.mp3', 400)
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  list = pl.create('Fiesta')
  pl.addTracks(list, lib.tracks().map((r) => r[0] as number))
  lib.db.prepare("INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at) VALUES (1, ?, 'x', 'y', 'prueba', '2026-10-20')").run(lib.tracks()[0][0])
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('sacar o excluir carpetas no borra nada', () => {
  it('excluir una subcarpeta oculta sus temas sin borrarlos, y volver a incluirla los trae con su playlist', async () => {
    const root = lib.roots()[0].id
    lib.setRule(root, 'Viejo', 'excluir')
    expect(visible()).toEqual(['Rock/a.mp3'])
    expect(inList()).toHaveLength(1)
    const s = await lib.scan()
    expect(s.removed).toBe(0) // lo excluido no cuenta como desaparecido
    expect((lib.db.prepare('SELECT COUNT(*) n FROM files').get() as { n: number }).n).toBe(2)
    lib.setRule(root, 'Viejo', 'musica')
    expect(visible()).toEqual(['Rock/a.mp3', 'Viejo/b.mp3'])
    expect(inList()).toHaveLength(2)
  })

  it('sacar la carpeta de la biblioteca la oculta; agregarla de nuevo devuelve temas, playlists e historial', async () => {
    const root = lib.roots()[0].id
    lib.removeRoot(root)
    expect(lib.roots()).toEqual([])
    expect(visible()).toEqual([])
    expect(inList()).toEqual([])
    expect((lib.db.prepare('SELECT COUNT(*) n FROM trash_log').get() as { n: number }).n).toBe(1) // el historial sigue
    await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
    expect(lib.roots()[0].id).toBe(root)
    expect(visible()).toEqual(['Rock/a.mp3', 'Viejo/b.mp3'])
    expect(inList()).toHaveLength(2)
    await lib.scan()
    expect((lib.db.prepare('SELECT COUNT(*) n FROM files').get() as { n: number }).n).toBe(2) // no se duplicó nada
  })
})

describe('carpetas una adentro de otra', () => {
  it('no deja agregar una carpeta que ya está adentro de otra', async () => {
    fs.mkdirSync(path.join(dir, 'M/Rock/Nacional'), { recursive: true })
    await expect(lib.addRoot(path.join(dir, 'M/Rock'), [{ rel: '', kind: 'musica' }])).rejects.toThrow(/ya está adentro de/)
    // la misma carpeta sí (actualiza sus reglas)
    await expect(lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).resolves.toBeTruthy()
    expect(lib.roots()).toHaveLength(1)
  })
})

describe('unir una carpeta más grande que contiene a otra ya agregada', () => {
  it('pasa los temas con sus playlists, papelera, historial y reglas, y el escaneo no los duplica', async () => {
    const { Trash } = await import('@paila/core/trash')
    const { trashUsage, purgeTrash } = await import('@paila/core/purge')
    const { Changes } = await import('@paila/core/changes')
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-unir-'))
    const mk = (rel: string, f: number) => { const out = path.join(d, 'M', rel); fs.mkdirSync(path.dirname(out), { recursive: true }); execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=1`, out]) }
    mk('Rock/a.mp3', 300); mk('Rock/b.mp3', 350); mk('Rock/Samples/kick.wav', 500); mk('Cumbia/c.mp3', 400)
    const l = new Library(path.join(d, 'paila.db'), findFfprobe())
    try {
      await l.addRoot(path.join(d, 'M', 'Rock'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
      await l.scan()
      const rows = () => l.tracks().map((r) => [r[0], String(r[2])] as [number, string]).sort((x, y) => x[1].localeCompare(y[1]))
      const idOf = (rel: string) => rows().find((r) => r[1] === rel)![0]
      const a = idOf('a.mp3'), b = idOf('b.mp3'), kick = idOf('Samples/kick.wav')
      const p = new Playlists(l.db, (i) => l.trackPath(i))
      const fiesta = p.create('Fiesta'); p.addTracks(fiesta, [a, b])
      const ch = new Changes(l.db, (i) => l.trackPath(i), ffmpeg)
      ch.stage([a], 'title', 'Uno'); const tags = await ch.apply()
      const rootPath = (rid: number) => l.roots().find((r) => r.id === rid)?.path ?? null
      const t = new Trash(l.db, rootPath, p)
      const sent = await t.trash([b], 'prueba')
      expect(sent.failed).toEqual([])
      expect(fs.existsSync(path.join(d, 'M', 'Rock', '_PAILA', 'papelera'))).toBe(true)

      // la grande: antes daba error; ahora se une
      await l.addRoot(path.join(d, 'M'), [{ rel: '', kind: 'musica' }])
      expect(l.roots()).toHaveLength(1)
      expect(rows().map((r) => r[1])).toEqual(['Rock/a.mp3', 'Rock/Samples/kick.wav'])
      expect(idOf('Rock/a.mp3')).toBe(a) // el mismo tema, con su análisis y su historial
      expect(l.trackPath(a)).toBe(path.join(d, 'M', 'Rock', 'a.mp3'))
      expect(l.db.prepare('SELECT kind FROM files WHERE id = ?').get(kick)).toEqual({ kind: 'produccion' }) // la regla de la de adentro sigue
      await l.scan()
      expect(rows().map((r) => r[1])).toEqual(['Cumbia/c.mp3', 'Rock/a.mp3', 'Rock/Samples/kick.wav'])
      expect((l.db.prepare('SELECT COUNT(*) n FROM files').get() as { n: number }).n).toBe(4) // nada duplicado (b sigue en la papelera)
      expect(p.trackIds(fiesta)).toEqual([a])

      // deshacer los tags y restaurar de la papelera siguen andando con las rutas nuevas
      expect((await ch.undo(tags.batchId!)).failed).toEqual([])
      const back = await t.restore(sent.batchId!)
      expect(back.failed).toEqual([])
      expect(fs.existsSync(path.join(d, 'M', 'Rock', 'b.mp3'))).toBe(true)
      expect(p.trackIds(fiesta).sort()).toEqual([a, b].sort())

      // restaurar no deja la carpeta de la tanda vacía en la papelera de adentro (core/restos.ts, podarPapelera); lo que se manda
      // después va a la papelera de la carpeta unida, se ve y se puede vaciar
      expect(fs.readdirSync(path.join(d, 'M', 'Rock', '_PAILA', 'papelera'))).toEqual([])
      await t.trash([b], 'otra vez')
      const u = trashUsage(l.db, () => l.roots())
      expect(u.folders.map((f) => f.trash)).toContain('_PAILA/papelera')
      const res = purgeTrash(l.db, () => l.roots(), u.folders.map((f) => f.key))
      expect(res.failed).toEqual([])
      expect(res.deleted).toBe(1)
    } finally { l.close(); fs.rmSync(d, { recursive: true, force: true }) }
  })
})
