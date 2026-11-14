// Tests de "Discos completos" (core/albums.ts, core/albumcheck.ts, core/albumrun.ts): qué es un disco y qué no, elegir la
// edición (normal, deluxe, con bonus), lo que falta y lo repetido, y mandar lo que falta a la lista «Faltan o suenan mal».
// MusicBrainz va simulado: nunca se pide nada a internet.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { albumDisc, albumGroups, joinedNames, type AlbumGroup } from '@paila/core/albums'
import { albumBase, catalogOf, decide, evaluate, pickCandidates, sameAlbum, searchName, titleKey } from '@paila/core/albumcheck'
import { AlbumSources, type Edition, type Tracklist } from '@paila/core/albumsources'
import { AlbumCheck } from '@paila/core/albumrun'
import { Wanted } from '@paila/core/wanted'
import type { FetchFn, HttpRes } from '@paila/core/online/http'

let dir: string
let db: Db
let nextId = 1
const add = (rel: string, album: string | null, title: string, extra: { artist?: string; track?: number; duration?: number; kind?: string; albumArtist?: string } = {}) =>
  db.prepare('INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, album_artist, title, album, track) VALUES (?, 1, ?, 1, 1, ?, \'mp3\', ?, ?, ?, ?, ?, ?)')
    .run(nextId++, rel, extra.kind ?? 'musica', extra.duration ?? 200, extra.artist ?? 'La Renga', extra.albumArtist ?? null, title, album, extra.track != null ? String(extra.track) : null)
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-discos-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '2026-10-20')").run()
  nextId = 1
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const list = (id: string, titles: string[], extra: Partial<Tracklist> = {}): Tracklist => ({
  source: 'musicbrainz', id, title: 'Detonador de sueños', artist: 'La Renga', date: '2003', country: 'AR', format: 'CD', trackCount: titles.length,
  status: 'Official', groupId: 'g1', secondary: [], note: null, score: 100, tracks: titles.map((t, i) => ({ disc: 1, pos: i + 1, title: t, artist: 'La Renga', length: 200 })), ...extra,
})
const group = (titles: (string | null)[], over: Partial<AlbumGroup> = {}): AlbumGroup => ({
  key: 'la renga|detonador de sueños', dir: 'Rock/La Renga/Detonador', artist: 'La Renga', album: 'Detonador de sueños', year: '2003', ownFolder: true, checkable: true, various: false,
  tracks: titles.map((t, i) => ({ id: i + 1, rel: `Rock/La Renga/Detonador/${String(i + 1).padStart(2, '0')} ${t ?? 'pista'}.mp3`, title: t, artist: 'La Renga', track: i + 1, disc: null, duration: 200, ext: 'mp3' })), ...over,
})

