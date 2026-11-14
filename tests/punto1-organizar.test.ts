// Lo que salió de la vista previa real de Organizar en el punto 1 (24/10), con los nombres de la Música del autor: una página
// ".es" como carpeta, el "Álbum desconocido" del Reproductor de Windows con la fecha pegada, la colaboración de un compilado y el
// título que arrastraba la extensión del archivo; y la carpeta de "Earth, Wind & Fire" cortada en la coma.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'
import { cleanBase, isSite, loose } from '@paila/core/names'
import { realAlbum } from '@paila/core/albums'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { recKey } from '@paila/core/official-findings'

let dir: string, lib: Library, rootId: number
const add = (rel: string, t: { artist?: string; albumArtist?: string; title?: string; album?: string; track?: string; year?: string }) =>
  Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, album_artist, title, album, track, year, probed_at) VALUES (?, ?, 1, 1, 'musica', ?, 200, ?, ?, ?, ?, ?, ?, '2026-10-24')")
    .run(rootId, rel, path.extname(rel).slice(1).toLowerCase(), t.artist ?? null, t.albumArtist ?? null, t.title ?? null, t.album ?? null, t.track ?? null, t.year ?? null).lastInsertRowid)
const dest = (from: string) => new Organizer(lib.db, () => path.join(dir, 'M')).plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' }).moves.find((m) => m.from === from)?.to
const title = (id: number) => tidy(lib.db, ['filename'], () => null, rulesOf('oficial')).changes.find((c) => c.id === id && c.field === 'title')?.to

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-punto1-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  rootId = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
})
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('punto 1 real: Organizar y Nombres', () => {
  it('"LanzamientosMp3.es" y otras terminaciones de país son páginas; "Mr.Kitty", "Bob.Dylan" o "will.i.am", no', () => {
    for (const v of ['LanzamientosMp3.es', 'MusicaCristiana.mx', 'www.cumbia.com.ar', 'Descargas.cl', 'mp3teca.net', 'bajarmusica.org', 'zaycev.ru', 'radio.fm'])
      expect(isSite(v), v).toBe(true)
    for (const v of ['Mr.Kitty', 'Bob.Dylan', 'will.i.am', 'St.Vincent', 'Dr.Dre', 'M.I.A.', 'B.o.B', 't.A.T.u.', 'Ms.Lauryn']) expect(isSite(v), v).toBe(false)
    expect(cleanBase('LanzamientosMp3.es - Bad Bunny - Monaco')).toBe('Bad Bunny - Monaco')
    add('Descargas/Bad Bunny - Monaco.mp3', { artist: 'Bad Bunny', albumArtist: 'LanzamientosMp3.es', title: 'Monaco', album: 'LanzamientosMp3.es' })
    expect(dest('Descargas/Bad Bunny - Monaco.mp3')).toBe('Biblioteca/Bad Bunny/Monaco.mp3')
  })

  it('"Álbum desconocido" con la fecha del Reproductor de Windows (entera o cortada) no es un disco', () => {
    for (const v of ['Álbum desconocido (03/05/2006 16:34:34)', 'Álbum desconocido (14/12/2005', 'Unknown Album (18/03/2006 10:00:01)', 'Álbum desconocido'])
      expect(realAlbum(v), v).toBe(false)
    for (const v of ['Unknown Pleasures', 'Desconocido Para Mí', 'Album Negro']) expect(realAlbum(v), v).toBe(true)
    for (let i = 1; i <= 5; i++) add(`Rock/El Bordo/Track0${i}.mp3`, { artist: 'El Bordo', title: `Tema ${i}`, album: 'Álbum desconocido (03/05/2006 16:34:34)', year: '2006', track: String(i) })
    add('Rock/El Bordo/Track06.mp3', { artist: 'El Bordo', title: 'Tema 6', album: 'Álbum desconocido (14/12/2005', year: '2005' })
    expect(dest('Rock/El Bordo/Track01.mp3')).toBe('Biblioteca/El Bordo/Tema 1.mp3')
    expect(dest('Rock/El Bordo/Track06.mp3')).toBe('Biblioteca/El Bordo/Tema 6.mp3')
  })

  it('la colaboración de un tema suelto de un compilado va a la carpeta del primer artista', () => {
    for (let i = 1; i <= 7; i++) add(`Reggaeton/J Balvin/J. Balvin - Tema ${i}.mp3`, { artist: 'J. Balvin', title: `Tema ${i}` })
    for (let i = 1; i <= 6; i++) add(`DISCO CUMPLE/Chengue/0${i}. Otro ${i} - Hit.mp3`, { artist: `Otro ${i}`, title: 'Hit' })
    const from = 'DISCO CUMPLE/Chengue/09. J. Balvin & Willy William - Mi Gente.flac'
    add(from, { artist: 'J. Balvin & Willy William', albumArtist: 'Various', title: 'Mi Gente', album: 'Reggaeton 2017' })
    expect(dest(from)).toBe('Biblioteca/J. Balvin/Mi Gente.flac')
  })

  it('el título que arrastra la extensión del archivo la pierde; el ".mp3" del disco de Emilia se queda', () => {
    expect(title(add('Rock/Iorio/almafuerte- se vos.mp3', { artist: 'Almafuerte', title: 'Se vos.mp3', album: 'Almafuerte' }))).toBe('Se vos')
    expect(title(add('2002 - Los Calientes Remixes/01 - Los Calientes (Diego Ro-K Remix).Mp3.Mp3', { artist: 'Babasónicos', title: 'Los Calientes (Diego Ro-K Remix).Mp3', album: 'Los Calientes Remixes' })))
      .toBe('Los Calientes (Diego Ro-K Remix)')
    // los de Emilia, como están en la Música: ninguno pierde su ".mp3"
    const emilia: [string, string, string | undefined][] = [
      ['DISCO CUMPLE/Cachengue 1/Emilia - Jagger.mp3 (Official Video).mp3', 'Jagger.mp3', '.mp3'],
      ['DISCO CUMPLE/set diciembre/Emilia - GTA.mp3 (Official Video).wav', 'Emilia - GTA.mp3', undefined],
      ['FIESTA AMIGOS 2024/Emilia, TINI - La_Original.mp3', 'Emilia, TINI - La_Original.mp3 (Official Video)', undefined],
      ['Pop/Emilia/01 - GTA.mp3.mp3', 'GTA.mp3', '.mp3'],
      // ya con Nombres aplicado (la base del punto 1): el título quedó "La_Original.mp3" y el archivo no dice más que eso
      ['FIESTA AMIGOS vol2/Emilia, TINI - La_Original.mp3', 'La_Original.mp3', undefined],
    ]
    for (const [rel, t, album] of emilia) expect(title(add(rel, { artist: 'Emilia', title: t, album })) ?? t, rel).toMatch(/\.mp3(?: \(Official Video\))?$/i)
  })
})

