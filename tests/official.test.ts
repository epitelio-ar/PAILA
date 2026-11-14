// Tests de los nombres oficiales (core/official.ts): cuándo un nombre de internet se propone solo, cuándo queda para
// mirar a mano y cuándo no se toca. Sin internet: las respuestas de las fuentes están armadas a mano.
import { describe, expect, it } from 'vitest'
import { bestRec, completeCut, decideByPrint, decideTrack, relate, titleMatch, transferMarks, type Evidence } from '@paila/core/official'
import { bareTitle, creditText, discogsName, type ArtistHit, type RecHit } from '@paila/core/online/hits'

const rec = (source: RecHit['source'], artist: string, title: string, length: number | null, extra: Partial<RecHit> = {}): RecHit => ({ source, title, credit: [{ name: artist, join: '' }], length, ...extra })
const mbArtist = (name: string, aliases: string[] = [], score = 100): ArtistHit => ({ source: 'musicbrainz', id: `id-${name}`, name, score, aliases })
const t = (artist: string, title: string, duration: number | null = 200) => ({ id: 1, artist, title, duration })
const ev = (recs: Evidence['recs'], artists: ArtistHit[] = []): Evidence => ({ artists, recs })

describe('relación entre el nombre del usuario y el oficial', () => {
  it('reconoce el mismo nombre, el alias, el nombre incompleto y el mal escrito', () => {
    expect(relate('Alma Fuerte', 'Almafuerte')).toBe('same')
    expect(relate('Los Redondos', 'Patricio Rey y sus Redonditos de Ricota', ['Los Redondos', 'Redondos'])).toBe('alias')
    expect(relate('Balvin', 'J Balvin')).toBe('subset')
    expect(relate('The Weekend', 'The Weeknd')).toBe('typo')
    expect(relate('Led Zepelin', 'Led Zeppelin')).toBe('typo')
  })
  it('no confunde artistas distintos ni usa "Various Artists"', () => {
    expect(relate('Miranda', 'Miranda Lambert')).toBe('subset') // posible, pero necesita dos fuentes (ver abajo)
    expect(relate('Duki', 'Dua Lipa')).toBeNull()
    expect(relate('Varios', 'Various Artists')).toBeNull()
    expect(relate('Los Redondos', 'Tarea Fina')).toBeNull()
  })
})

describe('títulos', () => {
  it('compara sin signos, acentos, feat. ni "Remastered" de Deezer', () => {
    expect(titleMatch('Cuando Vendran', 'Cuando vendrán')).toBe('same')
    expect(titleMatch('Satisfaction', 'Satisfaction - Remastered 2011')).toBe('same')
    expect(titleMatch('La Original', 'La Original (feat. TINI)')).toBe('same')
    expect(titleMatch('Blinding Lights (Asi-C Dancehall Remix 2020)', 'Blinding Lights')).toBe('base')
    expect(titleMatch('Voy A Bailar A La Nave Del Olv', 'Voy a bailar a la nave del olvido')).toBe('cut')
    expect(titleMatch('Otra cosa', 'Tarea fina')).toBeNull()
    expect(bareTitle('Don’t Stop (Remastered 2011)')).toBe("Don't Stop")
  })
  it('pone los acentos respetando las mayúsculas del usuario', () => {
    expect(transferMarks('SE QUE NO SE', 'Sé que no sé')).toBe('SÉ QUE NO SÉ')
    expect(transferMarks('Cuando Vendran', 'Cuando vendrán')).toBe('Cuando Vendrán')
    expect(transferMarks('Dont', "Don't")).toBeNull()
  })
  it('completa un título cortado en 30 letras con el estilo del usuario', () => {
    expect(completeCut('Voy A Bailar A La Nave Del Olv', 'Voy a bailar a la nave del olvido')).toBe('Voy A Bailar A La Nave Del Olvido')
    expect(completeCut('Negra Mi Alma, Negro Mi Corazo', 'Negra mi alma, negro mi corazón')).toBe('Negra Mi Alma, Negro Mi Corazón')
  })
})