describe('qué es un disco', () => {
  it('agrupa por carpeta y álbum; deja afuera sueltos, sets, sample packs y álbumes genéricos', () => {
    for (const t of ['Uno', 'Dos', 'Tres']) add(`Rock/La Renga/Detonador/${t}.mp3`, 'Detonador de sueños', t)
    for (const t of ['A', 'B', 'C']) add(`Rock/La Renga/Sueltos/${t}.mp3`, 'Detonador de sueños', t) // carpeta de sueltos
    for (const t of ['D', 'E', 'F']) add(`Rock/La Renga/Varios/${t}.mp3`, 'Álbum desconocido (03/05/2006 16:34:34)', t) // así quedó en El Bordo
    for (const t of ['G', 'H', 'I']) add(`Samples/Kit/${t}.wav`, 'Drum Kit', t, { kind: 'produccion' })
    for (const t of ['J', 'K', 'L']) add(`Sets/${t}.mp3`, 'Mis sets', `${t} set`, { duration: 3600 })
    const gs = albumGroups(db, 3)
    expect(gs.map((g) => [g.album, g.tracks.length, g.ownFolder])).toEqual([['Detonador de sueños', 3, true]])
  })

  it('un disco doble en CD1/CD2 o "Volumen 1/2" es un solo disco', () => {
    expect(albumDisc('Lobo suelto/Cordero atado (CD 2)')).toEqual({ base: 'Lobo suelto/Cordero atado', disc: 2 })
    expect(albumDisc('Estadio Chateau Carreras 2001, CD1')).toEqual({ base: 'Estadio Chateau Carreras 2001', disc: 1 })
    expect(albumDisc("Live: Era '87-'93 Disc 2")).toEqual({ base: "Live: Era '87-'93", disc: 2 })
    expect(albumDisc('Cintas Magicas Vol 2')).toEqual({ base: 'Cintas Magicas Vol 2', disc: null }) // es otro disco
    for (const [i, t] of ['Uno', 'Dos'].entries()) add(`Soda/Ruido Blanco/CD1/${t}.mp3`, 'Ruido Blanco (CD 1)', t, { track: i + 1 })
    for (const [i, t] of ['Tres', 'Cuatro'].entries()) add(`Soda/Ruido Blanco/CD2/${t}.mp3`, 'Ruido Blanco (CD 2)', t, { track: i + 1 })
    const [g] = albumGroups(db, 3)
    expect(g.album).toBe('Ruido Blanco')
    expect(g.dir).toBe('Soda/Ruido Blanco')
    expect(g.tracks.map((t) => [t.title, t.disc])).toEqual([['Uno', 1], ['Dos', 1], ['Tres', 2], ['Cuatro', 2]])
  })

  // decidido el 22/10: dos discos que salieron juntos van como dos discos separados
  it('"Lobo suelto/Cordero atado" en CD 1 y CD 2 son dos discos, cada uno con su nombre y su carpeta', () => {
    expect(joinedNames('Lobo suelto/Cordero atado')).toEqual(['Lobo suelto', 'Cordero atado'])
    expect(joinedNames('Nordpol / Südpol')).toEqual(['Nordpol', 'Südpol'])
    expect(joinedNames('Hitbreaker 2015 / 1')).toBeNull()
    for (const [i, t] of ['Invocación', 'Susanita', 'Sushi'].entries()) add(`Redondos/1993 - Lobo suelto - Cordero atado/Volumen 1/${t}.flac`, 'Lobo suelto/Cordero atado (CD 1)', t, { track: i + 1 })
    for (const [i, t] of ['Yo caníbal', 'San Telmo', 'Etiqueta negra'].entries()) add(`Redondos/1993 - Lobo suelto - Cordero atado/Volumen 2/${t}.flac`, 'Lobo suelto/Cordero atado (CD 2)', t, { track: i + 1 })
    // "Nordpol / Südpol" sin números de disco: un solo disco con ese nombre
    for (const t of ['A', 'B', 'C']) add(`Electronica/Nordpol/${t}.mp3`, 'Nordpol / Südpol', t, { artist: 'Pantha du Prince' })
    const gs = albumGroups(db, 3)
    expect(gs.map((g) => [g.album, g.dir, g.ownFolder, g.tracks.map((t) => [t.title, t.disc])])).toEqual([
      ['Cordero atado', 'Redondos/1993 - Lobo suelto - Cordero atado/Volumen 2', true, [['Yo caníbal', null], ['San Telmo', null], ['Etiqueta negra', null]]],
      ['Lobo suelto', 'Redondos/1993 - Lobo suelto - Cordero atado/Volumen 1', true, [['Invocación', null], ['Susanita', null], ['Sushi', null]]],
      ['Nordpol / Südpol', 'Electronica/Nordpol', true, [['A', null], ['B', null], ['C', null]]],
    ])
    expect(new Set(gs.map((g) => g.key)).size).toBe(3)
  })

  it('en una carpeta-playlist no se revisa si está completo (sí en la carpeta del artista)', () => {
    for (const t of ['A', 'B', 'C']) add(`DISCO CUMPLE/TRAP SET/${t}.mp3`, 'POST MORTEM', t, { artist: 'Dillom' })
    for (const t of ['D', 'E', 'F', 'G', 'H', 'I', 'J']) add(`DISCO CUMPLE/TRAP SET/${t}.mp3`, null, t, { artist: `Otro ${t}` })
    for (const t of ['Uno', 'Dos', 'Tres']) add(`Rock/Callejeros/${t}.mp3`, 'Señales', t, { artist: 'Callejeros' })
    for (const t of ['Cuatro', 'Cinco', 'Seis']) add(`Rock/Callejeros/${t}.mp3`, 'Presión', t, { artist: 'Callejeros' })
    const gs = albumGroups(db, 3)
    expect(gs.map((g) => [g.album, g.ownFolder, g.checkable])).toEqual([['Presión', false, true], ['Señales', false, true], ['POST MORTEM', false, false]])
  })
})

