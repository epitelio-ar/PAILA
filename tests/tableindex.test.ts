// Tests de la tabla para bibliotecas grandes (core/tableindex.ts y su hilo, core/tableserver.ts): da exactamente los mismos
// temas, en el mismo orden y con los mismos números que la tabla de siempre (la que filtra en la interfaz).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { externos } from '../scripts/externos.mjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { transaction } from '@paila/core/db'
import { TrackIndex } from '@paila/core/tableindex'
import { TableServer } from '@paila/core/tableserver'
import { TRACK_FIELDS, type Track } from '@paila/shared/types'
import { libraryStats, queryTracks, type TableQuery } from '@paila/shared/tableview'
import { PROBLEM_TESTS, SORT_VALUES, type ProblemKey, type SortKey } from '@paila/shared/trackinfo'

let dir: string
let lib: Library
const toTrack = (r: unknown[]) => Object.fromEntries(TRACK_FIELDS.map((f, i) => [f, r[i]])) as Track

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-tableindex-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  let s = 3
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const names = ['Ñandú', 'nandu', 'Árbol', 'Zeta 10', 'zeta 9', 'Éxito', 'Luna', 'luna roja', 'Soda', '10 Años', '9 Años', 'B2', 'b10']
  transaction(lib.db, () => {
    const f = lib.db.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec, sample_rate, bits, kbps, duration, artist, title, album, year, genre,
      error, trashed_at, missing_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const a = lib.db.prepare(`INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, flags, bpm, camelot, energy) VALUES (?, 1, 1, 1, '2026-01-01', ?, ?, ?, ?, ?)`)
    for (let i = 1; i <= 600; i++) {
      const tagged = rnd() > 0.15
      const artist = pick(names), title = pick(names)
      const ext = pick(['mp3', 'mp3', 'flac', 'wav', 'm4a', 'ogg'])
      const id = Number(f.run(root.id, `${pick(['Cumbia', 'House', 'Rock/Viejo'])}/${String(i % 20).padStart(2, '0')} - ${artist} - ${title} ${i}.${ext}`, Math.floor(rnd() * 1e7),
        pick(['musica', 'musica', 'musica', 'produccion', 'sets', 'revisar']), ext, ext === 'm4a' ? pick(['alac', 'aac']) : ext, pick([44100, 48000, 96000, null]), pick([16, 24, null]),
        pick([128, 320, 900, null]), rnd() < 0.05 ? null : 100 + rnd() * 300, tagged ? artist : null, tagged ? title : null, pick([null, 'Disco', 'álbum']), pick([null, '1999', '2024']),
        pick([null, 'Cumbia', 'House']), rnd() < 0.03 ? 'roto' : null, rnd() < 0.03 ? '2026-01-02' : null, rnd() < 0.05 ? '2026-01-02' : null).lastInsertRowid)
      if (rnd() < 0.8) a.run(id, pick(['A+', 'A', 'B', 'C', 'D', 'F', null]), pick([null, null, 'fake_lossless', 'upscaled,bpm_doubtful', 'damaged']), pick([null, 120, 128.5, 90]), pick([null, '8A', '12B', '1A']), pick([null, 3, 9]))
    }
  })
})

afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

/** Las consultas que hace la tabla: cada colección, cada problema, búsquedas, playlist y cada columna en los dos sentidos. */
function queries(): TableQuery[] {
  const out: TableQuery[] = []
  const sorts = (Object.keys(SORT_VALUES) as SortKey[]).flatMap((key) => [{ key, dir: 1 as const }, { key, dir: -1 as const }])
  for (const sort of sorts) out.push({ kind: 'musica', problem: null, query: '', plIds: null, sort })
  for (const kind of ['todo', 'produccion', 'sets', 'revisar'] as const) out.push({ kind, problem: null, query: '', plIds: null, sort: { key: 'artist', dir: 1 } })
  for (const problem of Object.keys(PROBLEM_TESTS) as ProblemKey[]) out.push({ kind: 'musica', problem, query: '', plIds: null, sort: { key: 'title', dir: -1 } })
  for (const query of ['luna', 'LUNA roja', 'cumbia', 'ñandú', 'zzz', ' 10 ']) out.push({ kind: 'todo', problem: null, query, plIds: null, sort: { key: 'artist', dir: 1 } })
  const pl = [50, 7, 300, 1, 12, 9999]
  out.push({ kind: 'musica', problem: null, query: '', plIds: pl, sort: { key: 'order', dir: 1 } })
  out.push({ kind: 'musica', problem: null, query: '', plIds: pl, sort: { key: 'order', dir: -1 } })
  out.push({ kind: 'musica', problem: null, query: '', plIds: pl, sort: { key: 'bpm', dir: 1 } })
  out.push({ kind: 'todo', problem: null, query: '', plIds: null, sort: { key: 'order', dir: 1 } }) // "order" sin playlist = por artista
  return out
}

describe('tabla grande', () => {
  it('da los mismos temas, en el mismo orden, que la tabla de la interfaz', () => {
    const tracks = lib.tracks().map(toTrack)
    const index = new TrackIndex()
    const load = index.load(lib.db)
    expect(load.total).toBe(tracks.length)
    expect(load.stats).toEqual(libraryStats(tracks))
    for (const q of queries()) expect(index.query(q), JSON.stringify(q)).toEqual(queryTracks(lib.tracks().map(toTrack), q).map((t) => t.id))
    // y las filas son las mismas que manda la tabla de siempre
    const some = index.query(queries()[0]).slice(0, 25)
    expect(index.rows(some)).toEqual(some.map((id) => lib.tracks(id)[0]))
    expect(index.rows([999_999])).toEqual([])
  })

  it('el hilo lee la base aparte mientras la app la usa, y ve los cambios al recargar', async () => {
    const out = path.join(path.resolve('node_modules/.cache/paila-run'), `table-worker-${process.pid}.mjs`)
    await build({ entryPoints: ['packages/core/tableworker.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', plugins: [externos] })
    const server = new TableServer(out, path.join(dir, 'paila.db'))
    try {
      const first = await server.load()
      const q: TableQuery = { kind: 'todo', problem: null, query: '', plIds: null, sort: { key: 'size', dir: -1 } }
      const { ids, rows } = await server.query(q, 0)
      expect(rows.slice(0, 5)).toEqual(ids.slice(0, 5).map((id) => lib.tracks(id)[0]))
      expect(ids.length).toBe(first.total)
      const [row] = await server.rows([ids[0]])
      expect(row).toEqual(lib.tracks(ids[0])[0])
      lib.db.prepare("UPDATE files SET title = 'Cambiado' WHERE id = ?").run(ids[0])
      await server.load()
      expect((await server.rows([ids[0]]))[0][TRACK_FIELDS.indexOf('title')]).toBe('Cambiado')
    } finally {
      await server.close()
      fs.rmSync(out, { force: true })
    }
  })
})
