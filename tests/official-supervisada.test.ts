// Casos de la corrida supervisada de nombres oficiales del 20/10/2026 (docs/archivo/pruebas/2026-10-20-nombres-oficiales.md):
// cada uno es una propuesta equivocada que se vio con respuestas reales de MusicBrainz y Deezer y no tiene que volver.
import { describe, expect, it } from 'vitest'
import { decideByPrint, decideTrack, dropsMarks, titleMatch, type Evidence } from '@paila/core/official'
import type { ArtistHit, RecHit } from '@paila/core/online/hits'

const rec = (source: RecHit['source'], artist: string, title: string, length: number | null): RecHit => ({ source, title, credit: [{ name: artist, join: '' }], length })
const t = (artist: string, title: string, duration: number | null = 200) => ({ id: 1, artist, title, duration })
const dz = (artist: string, title: string, len = 200): Evidence => ({ artists: [], recs: { deezer: [rec('deezer', artist, title, len)] } })
const found = (artist: string, title: string, e: Evidence, dur = 200) => decideTrack(t(artist, title, dur), e).found.map((f) => [f.field, f.to, f.conf])

describe('vuelta 1: con lo que respondió Deezer', () => {
  it('nunca saca acentos ni tildes (Deezer muchas veces no los tiene)', () => {
    expect(found('Eladio Carrión', 'Kemba Walker', dz('Eladio Carrion', 'Kemba Walker'))).toEqual([])
    expect(found('INVŌKER', 'Mantra', dz('INVOKER', 'Mantra'))).toEqual([])
    expect(found('Rombai', 'Cómo le Digo', dz('Rombai', 'Como le Digo'))).toEqual([])
    expect(found('La Mona Jiménez', 'Soy Cordobés', dz('La Mona Jimenez', 'Soy Cordobes'))).toEqual([])
    expect(found('Hernán y La Champions Liga', 'Hoy', dz('Hernan y La Champion´s Liga', 'Hoy'))).toEqual([])
    expect(dropsMarks('Ángel & Khriz', 'Angel y Khriz')).toBe(true)
    // agregar sí
    expect(found('Rosalia', 'Malamente', dz('Rosalía', 'Malamente'))).toEqual([['artist', 'Rosalía', 'media']]) // vuelta 3: el acento del artista lo confirma MusicBrainz
  })
  it('un título de 29 a 33 letras que no estaba cortado no se "completa"', () => {
    expect(titleMatch('Por Que No Puedo Ser Del Jet-Set?', 'Por Que No Puedo Ser Del Jet-Set?? Remasterizado 2007')).toBe('same')
    expect(found('Lauryn Hill', 'Can’t Take My Eyes Off of You', { artists: [], recs: { musicbrainz: [rec('musicbrainz', 'Lauryn Hill', 'Can’t Take My Eyes Off of You (I Love You Baby)', 222)] } })).toEqual([])
    expect(titleMatch('Frijo: Bzrp Music Sessions, Vol. 10', 'Frijo: Bzrp Music Sessions, Vol. 10/66')).toBeNull()
  })
  it('un dúo es un solo artista: "Wisin & Yandel" no pasa a "Wisin & Yandel & Yandel"', () => {
    expect(found('Wisin & Yandel', 'Abusadora', dz('Wisin & Yandel', 'Abusadora'))).toEqual([])
    expect(found('Kool & The Gang', 'Get Down On It', dz('Kool & The Gang', 'Get Down On It'))).toEqual([])
    expect(found('Hector & Tito feat. Don Omar', 'Baila Morena', dz('Hector & Tito', 'Baila Morena'))).toEqual([])
    expect(found('Earth Wind & Fire', 'September', dz('Earth, Wind & Fire', 'September'))).toEqual([['artist', 'Earth, Wind & Fire', 'media']])
    expect(found('Wisin y Yandel', 'Rakata', dz('Wisin & Yandel', 'Rakata'))).toEqual([['artist', 'Wisin & Yandel', 'media']])
  })
  it('signos o espacios del artista que dice una sola fuente que no es MusicBrainz quedan para mirar a mano', () => {
    expect(found('Locomia', 'Loco Mia', dz('Loco Mia', 'Loco Mia'))).toEqual([['artist', 'Loco Mia', 'media']])
    expect(found('Miranda', 'Ya lo Sabia', { artists: [], recs: { musicbrainz: [rec('musicbrainz', 'Miranda!', 'Ya lo sabía', 181)] } }, 181)[0]).toEqual(['artist', 'Miranda!', 'alta'])
  })
  it('títulos: no por espacios, no para sacar signos, sí para agregarlos (con las mayúsculas del usuario)', () => {
    expect(found('Omar Varela', 'Snow Tha Product: Bzrp Music Session, Vol. 39', dz('Omar Varela', 'Snow Tha Product: Bzrp Music Session , Vol. 39'))).toEqual([])
    expect(found('Irene Cara', 'Flashdance...What a Feeling', dz('Irene Cara', 'Flashdance... What A Feeling'))).toEqual([])
    expect(found('La Mona Jimenez', 'LA PUPERA.', dz('La Mona Jimenez', 'La Pupera'))).toEqual([])
    expect(found('Ángel & Khriz', "Na' de na'", dz('Ángel & Khriz', 'Na De Na'))).toEqual([])
    expect(found('Angel y Khriz', 'Ven Bailalo (Reggaeton Mix)', dz('Angel y Khriz', 'Ven Bailalo - Reggaeton Mix'))).toEqual([])
    expect(found('Queen', 'Dont Stop Me Now', dz('Queen', "Don't Stop Me Now"))).toEqual([['title', "Don't Stop Me Now", 'media']])
    expect(found('Ysy A', 'CUÁNTOS TÉRMINOS_', dz('Ysy A', 'CUÁNTOS TÉRMINOS?'))).toEqual([['title', 'CUÁNTOS TÉRMINOS?', 'media']])
    expect(found('Jesse & Joy', 'Que Le Pasa Conmigo', dz('Jesse & Joy', 'qué le pasa conmigo?'))).toEqual([['title', 'Qué Le Pasa Conmigo?', 'media']])
  })
  it('vuelta 2: "Sparrow & Barbossa, Enzo Siffredi" no se duplica; "Rodrigo" no se completa con una sola fuente', () => {
    expect(found('Sparrow & Barbossa, Enzo Siffredi', 'Hipnosis', dz('Sparrow & Barbossa', 'Hipnosis'))).toEqual([])
    expect(found('Rodrigo', 'Amor Clasificado', dz('Rodrigo Romero', 'Amor Clasificado'))).toEqual([])
  })
  it('los alias de MusicBrainz cambian el nombre aunque el de la biblioteca sea más corto o más largo', () => {
    const beatles: ArtistHit[] = [{ source: 'musicbrainz', id: 'b', name: 'The Beatles', score: 100, aliases: ['Beatles'] }]
    expect(found('Beatles', 'Twist and Shout', { artists: beatles, recs: { deezer: [rec('deezer', 'The Beatles', 'Twist And Shout', 155)] } }, 155)).toEqual([['artist', 'The Beatles', 'alta']])
  })
})