describe('comparar con la lista oficial', () => {
  it('títulos con número, feat. o "Remastered" coinciden igual', () => {
    expect(titleKey('03 - La Renga - Hey Hey Hey (feat. Ricardo Iorio)', 'La Renga')).toBe(titleKey('Hey Hey Hey'))
    expect(titleKey('Paranoid - 2012 Remaster')).toBe(titleKey('Paranoid'))
    expect(albumBase('Appetite for Destruction (Deluxe Edition)')).toBe(albumBase('Appetite For Destruction'))
    expect(albumBase('Use Your Illusion I')).not.toBe(albumBase('Use Your Illusion II'))
  })

  it('dice qué falta y qué está repetido', () => {
    const g = group(['Uno', 'Dos', 'Dos', 'Cuatro'])
    const ev = evaluate(g, list('r1', ['Uno', 'Dos', 'Tres', 'Cuatro']))
    expect(ev.matched).toBe(3)
    expect(ev.missing.map((t) => t.title)).toEqual(['Tres'])
    expect(ev.repeated).toEqual([{ title: 'Dos', files: [g.tracks[1].rel, g.tracks[2].rel] }])
    expect(ev.extra).toEqual([])
  })

  it('"Track 05" sin título se empareja por número de tema y duración', () => {
    const ev = evaluate(group(['Uno', 'Track 02', 'Tres']), list('r1', ['Uno', 'Dos', 'Tres']))
    expect(ev.matched).toBe(3)
  })

  it('con la edición normal completa no pide la deluxe, pero avisa que existe', () => {
    const r = decide(group(['Uno', 'Dos', 'Tres']), [list('normal', ['Uno', 'Dos', 'Tres']), list('deluxe', ['Uno', 'Dos', 'Tres', 'Bonus 1', 'Bonus 2'], { title: 'Detonador de sueños (Deluxe)' })], null, true)
    expect(r.status).toBe('completo')
    expect(r.edition?.ref).toBe('musicbrainz:normal')
    expect(r.bigger?.more).toBe(2)
  })

  it('con un bonus de otra edición, ante la duda muestra las ediciones para elegir', () => {
    const r = decide(group(['Uno', 'Dos', 'Tres', 'Bonus 1']), [list('normal', ['Uno', 'Dos', 'Tres']), list('japon', ['Uno', 'Dos', 'Tres', 'Bonus 1', 'Bonus 2'])], null, true)
    expect(r.status).toBe('elegir')
    expect(r.options.map((o) => o.ref)).toEqual(['musicbrainz:japon', 'musicbrainz:normal'])
    // elegida a mano, decide esa
    const m = decide(group(['Uno', 'Dos', 'Tres', 'Bonus 1']), [list('normal', ['Uno', 'Dos', 'Tres']), list('japon', ['Uno', 'Dos', 'Tres', 'Bonus 1', 'Bonus 2'])], 'musicbrainz:normal', true)
    expect([m.status, m.manual, m.extra.length]).toEqual(['completo', true, 1])
  })

  it('un disco con el mismo nombre pero otros temas no cuenta (es otro disco)', () => {
    const r = decide(group(['Uno', 'Dos', 'Tres', 'Cuatro']), [list('otro', ['Cinco', 'Seis', 'Siete', 'Uno'])], null, true)
    expect(r.status).toBe('no_encontrado')
  })

  it('"ignorar" deja el disco afuera', () => {
    expect(decide(group(['Uno', 'Dos', 'Tres']), [list('n', ['Uno'])], 'ignorar', true).status).toBe('ignorado')
  })

  it('elige para bajar ediciones con distinta cantidad de temas, del mismo disco y artista', () => {
    const ed = (id: string, title: string, n: number, artist = 'La Renga', score = 100): Edition => ({ source: 'musicbrainz', id, title, artist, date: null, country: null, format: null, trackCount: n, status: 'Official', groupId: 'g', secondary: [], note: null, score })
    const picked = pickCandidates([ed('a', 'Detonador de sueños', 13), ed('b', 'Detonador de sueños', 13), ed('c', 'Detonador de sueños (Edición especial)', 15), ed('d', 'Detonador', 13), ed('e', 'Detonador de sueños', 13, 'Otra banda'), ed('f', 'Detonador de sueños', 12, 'La Renga', 40)], group(Array(13).fill('x')))
    expect(picked.map((e) => e.id)).toEqual(['a', 'c'])
  })
})

