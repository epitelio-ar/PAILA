// Tests de los géneros desde internet (MASTERPLAN-3, punto 4): el vocabulario (core/genrewords.ts), la decisión por tema
// (core/genres.ts), las propuestas con la base (core/genres-find.ts), la búsqueda (core/genres-run.ts) y Last.fm
// (core/online/lastfm.ts). Discogs y Last.fm: respuestas armadas a mano, sin internet.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { canonGenre, isJunkGenre } from '@paila/core/genrewords'
import { decideGenre } from '@paila/core/genres'
import { genreReport, lastfmArtistKey, lastfmTrackKey } from '@paila/core/genres-find'
import { GenreSearch } from '@paila/core/genres-run'
import { recKey, type NameRow } from '@paila/core/official-findings'
import { KeyError, OnlineCache, type FetchFn, type HttpRes } from '@paila/core/online/http'
import { LastFm } from '@paila/core/online/lastfm'
import type { RecHit } from '@paila/core/online/hits'

const res = (status: number, body: unknown): HttpRes => ({ ok: status < 400, status, json: async () => body })
const rel = (artist: string, styles: string[], genres?: string[]): RecHit => ({ source: 'discogs', title: 'x', titleFromQuery: true, length: null, credit: [{ name: artist, join: '' }], styles, ...(genres ? { genres } : {}) })
const tags = (...t: [string, number][]) => t.map(([name, count]) => ({ name, count }))

describe('vocabulario de géneros', () => {
  it('reconoce las formas de escribir un género y deja afuera lo que no es un género', () => {
    expect(canonGenre('drum and bass')?.name).toBe('Drum n Bass')
    expect(canonGenre('D&B')?.name).toBe('Drum n Bass')
    expect(canonGenre('hip-hop')?.name).toBe('Hip Hop')
    expect(canonGenre('rock argentino')?.name).toBe('Rock Nacional')
    expect(canonGenre('reguetón')?.name).toBe('Reggaeton')
    expect(canonGenre('Deep House')).toEqual({ name: 'Deep House', parent: 'Electronic' })
    // corrida supervisada del 23/10: Discogs dice "Horrorcore" para Dillom; de qué habla, no cómo suena
    expect(canonGenre('Horrorcore')?.name).toBe('Hip Hop')
    for (const junk of ['seen live', 'favorites', 'female vocalists', 'argentina', '80s', 'spanish', 'love', 'Soda Stereo', 'chill', 'dance'])
      expect(canonGenre(junk, true), junk).toBeNull()
  })

  it('las palabras dudosas valen desde Discogs pero no desde Last.fm ("romantic" es un ánimo, no el período)', () => {
    expect(canonGenre('Romantic')?.name).toBe('Romantic')
    expect(canonGenre('romantic', true)).toBeNull()
    expect(canonGenre('Ballad', true)).toBeNull()
  })

  it('"Other", "Unknown", un número de tag viejo o una letra suelta cuentan como vacío; un género de verdad no', () => {
    for (const v of [null, '', '  ', 'Other', 'unknown', 'genre', 'Desconocido', '(12)', '255', 'V', 'default']) expect(isJunkGenre(v), String(v)).toBe(true)
    for (const v of ['Rock', 'Folcklore', '80s', 'Electronic, Latin, Pop', 'Top 40']) expect(isJunkGenre(v), v).toBe(false)
  })
})