describe('vuelta 3: con MusicBrainz', () => {
  const mbHit = (name: string, aliases: string[] = []): ArtistHit => ({ source: 'musicbrainz', id: name, name, score: 100, aliases })
  it('un título cortado se completa sin la versión que viene después ("(Live)")', () => {
    expect(found('La Renga', 'Moscas Verdes, Para El Charlat', dz('La Renga', 'Moscas Verdes, Para El Charlatán (Live)', 318), 318)).toEqual([['title', 'Moscas Verdes, Para El Charlatán', 'alta']])
    expect(found('Kiss', "Living Loving Maid (She's Just", dz('Kiss', "Living Loving Maid (She's Just A Woman)", 184), 184)).toEqual([['title', "Living Loving Maid (She's Just A Woman)", 'alta']])
  })
  it('"Love The Way You Lie (Part II)" tiene 30 letras pero no estaba cortado', () => {
    expect(found('Rihanna feat. Eminem', 'Love The Way You Lie (Part II)', dz('Rihanna', 'Love The Way You Lie (Part II) (Pt. 2)', 296), 296)).toEqual([])
  })
  it('un acento en el nombre del artista que dice solo Deezer queda para mirar ("Balvín" era otro artista)', () => {
    expect(found('Balvin', 'Sigo Extrañandote', dz('Balvín', 'Sigo Extrañándote', 141), 141)).toEqual([['artist', 'Balvín', 'media'], ['title', 'Sigo Extrañándote', 'alta']])
    expect(found('Rosalia', 'Malamente', { artists: [mbHit('ROSALÍA')], recs: { deezer: [rec('deezer', 'Rosalía', 'Malamente', 200)] } })).toEqual([['artist', 'Rosalía', 'alta']])
  })
  it('si MusicBrainz conoce al artista, se escribe como MusicBrainz aunque la grabación venga de Deezer', () => {
    const ntvg = [mbHit('No Te Va Gustar', ['NTVG', 'No te va a gustar'])]
    expect(found('NTVG', 'Cielo Grande', { artists: ntvg, recs: { deezer: [rec('deezer', 'No te va Gustar', 'Cielo Grande', 200)] } })).toEqual([['artist', 'No Te Va Gustar', 'alta']])
  })
})