// Errores de la corrida supervisada del 20/10/2026 sobre la biblioteca real (docs/archivo/pruebas/2026-10-20-discos-tapas-volumen.md)
describe('corrida supervisada: cada error, un test', () => {
  const pair = (mine: string, official: string) => evaluate(group([mine, 'Otro tema']), list('r', [official, 'Otro tema'])).matched === 2

  it('títulos que son el mismo tema escrito distinto', () => {
    expect(pair('Buick MacKane (Big Dumb Sex) [Medley]', 'Buick Makane (Big Dumb Sex)')).toBe(true) // Guns N' Roses
    expect(pair('Roxana porcelana (Stud Free Pub, 15-07-85)', 'Roxana porchelana')).toBe(true) // Redondos, Inéditos
    expect(pair('Rock 18 (Teatros de San Telmo, 10-06-82)', 'Rock18')).toBe(true)
    expect(pair('El tío Alberto en el Día de la Bici', 'El tío Alberto en el día de la bicicleta')).toBe(true) // Indio Solari
    expect(pair('El martillo de las brujas (Malleus', 'El martillo de las brujas (Malleus maleficarum)')).toBe(true) // tag cortado
    expect(pair('Y mientras el sol se muere', 'Y mientras tanto el sol se muere...')).toBe(true) // Porco Rex
    expect(pair('Los Calientes (Remix) (Romina Cohn)', 'Los calientes (rmx)')).toBe(true) // Babasónicos
    // y los que no son el mismo tema
    expect(pair('Use Your Illusion', 'Use Your Illusion II')).toBe(false)
    expect(pair('Ella', 'Ella baila con todos')).toBe(false)
  })

  it('"Track11" sin espacio se empareja por número de tema (El Bordo)', () => {
    const g = group(['Uno', 'Track11'])
    g.tracks[1].track = 2
    expect(evaluate(g, list('r', ['Uno', 'El traicionero'])).matched).toBe(2)
  })

  it('las pistas "[silencio]" del CD no son temas que falten (No Te Va Gustar)', () => {
    const r = decide(group(['Uno', 'Dos', 'Tres']), [list('r', ['Uno', 'Dos', '[silencio]', 'Tres'])], null, true)
    expect([r.status, r.edition?.tracks]).toEqual(['completo', 3])
  })

  it('sin título en el tag, el nombre del archivo con el artista adelante ("las pelotas    Será")', () => {
    const g = group([null, 'Dos'], { artist: 'Las Pelotas' })
    g.tracks[0] = { ...g.tracks[0], rel: 'Rock/Las Pelotas/las pelotas    Será .mp3', artist: 'Las Pelotas' }
    expect(evaluate(g, list('r', ['Será', 'Dos'])).matched).toBe(2)
  })

  it('una caja de lujo con los mismos temas repetidos no gana al disco normal (Led Zeppelin)', () => {
    const songs = ['The Song Remains the Same', 'The Rain Song', 'Over the Hills', 'The Crunge', 'Dancing Days', "D'yer Mak'er", 'No Quarter', 'The Ocean']
    const mine = group([...songs, 'Dancing Days', 'Dancing Days', 'No Quarter', 'The Rain Song'])
    const box = list('caja', [...songs, ...songs.map((s) => `${s} (rough mix)`), ...songs])
    const r = decide(mine, [list('normal', songs), box], null, true)
    expect([r.status, r.edition?.ref]).toEqual(['completo', 'musicbrainz:normal'])
    expect(r.repeated.map((x) => [x.title, x.files.length])).toEqual([['The Rain Song', 2], ['Dancing Days', 3], ['No Quarter', 2]])
  })

  it('una pista con dos temas ("A / B") cuenta para el primero (Guns N\' Roses, edición europea)', () => {
    expect(pair("I Don't Care About You", "I Don't Care About You / Look at Your Game, Girl")).toBe(true)
  })

  it('mismo número y misma duración es el mismo tema con otro nombre ("Final" = "Cierre", La Renga)', () => {
    expect(pair('Final', 'Cierre')).toBe(false) // con distinta duración no
    const g = group(['Uno', 'Dos', 'Tres', 'Final'])
    const l = list('r', ['Uno', 'Dos', 'Tres', 'Cierre'])
    l.tracks[3].length = 201
    expect(evaluate(g, l).matched).toBe(4)
    l.tracks[3].length = 230
    expect(evaluate(g, l).matched).toBe(3)
  })

  it('"TruenoTierra2" al lado de "Trueno Tierra" es el segundo disco del mismo álbum', () => {
    for (const [i, t] of ['Uno', 'Dos'].entries()) add(`Rock/La Renga/${t}.mp3`, 'Trueno Tierra', t, { track: i + 1 })
    for (const [i, t] of ['Tres', 'Cuatro'].entries()) add(`Rock/La Renga/${t}.mp3`, 'TruenoTierra2', t, { track: i + 1 })
    const gs = albumGroups(db, 3)
    expect(gs.map((g) => [g.album, g.tracks.map((t) => t.disc ?? 1)])).toEqual([['Trueno Tierra', [1, 1, 2, 2]]])
  })

  it('el mismo disco con un subtítulo sí; otro disco o un en vivo no', () => {
    expect(sameAlbum('El tesoro de los inocentes (Final paraíso)', [], 'El Tesoro de los Inocentes')).toBe(true)
    expect(sameAlbum('Led Zeppelin II', [], 'Led Zeppelin')).toBe(false)
    expect(sameAlbum('Gulp (En vivo)', ['Live'], 'Gulp')).toBe(false)
    expect(sameAlbum('Truenotierra', [], 'Trueno Tierra')).toBe(true)
  })

  it('si nada se llama igual, busca el nombre todo junto ("Trueno Tierra" = "Truenotierra")', async () => {
    const asked: string[] = []
    const res = (body: unknown): HttpRes => ({ ok: true, status: 200, json: async () => body })
    const fetchFn: FetchFn = async (url) => {
      asked.push(decodeURIComponent(url))
      return res({ releases: url.toLowerCase().includes('truenotierra') ? [{ id: 't', score: 100, title: 'Truenotierra', 'artist-credit': [{ name: 'La Renga' }] }] : [] })
    }
    const eds = await new AlbumSources(db, { ua: 'test', fetchFn, gapMs: 0 }).editions('La Renga', 'Trueno Tierra')
    expect(eds.map((e) => e.title)).toEqual(['Truenotierra'])
    expect(asked.length).toBe(2)
  })
})

