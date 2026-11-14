// Casos de la corrida supervisada del Organizador del 20/10/2026 sobre la biblioteca real (docs/archivo/pruebas/2026-10-20-organizar.md).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { DEFAULT_RULE, Organizer, mainArtist, targetFor, type TagRow } from '@paila/core/organizer'

const opts = { rule: DEFAULT_RULE, dest: 'Biblioteca' }
const row = (o: Partial<TagRow>): TagRow => ({ id: 1, rootId: 1, rel: 'x.mp3', ext: 'mp3', kind: 'musica', artist: 'La Renga', albumArtist: null, title: 'Tema', album: null, track: null, year: null, genre: null, ...o })

describe('Organizador: cómo arma cada carpeta', () => {
  it('la carpeta del artista es el principal, sin invitados', () => {
    expect(mainArtist('Beyoncé feat. JAY Z')).toBe('Beyoncé')
    expect(mainArtist('Bizarrap, Lalo Ebratt')).toBe('Bizarrap')
    expect(mainArtist('Wisin & Yandel')).toBe('Wisin & Yandel')
    expect(targetFor(row({ artist: 'Beyoncé feat. JAY Z', title: 'Crazy In Love' }), opts)).toBe('Biblioteca/Beyoncé/Crazy In Love.mp3')
  })
  it('un tema sin álbum va directo a la carpeta del artista, aunque tenga año (no "2021 - Sueltos")', () => {
    expect(targetFor(row({ year: '2021' }), opts)).toBe('Biblioteca/La Renga/Tema.mp3')
  })
  it('reconoce más formas de "Varios Artistas"', () => {
    for (const va of ['Artisti Vari', 'V_A', 'VA', 'Various Artists']) {
      expect(targetFor(row({ albumArtist: va, album: 'Compilado', artist: 'Otro' }), opts)).toBe('Biblioteca/Varios Artistas/Compilado/Tema.mp3')
    }
  })
  it('"Unknown Artist", "Artista sconosciuto" o un álbum que es una página cuentan como vacíos', () => {
    expect(targetFor(row({ artist: 'Artista sconosciuto' }), opts)).toBeNull()
    expect(targetFor(row({ album: 'www.htrk.org' }), opts)).toBe('Biblioteca/La Renga/Tema.mp3')
    expect(targetFor(row({ album: 'http___vk.com_usuario', year: '2017' }), opts)).toBe('Biblioteca/La Renga/Tema.mp3')
    expect(targetFor(row({ album: 'Album' }), opts)).toBe('Biblioteca/La Renga/Tema.mp3')
    expect(targetFor(row({ albumArtist: '[Www.FlowCumbiero.Com.Ar]', artist: 'De La Calle' }), opts)).toBe('Biblioteca/De La Calle/Tema.mp3')
  })
})

describe('Organizador: una sola carpeta por artista aunque los tags lo escriban distinto', () => {
  let dir: string
  let db: Db
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-org2-'))
    db = openDb(path.join(dir, 'paila.db'))
    db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', 'X', ?)").run(dir)
    db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, '', '2026-10-20')").run()
    const add = (id: number, rel: string, artist: string, title: string, album: string | null = null) =>
      db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, artist, title, album) VALUES (?, 1, ?, 1, 0, 'musica', 'mp3', ?, ?, ?)").run(id, rel, artist, title, album)
    add(1, 'a.mp3', 'El Bordo', 'Uno', 'Yacanto'); add(2, 'b.mp3', 'El Bordo', 'Dos', 'yacanto'); add(3, 'c.mp3', 'el bordo', 'Tres')
    add(4, 'd.mp3', 'La Mona Jiménez', 'Cuatro'); add(5, 'e.mp3', 'La Mona Jimenez', 'Cinco'); add(6, 'f.mp3', 'La Mona Jiménez', 'Seis')
    add(7, 'g.mp3', 'Miranda!', 'Siete'); add(8, 'h.mp3', 'Miranda!', 'Ocho'); add(9, 'i.mp3', 'Miranda', 'Nueve')
  })
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('usa la forma más común y no la que está toda en minúscula; los nombres de archivo no cambian de artista', () => {
    const p = new Organizer(db, () => dir).plan(opts)
    const to = (id: number) => p.moves.find((m) => m.fileId === id)!.to
    expect(to(3)).toBe('Biblioteca/El Bordo/Tres.mp3')
    expect(to(2)).toBe('Biblioteca/El Bordo/Yacanto/Dos.mp3') // el disco también se escribe igual
    expect(to(5)).toBe('Biblioteca/La Mona Jiménez/Cinco.mp3')
    expect(to(9)).toBe('Biblioteca/Miranda!/Nueve.mp3')
    const folders = new Set(p.moves.map((m) => m.to.split('/')[1]))
    expect([...folders].sort()).toEqual(['El Bordo', 'La Mona Jiménez', 'Miranda!'])
  })
})