describe('vuelta 4: cada fuente vota con lo que escribe ella', () => {
  const mbHit = (name: string): ArtistHit => ({ source: 'musicbrainz', id: name, name, score: 100, aliases: [] })
  it('mayúsculas del artista: solo si MusicBrainz y Deezer escriben exactamente lo mismo', () => {
    expect(found('FISHER', 'Losing It', { artists: [mbHit('Fisher')], recs: { deezer: [rec('deezer', 'FISHER', 'Losing It', 200)] } })).toEqual([])
    expect(found('Taichu', 'Tema', { artists: [mbHit('TAICHU')], recs: { deezer: [rec('deezer', 'Taichu', 'Tema', 200)] } })).toEqual([])
    expect(found('DUKI', 'Goteo', { artists: [mbHit('Duki')], recs: { deezer: [rec('deezer', 'Duki', 'Goteo', 200)] } })).toEqual([['artist', 'Duki', 'alta']])
  })
  it('no saca los puntos de un nombre ("C.R.O" → "CRO", "N.O.B.A" → "Noba")', () => {
    expect(found('C.R.O, Cazzu', 'Tema', { artists: [mbHit('CRO')], recs: { musicbrainz: [rec('musicbrainz', 'CRO', 'Tema', 200)] } })).toEqual([])
    expect(found('N.O.B.A', 'Tema', { artists: [mbHit('Noba')], recs: { musicbrainz: [rec('musicbrainz', 'Noba', 'Tema', 200)] } })).toEqual([])
    expect(found('ROD', 'Tema', { artists: [mbHit('R.O.D.')], recs: { musicbrainz: [rec('musicbrainz', 'R.O.D.', 'Tema', 200)] } })).toEqual([['artist', 'R.O.D.', 'alta']])
  })
})

describe('vuelta 5', () => {
  const mbHit = (name: string, aliases: string[] = []): ArtistHit => ({ source: 'musicbrainz', id: name, name, score: 100, aliases })
  it('sacar un punto del nombre, solo si MusicBrainz y Deezer lo escriben igual', () => {
    expect(found('J. Balvin', 'Mi Gente', { artists: [mbHit('J Balvin')], recs: { musicbrainz: [rec('musicbrainz', 'J Balvin', 'Mi Gente', 200)], deezer: [rec('deezer', 'J Balvin', 'Mi Gente', 200)] } })).toEqual([['artist', 'J Balvin', 'alta']])
    expect(found('C.R.O', 'Tema', { artists: [mbHit('CRO')], recs: { musicbrainz: [rec('musicbrainz', 'CRO', 'Tema', 200)], deezer: [rec('deezer', 'C.R.O', 'Tema', 200)] } })).toEqual([])
  })
  it('si una fuente confirma el nombre tal cual, otra no lo cambia por uno parecido', () => {
    expect(found('Miley Cyrus', 'Flowers', { artists: [mbHit('MILEY', ['Miley Cyrus'])], recs: { musicbrainz: [rec('musicbrainz', 'MILEY', 'Flowers', 200)], deezer: [rec('deezer', 'Miley Cyrus', 'Flowers', 200)] } })).toEqual([])
    expect(found('Los Enanitos Verdes', 'Lamento Boliviano', { artists: [], recs: { musicbrainz: [rec('musicbrainz', 'Enanitos Verdes', 'Lamento Boliviano', 200)], deezer: [rec('deezer', 'Los Enanitos Verdes', 'Lamento Boliviano', 200)] } })).toEqual([])
  })
  it('si MusicBrainz tiene un artista que se llama exactamente así, un parecido de Deezer no se propone', () => {
    expect(found('Katy Perry', 'Roar', { artists: [mbHit('Katy Perry')], recs: { deezer: [rec('deezer', 'Katie Perry', 'Roar', 200)] } })).toEqual([])
    expect(found('La Mancha de Rolando', 'Arde la ciudad', { artists: [mbHit('La Mancha de Rolando')], recs: { deezer: [rec('deezer', 'Mancha De Rolando', 'Arde La Ciudad', 200)] } })).toEqual([])
    expect(found('Robert Glasper feat. Bilal', 'Tema', { artists: [mbHit('Robert Glasper')], recs: { deezer: [rec('deezer', 'Robert Glasper Experiment', 'Tema', 200)] } })).toEqual([])
  })
})

