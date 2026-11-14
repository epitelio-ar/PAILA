// Lo que encontró el repaso de criterios del 24/10 en Organizar (docs/pruebas/2026-10-24-repaso-criterios.md), con los nombres de
// la Música real: temas sueltos escondidos en "Varios Artistas", el mismo dúo en dos carpetas y páginas o mails como artista.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'
import { OnlineCache } from '@paila/core/online/http'
import { loose } from '@paila/core/names'
import { recKey } from '@paila/core/official-findings'

let dir: string, lib: Library, rootId: number
const add = (rel: string, t: { artist?: string; albumArtist?: string; title?: string; album?: string; track?: string; year?: string }) =>
  lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, album_artist, title, album, track, year, probed_at) VALUES (?, ?, 1, 1, 'musica', 'mp3', 200, ?, ?, ?, ?, ?, ?, '2026-10-24')")
    .run(rootId, rel, t.artist ?? null, t.albumArtist ?? null, t.title ?? null, t.album ?? null, t.track ?? null, t.year ?? null)
const plan = () => new Organizer(lib.db, () => path.join(dir, 'M')).plan({ rule: DEFAULT_RULE, dest: 'Biblioteca' })
const dest = (from: string) => plan().moves.find((m) => m.from === from)?.to

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-org-repaso-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  rootId = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
})
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('repaso de criterios: Organizar', () => {
  it('dos temas sueltos que de tag traen el mismo compilado van con su artista, no a "Varios Artistas"', () => {
    const comp = { albumArtist: 'Various Artists', album: "Saturday Night Party 80's", year: '2021' }
    add('DISCO CUMPLE/DISCOROCK/DISCOROCK 1/20. Bee Gees - Stayin Alive.mp3', { ...comp, artist: 'Bee Gees', title: 'Stayin Alive', track: '20' })
    add("DISCO CUMPLE/set diciembre/15. ABBA - Gimme! Gimme! Gimme!.mp3", { ...comp, artist: 'ABBA', title: 'Gimme! Gimme! Gimme!', track: '15' })
    for (let i = 0; i < 6; i++) add(`DISCO CUMPLE/set diciembre/Otro ${i} - Tema ${i}.mp3`, { artist: `Otro ${i}`, title: `Tema ${i}` })
    expect(dest('DISCO CUMPLE/DISCOROCK/DISCOROCK 1/20. Bee Gees - Stayin Alive.mp3')).toBe('Biblioteca/Bee Gees/Stayin Alive.mp3')
    expect(dest('DISCO CUMPLE/set diciembre/15. ABBA - Gimme! Gimme! Gimme!.mp3')).toBe('Biblioteca/ABBA/Gimme! Gimme! Gimme!.mp3')
  })

  it('un compilado que está junto en su carpeta sigue yendo a "Varios Artistas"', () => {
    const comp = { albumArtist: 'Various Artists', album: 'The Year Of The Conga', year: '2019' }
    for (const [n, t] of [['01', 'Aee'], ['02', 'Another Day'], ['03', 'Beat'], ['04', 'Red Eye']])
      add(`Electronica/Tech/Conguero/VA - The Year Of The Conga/Guti - ${t} (Original Mix).aiff`, { ...comp, artist: 'Guti', title: `${t} (Original Mix)`, track: n })
    const p = plan()
    expect(p.moves.map((m) => m.to.split('/').slice(1, 3).join('/'))).toEqual(Array(4).fill('Varios Artistas/2019 - The Year Of The Conga'))
  })

  it('"Wisin & Yandel" y "Wisin Y Yandel", "Ángel & Khriz" y "Angel y Khriz": una sola carpeta', () => {
    add('set/07 - Wisin & Yandel - Sexy Movimiento.mp3', { artist: 'Wisin & Yandel', title: 'Sexy Movimiento' })
    add('set/47. Wisin & Yandel - Abusadora.mp3', { artist: 'Wisin & Yandel', title: 'Abusadora' })
    add('Chengue/14 Besos Mojados.mp3', { artist: 'Wisin Y Yandel', title: 'Besos Mojados' })
    // los de un compilado (GTA IV) que van sueltos votan con el artista del tema
    add('set/09 - Angel & Khriz - Ven Bailalo.flac', { artist: 'Ángel & Khriz', albumArtist: 'Various Artists', album: 'Grand Theft Auto IV: San Juan Sounds', title: 'Ven Baílalo' })
    add('set/02 - Angel & Khriz - Na de na.flac', { artist: 'Ángel & Khriz feat. Gocho', albumArtist: 'Various Artists', album: 'Grand Theft Auto: The Ballad of Gay Tony', title: "Na' de na'" })
    add('set/Angel y Khriz - Ven Bailalo - Reggaeton Mix [www.slider.kz].mp3', { artist: 'Angel y Khriz', title: 'Ven Bailalo (Reggaeton Mix)' })
    const folders = new Set(plan().moves.map((m) => m.to.split('/')[1]))
    expect(folders).toEqual(new Set(['Ángel & Khriz', 'Wisin & Yandel']))
  })

  it('un mail o una página como artista no arma carpeta; "Various Artists" va a "Varios Artistas"', () => {
    add('CA2024/KONGA -- La Cabaña.Mp3', { artist: 'dj.ejemplo@correo.com', title: 'La Cabaña', album: 'Perico- Jujuy' })
    add('Chengue/Los Turros - Hasta que el sol salga.mp3', { artist: 'Los Turros', albumArtist: 'www.delirandocumbia.ya.st', title: 'Hasta que el sol salga' })
    add('80s90s/Hard Drive - Deep Inside [www.slider.kz].mp3', { artist: 'Hard Drive', albumArtist: 'vk.com/RealDJingNN', title: 'Deep Inside' })
    add('set/017 - Queen - Bohemian Rhapsody.mp3', { artist: 'Various Artists', title: 'Queen - Bohemian Rhapsody', album: 'Bacobens Rock Top 500' })
    const p = plan()
    expect(p.skipped.map((s) => s.rel)).toContain('CA2024/KONGA -- La Cabaña.Mp3')
    expect(new Set(p.moves.map((m) => m.to.split('/')[1]))).toEqual(new Set(['Los Turros', 'Hard Drive', 'Varios Artistas']))
  })
})

