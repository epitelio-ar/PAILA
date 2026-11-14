// País del artista (core/artistcountry.ts; decidido el 22/10): sale de lo que MusicBrainz contestó en
// "Completar desde internet" (la caché), solo con seguridad, y se ve en Estadísticas. Nunca va a los archivos.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { OnlineCache } from '@paila/core/online/http'
import { artistCountry, countryName, hitCountry } from '@paila/core/artistcountry'
import { artistKey } from '@paila/core/official-findings'
import { collectionStats } from '@paila/core/colstats'
import type { ArtistHit } from '@paila/core/online/hits'

let dir: string, db: Db, cache: OnlineCache
const hit = (name: string, score: number, extra: Partial<ArtistHit> = {}): ArtistHit => ({ source: 'musicbrainz', id: name, name, score, aliases: [], ...extra })
let nextId = 1
const add = (artist: string) => db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, artist, title) VALUES (?, 1, ?, 10, 1, 'musica', 'mp3', ?, 'x')").run(nextId++, `${nextId}.mp3`, artist)

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-pais-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  cache = new OnlineCache(db)
  cache.put('musicbrainz', artistKey('Soda Stereo'), 'ok', [hit('Soda Stereo', 100, { country: 'AR' })])
  // guardado antes del 22/10: el país venía al final de la nota
  cache.put('musicbrainz', artistKey('Los Redondos'), 'ok', [hit('Patricio Rey y sus Redonditos de Ricota', 100, { aliases: ['Los Redondos'], note: 'Argentine rock band · AR' })])
  // dos artistas con el mismo nombre de países distintos: no se dice nada
  cache.put('musicbrainz', artistKey('Nirvana'), 'ok', [hit('Nirvana', 100, { country: 'US' }), hit('Nirvana', 98, { country: 'GB' })])
  // un nombre parecido no alcanza
  cache.put('musicbrainz', artistKey('Babasonicos'), 'ok', [hit('Babasónicos Tributo', 95, { country: 'MX' })])
  for (const a of ['Soda Stereo', 'Soda Stereo', 'Los Redondos feat. Skay', 'Nirvana', 'Babasonicos', 'Sin buscar']) add(a)
})
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('país del artista', () => {
  it('solo con seguridad: mismo nombre o alias, 90 puntos o más y un solo país', () => {
    expect(hitCountry(hit('x', 100, { note: 'banda · AR' }))).toBe('AR')
    expect(hitCountry(hit('x', 100, { note: 'Nirvana (UK band)' }))).toBeNull()
    expect(artistCountry(cache, 'Soda Stereo')).toBe('AR')
    expect(artistCountry(cache, 'Los Redondos feat. Skay')).toBe('AR')
    expect(artistCountry(cache, 'Nirvana')).toBeNull()
    expect(artistCountry(cache, 'Babasonicos')).toBeNull()
    expect(artistCountry(cache, 'Sin buscar')).toBeNull()
    expect(countryName('AR')).toBe('Argentina')
    expect(countryName('XW')).toBe('Todo el mundo')
  })

  it('Estadísticas cuenta temas y artistas por país', () => {
    const s = collectionStats(db)
    expect(s.countries.map((c) => [c.label, c.tracks])).toEqual([['Argentina', 3]])
    expect(s.withCountry).toBe(3)
    expect(s.countryArtists).toBe(2)
  })
})