describe('decidir el género de un tema', () => {
  it('Discogs con varios discos que dicen lo mismo: confianza alta', () => {
    const p = decideGenre({ discogs: [{ styles: ['Deep House', 'Tech House'] }, { styles: ['Deep House'] }, { styles: ['Deep House'] }] })
    expect(p).toMatchObject({ genre: 'Deep House', conf: 'alta', sources: ['discogs'] })
    expect(p?.why).toBe('Discogs: 3 de 3 discos')
  })

  it('un solo disco de Discogs alcanza para proponer, pero con confianza media', () => {
    expect(decideGenre({ discogs: [{ styles: ['Cumbia'] }] })).toMatchObject({ genre: 'Cumbia', conf: 'media' })
  })

  it('las etiquetas que no son géneros no cuentan aunque sean las más usadas', () => {
    const p = decideGenre({ lastfmTrack: tags(['seen live', 100], ['favorites', 90], ['rock nacional', 60], ['argentina', 55]) })
    expect(p?.genre).toBe('Rock Nacional')
  })

  it('Discogs y Last.fm de acuerdo: alta, aunque sea un solo disco', () => {
    expect(decideGenre({ discogs: [{ styles: ['Techno'] }], lastfmTrack: tags(['techno', 100]) })).toMatchObject({ genre: 'Techno', conf: 'alta', sources: ['discogs', 'lastfm'] })
  })

  it('"electronic" a secas pierde contra un estilo con peso: es más preciso', () => {
    expect(decideGenre({ lastfmTrack: tags(['electronic', 100], ['deep house', 60]) })?.genre).toBe('Deep House')
  })

  it('en un empate gana el género que más se usa en la biblioteca, no el primero en orden alfabético', () => {
    // Discogs da los estilos de un disco en orden alfabético: sin desempate ganaba siempre el primero
    const ev = { discogs: [1, 2, 3].map(() => ({ styles: ['Deep House', 'Tech House'] })) }
    expect(decideGenre(ev)?.genre).toBe('Deep House')
    expect(decideGenre(ev, 'estilo', (g) => (g === 'Tech House' ? 30 : 1))).toMatchObject({ genre: 'Tech House', conf: 'alta' })
    // un género que pesa claramente más no se cambia por uno más usado
    expect(decideGenre({ discogs: [{ styles: ['Cumbia'] }, { styles: ['Cumbia', 'Rumba'] }] }, 'estilo', (g) => (g === 'Rumba' ? 99 : 0))?.genre).toBe('Cumbia')
  })

  it('un hit de pop que Discogs tiene como "Electronic, Pop" y House (los simples con remixes) queda en media sin Last.fm', () => {
    const pop = { discogs: [1, 2, 3].map(() => ({ styles: ['House'], genres: ['Electronic', 'Pop'] })) }
    expect(decideGenre(pop)).toMatchObject({ genre: 'House', conf: 'media' })
    expect(decideGenre({ ...pop, lastfmTrack: tags(['house', 100]) })?.conf).toBe('alta')
    expect(decideGenre({ discogs: [1, 2, 3].map(() => ({ styles: ['Techno'], genres: ['Electronic'] })) })?.conf).toBe('alta')
  })

  it('con el nivel general propone el género grande', () => {
    expect(decideGenre({ discogs: [{ styles: ['Deep House'] }, { styles: ['Tech House'] }] }, 'general')?.genre).toBe('Electronic')
    expect(decideGenre({ lastfmTrack: tags(['cumbia', 100]) }, 'general')?.genre).toBe('Latin')
  })

  it('un estilo de dos familias usa el género que Discogs le puso al disco', () => {
    expect(decideGenre({ discogs: [{ styles: ['Hardcore'], genres: ['Electronic'] }, { styles: ['Hardcore', 'Gabber'], genres: ['Electronic'] }] }, 'general')?.genre).toBe('Electronic')
  })

  it('dos géneros parejos de familias distintas: media, y el otro queda a la vista', () => {
    const p = decideGenre({ discogs: [{ styles: ['Reggae'] }, { styles: ['Rock'] }] })
    expect(p?.conf).toBe('media')
    expect(p?.others.length).toBe(1)
  })

  it('solo con lo del artista propone con confianza media; MusicBrainz solo, una etiqueta floja o nada, no', () => {
    expect(decideGenre({ lastfmArtist: tags(['pop', 100]) })).toMatchObject({ genre: 'Pop', conf: 'media' })
    expect(decideGenre({ lastfmArtist: tags(['seen live', 100], ['pop', 40]) })).toBeNull()
    expect(decideGenre({})).toBeNull()
    // corrida supervisada del 23/10: la etiqueta de MusicBrainz sola daba "Comfortably Numb" → Electronic
    expect(decideGenre({ musicbrainz: 'Electronic' })).toBeNull()
    expect(decideGenre({ discogs: [{ styles: ['Rock'] }], musicbrainz: 'Rock' })).toMatchObject({ genre: 'Rock', conf: 'media', sources: ['discogs', 'musicbrainz'] })
  })
})