// Decisiones sobre la corrida supervisada (20/10/2026): "un solo tema de un disco: puede ser directo dentro del
// artista", y los sets largos no se organizan como temas (docs/archivo/pruebas/2026-10-20-organizar.md, "Después de las decisiones").
describe('Organizador: carpeta de disco solo con 2 temas o más; los sets no se organizan', () => {
  let dir: string
  let db: Db
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-org3-'))
    db = openDb(path.join(dir, 'paila.db'))
    db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', 'X', ?)").run(dir)
    db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, '', '2026-10-20')").run()
    const add = (id: number, rel: string, o: { artist?: string; title?: string; album?: string; year?: string; track?: string; albumArtist?: string; duration?: number }) =>
      db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, artist, title, album, year, track, album_artist, duration) VALUES (?, 1, ?, 1, 0, 'musica', 'mp3', ?, ?, ?, ?, ?, ?, ?)")
        .run(id, rel, o.artist ?? null, o.title ?? null, o.album ?? null, o.year ?? null, o.track ?? null, o.albumArtist ?? null, o.duration ?? 200)
    // un tema solo de "Barrio Fino": directo en Daddy Yankee/
    add(1, 'x/gasolina.mp3', { artist: 'Daddy Yankee', title: 'Gasolina', album: 'Barrio Fino', year: '2004', track: '5' })
    // dos temas del mismo disco, uno sin año: una sola carpeta "2004 - inFame"
    add(2, 'x/irresponsables.mp3', { artist: 'Babasónicos', title: 'Irresponsables', album: 'inFame', track: '1' })
    add(3, 'x/putita.mp3', { artist: 'Babasónicos', title: 'Putita', album: 'inFame', year: '2004', track: '5' })
    // un compilado del que hay un solo tema: con su artista, no en "Varios Artistas"
    add(4, 'x/karma.mp3', { artist: 'Culture Club', title: 'Karma Chameleon', album: 'NOW 1', albumArtist: 'Various Artists', track: '9' })
    // el mismo título de dos discos distintos: cada uno en la carpeta de su disco antes que "(2)"
    add(5, 'x/believe1.mp3', { artist: 'Cher', title: 'Believe', album: 'Believe', year: '1998' })
    add(6, 'x/believe2.mp3', { artist: 'Cher', title: 'Believe', album: 'Greatest Hits', year: '2003' })
    // sets largos: con los tags inventados del 19/10 armarían "ENGANCHADO PREVIA #19 _ SET LIVE/"; no se organizan
    add(7, 'Pendrive/ENGANCHADO PREVIA #19 _ SET LIVE - DJ Sol (1).mp3', { artist: 'ENGANCHADO PREVIA #19 _ SET LIVE', title: 'DJ Sol (1)', duration: 28 * 60 })
    add(8, 'Recitales/Entrevista Rock&Pop.mp3', { artist: 'Patricio Rey', title: 'Entrevista', duration: 89 * 60 })
    // largo pero sin palabras de set (y menos de 40 minutos): es un tema ("Echoes" dura 24 minutos)
    add(9, 'Rock/echoes.mp3', { artist: 'Pink Floyd', title: 'Echoes', duration: 24 * 60 })
    // de la vista previa del 20/10: "VA" como artista de un tema suelto, el ";" de algunos programas y "/" en el artista
    add(10, 'x/penn.mp3', { artist: 'VA', title: 'Penn, Dawn _ You Dont Love Me', album: 'DJ Classics Hits 53', albumArtist: 'VA' })
    add(11, 'x/ventanita.mp3', { artist: 'Daniel Agostini;Grupo Sombras', title: 'La Ventanita', album: 'La Movida Tropical', albumArtist: 'Varios' })
    add(12, 'x/ouke.mp3', { artist: 'Ca7riel/Paco Amoroso', title: 'OUKE' }); add(13, 'x/cono.mp3', { artist: 'Ca7riel/Paco Amoroso', title: 'Cono hielo' })
    add(14, 'x/amino.mp3', { artist: 'ca7riel & Paco Amoroso', title: 'A Mí No' })
  })
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('un tema solo de un disco (o sin disco) va directo al artista, sin n.º; con 2 o más se arma la carpeta del disco', () => {
    const p = new Organizer(db, () => dir).plan(opts)
    const to = (id: number) => p.moves.find((m) => m.fileId === id)?.to
    expect(to(1)).toBe('Biblioteca/Daddy Yankee/Gasolina.mp3')
    expect(to(2)).toBe('Biblioteca/Babasónicos/2004 - inFame/01 - Irresponsables.mp3') // el año del disco, aunque este tema no lo tenga
    expect(to(3)).toBe('Biblioteca/Babasónicos/2004 - inFame/05 - Putita.mp3')
    expect(to(4)).toBe('Biblioteca/Culture Club/Karma Chameleon.mp3')
    expect([to(5), to(6)].sort()).toEqual(['Biblioteca/Cher/2003 - Greatest Hits/Believe.mp3', 'Biblioteca/Cher/Believe.mp3'])
    expect(p.conflicts).toBe(0)
    expect(to(9)).toBe('Biblioteca/Pink Floyd/Echoes.mp3')
  })

  it('ni "VA" ni "Ca7riel_Paco Amoroso" como carpeta de artista; el ";" separa artistas', () => {
    const p = new Organizer(db, () => dir).plan(opts)
    const to = (id: number) => p.moves.find((m) => m.fileId === id)?.to
    expect(to(10)).toBe('Biblioteca/Varios Artistas/DJ Classics Hits 53/Penn, Dawn _ You Dont Love Me.mp3')
    expect(to(11)).toBe('Biblioteca/Daniel Agostini/La Ventanita.mp3')
    expect(new Set([to(12), to(13), to(14)].map((x) => x!.split('/')[1]))).toEqual(new Set(['ca7riel & Paco Amoroso']))
  })

  it('los sets largos se saltean con el motivo: no se les arma "Artista/Título"', () => {
    const p = new Organizer(db, () => dir).plan(opts)
    expect(p.moves.some((m) => m.fileId === 7 || m.fileId === 8)).toBe(false)
    expect(p.skipped.find((s) => s.fileId === 7)?.reason).toMatch(/Dura 28 minutos y el nombre dice "enganchado".*Sets y en vivo/)
    expect(p.skipped.find((s) => s.fileId === 8)?.reason).toMatch(/Dura 89 minutos/)
  })
})
