// Duplicados y lo traído de Rekordbox (core/trash-dj.ts; punto 1 real del 24/10): la copia que queda hereda la estrella más alta,
// la suma de veces tocado y las playlists del duplicado que va a la papelera; al restaurarlo, vuelve a lo que tenía. Con archivos
// de verdad y la papelera de siempre (core/trash.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'

let dir: string, lib: Library, pl: Playlists, trash: Trash, root: number
const add = (rel: string) => {
  fs.mkdirSync(path.join(dir, 'M', path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, 'M', ...rel.split('/')), 'x')
  return Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, probed_at) VALUES (?, ?, 1, 1, 'musica', 'mp3', 'x')").run(root, rel).lastInsertRowid)
}
const meta = (id: number, stars: number, plays: number | null) =>
  lib.db.prepare("INSERT INTO dj_meta (file_id, stars, play_count, imported_at) VALUES (?, ?, ?, 'x')").run(id, stars, plays)
const dj = (id: number) => lib.db.prepare('SELECT stars, play_count AS plays FROM dj_meta WHERE file_id = ?').get(id) as { stars: number; plays: number | null } | undefined

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dup-rb-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  root = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  trash = new Trash(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null, pl)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Duplicados: la copia que queda hereda lo de Rekordbox', () => {
  it('la estrella más alta, la suma de veces tocado y las playlists; al restaurar, vuelve a lo que tenía', async () => {
    const kept = add('Rock/Cerati - Crimen.mp3'), dup = add('Descargas/Cerati - Crimen [slider.kz].mp3')
    meta(kept, 3, 2); meta(dup, 5, 4) // la que se va tenía 5 estrellas y 4 veces tocado en Rekordbox
    const lista = pl.create('Para el sábado'); pl.addTracks(lista, [dup])
    const r = await trash.trash([dup], 'Duplicados', new Map([[dup, kept]]))
    expect(r.failed).toEqual([])
    expect(dj(kept)).toEqual({ stars: 5, plays: 6 })
    expect(lib.db.prepare('SELECT file_id AS id FROM playlist_items WHERE playlist_id = ?').all(lista)).toEqual([{ id: kept }])
    await trash.restore(r.batchId!)
    expect(dj(kept)).toEqual({ stars: 3, plays: 2 })
    expect(lib.db.prepare('SELECT file_id AS id FROM playlist_items WHERE playlist_id = ?').all(lista)).toEqual([{ id: dup }])
  })

  it('si la que queda no tenía nada de Rekordbox, lo recibe; al restaurar se le saca; si después se tocó más, eso queda', async () => {
    const kept = add('Rock/Spinetta - Seguir viviendo sin tu amor.mp3'), dup = add('Descargas/Spinetta - Seguir viviendo.mp3')
    meta(dup, 4, 3)
    const r = await trash.trash([dup], 'Duplicados', new Map([[dup, kept]]))
    expect(dj(kept)).toEqual({ stars: 4, plays: 3 })
    lib.db.prepare('UPDATE dj_meta SET play_count = 5 WHERE file_id = ?').run(kept) // dos veces más, después
    await trash.restore(r.batchId!)
    expect(dj(kept)).toEqual({ stars: 0, plays: 2 })
  })

  it('un duplicado sin nada de Rekordbox no cambia nada', async () => {
    const kept = add('Rock/Soda - Persiana americana.mp3'), dup = add('Descargas/Soda - Persiana americana (1).mp3')
    meta(kept, 2, 1)
    await trash.trash([dup], 'Duplicados', new Map([[dup, kept]]))
    expect(dj(kept)).toEqual({ stars: 2, plays: 1 })
  })
})
