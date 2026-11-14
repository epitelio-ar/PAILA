// El criterio nuevo de lo dudoso que trae internet (core/revision-internet.ts; docs/pruebas/mp5-internet-dudoso.md, 13/11): con la
// base del autor, 456 de 472 dudosos eran el disco y el año de una recopilación o un vivo, y casi todos estaban mal. Un test por
// regla, con los casos reales achicados: lo de una recopilación no se propone (aunque MusicBrainz no la marque), lo de confianza
// media queda sin tildar, lo de confianza alta y disco normal entra tildado, el género nunca, y lo que una versión anterior dejó sin
// tildar y hoy no se propone sale de la lista (sin tocar lo que la persona tildó o cambió).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { Changes } from '@paila/core/changes'
import { apagar, claveCambio } from '@paila/core/revision-apagados'
import { enLetrasLatinas, MusicBrainz, pickRelease } from '@paila/core/musicbrainz'
import { criterioMb, deMusicBrainz, limpiarDescartados, pareceRecopilacion, repartirOficiales, soloAcentosYSignos, sumarSinTildar } from '@paila/core/revision-internet'
import type { TidyReview } from '@paila/shared/types'

const caso = (confidence: 'alta' | 'media', suspicious: boolean, album: string | null, year: string | null = '2018') => ({ confidence, suspicious, album, year })

describe('el criterio de MusicBrainz', () => {
  it('el disco y el año de un vivo o una recopilación no se proponen (Thriller 1992 de "Groovin\' Day And Night", 13/11)', () => {
    expect(criterioMb(caso('alta', true, "Groovin' Day And Night"), 'album')).toBe('descartar')
    expect(criterioMb(caso('alta', true, "Groovin' Day And Night", '1992'), 'year')).toBe('descartar')
    expect(criterioMb(caso('media', true, 'Defected Presents the Closing Party Ibiza 2018'), 'year')).toBe('descartar')
  })

  it('una recopilación por el nombre, aunque MusicBrainz no la marque ("Tektones #3 (Selected By T78)")', () => {
    for (const a of ['Tektones #3 (Selected By T78)', '110 Hits 2022, Vol. 2', 'Clubland 22', 'Bravo Hits: 1/2009', 'Defected Presents Miami 2019', 'Greatest Hits'])
      expect([a, pareceRecopilacion(a)]).toEqual([a, true])
    expect(criterioMb(caso('media', false, 'Tektones #3 (Selected By T78)'), 'album')).toBe('descartar')
    // un disco de verdad no ("Antezana 247", "REALM EP", "Despedazado por mil partes")
    for (const a of ['Antezana 247', 'REALM EP', 'Despedazado por mil partes', 'Crystal Castles']) expect([a, pareceRecopilacion(a)]).toEqual([a, false])
  })

  it('confianza media y disco normal queda sin tildar (3 de 4 bien); alta y normal, tildado', () => {
    expect(criterioMb(caso('media', false, 'Antezana 247'), 'album')).toBe('dudoso')
    expect(criterioMb(caso('media', false, 'Antezana 247'), 'year')).toBe('dudoso')
    expect(criterioMb(caso('alta', false, 'Oktubre'), 'year')).toBe('tildar')
  })

  it('el género que llena uno vacío: con confianza alta, tildado; media, sin tildar; el disco no importa (el autor, 13/11)', () => {
    expect(criterioMb(caso('alta', false, 'Oktubre'), 'genre')).toBe('tildar')
    expect(criterioMb(caso('alta', true, "Groovin' Day And Night"), 'genre')).toBe('tildar')
    expect(criterioMb(caso('media', false, 'Antezana 247'), 'genre')).toBe('dudoso')
  })
})

describe('los nombres oficiales de confianza media (el autor, 13/11)', () => {
  it('con las mismas letras (solo acentos y signos) van tildados; si cambia una palabra, sin tildar', () => {
    expect(soloAcentosYSignos('Lo Que Paso, Paso', 'Lo Que Pasó, Pasó')).toBe(true)
    expect(soloAcentosYSignos('Voyage voyage', 'Voyage, voyage')).toBe(true)
    expect(soloAcentosYSignos('Como le digo', 'Cómo le digo')).toBe(true)
    expect(soloAcentosYSignos('Wanakin', 'Wanakín DJ')).toBe(false)
    expect(soloAcentosYSignos('Bailando en una pata', 'Bailando en una pata')).toBe(false)
    expect(soloAcentosYSignos(null, 'Cómo le digo')).toBe(false)
    const rev = (id: number, from: string, to: string): TidyReview => ({ id, rel: 'x', field: 'title', from, to, why: '', staged: false, origin: 'oficial' })
    const r = repartirOficiales([rev(1, 'Como le digo', 'Cómo le digo'), rev(2, 'Voyage', 'Voyage, voyage (Remix)')])
    expect([r.seguros.map((p) => p.id), r.dudosos.map((p) => p.id)]).toEqual([[1], [2]])
    expect(r.seguros[0].source).toBe('oficial')
  })
})

let dir = '', db: Db | null = null
afterEach(() => { db?.close(); db = null; if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = '' })