describe('decidir un tema', () => {
  it('"Balvin" → "J Balvin": una palabra sola completada necesita dos fuentes con la misma duración', () => {
    const one = decideTrack(t('Balvin', 'Mi Gente', 187), ev({ musicbrainz: [rec('musicbrainz', 'J Balvin', 'Mi Gente', 186)] }))
    expect(one.found).toEqual([])
    const ev2 = decideTrack(t('Enanitos Verdes', 'Lamento Boliviano', 222), ev({ deezer: [rec('deezer', 'Los Enanitos Verdes', 'Lamento Boliviano', 223)] }))
    expect(ev2.found).toEqual([expect.objectContaining({ field: 'artist', to: 'Los Enanitos Verdes', conf: 'media' })])
    const two = decideTrack(t('Balvin', 'Mi Gente', 187), ev({ musicbrainz: [rec('musicbrainz', 'J Balvin', 'Mi Gente', 186)], deezer: [rec('deezer', 'J Balvin', 'Mi Gente', 187)] }))
    expect(two.found[0]).toMatchObject({ field: 'artist', to: 'J Balvin', conf: 'alta' })
  })
  it('"Los Redondos" (alias de MusicBrainz) con el tema confirmado se propone; el feat. se conserva', () => {
    const d = decideTrack(t('Los Redondos feat. Skay', 'Tarea Fina', 210), ev({ musicbrainz: [rec('musicbrainz', 'Patricio Rey y sus Redonditos de Ricota', 'Tarea fina', 212)] }, [mbArtist('Patricio Rey y sus Redonditos de Ricota', ['Los Redondos'])]))
    expect(d.found).toEqual([expect.objectContaining({ field: 'artist', to: 'Patricio Rey y sus Redonditos de Ricota feat. Skay', conf: 'alta' }), expect.objectContaining({ field: 'title', to: 'Tarea fina' })])
  })
  it('"The Weekend" → "The Weeknd" necesita dos fuentes', () => {
    const one = decideTrack(t('The Weekend', 'Blinding Lights', 201), ev({ deezer: [rec('deezer', 'The Weeknd', 'Blinding Lights', 200)] }))
    expect(one.found[0]).toMatchObject({ to: 'The Weeknd', conf: 'media' })
    const two = decideTrack(t('The Weekend', 'Blinding Lights', 201), ev({ musicbrainz: [rec('musicbrainz', 'The Weeknd', 'Blinding Lights', 200)], deezer: [rec('deezer', 'The Weeknd', 'Blinding Lights', 200)] }))
    expect(two.found[0]).toMatchObject({ to: 'The Weeknd', conf: 'alta' })
  })
  it('las mayúsculas del artista cambian solo si MusicBrainz y Deezer lo escriben igual; los estilizados nunca', () => {
    expect(decideTrack(t('DUKI', 'Goteo'), ev({ musicbrainz: [rec('musicbrainz', 'Duki', 'Goteo', 200)] })).found).toEqual([])
    expect(decideTrack(t('DUKI', 'Goteo'), ev({ musicbrainz: [rec('musicbrainz', 'Duki', 'Goteo', 200)], deezer: [rec('deezer', 'Duki', 'Goteo', 199)] })).found[0]).toMatchObject({ to: 'Duki', conf: 'alta' })
    expect(decideTrack(t('CA7RIEL', 'Jala Jala'), ev({ musicbrainz: [rec('musicbrainz', 'Ca7riel', 'Jala Jala', 200)], deezer: [rec('deezer', 'Ca7riel', 'Jala Jala', 200)] })).found).toEqual([])
  })
  it('el título como lo escribe MusicBrainz (decidido el 20/10); con Deezer solo, acentos y las mayúsculas como vienen', () => {
    const d = decideTrack(t('La Renga', 'Cuando Vendran'), ev({ musicbrainz: [rec('musicbrainz', 'La Renga', 'Cuando vendrán', 201)] }))
    expect(d.found).toEqual([expect.objectContaining({ field: 'title', to: 'Cuando vendrán', conf: 'alta' })])
    expect(decideTrack(t('Callejeros', 'Tarea Fina'), ev({ musicbrainz: [rec('musicbrainz', 'Callejeros', 'Tarea fina', 200)] })).found).toEqual([expect.objectContaining({ field: 'title', to: 'Tarea fina', conf: 'alta' })])
    expect(decideTrack(t('La Renga', 'Cuando Vendran'), ev({ deezer: [rec('deezer', 'La Renga', 'Cuando vendrán', 201)] })).found).toEqual([expect.objectContaining({ field: 'title', to: 'Cuando Vendrán' })])
    expect(decideTrack(t('Callejeros', 'Tarea Fina'), ev({ deezer: [rec('deezer', 'Callejeros', 'Tarea fina', 200)] })).found).toEqual([])
    const a = decideTrack(t('Babasonicos', 'Irresponsables'), ev({ musicbrainz: [rec('musicbrainz', 'Babasónicos', 'Irresponsables', 200)] }))
    expect(a.found[0]).toMatchObject({ field: 'artist', to: 'Babasónicos', conf: 'alta' })
  })
  it('un vivo de 8 minutos no confirma el tema de estudio (la duración no coincide)', () => {
    expect(decideTrack(t('Balvin', 'Mi Gente', 187), ev({ musicbrainz: [rec('musicbrainz', 'J Balvin', 'Mi Gente', 480)], deezer: [rec('deezer', 'J Balvin', 'Mi Gente', 480)] })).found).toEqual([])
  })
  it('sin duración para comparar, lo que cambia el nombre queda para mirar a mano', () => {
    const d = decideTrack(t('Los Redondos', 'Ji Ji Ji', null), ev({ musicbrainz: [rec('musicbrainz', 'Patricio Rey y sus Redonditos de Ricota', 'Ji ji ji', 300)] }, [mbArtist('Patricio Rey y sus Redonditos de Ricota', ['Los Redondos'])]))
    expect(d.found[0]).toMatchObject({ conf: 'media' })
  })
  it('"…" del usuario es lo mismo que "..." de la base', () => {
    expect(decideTrack(t('Miranda!', 'Quereme… Tengo frío'), ev({ musicbrainz: [rec('musicbrainz', 'Miranda!', 'Quereme... Tengo frío', 200)] })).found).toEqual([])
  })
  it('"Various Artists" nunca es el artista; Discogs solo confirma el artista, no el título', () => {
    expect(decideTrack(t('Varios', 'Tema'), ev({ musicbrainz: [rec('musicbrainz', 'Various Artists', 'Tema', 200)] })).found).toEqual([])
    const d = decideTrack(t('Enanitos Verdes', 'Lamento Boliviano'), ev({ discogs: [rec('discogs', 'Los Enanitos Verdes', 'Lamento Boliviano', null, { titleFromQuery: true })] }))
    expect(d.found).toEqual([expect.objectContaining({ field: 'artist', to: 'Los Enanitos Verdes', conf: 'media' })])
  })
  it('si MusicBrainz y Deezer escriben distinto el título, queda para mirar (gana MusicBrainz)', () => {
    const d = decideTrack(t('Miranda!', 'Dejame', 186), ev({ musicbrainz: [rec('musicbrainz', 'Miranda!', 'Déjame', 186)], deezer: [rec('deezer', 'Miranda!', 'Dejame', 186)] }))
    expect(d.found).toEqual([expect.objectContaining({ field: 'title', to: 'Déjame', conf: 'media' })])
  })
  it('prefiere la grabación de estudio a la en vivo cuando las dos coinciden', () => {
    const p = bestRec(t('La Renga', 'El Final Es En Donde Partí'), [rec('musicbrainz', 'La Renga', 'El final es en donde partí', 200, { odd: true }), rec('musicbrainz', 'La Renga', 'El final es en donde partí', 201)], [])
    expect(p?.hit.odd).toBeFalsy()
  })
})

