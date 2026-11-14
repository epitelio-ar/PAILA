// Lo que pidió el autor con el repaso de criterios del 24/10 en Tapas (docs/pruebas/2026-10-24-repaso-criterios.md): de varios
// discos de Deezer con el mismo nombre, el que tiene tus temas y tu año; y un artista que contiene al tuyo no es el tuyo. Y del
// punto 1 real: un compilado con nombre genérico pide temas o año.
import { describe, expect, it } from 'vitest'
import { albumMatch, pickByTracks, type DeezerAlbum, type DeezerAlbumInfo } from '@paila/core/covers'
import type { AlbumGroup } from '@paila/core/albums'

const group = (artist: string, album: string, year: string | null, titles: string[]): AlbumGroup => ({
  key: 'k', dir: 'd', artist, album, year, ownFolder: true, checkable: true, various: false,
  tracks: titles.map((t, i) => ({ id: i + 1, rel: `d/${t}.mp3`, title: t, artist, track: i + 1, disc: 1, duration: 200, ext: 'mp3' })),
})
const album = (id: number, title: string, artist: string): DeezerAlbum => ({ id, title, artist: { name: artist }, cover_xl: `https://x/${id}.jpg` })
const info = (byId: Record<number, DeezerAlbumInfo>) => async (id: number) => byId[id] ?? null

describe('repaso de criterios: Tapas', () => {
  it('"Luis Miguel del Amargue" no es "Luis Miguel"; "Robert Glasper Experiment" quizás (vale si el disco tiene tus temas)', () => {
    const g = group('Luis Miguel', 'Grandes Éxitos', '1987', ['Cuando Calienta El Sol'])
    expect(albumMatch(g, 'Luis Miguel del Amargue', 'Grandes Éxitos')).toBe('quizas')
    expect(albumMatch(g, 'Luis Miguel', 'Grandes Éxitos')).toBe('si')
    expect(albumMatch(group('Wisin', 'X', null, []), 'Wisin & Yandel', 'X')).toBe('si') // un invitado sí
    expect(albumMatch(g, 'Luis Miguel', 'Grandes Éxitos II')).toBeNull()
  })

  it('el "quizás" sin ninguno de tus temas queda afuera (era la tapa de otro artista)', async () => {
    const g = group('Luis Miguel', 'Grandes Éxitos', '1987', ['Cuando Calienta El Sol', 'Será Que No Me Amas'])
    const otro = album(1, 'Grandes Éxitos', 'Luis Miguel del Amargue')
    const got = await pickByTracks(g, [otro], info({ 1: { release_date: '2015-01-01', tracks: { data: [{ title: 'Ella No Es Para Ti' }] } } }), new Set([otro]))
    expect(got).toBeUndefined()
    // "Robert Glasper Experiment — Black Radio" tiene tus temas: vale
    const bg = group('Robert Glasper', 'Black Radio', '2012', ['Afro Blue'])
    const exp = album(2, 'Black Radio', 'Robert Glasper Experiment')
    expect(await pickByTracks(bg, [exp], info({ 2: { release_date: '2012-02-27', tracks: { data: [{ title: 'Afro Blue' }] } } }), new Set([exp]))).toBe(exp)
  })

  it('de varios con el mismo nombre: más temas tuyos, después tu año, después el de menos temas que no son tuyos', async () => {
    // "Safari" de Miranda!: un simple de 2026 con un tema contra el disco de 2014
    const safari = group('Miranda!', 'Safari', '2014', ['Navidad', 'Fantasmas'])
    const simple = album(1, 'Safari', 'Miranda!'), disco = album(2, 'Safari', 'Miranda!')
    expect(await pickByTracks(safari, [simple, disco], info({ 1: { release_date: '2026-01-01', tracks: { data: [{ title: 'Safari' }] } }, 2: { release_date: '2014-05-01', tracks: { data: [{ title: 'Navidad' }, { title: 'Fantasmas' }, { title: 'Safari' }] } } }))).toBe(disco)
    // "Pet Sounds": la de 1966 antes que la de 2023 (mismos temas) y que la de los 50 años
    const pet = group('The Beach Boys', 'Pet Sounds', '1966', ['Wouldn\'t It Be Nice', 'Sloop John B'])
    const tracks = { data: [{ title: 'Wouldn\'t It Be Nice' }, { title: 'Sloop John B' }] }
    const a50 = album(3, 'Pet Sounds (50th Anniversary Edition)', 'The Beach Boys'), a23 = album(4, 'Pet Sounds', 'The Beach Boys'), a66 = album(5, 'Pet Sounds', 'The Beach Boys')
    expect(await pickByTracks(pet, [a50, a23, a66], info({ 3: { release_date: '2016-06-10', tracks: { data: [...tracks.data, { title: 'Hang On To Your Ego' }] } }, 4: { release_date: '2023-01-01', tracks }, 5: { release_date: '1966-05-16', tracks } }))).toBe(a66)
    // "Appetite for Destruction": la Super Deluxe trae también la versión en vivo de un tema tuyo; cuenta una vez y gana la de 12
    const afd = group("Guns N' Roses", 'Appetite for Destruction', '1987', ['Welcome to the Jungle', 'Paradise City'])
    const std = album(6, 'Appetite For Destruction', "Guns N' Roses"), sd = album(7, 'Appetite For Destruction (Super Deluxe Edition)', "Guns N' Roses")
    expect(await pickByTracks(afd, [std, sd], info({
      6: { release_date: '2018-06-29', tracks: { data: [{ title: 'Welcome To The Jungle' }, { title: 'Paradise City' }, { title: 'Think About You' }] } },
      7: { release_date: '2018-06-29', tracks: { data: [{ title: 'Welcome To The Jungle' }, { title: 'Paradise City' }, { title: 'Think About You' }, { title: 'Welcome To The Jungle (Live)' }, { title: 'Shadow Of Your Love' }] } },
    }))).toBe(std)
    // sin datos para decidir, el primero (como antes)
    expect(await pickByTracks(afd, [std, sd], info({}))).toBe(std)
  })

  it('un compilado "Varios Artistas" con nombre genérico pide alguno de tus temas o tu año (punto 1 real: "Reggaeton Classics")', async () => {
    const g = { ...group('Varios Artistas', 'Reggaeton Classics', '2022', ['Abusadora', 'Es un Secreto']), various: true }
    const otro = album(1, 'Reggaeton Classics', 'Jam and Suppose')
    const ninguno = { release_date: '2019-03-01', tracks: { data: [{ title: 'Gasolina' }] } }
    expect(await pickByTracks(g, [otro], info({ 1: ninguno }), new Set([otro]))).toBeUndefined() // ni temas ni año: queda sin tapa
    expect(await pickByTracks(g, [otro], info({ 1: { ...ninguno, release_date: '2022-06-01' } }), new Set([otro]))).toBe(otro) // tu año
    expect(await pickByTracks(g, [otro], info({ 1: { ...ninguno, tracks: { data: [{ title: 'Abusadora' }] } } }), new Set([otro]))).toBe(otro) // un tema tuyo
  })
})