let dir: string
let db: Db
let nextId = 1
const add = (relPath: string, artist: string, title: string, genre: string | null = null, album: string | null = null) => {
  const id = nextId++
  db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title, genre, album, codec) VALUES (?, 1, ?, 1000, 1, 'musica', 'mp3', 200, ?, ?, ?, ?, 'mp3')").run(id, relPath, artist, title, genre, album)
  return id
}
const rowsOf = (): NameRow[] => (db.prepare('SELECT id, artist, title, duration FROM files').all() as unknown as NameRow[])
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-generos-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  nextId = 1
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('propuestas con la base', () => {
  it('propone solo para los que no tienen género (o tienen "Other"), y respeta lo tocado a mano', () => {
    const cache = new OnlineCache(db)
    const a = add('a.mp3', 'Soda Stereo', 'Persiana Americana')
    const b = add('b.mp3', 'Soda Stereo', 'De Música Ligera', 'Other')
    const c = add('c.mp3', 'Soda Stereo', 'Té Para Tres', 'Pop')
    const d = add('d.mp3', 'Soda Stereo', 'En La Ciudad De La Furia')
    for (const t of ['Persiana Americana', 'De Música Ligera', 'Té Para Tres', 'En La Ciudad De La Furia']) cache.put('lastfm', lastfmTrackKey('Soda Stereo', t), 'ok', tags(['rock nacional', 100], ['seen live', 80]))
    // "d" lo vació el usuario a mano en PAILA: no se le propone nada
    db.prepare("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (1, ?, 'd.mp3', 'genre', 'Rock', NULL, '')").run(d)
    const r = genreReport(db, rowsOf())
    expect(r.proposals.map((p) => [p.fileId, p.genre, p.current])).toEqual([[a, 'Rock Nacional', null], [b, 'Rock Nacional', 'Other']])
    expect(r.proposals.some((p) => p.fileId === c)).toBe(false)
    expect(r).toMatchObject({ empty: 3, handTouched: 1, withGenre: 1 })
  })

  it('usa la forma de escribir de la biblioteca ("Drum & Bass" si así lo tenés)', () => {
    add('x1.mp3', 'Otro', 'Uno', 'Drum & Bass'); add('x2.mp3', 'Otro', 'Dos', 'Drum & Bass')
    const id = add('a.mp3', 'Netsky', 'Memory Lane')
    new OnlineCache(db).put('discogs', recKey('Netsky', 'Memory Lane'), 'ok', [rel('Netsky', ['Drum n Bass']), rel('Netsky', ['Drum n Bass'])])
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === id)?.genre).toBe('Drum & Bass')
  })

  it('los discos de Discogs de otro artista con un tema del mismo nombre no cuentan', () => {
    const id = add('a.mp3', 'Charly Garcia', 'Promesas Sobre El Bidet')
    new OnlineCache(db).put('discogs', recKey('Charly Garcia', 'Promesas Sobre El Bidet'), 'ok', [rel('Banda Tributo Polaca', ['Polka']), rel('Charly García', ['Pop Rock'])])
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === id)?.genre).toBe('Pop Rock')
  })

  it('el disco manda: si los otros temas del disco ya tienen un género parejo, propone ese', () => {
    for (const t of ['Uno', 'Dos', 'Tres']) add(`Disco/${t}.mp3`, 'Dj X', t, 'Minimal', 'El Disco')
    const id = add('Disco/Cuatro.mp3', 'Dj X', 'Cuatro', null, 'El Disco')
    new OnlineCache(db).put('lastfm', lastfmTrackKey('Dj X', 'Cuatro'), 'ok', tags(['techno', 100]))
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === id)).toMatchObject({ genre: 'Minimal', conf: 'alta', sources: ['disco'] })
  })

  it('un álbum que no es un disco ("album", "Álbum desconocido") no manda: El Bordo, repaso de criterios del 24/10', () => {
    for (const t of ['Uno', 'Dos', 'Tres']) add(`Rock/El Bordo/${t}.mp3`, 'El Bordo', t, 'Cumbia', 'album')
    const id = add('Rock/El Bordo/Cuatro.mp3', 'El Bordo', 'Cuatro', null, 'album')
    new OnlineCache(db).put('lastfm', lastfmTrackKey('El Bordo', 'Cuatro'), 'ok', tags(['rock nacional', 100]))
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === id)).toMatchObject({ genre: 'Rock Nacional' })
  })

  it('desempata con lo que ya tenés: si tu biblioteca está llena de Tech House, gana Tech House', () => {
    for (let i = 0; i < 4; i++) add(`t${i}.mp3`, 'Otro', `t${i}`, 'Tech House')
    const id = add('a.mp3', 'Dj Y', 'Groove')
    new OnlineCache(db).put('discogs', recKey('Dj Y', 'Groove'), 'ok', [1, 2, 3].map(() => rel('Dj Y', ['Deep House', 'Tech House'])))
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === id)?.genre).toBe('Tech House')
  })

  it('los discos de remixes de un hit de pop pesan poco: "Bad Romance" no es House (corrida del 23/10)', () => {
    const relx = (release: string, styles: string[]): RecHit => ({ ...rel('Lady Gaga', styles), release })
    const id = add('a.mp3', 'Lady Gaga', 'Bad Romance')
    const id2 = add('b.mp3', 'Lady Gaga', 'Bad Romance (Starsmith Remix)')
    const hits = [relx('Lady Gaga - Bad Romance (Remixes)', ['House']), relx('Lady Gaga - Bad Romance (The Remixes Part 2)', ['House']), relx('Lady Gaga - Bad Romance Club Mixes', ['House', 'Electro']), relx('Lady Gaga - The Fame Monster', ['Synth-pop', 'Dance-pop'])]
    new OnlineCache(db).put('discogs', recKey('Lady Gaga', 'Bad Romance'), 'ok', hits)
    new OnlineCache(db).put('discogs', recKey('Lady Gaga', 'Bad Romance (Starsmith Remix)'), 'ok', hits)
    const r = genreReport(db, rowsOf())
    expect(r.proposals.find((p) => p.fileId === id)?.genre).toBe('Synth Pop')
    // si el tema es un remix, los discos de remixes sí cuentan
    expect(r.proposals.find((p) => p.fileId === id2)?.genre).toBe('House')
  })

  it('el tema que se sale del resto del disco se empareja, con confianza media (Rodrigo: Cumbia y uno "Ballad")', () => {
    const ids = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((t) => add(`Rodrigo/${t}.mp3`, 'Rodrigo', t, null, 'Grandes Éxitos'))
    const c = new OnlineCache(db)
    for (const t of ['Uno', 'Dos', 'Tres', 'Cuatro']) c.put('discogs', recKey('Rodrigo', t), 'ok', [rel('Rodrigo', ['Cumbia']), rel('Rodrigo', ['Cumbia'])])
    c.put('discogs', recKey('Rodrigo', 'Cinco'), 'ok', [rel('Rodrigo', ['Pop Rock']), rel('Rodrigo', ['Pop Rock'])])
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === ids[4])).toMatchObject({ genre: 'Cumbia', conf: 'media', sources: ['disco'], others: ['Pop Rock'] })
  })

  it('no copia una forma desprolija de la biblioteca ("Progressive rock", "CUMBIA"): usa la de la lista', () => {
    add('x.mp3', 'X', 'x', 'Progressive rock'); add('y.mp3', 'Y', 'y', 'CUMBIA')
    const a = add('a.mp3', 'Pink Floyd', 'Time'), b = add('b.mp3', 'Gilda', 'Fuiste')
    new OnlineCache(db).put('discogs', recKey('Pink Floyd', 'Time'), 'ok', [rel('Pink Floyd', ['Prog Rock']), rel('Pink Floyd', ['Prog Rock'])])
    new OnlineCache(db).put('discogs', recKey('Gilda', 'Fuiste'), 'ok', [rel('Gilda', ['Cumbia']), rel('Gilda', ['Cumbia'])])
    const r = genreReport(db, rowsOf())
    expect(r.proposals.find((p) => p.fileId === a)?.genre).toBe('Prog Rock')
    expect(r.proposals.find((p) => p.fileId === b)?.genre).toBe('Cumbia')
  })

  it('como tu biblioteca: si el rock lo tenés como "Rock" a secas, propone Rock; la electrónica, por estilo', () => {
    for (let i = 0; i < 6; i++) add(`r${i}.mp3`, 'X', `r${i}`, 'Rock')
    for (let i = 0; i < 3; i++) add(`t${i}.mp3`, 'Y', `t${i}`, 'Techno')
    const a = add('a.mp3', 'La Renga', 'El Final Es En Donde Parti'), b = add('b.mp3', 'FJAAK', 'Drugs')
    const c = new OnlineCache(db)
    c.put('discogs', recKey('La Renga', 'El Final Es En Donde Parti'), 'ok', [rel('La Renga', ['Hard Rock']), rel('La Renga', ['Hard Rock'])])
    c.put('discogs', recKey('FJAAK', 'Drugs'), 'ok', [rel('FJAAK', ['Techno']), rel('FJAAK', ['Techno'])])
    const mine = genreReport(db, rowsOf())
    expect(mine.proposals.find((p) => p.fileId === a)?.genre).toBe('Rock')
    expect(mine.proposals.find((p) => p.fileId === b)?.genre).toBe('Techno')
    expect(genreReport(db, rowsOf(), 'estilo').proposals.find((p) => p.fileId === a)?.genre).toBe('Hard Rock')
    // un estilo puente no se achica: Katy Perry no es Rock
    const k = add('k.mp3', 'Katy Perry', 'Hot N Cold')
    new OnlineCache(db).put('discogs', recKey('Katy Perry', 'Hot N Cold'), 'ok', [rel('Katy Perry', ['Pop Rock']), rel('Katy Perry', ['Pop Rock'])])
    expect(genreReport(db, rowsOf()).proposals.find((p) => p.fileId === k)?.genre).toBe('Pop Rock')
  })

  it('misma cosa escrita distinto: solo mayúsculas o signos ("rock" → "Rock"), nunca "Rap" → "Hip-Hop"', () => {
    for (let i = 0; i < 3; i++) add(`r${i}.mp3`, 'A', `t${i}`, 'Rock')
    add('r9.mp3', 'A', 't9', 'rock')
    add('h1.mp3', 'B', 'h1', 'Hip-Hop'); add('h2.mp3', 'B', 'h2', 'Hip-Hop'); add('h3.mp3', 'B', 'h3', 'Rap')
    add('n1.mp3', 'C', 'n1', 'Rock And Roll'); add('n2.mp3', 'C', 'n2', 'Rock & Roll'); add('n3.mp3', 'C', 'n3', 'Rock & Roll')
    expect(genreReport(db, rowsOf()).spelling.map((s) => [s.from, s.to, s.ids.length])).toEqual([['rock', 'Rock', 1], ['Rock And Roll', 'Rock & Roll', 1]])
  })

  // decisión del autor del 23/10: de fábrica "Como tu biblioteca" (los otros dos niveles a un clic) y un solo género por tema
  it('de fábrica es "Como tu biblioteca", y los otros dos niveles siguen a un clic', () => {
    for (let i = 0; i < 6; i++) add(`r${i}.mp3`, 'X', `r${i}`, 'Rock')
    const a = add('a.mp3', 'La Renga', 'El Final Es En Donde Parti')
    new OnlineCache(db).put('discogs', recKey('La Renga', 'El Final Es En Donde Parti'), 'ok', [rel('La Renga', ['Hard Rock']), rel('La Renga', ['Hard Rock'])])
    const genreOf = (level?: 'biblioteca' | 'estilo' | 'general') => genreReport(db, rowsOf(), level).proposals.find((p) => p.fileId === a)?.genre
    expect(genreOf()).toBe(genreOf('biblioteca'))
    expect(genreOf()).toBe('Rock') // como lo tiene la biblioteca
    expect(genreOf('estilo')).toBe('Hard Rock')
    expect(genreOf('general')).toBe('Rock')
  })

  it('un solo género por tema, aunque las fuentes digan varios (los otros quedan para mirar en "También")', () => {
    const id = add('a.mp3', 'Dj Z', 'Mezcla')
    new OnlineCache(db).put('discogs', recKey('Dj Z', 'Mezcla'), 'ok', [1, 2, 3].map(() => rel('Dj Z', ['Deep House', 'Tech House', 'Minimal', 'Electro'], ['Electronic', 'Funk / Soul'])))
    new OnlineCache(db).put('lastfm', lastfmTrackKey('Dj Z', 'Mezcla'), 'ok', tags(['electronic', 100], ['deep house', 90], ['latin', 40]))
    for (const level of ['biblioteca', 'estilo', 'general'] as const) {
      const props = genreReport(db, rowsOf(), level).proposals.filter((p) => p.fileId === id)
      expect(props, level).toHaveLength(1)
      expect(typeof props[0].genre).toBe('string')
      expect(props[0].genre, level).not.toMatch(/[;,]/) // no es una lista de géneros pegados
      expect(props[0].others).not.toContain(props[0].genre)
    }
  })
})

