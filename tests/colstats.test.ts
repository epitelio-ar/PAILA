// Tests de las estadísticas de la colección (core/colstats.ts): décadas, géneros, formatos, artistas con más discos y calidad de CD o mejor.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb, transaction, type Db } from '@paila/core/db'
import { collectionStats } from '@paila/core/colstats'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-colstats-'))
let db: Db
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

interface T { artist?: string | null; aa?: string | null; album?: string | null; year?: number | null; genre?: string | null; ext?: string; codec?: string | null; size?: number; kind?: string; grade?: string | null; trashed?: boolean; missing?: boolean }

function seed(db: Db, tracks: T[]) {
  transaction(db, () => {
    db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('X', 'X', 'C:\\\\')")
    db.exec("INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, 'M', '2026-01-01')")
    const f = db.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec, artist, album_artist, album, year, genre, trashed_at, missing_at)
      VALUES (1, ?, ?, 5, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const a = db.prepare('INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade) VALUES (?, 1, 1, 5, ?, ?)')
    tracks.forEach((t, i) => {
      f.run(`t${i}.${t.ext ?? 'mp3'}`, t.size ?? 100, t.kind ?? 'musica', t.ext ?? 'mp3', t.codec ?? null, t.artist ?? null, t.aa ?? null, t.album ?? null, t.year ?? null, t.genre ?? null,
        t.trashed ? '2026-01-02' : null, t.missing ? '2026-01-02' : null)
      if (t.grade) a.run(i + 1, '2026-01-01', t.grade)
    })
  })
}

const open = (name: string) => (db = openDb(path.join(dir, name)))

describe('collectionStats', () => {
  it('cuenta décadas, géneros y formatos solo de la Música visible', () => {
    open('a.db')
    seed(db, [
      { year: 1994, genre: 'Rock', ext: 'mp3' }, { year: 1999, genre: 'rock', ext: 'mp3' }, { year: 2003, genre: 'Cumbia', ext: 'flac', codec: 'flac' },
      { year: null, genre: null, ext: 'flac', codec: 'flac' },
      { year: 1980, genre: 'Rock', kind: 'produccion' }, { year: 1970, trashed: true }, { year: 1960, missing: true }, { year: 1850 },
    ])
    const s = collectionStats(db)
    expect(s.tracks).toBe(5)
    expect(s.decades.map((d) => [d.label, d.tracks])).toEqual([['1990s', 2], ['2000s', 1]])
    expect(s.withYear).toBe(3)
    expect(s.genres.map((g) => [g.label, g.tracks])).toEqual([['Rock', 2], ['Cumbia', 1]]) // "Rock" y "rock" son el mismo género
    expect(s.formats.map((f) => [f.label, f.tracks])).toEqual([['MP3', 3], ['FLAC', 2]])
    expect(s.cdOrBetter.lossless).toBe(2)
    db.close()
  })

  it('los artistas se ordenan por discos distintos, no por temas, y "Varios Artistas" no cuenta', () => {
    open('b.db')
    seed(db, [
      { artist: 'Soda Stereo', album: 'Signos' }, { artist: 'Soda Stereo', album: 'Signos' }, { artist: 'Soda Stereo', album: 'Signos' }, { artist: 'Soda Stereo', album: 'Signos' },
      { artist: 'Charly García', album: 'Clics modernos' }, { artist: 'charly garcía', album: 'Piano bar' }, { artist: 'Charly García', album: null },
      { artist: 'Varios', aa: 'Varios Artistas', album: 'Compilado 1' }, { artist: 'Varios', aa: 'Varios Artistas', album: 'Compilado 2' },
      { artist: 'Fito', aa: 'Fito Páez', album: 'El amor' },
    ])
    const s = collectionStats(db)
    expect(s.topArtists.map((a) => [a.artist, a.albums, a.tracks])).toEqual([['Charly García', 2, 3], ['Soda Stereo', 1, 4], ['Fito Páez', 1, 1]]) // empatan en discos: primero el de más temas
    db.close()
  })

  it('calidad de CD o mejor: solo notas A+ y A, sobre lo ya analizado', () => {
    open('c.db')
    seed(db, [{ grade: 'A+', size: 10 }, { grade: 'A', size: 20 }, { grade: 'B', size: 5 }, { grade: 'F', size: 1 }, {}])
    const s = collectionStats(db)
    expect(s.cdOrBetter).toMatchObject({ count: 2, graded: 4, bytes: 30, hiRes: 1 })
    expect(s.byGrade).toEqual({ 'A+': 1, A: 1, B: 1, F: 1 })
    expect(s.tracks).toBe(5)
    db.close()
  })

  it('con más de 12 géneros, el resto se junta en "otros"', () => {
    open('d.db')
    seed(db, Array.from({ length: 15 }, (_, i) => ({ genre: `Género ${i}` })))
    const s = collectionStats(db)
    expect(s.genres).toHaveLength(12)
    expect(s.genresOther).toBe(3)
    db.close()
  })

  it('sin temas no falla', () => {
    open('e.db')
    expect(collectionStats(db)).toMatchObject({ tracks: 0, decades: [], topArtists: [], cdOrBetter: { count: 0, graded: 0 } })
    db.close()
  })
})