describe('Discogs (con clave)', () => {
  it('lee la lista de temas: discos ("1-03"), lados de vinilo ("A1") y saltea los títulos de sección', async () => {
    const fetchFn: FetchFn = async (url) => ({
      ok: true, status: 200, json: async () => url.includes('/releases/7') ? {
        id: 7, title: 'Detonador de sueños', year: 2003, country: 'Argentina', artists: [{ name: 'La Renga (2)' }], formats: [{ name: 'Vinyl' }],
        tracklist: [{ type_: 'heading', title: 'Lado A' }, { position: 'A1', type_: 'track', title: 'A tu lado', duration: '4:05' }, { position: 'B1', type_: 'track', title: 'Detonador de sueños', duration: '' }],
      } : { results: [{ id: 7, title: 'La Renga (2) - Detonador de sueños', year: '2003', country: 'Argentina', format: ['Vinyl', 'LP'] }] },
    })
    const src = new AlbumSources(db, { ua: 'test', fetchFn, gapMs: 0, discogs: { token: 'x' } })
    const [e] = await src.discogsEditions('La Renga', 'Detonador de sueños')
    expect([e.artist, e.title, e.format]).toEqual(['La Renga', 'Detonador de sueños', 'Vinyl, LP'])
    const l = await src.discogsTracklist('7')
    expect(l.tracks).toEqual([{ disc: 1, pos: 1, title: 'A tu lado', artist: null, length: 245 }, { disc: 1, pos: 2, title: 'Detonador de sueños', artist: null, length: null }])
    expect(src.cachedTracklist({ source: 'discogs', id: '7' })?.title).toBe('Detonador de sueños')
  })
})