describe('repaso de criterios: lo que contestó el autor (24/10)', () => {
  const mb = (name: string, hit: string) => new OnlineCache(lib.db).put('musicbrainz', `a:${loose(name)}`, 'ok', [{ source: 'musicbrainz', id: '1', name: hit, score: 100, aliases: [] }])
  const folders = () => new Set(plan().moves.map((m) => m.to.split('/')[1]))

  it('la carpeta va con el nombre oficial y sus mayúsculas (MusicBrainz): "ABBA", aunque tus tags digan "Abba"', () => {
    mb('Abba', 'ABBA')
    add('DISCOROCK/02 - Dancing Queen.flac', { artist: 'Abba', title: 'Dancing Queen' })
    expect(folders()).toEqual(new Set(['ABBA']))
  })

  it('con otras letras o signos puede ser otro artista: "C.R.O" no pasa a "CRO"', () => {
    mb('C.R.O', 'CRO')
    add('Trap/C.R.O - Pinta.mp3', { artist: 'C.R.O', title: 'Pinta' })
    expect(folders()).toEqual(new Set(['C.R.O']))
  })

  it('si Deezer lo publica con otras mayúsculas, no hay forma oficial clara: queda la tuya', () => {
    mb('Se Va El Camello', 'Se va el camello')
    new OnlineCache(lib.db).put('deezer', recKey('Se Va El Camello', 'Diagonales'), 'ok', [{ source: 'deezer', id: '2', title: 'Diagonales', length: 200, credit: [{ name: 'Se Va El Camello', join: '' }], odd: false }])
    add('Rock/Se Va El Camello/Diagonales.mp3', { artist: 'Se Va El Camello', title: 'Diagonales' })
    expect(folders()).toEqual(new Set(['Se Va El Camello']))
  })

  it('lo oficial no baja un "DJ": "DJ Peligro" no pasa a "Dj Peligro"', () => {
    mb('DJ Peligro', 'Dj Peligro')
    add('cumbia/DJ Peligro - Candy Perreo.mp3', { artist: 'DJ Peligro', title: 'Candy Perreo' })
    expect(folders()).toEqual(new Set(['DJ Peligro']))
  })

  it('una colaboración de uno o dos temas va a la carpeta del primer artista si tiene más temas; un dúo estable, no', () => {
    for (const t of ['Los dinosaurios', 'Demoliendo hoteles', 'Rezo por vos']) add(`Rock/Charly García/${t}.mp3`, { artist: 'Charly García', title: t })
    add('CA2024/Hablando a tu corazón.flac', { artist: 'Charly García & Pedro Aznar', title: 'Hablando a tu corazón' })
    for (const t of ['Rakata', 'Abusadora', 'Sexy Movimiento']) add(`set/${t}.mp3`, { artist: 'Wisin & Yandel', title: t })
    add('set/Wisin - Escapate Conmigo.mp3', { artist: 'Wisin', title: 'Escapate Conmigo' })
    expect(folders()).toEqual(new Set(['Charly García', 'Wisin & Yandel', 'Wisin']))
  })
})
