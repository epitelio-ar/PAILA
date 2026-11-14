// Tests de las consultas del Inicio (core/inicio.ts): los últimos discos que sumaste.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb, transaction } from '@paila/core/db'
import { recentAlbums } from '@paila/core/inicio'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-inicio-'))
const abiertas: { close: () => void }[] = []
afterAll(() => { for (const d of abiertas) d.close(); fs.rmSync(dir, { recursive: true, force: true }) })

interface T { rel: string; album?: string | null; artist?: string; year?: number; track?: string; mtime?: number; grade?: string; kind?: string; trashed?: boolean }

function base(name: string, tracks: T[]) {
  const db = openDb(path.join(dir, name))
  abiertas.push(db)
  transaction(db, () => {
    db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('X', 'X', 'C:\\')")
    db.exec("INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'M', '2026-01-01')")
    const f = db.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, album, year, track, trashed_at) VALUES (1, ?, 1, ?, ?, 'mp3', ?, ?, ?, ?, ?)`)
    const a = db.prepare('INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade) VALUES (?, 1, 1, 1, ?, ?)')
    tracks.forEach((t, i) => {
      f.run(t.rel, t.mtime ?? 1, t.kind ?? 'musica', t.artist ?? 'Artista', t.album ?? null, t.year ?? null, t.track ?? null, t.trashed ? '2026-01-02' : null)
      if (t.grade) a.run(i + 1, '2026-01-01', t.grade)
    })
  })
  return db
}

describe('recentAlbums', () => {
  it('ordena por el disco sumado más nuevo, con su nota más frecuente y el primer tema', () => {
    const db = base('a.db', [
      { rel: 'Viejo/02.mp3', album: 'Viejo', track: '2', mtime: 10, grade: 'D' }, { rel: 'Viejo/01.mp3', album: 'Viejo', track: '1', mtime: 10, grade: 'D' }, { rel: 'Viejo/03.mp3', album: 'Viejo', track: '3', mtime: 10, grade: 'B' },
      { rel: 'Nuevo/1.mp3', album: 'Nuevo', artist: 'Miranda!', year: 2008, track: '1', mtime: 99, grade: 'A' }, { rel: 'Nuevo/2.mp3', album: 'Nuevo', artist: 'Miranda!', track: '2', mtime: 50, grade: 'A' }, { rel: 'Nuevo/3.mp3', album: 'Nuevo', artist: 'Miranda!', track: '3', mtime: 50 },
    ])
    const r = recentAlbums(db)
    expect(r.map((x) => x.album)).toEqual(['Nuevo', 'Viejo'])
    expect(r[0]).toMatchObject({ artist: 'Miranda!', year: 2008, tracks: 3, grade: 'A', trackId: 4 })
    expect(r[1]).toMatchObject({ grade: 'D', trackId: 2 }) // el tema 1 del disco, aunque esté segundo en la base
  })
  it('no cuenta sueltos, carpetas con pocos temas, lo que no es Música ni lo que está en la papelera', () => {
    const db = base('b.db', [
      { rel: 'Suelto.mp3', album: null, mtime: 99 }, { rel: 'Dos/1.mp3', album: 'Dos', mtime: 99 }, { rel: 'Dos/2.mp3', album: 'Dos', mtime: 99 },
      { rel: 'Samples/1.mp3', album: 'Pack', kind: 'produccion' }, { rel: 'Samples/2.mp3', album: 'Pack', kind: 'produccion' }, { rel: 'Samples/3.mp3', album: 'Pack', kind: 'produccion' },
      { rel: 'Borrado/1.mp3', album: 'Borrado', trashed: true }, { rel: 'Borrado/2.mp3', album: 'Borrado', trashed: true }, { rel: 'Borrado/3.mp3', album: 'Borrado' },
    ])
    expect(recentAlbums(db)).toEqual([])
  })
  it('el mismo nombre de álbum en dos carpetas son dos discos', () => {
    const db = base('c.db', [
      { rel: 'A/Grandes éxitos/1.mp3', album: 'Grandes Éxitos' }, { rel: 'A/Grandes éxitos/2.mp3', album: 'Grandes Éxitos' }, { rel: 'A/Grandes éxitos/3.mp3', album: 'grandes éxitos' },
      { rel: 'B/Grandes éxitos/1.mp3', album: 'Grandes Éxitos' }, { rel: 'B/Grandes éxitos/2.mp3', album: 'Grandes Éxitos' }, { rel: 'B/Grandes éxitos/3.mp3', album: 'Grandes Éxitos' },
    ])
    expect(recentAlbums(db)).toHaveLength(2)
  })
})