describe('el proceso y la lista «Faltan o suenan mal»', () => {
  it('busca en MusicBrainz (una vez), decide sin internet y manda lo que falta con el motivo "falta del disco"', async () => {
    for (const [i, t] of ['Uno', 'Dos', 'Cuatro'].entries()) add(`Rock/La Renga/Detonador/${t}.mp3`, 'Detonador de sueños', t, { track: i + 1 })
    const calls: string[] = []
    const res = (body: unknown): HttpRes => ({ ok: true, status: 200, json: async () => body })
    const fetchFn: FetchFn = async (url) => {
      calls.push(url)
      if (url.includes('/release/?query=')) return res({ releases: [{ id: 'r1', score: 100, title: 'Detonador de sueños', status: 'Official', 'track-count': 4, 'artist-credit': [{ name: 'La Renga' }], 'release-group': { id: 'g1' } }] })
      return res({ id: 'r1', title: 'Detonador de sueños', status: 'Official', 'artist-credit': [{ name: 'La Renga' }], media: [{ position: 1, format: 'CD', tracks: ['Uno', 'Dos', 'Tres', 'Cuatro'].map((t, i) => ({ position: i + 1, title: t, length: 200000, 'artist-credit': [{ name: 'La Renga' }] })) }] })
    }
    const ac = new AlbumCheck(db, new AlbumSources(db, { ua: 'test', fetchFn, gapMs: 0, deezer: false }))
    expect(ac.report().reports[0].status).toBe('sin_buscar')
    expect(await ac.run(() => {}, () => false)).toMatchObject({ looked: 1, found: 1, errors: 0 })
    expect(calls.length).toBe(2)
    await ac.run(() => {}, () => false)
    expect(calls.length).toBe(2) // ya estaba guardado
    const [r] = ac.report().reports
    expect([r.status, r.missing.map((m) => m.title)]).toEqual(['faltan', ['Tres']])
    const wanted = new Wanted(db)
    expect(ac.toWanted(wanted, [r.key])).toBe(1)
    expect(ac.toWanted(wanted, [r.key])).toBe(0) // no se repite
    const item = wanted.list().find((i) => i.title === 'Tres')!
    expect([item.artist, item.album, item.reasons]).toEqual(['La Renga', 'Detonador de sueños', ['falta_disco']])
  })
})

