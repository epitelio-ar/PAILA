// Tests de las bibliotecas de Engine DJ (core/enginedb.ts): una por disco, como Engine 4 y 5 (visto con Engine 5.1). Los temas van
// a la del disco y las playlists a la de la compu, nombrando la base de cada tema; a un disco sin biblioteca se le arma una igual
// a la de la compu. Con bases armadas a mano en una carpeta temporal (tests/engine-base.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DjExport, engineDb } from '@paila/core/djexport'
import { createEngineDb, writeEngine } from '@paila/core/enginedb'
import type { EngineSong } from '@paila/core/enginedj'
import type { PlaylistNode } from '@paila/shared/types'
import { makeEngine } from './engine-base'

let dir: string
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-enginedb-')) })
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('Una biblioteca por disco (como Engine 4 y 5)', () => {
  const song = (id: number, abs: string): EngineSong => ({
    t: { id, rel: path.basename(abs), ext: 'mp3', codec: 'mp3', size: 1000, duration: 10, sr: 44100, bits: null, kbps: 320, artist: 'A', albumArtist: null, title: `Tema ${id}`, album: null, track: null, year: null, genre: null, bpm: 120, musicKey: 'Am', probedAt: null, abs },
    marks: { grid: { bpm: 120, segments: [{ start: 0.5, bpm: 120, beat: 1 }] }, cues: [] }, offset: 0, stars: 0, comment: '',
  })
  const node = (id: number, name: string): PlaylistNode => ({ id, parentId: null, name, kind: 'list', rules: null, count: 0, position: 0 })

  it('cada disco de afuera tiene la suya en su raíz; el de la compu, la de Música', () => {
    const d = new DjExport(null as never, 'C:\\Users\\yo', 'C:\\Users\\yo\\AppData\\Local\\VirtualDJ', '', 'C:\\Users\\yo\\Music\\Engine Library')
    expect(d.engineDir('C:')).toBe('C:\\Users\\yo\\Music\\Engine Library')
    expect(d.engineDir('D:')).toBe('D:\\Engine Library')
    expect(d.engineDir('')).toBe('C:\\Users\\yo\\Music\\Engine Library')
    expect(new DjExport(null as never, '/Users/yo', '/x', 'Macintosh HD', '/Users/yo/Music/Engine Library').engineDir('/Volumes/SSD')).toBe('/Volumes/SSD/Engine Library')
  })

  it('a un disco sin biblioteca se le arma una igual a la de la compu, con su propia identidad', () => {
    const casa = path.join(dir, 'casa1', 'Engine Library')
    makeEngine(casa, 3)
    const nueva = path.join(dir, 'disco1', 'Engine Library', 'Database2', 'm.db')
    fs.mkdirSync(path.dirname(nueva), { recursive: true })
    createEngineDb(engineDb(casa), nueva)
    const a = new DatabaseSync(engineDb(casa), { readOnly: true }), b = new DatabaseSync(nueva, { readOnly: true })
    const ddl = (d: DatabaseSync) => d.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
    expect(ddl(b)).toEqual(ddl(a))
    const info = b.prepare('SELECT uuid, schemaVersionMajor AS ma, schemaVersionMinor AS mi, schemaVersionPatch AS pa FROM Information').get() as { uuid: string; ma: number; mi: number; pa: number }
    expect(info).toMatchObject({ ma: 3, mi: 0, pa: 2 })
    expect(info.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(b.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4194305 })
    expect(b.prepare('SELECT id, hash, albumArt FROM AlbumArt').all()).toEqual([{ id: 1, hash: null, albumArt: null }])
    expect(b.prepare('SELECT COUNT(*) AS n FROM Playlist').get()).toEqual({ n: 0 })
    a.close(); b.close()
  })

  it('los temas van a la del disco y las playlists a la de la compu, nombrando la base de cada tema', () => {
    const casa = path.join(dir, 'casa2', 'Engine Library')
    const disco = path.join(dir, 'disco2', 'Engine Library')
    makeEngine(casa, 3, 'uuid-casa')
    makeEngine(disco, 3, 'uuid-disco')
    // la copia de las playlists que había hecho Engine en el disco (isPersisted = 0): se saca, Engine la vuelve a copiar
    const pre = new DatabaseSync(engineDb(disco))
    pre.exec("INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES ('PAILA', 0, 0, 0, '', 0)")
    pre.exec("INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES ('Vieja', 2, 0, 0, '', 0)")
    pre.close()
    const a = path.join(dir, 'disco2', 'Música', 'a.mp3'), b = path.join(dir, 'disco2', 'Música', 'b.mp3')
    const d = writeEngine(engineDb(disco), { songs: [song(101, a), song(102, b)], libDir: disco })
    expect(d.uuid).toBe('uuid-disco')
    expect([...d.refs.values()]).toEqual([{ uuid: 'uuid-disco', id: 1 }, { uuid: 'uuid-disco', id: 2 }])
    const dd = new DatabaseSync(engineDb(disco), { readOnly: true })
    expect(dd.prepare('SELECT path FROM Track ORDER BY id').all()).toEqual([{ path: '../Música/a.mp3' }, { path: '../Música/b.mp3' }])
    expect(dd.prepare('SELECT title FROM Playlist ORDER BY id').all()).toEqual([{ title: 'Mía' }])
    dd.close()

    const h = writeEngine(engineDb(casa), { songs: [], libDir: casa, lists: { nodes: [node(1, 'Fiesta')], playlistTracks: new Map([[1, [102, 101, 999]]]), refs: d.refs } })
    expect(h.added).toBe(0)
    const hd = new DatabaseSync(engineDb(casa), { readOnly: true })
    expect(hd.prepare('SELECT COUNT(*) AS n FROM Track').get()).toEqual({ n: 0 })
    const fiesta = (hd.prepare("SELECT id, isPersisted FROM Playlist WHERE title = 'Fiesta'").get() as { id: number; isPersisted: number })
    expect(fiesta.isPersisted).toBe(1)
    // en el orden de PAILA, cada uno con la base donde está (el que no se exportó, 999, no entra)
    expect(hd.prepare('SELECT trackId, databaseUuid FROM PlaylistEntity WHERE listId = ? ORDER BY id').all(fiesta.id)).toEqual([{ trackId: 2, databaseUuid: 'uuid-disco' }, { trackId: 1, databaseUuid: 'uuid-disco' }])
    hd.close()

    // una "PAILA" propia del disco (no la copia de Engine) queda
    const own = new DatabaseSync(engineDb(disco))
    own.exec("INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES ('PAILA', 0, 1, 0, '', 1)")
    own.close()
    writeEngine(engineDb(disco), { songs: [song(101, a)], libDir: disco })
    const after = new DatabaseSync(engineDb(disco), { readOnly: true })
    expect(after.prepare("SELECT COUNT(*) AS n FROM Playlist WHERE title = 'PAILA'").get()).toEqual({ n: 1 })
    expect(after.prepare('SELECT COUNT(*) AS n FROM Track').get()).toEqual({ n: 2 }) // a.mp3 ya estaba: no se repite
    after.close()
  })
})
