// Lo que pidió el autor con el repaso de criterios del 24/10 (docs/pruebas/2026-10-24-repaso-criterios.md): que los tags rotos se
// arreglen solos en "Arreglar nombres y tags", como reglas generales. Los cuatro casos de su Música.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { OnlineCache } from '@paila/core/online/http'
import { officialFindings, recKey } from '@paila/core/official-findings'

let dir: string, lib: Library, rootId: number
const add = (rel: string, t: { artist?: string; albumArtist?: string; title?: string; track?: string }) =>
  Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, album_artist, title, track, probed_at) VALUES (?, ?, 1, 1, 'musica', 'mp3', 200, ?, ?, ?, ?, '2026-10-24')")
    .run(rootId, rel, t.artist ?? null, t.albumArtist ?? null, t.title ?? null, t.track ?? null).lastInsertRowid)
const proposed = () => {
  const { changes } = tidy(lib.db, ['filename'], () => null, rulesOf('oficial'))
  return (id: number) => Object.fromEntries(changes.filter((c) => c.id === id).map((c) => [c.field, c.to]))
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-nombres-repaso-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  rootId = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
})
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('repaso de criterios: tags rotos que se arreglan solos', () => {
  it('"05.Que" / "ves": el n.º de tema pegado al artista; el artista sale de la carpeta', () => {
    for (const t of ['Salir a asustar', 'Ala delta', 'El 38']) add(`Rock/Divididos/${t}.mp3`, { artist: 'Divididos', title: t })
    const id = add('Rock/Divididos/05.Que ves.mp3', { artist: '05.Que', title: 'ves' })
    expect(proposed()(id)).toMatchObject({ artist: 'Divididos', title: 'Que ves', track: '05' })
  })

  it('"152_Bee Gees": el número adelante del artista se va si lo que queda es un artista conocido', () => {
    add('Pop/Bee Gees - Tragedy.mp3', { artist: 'Bee Gees', title: 'Tragedy' })
    add('Pop/Bee Gees - Jive Talkin.mp3', { artist: 'Bee Gees', title: 'Jive Talkin' })
    const id = add("DISCOROCK/Bee Gees - Stayin' Alive.mp3", { artist: '152_Bee Gees', albumArtist: '152_Bee Gees', title: "Stayin' Alive" })
    expect(proposed()(id)).toMatchObject({ artist: 'Bee Gees', albumArtist: 'Bee Gees' })
    // "50 Cent" o "21 Savage" no: el número va con espacio y es parte del nombre
    const cent = add('Rap/50 Cent - In Da Club.mp3', { artist: '50 Cent', title: 'In Da Club' })
    expect(proposed()(cent).artist).toBeUndefined()
  })

  it('"Various Artists" con el título "Queen - Bohemian Rhapsody": se separan artista y título', () => {
    add('Rock/Queen - Under Pressure.mp3', { artist: 'Queen', title: 'Under Pressure' })
    add('Rock/Queen - Radio Ga Ga.mp3', { artist: 'Queen', title: 'Radio Ga Ga' })
    const id = add('set/017 - Queen - Bohemian Rhapsody.mp3', { artist: 'Various Artists', title: '017 - Queen - Bohemian Rhapsody' })
    expect(proposed()(id)).toMatchObject({ artist: 'Queen', title: 'Bohemian Rhapsody' })
  })

  it('un mail como artista: el artista sale del nombre del archivo, aunque separe con " -- "', () => {
    const id = add('CA2024/KONGA -- La Cabaña.Mp3', { artist: 'dj.ejemplo@correo.com', title: 'La Cabaña' })
    expect(proposed()(id)).toMatchObject({ artist: 'KONGA' })
  })
})

describe('repaso de criterios: un artista que cambió de nombre va como se publica hoy en las tiendas', () => {
  const put = (source: 'musicbrainz' | 'deezer', query: string, data: unknown) => new OnlineCache(lib.db).put(source, query, 'ok', data)
  const ye = [{ source: 'musicbrainz', id: '1', name: 'Ye', score: 100, aliases: ['Kanye West', 'Yeezy'] }]
  const rows = [{ id: 1, artist: 'Kanye West', title: "I'm So Apalled", duration: 111 }, { id: 2, artist: 'Kanye West', title: 'Gorgeus', duration: 358 }]

  it('"Kanye West": MusicBrainz dice "Ye", pero Deezer lo publica "Kanye West" (en otro tema tuyo): queda "Kanye West"', () => {
    put('musicbrainz', 'a:kanyewest', ye)
    put('musicbrainz', recKey('Kanye West', "I'm So Apalled"), [{ source: 'musicbrainz', title: "I'm So Apalled", length: 111, credit: [{ name: 'Ye', join: '' }], odd: false }])
    put('deezer', recKey('Kanye West', 'Gorgeus'), [{ source: 'deezer', id: '7', title: 'Gorgeous', length: 358, credit: [{ name: 'Kanye West', join: '' }], odd: false }])
    const f = officialFindings(lib.db, rows)
    expect([...f.values()].flat().filter((x) => x.field === 'artist')).toEqual([])
  })

  it('sin Deezer, el nombre de MusicBrainz (como antes); con Deezer y las mismas letras, manda MusicBrainz ("No Te Va Gustar")', () => {
    put('musicbrainz', 'a:kanyewest', ye)
    put('musicbrainz', recKey('Kanye West', "I'm So Apalled"), [{ source: 'musicbrainz', title: "I'm So Apalled", length: 111, credit: [{ name: 'Ye', join: '' }], odd: false }])
    expect(officialFindings(lib.db, rows.slice(0, 1)).get(1)?.find((x) => x.field === 'artist')?.to).toBe('Ye')
    put('musicbrainz', 'a:ntvg', [{ source: 'musicbrainz', id: '2', name: 'No Te Va Gustar', score: 100, aliases: ['NTVG'] }])
    put('musicbrainz', recKey('NTVG', 'En la cara'), [{ source: 'musicbrainz', title: 'En la cara', length: 200, credit: [{ name: 'No Te Va Gustar', join: '' }], odd: false }])
    put('deezer', recKey('NTVG', 'En la cara'), [{ source: 'deezer', id: '3', title: 'En la cara', length: 200, credit: [{ name: 'No te va Gustar', join: '' }], odd: false }])
    expect(officialFindings(lib.db, [{ id: 3, artist: 'NTVG', title: 'En la cara', duration: 200 }]).get(3)?.find((x) => x.field === 'artist')?.to).toBe('No Te Va Gustar')
  })
})