describe('Deezer (sin clave)', () => {
  it('encuentra el EP digital que MusicBrainz no tiene, y se puede apagar', async () => {
    for (const [i, t] of ['Twister (Original Mix)', 'Spacey (Original Mix)', 'Spacey (ANOTR Remix)'].entries()) add(`Electronica/House/ANOTR, Dimmish - Twister EP/${i + 1}.mp3`, 'Twister EP', t, { artist: 'Dimmish', track: i + 1 })
    const calls: string[] = []
    const res = (body: unknown): HttpRes => ({ ok: true, status: 200, json: async () => body })
    const fetchFn: FetchFn = async (url) => {
      calls.push(url)
      if (url.includes('musicbrainz.org')) return res({ releases: [] })
      if (url.includes('/search/album')) return res({ data: [{ id: 55, title: 'Twister EP', nb_tracks: 3, record_type: 'ep', artist: { name: 'Dimmish' } }] })
      if (url.includes('/album/55/tracks')) return res({ data: ['Twister', 'Spacey', 'Spacey (ANOTR Remix)'].map((t, i) => ({ title: t, duration: 200, track_position: i + 1, disk_number: 1, artist: { name: 'Dimmish' } })) })
      return res({ id: 55, title: 'Twister EP', release_date: '2021-05-07', record_type: 'ep', artist: { name: 'Dimmish' } })
    }
    const ac = new AlbumCheck(db, new AlbumSources(db, { ua: 'test', fetchFn, gapMs: 0 }))
    await ac.run(() => {}, () => false)
    const [r] = ac.report().reports
    expect([r.status, r.edition?.ref, r.edition?.date]).toEqual(['completo', 'deezer:55', '2021-05-07'])
    const off = new AlbumCheck(db, new AlbumSources(db, { ua: 'test', fetchFn, gapMs: 0, deezer: false }))
    expect(off.report().reports[0].status).toBe('no_encontrado') // apagado: no usa lo de Deezer
  })
})

describe('corrida supervisada (2): MusicBrainz y Deezer con la misma edición', () => {
  it('títulos escritos distinto en cada fuente no hacen pedir "elegí la edición"; ante empate gana MusicBrainz', () => {
    const mine = group(['Heartbreaker', 'Living Loving Maid'])
    const mb = list('mb', ['Whole Lotta Love', 'Heartbreaker', 'Living Loving Maid', 'Psilocybe mexicana'])
    const dz = { ...list('55', ['Whole Lotta Love (Remaster)', 'Heartbreaker (Remaster)', 'Living Loving Maid (Remaster)', 'Psilosibe Mexicana']), source: 'deezer' as const, date: '1969-10-22' }
    const r = decide(mine, [dz, mb], null, true)
    expect([r.status, r.edition?.ref]).toEqual(['faltan', 'musicbrainz:mb'])
  })
})

describe('corrida supervisada (3): nombres con basura y números adelante', () => {
  it('busca sin "(Vinyl Only)" ni el código pegado, y usa el código de catálogo en Discogs', () => {
    expect(searchName('The Summit EP (Vinyl Only) MULENV017')).toBe('The Summit EP')
    expect(searchName('FUN007 (Vinyl Only) FUN007')).toBe('FUN007')
    expect(searchName('Arriba las manos')).toBe('Arriba las manos')
    expect(catalogOf('ORIGINAL SERIES 01 (Vinyl Only) ALNOS01')).toBe('ALNOS01')
    expect(catalogOf('Use Your Illusion II')).toBeNull()
    expect(sameAlbum('The Summit EP', [], 'The Summit EP (Vinyl Only) MULENV017')).toBe(true)
  })

  it('"01 Viva El Funk" sin guion: el número se saca si tiene cero adelante o es el n.º de tema; "22 Acacia Avenue" no', () => {
    const g = group(['01 Viva El Funk', '22 Acacia Avenue'])
    g.tracks.forEach((t) => { t.track = null })
    expect(evaluate(g, list('r', ['Viva El Funk', '22 Acacia Avenue'])).matched).toBe(2)
  })
})

describe('corrida supervisada (4)', () => {
  it('"10 Ella No Vea La Tele (Con Kase.O)" cuando todos los títulos empiezan con su número; "1440 VINYL ONLY" = "1440"', () => {
    const g = group(['01 Viva El Funk', '03 Gordo Funk', '10 Ella No Vea La Tele (Con Kase.O)'])
    g.tracks.forEach((t) => { t.track = null })
    expect(evaluate(g, list('r', ['Viva El Funk', 'Gordo Funk', 'Ella No Veía La Tele'])).matched).toBe(3)
    expect(evaluate(group(['1440 VINYL ONLY', 'Slow It Down VINYL ONLY']), list('r', ['1440', 'Slow It Down'])).matched).toBe(2)
  })
})