describe('textos de las fuentes', () => {
  it('feat. siempre igual en el crédito y sin numeración de homónimos de Discogs', () => {
    expect(creditText([{ name: 'Emilia', join: ' feat. ' }, { name: 'TINI', join: '' }])).toBe('Emilia feat. TINI')
    expect(creditText([{ name: 'Bizarrap', join: ' & ' }, { name: 'Quevedo', join: '' }])).toBe('Bizarrap & Quevedo')
    expect(creditText([{ name: 'A', join: ' ft. ' }, { name: 'B', join: '' }])).toBe('A feat. B')
    expect(discogsName('Daft Punk (2)')).toBe('Daft Punk')
    expect(discogsName('Prince*')).toBe('Prince')
  })
})

describe('reconocer por el sonido (AcoustID)', () => {
  const hit = (score: number, recs: RecHit[]) => ({ score, recordings: recs })
  it('un tema sin tags con una huella muy parecida se propone', () => {
    const f = decideByPrint({ artist: null, title: null, duration: 205 }, [hit(0.96, [rec('acoustid', 'Soda Stereo', 'De música ligera', 210), rec('acoustid', 'Soda Stereo', 'De Música Ligera', 209)])])
    expect(f).toEqual([expect.objectContaining({ field: 'artist', to: 'Soda Stereo', conf: 'alta' }), expect.objectContaining({ field: 'title', to: 'De música ligera', conf: 'alta' })])
  })
  it('si hay varios nombres posibles o no coincide con lo que tenía, queda para mirar a mano', () => {
    const two = decideByPrint({ artist: null, title: null, duration: 205 }, [hit(0.95, [rec('acoustid', 'A', 'Uno', 205), rec('acoustid', 'B', 'Dos', 205)])])
    expect(two.every((x) => x.conf === 'media')).toBe(true)
    const clash = decideByPrint({ artist: 'Otro', title: null, duration: 205 }, [hit(0.97, [rec('acoustid', 'Soda Stereo', 'Persiana americana', 205)])])
    expect(clash).toEqual([expect.objectContaining({ field: 'title', conf: 'media' })])
  })
  it('una huella poco parecida o de otra duración no sirve', () => {
    expect(decideByPrint({ artist: null, title: null, duration: 205 }, [hit(0.5, [rec('acoustid', 'A', 'Uno', 205)])])).toEqual([])
    expect(decideByPrint({ artist: null, title: null, duration: 205 }, [hit(0.95, [rec('acoustid', 'A', 'Uno', 400)])])).toEqual([])
  })
})
