// Una búsqueda de artista que MusicBrainz no contestó (un 503, "ir más despacio") queda en la caché con status 'error' y data
// {error}, no una lista. Punto 1 real, 24/10: con "Sabroso" así, Arreglar nombres (perfil Oficial) no abría
// ("artistHits.filter is not a function") y la búsqueda de sus temas quedaba con error. Ahora esa entrada se ignora.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { OnlineCache } from '@paila/core/online/http'
import { cleanedRows } from '@paila/core/official-run'
import { artistKey, officialFindings, recKey } from '@paila/core/official-findings'
import type { RecHit } from '@paila/core/online/hits'

let dir: string, db: Db, cache: OnlineCache
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-cache-error-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title, codec) VALUES (1, 1, 'Sabroso - Llego tu papi.mp3', 1000, 1, 'musica', 'mp3', 200, 'Sabroso', 'Llego tu papi', 'mp3')").run()
  cache = new OnlineCache(db)
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('una búsqueda de artista con error en la caché', () => {
  it('lista() solo da la lista de una búsqueda que salió bien', () => {
    cache.put('musicbrainz', artistKey('Sabroso'), 'error', { error: 'HTTP 503' })
    expect(cache.lista('musicbrainz', artistKey('Sabroso'))).toEqual([])
    cache.put('musicbrainz', artistKey('Otro'), 'ok', { no: 'una lista' })
    expect(cache.lista('musicbrainz', artistKey('Otro'))).toEqual([])
    expect(cache.lista('musicbrainz', artistKey('Nadie'))).toEqual([])
  })

  it('no rompe la vista de Nombres oficiales, aunque el tema tenga grabaciones encontradas', () => {
    cache.put('musicbrainz', artistKey('Sabroso'), 'error', { error: 'HTTP 503' })
    const rec: RecHit = { source: 'musicbrainz', id: 'r1', title: 'Llegó Tu Papi', credit: [{ name: 'Sabroso' }], length: 200 } as unknown as RecHit
    cache.put('musicbrainz', recKey('Sabroso', 'Llego tu papi'), 'ok', [rec])
    expect(() => officialFindings(db, cleanedRows(db))).not.toThrow()
  })
})
