// Tests de acciones sobre tags (core/tagactions.ts): reemplazar texto, mayúsculas, numerar y pasar nombre a tags.
import { describe, expect, it } from 'vitest'
import { tagsToFileName, caseAction, changeCase, fileNameToTags, fixMojibake, folderToTags, numberTracks, parsePattern, replaceText, youtubeClean, type TrackLike } from '@paila/core/tagactions'

const T = (id: number, rel: string, o: Partial<TrackLike> = {}): TrackLike => ({ id, rel, title: null, artist: null, albumArtist: null, album: null, track: null, year: null, genre: null, ...o })

describe('acciones de tags', () => {
  it('reemplaza texto literal y con regex, sin tocar lo que no cambia', () => {
    const r = replaceText([T(1, 'a.mp3', { title: 'Tema [HD]' }), T(2, 'b.mp3', { title: 'Otro' })], 'title', '[HD]', '')
    expect(r).toEqual([{ id: 1, field: 'title', value: 'Tema' }])
    expect(replaceText([T(1, 'a', { title: 'a_b_c' })], 'title', '_', ' ')[0].value).toBe('a b c')
    expect(replaceText([T(1, 'a', { title: 'Tema 123' })], 'title', String.raw`\s*\d+$`, '', { regex: true })[0].value).toBe('Tema')
  })
  it('mayúsculas tipo título', () => {
    expect(changeCase('la vida de los GATOS y el mar', 'title')).toBe('La Vida de los Gatos y el Mar')
    expect(changeCase('HOLA MUNDO', 'sentence')).toBe('Hola mundo')
    expect(caseAction([T(1, 'a', { title: 'ya Está' })], 'title', 'upper')[0].value).toBe('YA ESTÁ')
  })
  it('numera en el orden recibido', () => {
    expect(numberTracks([T(1, 'a'), T(2, 'b'), T(3, 'c', { track: '3' })], { pad: true })).toEqual([
      { id: 1, field: 'track', value: '01' }, { id: 2, field: 'track', value: '02' },
    ])
  })
  it('arregla caracteres rotos y deja en paz lo sano', () => {
    expect(fixMojibake('GarcÃ­a')).toBe('García')
    expect(fixMojibake('NiÃ±o')).toBe('Niño')
    expect(fixMojibake('García')).toBe('García')
    expect(fixMojibake('Ã')).toBe('Ã')
  })
  it('limpieza de YouTube', () => {
    const r = youtubeClean([T(1, 'x.opus', { title: 'La Renga - Hablando de la Libertad (Official Video) [HD]' }), T(2, 'y.m4a', { title: 'Tema_raro www.sitio.com' })])
    expect(r).toContainEqual({ id: 1, field: 'artist', value: 'La Renga' })
    expect(r).toContainEqual({ id: 1, field: 'title', value: 'Hablando de la Libertad' })
    expect(r).toContainEqual({ id: 2, field: 'title', value: 'Tema raro' })
    expect(youtubeClean([T(3, 'Carpeta/01 Uno [HD].mp3')])).toEqual([{ id: 3, field: 'title', value: 'Uno' }])
  })
  it('tags → nombre de archivo', () => {
    const t = T(1, 'x/a.mp3', { track: '7', artist: 'Los Gardelitos', title: 'Mezclas: Raras?' })
    expect(tagsToFileName([t, T(2, 'x/b.mp3', { title: 'Sin artista' })], '%n% - %artista% - %titulo%')).toEqual([{ id: 1, field: 'filename', value: '07 - Los Gardelitos - Mezclas_ Raras_' }])
  })
  it('nombre de archivo → tag y carpeta → tag', () => {
    expect(parsePattern('Carpeta/La Mona Jimenez 11-Soy Argentino.opus', '%artista% %n%-%titulo%')).toEqual({ artist: 'La Mona Jimenez', track: '11', title: 'Soy Argentino' })
    expect(parsePattern('x/otra cosa.mp3', '%n% - %titulo%')).toBeNull()
    expect(() => parsePattern('a.mp3', '%foo%')).toThrow()
    expect(fileNameToTags([T(1, '07 - Mezclas Raras.flac', { title: 'Mezclas Raras' })], '%n% - %titulo%')).toEqual([{ id: 1, field: 'track', value: '07' }])
    expect(folderToTags([T(1, 'Los Gardelitos/2008 - Oxigeno/01.mp3')])).toEqual([
      { id: 1, field: 'album', value: 'Oxigeno' }, { id: 1, field: 'year', value: '2008' }, { id: 1, field: 'artist', value: 'Los Gardelitos' },
    ])
  })
})