describe('lo que dejó sin tildar una versión anterior', () => {
  it('sale de la lista si hoy no se propone; lo tildado o cambiado a mano se queda', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dudoso-'))
    const d = openDb(path.join(dir, 'paila.db')); db = d
    d.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', ?)").run(dir)
    d.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
    const ins = d.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title) VALUES (1, ?, 1, 1, 'musica', 'mp3', 'Michael Jackson', ?)")
    const [thriller, bad, beat, antezana] = ['Thriller', 'Bad', 'Beat It', 'Vuelta a la Luna'].map((t) => Number(ins.run(`x/${t}.mp3`, t).lastInsertRowid))
    const changes = new Changes(d, () => null, 'ffmpeg-no-se-usa', path.join(dir, 'resguardo'))
    // lo que sumó la versión anterior, sin tildar: el año de una recopilación en los tres primeros, uno de confianza media en el cuarto
    sumarSinTildar(d, changes, [thriller, bad, beat].map((id) => ({ id, field: 'year' as const, value: '1992' })))
    sumarSinTildar(d, changes, [{ id: antezana, field: 'year', value: '2018' }])
    apagar(d, [claveCambio(bad, 'year')], false) // "Bad": la persona lo tildó
    changes.stageMany([{ id: beat, field: 'year', value: '1983' }], 'internet') // "Beat It": cambió el valor (sigue destildado)
    const cache = (id: number) => (id === antezana ? caso('media', false, 'Antezana 247') : caso('alta', true, "Groovin' Day And Night", '1992'))
    expect(limpiarDescartados(d, changes, cache)).toBe(1)
    const quedan = (d.prepare('SELECT file_id AS id, after FROM pending_changes ORDER BY file_id').all() as { id: number; after: string }[]).map((r) => [r.id, r.after])
    expect(quedan).toEqual([[bad, '1992'], [beat, '1983'], [antezana, '2018']])
  })
})

describe('el año original de MusicBrainz (el autor, 13/11)', () => {
  function baseMb() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-anio-'))
    const d = openDb(path.join(dir, 'paila.db')); db = d
    d.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', ?)").run(dir)
    d.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
    const id = Number(d.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, 'x/Thriller.mp3', 1, 1, 'musica', 'mp3', 'Michael Jackson', 'Thriller', 357)").run().lastInsertRowid)
    // lo que se guardó antes del 13/11: el disco de una recopilación, sin el año original
    const viejo = { mbid: 'm', score: 100, confidence: 'alta', artist: 'Michael Jackson', title: 'Thriller', album: "Groovin' Day And Night", year: '1992', releaseId: null, track: null, genre: null, suspicious: true }
    d.prepare("INSERT INTO mb_lookup (file_id, status, result, looked_at) VALUES (?, 'ok', ?, '')").run(id, JSON.stringify(viejo))
    return { d, id }
  }
  // lo que contesta MusicBrainz hoy: la remasterización mejor puntuada (salió en 2008) y la grabación original (1982); vale la más vieja
  const grabacion = (id: string, score: number, primera: string) => ({ id, title: 'Thriller', score, length: 357000, 'first-release-date': primera, 'artist-credit': [{ name: 'Michael Jackson', artist: { name: 'Michael Jackson' } }],
    releases: [{ id: 'r', title: "Groovin' Day And Night", date: '1992', status: 'Official', 'release-group': { 'primary-type': 'Album', 'secondary-types': ['Compilation'] } }] })
  const respuesta = { recordings: [grabacion('remaster', 100, '2008-02-08'), grabacion('original', 90, '1982-11-30')] }
  const fetchFalso = (llamadas: string[]) => async (url: string) => { llamadas.push(url); return { ok: true, status: 200, json: async () => respuesta, arrayBuffer: async () => new ArrayBuffer(0) } }

  it('un tema sin año con una respuesta vieja de una recopilación se vuelve a preguntar una vez, y se ofrece el año original sin tildar', async () => {
    const { d, id } = baseMb()
    const llamadas: string[] = []
    const mb = new MusicBrainz(d, 'prueba', fetchFalso(llamadas), 0)
    await mb.run(() => {}, () => false)
    expect(llamadas).toHaveLength(1)
    const p = mb.proposals().find((x) => x.fileId === id)!
    expect(p.fills.find((f) => f.field === 'year')).toEqual({ field: 'year', value: '1982', original: true }) // no el 1992 de la recopilación
    const r = deMusicBrainz([p])
    // el año original, sin tildar; el disco de la recopilación no se propone
    expect([r.seguros.length, r.dudosos.map((x) => x.value), r.descartados.map((x) => x.field)]).toEqual([0, ['1982'], ['album']])
    // ya tiene el año original guardado: no se vuelve a preguntar
    await mb.run(() => {}, () => false)
    expect(llamadas).toHaveLength(1)
  })
})

describe('las ediciones en otro alfabeto (13/11)', () => {
  const rel = (title: string, extra: Record<string, unknown> = {}) => ({ id: title, title, date: '2019-03-29', status: 'Official', 'release-group': { 'primary-type': 'Album' }, ...extra })
  it('MusicBrainz prefiere la edición con el título en letras latinas ("bury a friend": no la japonesa)', () => {
    const japonesa = rel('ホエン・ウィー・オール・フォール・アスリープ、ホエア・ドゥー・ウィー・ゴー?', { date: '2019-03-27' })
    expect(pickRelease([japonesa, rel('WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?')])?.title).toBe('WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?')
    expect([enLetrasLatinas('Björk – Homogenic'), enLetrasLatinas('Ça plane pour moi'), enLetrasLatinas('Кино'), enLetrasLatinas('クロマティカ')]).toEqual([true, true, false, false])
  })
  it('si la única está en otro alfabeto, su disco y su año no entran tildados aunque la confianza sea alta', () => {
    expect(criterioMb(caso('alta', false, 'クロマティカ'), 'album')).toBe('dudoso')
    expect(criterioMb(caso('alta', false, 'クロマティカ'), 'year')).toBe('dudoso')
    expect(criterioMb(caso('alta', false, 'Chromatica'), 'album')).toBe('tildar')
  })
})