describe('buscar géneros', () => {
  const lastfmBody = (url: string) => (url.includes('artist.gettoptags') ? { toptags: { tag: [{ name: 'electronic', count: 100 }] } } : url.includes('Nadie') ? { error: 6, message: 'Track not found' } : { toptags: { tag: [{ name: 'techno', count: 100 }, { name: 'seen live', count: 40 }] } })
  const fake = (log: string[], lastfm: (url: string) => HttpRes = (u) => res(200, lastfmBody(u))): FetchFn => async (url) => {
    log.push(url)
    if (url.includes('audioscrobbler')) return lastfm(url)
    return res(200, { results: [{ title: 'Dj X - Algo', style: ['Techno'], genre: ['Electronic'] }] })
  }

  it('pregunta solo por los temas sin género, a Discogs y a Last.fm, y lo guarda para no repetir', async () => {
    const a = add('a.mp3', 'Dj X', 'Algo')
    add('b.mp3', 'Dj X', 'Con Genero', 'Techno')
    add('c.mp3', 'Dj X', 'Nadie')
    const log: string[] = []
    const s = new GenreSearch(db, { ua: 't', keys: () => ({ discogs: { token: 'abcdefgh' }, lastfm: 'k'.repeat(32) }), fetchFn: fake(log), gapMs: { discogs: 0, lastfm: 0 } })
    expect(s.todo(rowsOf())).toEqual({ tracks: 2, discogs: 2, lastfm: 3 })
    const p = await s.run(rowsOf(), () => {}, () => false)
    expect(p.done).toBe(5)
    expect(log.some((u) => u.includes('Con%20Genero'))).toBe(false)
    expect(new OnlineCache(db).get('lastfm', lastfmArtistKey('Dj X'))?.data).toEqual([{ name: 'electronic', count: 100 }])
    expect(new OnlineCache(db).get('lastfm', lastfmTrackKey('Dj X', 'Nadie'))?.data).toEqual([])
    // Discogs guarda el disco (para reconocer los de remixes) y sus géneros generales
    expect(new OnlineCache(db).get<RecHit[]>('discogs', recKey('Dj X', 'Algo'))?.data?.[0]).toMatchObject({ styles: ['Techno'], genres: ['Electronic'], release: 'Dj X - Algo' })
    expect(s.todo(rowsOf())).toEqual({ tracks: 2, discogs: 0, lastfm: 0 })
    expect(genreReport(db, rowsOf()).proposals.find((x) => x.fileId === a)).toMatchObject({ genre: 'Techno', conf: 'alta' })
  })

  it('sin clave de Last.fm anda solo con Discogs', async () => {
    add('a.mp3', 'Dj X', 'Algo')
    const log: string[] = []
    const s = new GenreSearch(db, { ua: 't', keys: () => ({ discogs: { token: 'abcdefgh' } }), fetchFn: fake(log), gapMs: { discogs: 0 } })
    await s.run(rowsOf(), () => {}, () => false)
    expect(log.every((u) => u.includes('api.discogs.com'))).toBe(true)
    expect(genreReport(db, rowsOf()).proposals[0]).toMatchObject({ genre: 'Techno', conf: 'media', sources: ['discogs'] })
  })

  it('con la clave de Last.fm mala, Last.fm para solo y Discogs sigue', async () => {
    add('a.mp3', 'Dj X', 'Algo'); add('b.mp3', 'Dj X', 'Otro')
    const log: string[] = []
    const s = new GenreSearch(db, { ua: 't', keys: () => ({ discogs: { token: 'abcdefgh' }, lastfm: 'mala' }), fetchFn: fake(log, () => res(403, { error: 10, message: 'Invalid API key' })), gapMs: { discogs: 0, lastfm: 0 } })
    const p = await s.run(rowsOf(), () => {}, () => false)
    expect(p.bySource.lastfm?.stopped).toBe('Last.fm no aceptó la clave')
    expect(p.bySource.discogs).toMatchObject({ done: 2, total: 2 })
  })

  // prueba de usabilidad del 27/10 (interrupciones): el wifi se corta en medio de una búsqueda larga
  it('si se corta internet en el medio, termina sin colgarse, guarda lo que trajo y la próxima no lo repite', async () => {
    for (let i = 0; i < 10; i++) add(`t${i}.mp3`, 'Dj X', `Tema ${i}`)
    const log: string[] = []
    let vivo = 3
    const cortado: FetchFn = async (url, init) => { if (vivo-- <= 0) throw new Error('getaddrinfo ENOTFOUND api.discogs.com'); return fake(log)(url, init) }
    const s = new GenreSearch(db, { ua: 't', keys: () => ({ discogs: { token: 'abcdefgh' } }), fetchFn: cortado, gapMs: { discogs: 0 } })
    const antes = s.todo(rowsOf()).discogs
    const cortada = await s.run(rowsOf(), () => {}, () => false)
    expect(cortada.bySource.discogs?.stopped).toBe('Se cortó internet: lo que falta se busca solo la próxima vez')
    const despues = s.todo(rowsOf()).discogs
    expect(despues).toBeGreaterThan(0) // lo que no pudo preguntar sigue pendiente (no se anotó como "sin resultado")
    expect(despues).toBe(antes - 3) // y lo que ya trajo (3) no se vuelve a pedir
    const p = await new GenreSearch(db, { ua: 't', keys: () => ({ discogs: { token: 'abcdefgh' } }), fetchFn: fake(log), gapMs: { discogs: 0 } }).run(rowsOf(), () => {}, () => false)
    expect(p.bySource.discogs?.done).toBe(despues)
  })
})

describe('Last.fm', () => {
  it('lee una sola etiqueta (viene como objeto, no lista), "no lo encontré" y la clave mala', async () => {
    const lf = (body: unknown, status = 200) => new LastFm('k', 't', async () => res(status, body), 0)
    expect(await lf({ toptags: { tag: { name: 'cumbia', count: '100' } } }).trackTags('A', 'B')).toEqual([{ name: 'cumbia', count: 100 }])
    expect(await lf({ error: 6, message: 'Track not found' }, 404).trackTags('A', 'B')).toEqual([])
    await expect(lf({ error: 10, message: 'Invalid API key' }, 403).test()).rejects.toBeInstanceOf(KeyError)
  })
})