describe('punto 1 real: la carpeta del artista no se corta en la coma de un nombre que es uno solo', () => {
  const cache = (source: string, query: string, data: unknown) =>
    lib.db.prepare("INSERT INTO online_cache (source, query, status, data, looked_at) VALUES (?, ?, 'ok', ?, '2026-10-24')").run(source, query, JSON.stringify(data))
  const credit = (name: string) => [{ source: 'musicbrainz', title: 'x', length: 200, credit: [{ name, join: '' }], odd: true }]
  const lead = (name: string, title: string) => `r:${loose(name)}|${loose(title)}` // como la guardó la caché: con el nombre cortado
  const folder = (from: string) => dest(from)?.split('/')[1]

  it('"Earth, Wind & Fire", "Lipps, Inc." y "Tyler, The Creator", como los tiene MusicBrainz en la caché', () => {
    add('DISCOROCK/09 September.flac', { artist: 'Earth, Wind & Fire', title: 'September' })
    cache('musicbrainz', lead('Earth, Wind', 'September'), credit('Earth, Wind & Fire'))
    add('DISCOROCK/05. Lipps Inc. - Funkytown.flac', { artist: 'Lipps, Inc.', title: 'Funkytown' })
    cache('musicbrainz', 'a:lippsinc', [{ source: 'musicbrainz', id: 'x', name: 'Lipps, Inc.', score: 100, aliases: ['Lipps Inc.'] }])
    add('Rap/Tyler, The Creator feat. Lil Wayne - HOT WIND BLOWS.mp3', { artist: 'Tyler, The Creator feat. Lil Wayne', title: 'HOT WIND BLOWS' })
    // la búsqueda fue por "Tyler": Tyler, The Creator está con 83 de parecido, pero el nombre es ese
    cache('musicbrainz', 'a:tyler', [{ source: 'musicbrainz', id: 'b', name: 'Bonnie Tyler', score: 100, aliases: [] }, { source: 'musicbrainz', id: 't', name: 'Tyler, The Creator', score: 83, aliases: ['Tyler Okonma'] }])
    // Deezer y Discogs juntan a varios en un crédito: no cuentan
    add('Trap/C. Tangana, Toquinho - Comerte Entera.mp3', { artist: 'C. Tangana, Toquinho', title: 'Comerte Entera' })
    cache('discogs', recKey('C. Tangana, Toquinho', 'Comerte Entera'), [{ source: 'discogs', title: 'Comerte Entera', length: null, credit: [{ name: 'C. Tangana, Toquinho', join: '' }] }])
    cache('deezer', recKey('C. Tangana, Toquinho', 'Comerte Entera'), [{ source: 'deezer', id: '1', title: 'Comerte Entera', length: 200, credit: [{ name: 'C. Tangana, Toquinho', join: '' }], odd: false }])
    expect(folder('DISCOROCK/09 September.flac')).toBe('Earth, Wind & Fire')
    expect(folder('DISCOROCK/05. Lipps Inc. - Funkytown.flac')).toBe('Lipps, Inc') // Windows no deja una carpeta que termina en punto
    expect(folder('Rap/Tyler, The Creator feat. Lil Wayne - HOT WIND BLOWS.mp3')).toBe('Tyler, The Creator')
    expect(folder('Trap/C. Tangana, Toquinho - Comerte Entera.mp3')).toBe('C. Tangana')
  })

  it('sin internet: una carpeta tuya con ese nombre, o el artista del disco de temas con invitados', () => {
    add('Rock/Crosby, Stills & Nash/Suite Judy Blue Eyes.mp3', { artist: 'Crosby, Stills & Nash', title: 'Suite: Judy Blue Eyes' })
    for (const t of ['Lucky Man', 'Still... You Turn Me On'])
      add(`Prog/ELP/${t}.mp3`, { artist: 'Emerson, Lake & Palmer feat. Pete Sinfield', albumArtist: 'Emerson, Lake & Palmer', title: t, album: 'Works' })
    expect(folder('Rock/Crosby, Stills & Nash/Suite Judy Blue Eyes.mp3')).toBe('Crosby, Stills & Nash')
    expect(folder('Prog/ELP/Lucky Man.mp3')).toBe('Emerson, Lake & Palmer')
  })

  it('las listas se siguen cortando: "Charly García, Pedro Aznar", "Bizarrap, Duki, Nicki Nicole"; y la banda con un invitado', () => {
    add('Rock/Charly García - Demoliendo hoteles.mp3', { artist: 'Charly García', title: 'Demoliendo hoteles' })
    add('Rock/Pedro Aznar - A primera vista.mp3', { artist: 'Pedro Aznar', title: 'A primera vista' })
    add('Rock/Charly García, Pedro Aznar - Hablando a tu corazón.mp3', { artist: 'Charly García, Pedro Aznar', title: 'Hablando a tu corazón' })
    cache('musicbrainz', lead('Charly García', 'Hablando a tu corazón'), credit('Charly García, Pedro Aznar')) // aunque la fuente lo junte
    add('Trap/Bizarrap, Duki, Nicki Nicole - YaMeFui.mp3', { artist: 'Bizarrap, Duki, Nicki Nicole', title: 'YaMeFui' })
    add('Funk/Earth, Wind & Fire, Chaka Khan - Live.mp3', { artist: 'Earth, Wind & Fire, Chaka Khan', title: 'Live' })
    cache('musicbrainz', lead('Earth, Wind & Fire', 'Live'), credit('Earth, Wind & Fire'))
    expect(folder('Rock/Charly García, Pedro Aznar - Hablando a tu corazón.mp3')).toBe('Charly García')
    expect(folder('Trap/Bizarrap, Duki, Nicki Nicole - YaMeFui.mp3')).toBe('Bizarrap')
    expect(folder('Funk/Earth, Wind & Fire, Chaka Khan - Live.mp3')).toBe('Earth, Wind & Fire')
  })
})