describe('vuelta 6', () => {
  it('cambiar corchetes por paréntesis no es una corrección', () => {
    expect(found("Guns N' Roses", "Don't Cry [Alternate Lyrics]", dz("Guns N' Roses", "Don't Cry (alternate Lyrics)"))).toEqual([])
  })
})

describe('vuelta 7: AcoustID en vivo (temas sin nombre de la copia completa)', () => {
  const hit = (artist: string, title: string, len = 200) => [{ score: 0.99, recordings: [rec('acoustid', artist, title, len)] }]
  it('si el nombre del archivo dice otra cosa, lo reconocido queda para mirar a mano', () => {
    expect(decideByPrint({ artist: 'Madonna', title: null, duration: 200, file: '03 give it 2 me.mp3' }, hit('Madonna', 'Super Pop'))).toEqual([expect.objectContaining({ field: 'title', conf: 'media' })])
    expect(decideByPrint({ artist: null, title: null, duration: 200, file: 'scapate.mp3' }, hit('Nene Malo', 'Amigos con derecho')).every((f) => f.conf === 'media')).toBe(true)
  })
  it('si el nombre del archivo coincide (o no dice nada), se propone', () => {
    expect(decideByPrint({ artist: null, title: null, duration: 200, file: 'lagrasa.mp3' }, hit('Serú Girán', 'La grasa de las capitales')).every((f) => f.conf === 'alta')).toBe(true)
    expect(decideByPrint({ artist: null, title: null, duration: 200, file: '85h_(Original Mix).wav' }, hit('Trickfinger', '85h')).every((f) => f.conf === 'alta')).toBe(true)
    expect(decideByPrint({ artist: null, title: 'Panic show', duration: 200, file: '01 - Panic show.mp3' }, hit('La Renga', 'Panic show'))).toEqual([expect.objectContaining({ field: 'artist', to: 'La Renga', conf: 'alta' })])
  })
})

describe('vuelta 8: Discogs en vivo', () => {
  const mbHit = (name: string): ArtistHit => ({ source: 'musicbrainz', id: name, name, score: 100, aliases: [] })
  const dg = (artist: string, title: string): RecHit => ({ source: 'discogs', title, titleFromQuery: true, credit: [{ name: artist, join: '' }], length: null })
  it('Discogs confirma qué artista es, pero no cómo se escribe', () => {
    const e = (discogs: string) => ({ artists: [mbHit('La Renga')], recs: { musicbrainz: [rec('musicbrainz', 'La Renga', 'Panic show', 200)], deezer: [rec('deezer', 'La Renga', 'Panic Show', 200)], discogs: [dg(discogs, 'Panic show')] } })
    expect(found('la renga', 'Panic show', e('La Renga'))).toEqual([['artist', 'La Renga', 'alta']])
    expect(found('la renga', 'Panic show', e('LA RENGA'))).toEqual([['artist', 'La Renga', 'alta']])
  })
  it('si Discogs tiene el tema con el nombre tal cual, otra fuente no lo cambia por uno parecido', () => {
    expect(found('Miley Cyrus', 'Flowers', { artists: [mbHit('MILEY')], recs: { musicbrainz: [rec('musicbrainz', 'MILEY', 'Flowers', 200)], discogs: [dg('Miley Cyrus', 'Flowers')] } })).toEqual([])
  })
})
