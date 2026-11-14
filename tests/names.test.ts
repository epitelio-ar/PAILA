// Cada caso salió de la corrida supervisada del 20/10/2026 sobre la biblioteca real (docs/archivo/pruebas/2026-10-20-arreglar-nombres.md).
import { describe, expect, it } from 'vitest'
import {
  caseKind, cleanBase, gluedNumber, isCatalog, isSite, underscoreDoubt, smartCase, sameCase, stripCopy, stripMarks, tidySpaces, trailingYear, underscores,
  versionParens,
} from '@paila/core/names'
import { ArtistSpelling, djMc, looksLikeLabel, mergeFeat, normalizeFeat, splitFeat, stripArtistFromTitle, stripChannel } from '@paila/core/artists'
import { stripJunk } from '@paila/core/tagactions'
import { setReason } from '@paila/core/sets'

describe('limpiar el nombre del archivo antes de leerlo', () => {
  it('saca páginas de descarga, copias, "_mp3", corazones y corchetes que envuelven todo', () => {
    expect(cleanBase('y2mate.com - Rusherking  LOBA Official Video')).toBe('Rusherking  LOBA')
    expect(cleanBase('La Mona Jimenez - LA PUPERA. [www.slider.kz] (1)')).toBe('La Mona Jimenez - LA PUPERA.')
    expect(cleanBase('callejeros - puede(2)')).toBe('callejeros - puede')
    expect(cleanBase('05- La Renga - Cuando Vendran_mp3')).toBe('05- La Renga - Cuando Vendran')
    expect(cleanBase('[ affkt - parafernalia (damon jee remix) ] [www.slider.kz]')).toBe('affkt - parafernalia (damon jee remix)')
    expect(cleanBase('♥  Ms Nina ♥   -   Tu Sicaria Prod  Beauty Brain').replace(/\s+/g, ' ')).toBe('Ms Nina - Tu Sicaria Prod Beauty Brain')
    expect(cleanBase('Cd2 05 - Cindy Lauper - Girls Just Want To Have Fun')).toBe('05 - Cindy Lauper - Girls Just Want To Have Fun')
  })
  it('nunca se come el ".mp3" de los títulos que lo llevan a propósito (disco ".mp3" de Emilia)', () => {
    expect(cleanBase('Emilia - Jagger.mp3 (Official Video)')).toBe('Emilia - Jagger.mp3')
    expect(cleanBase('Emilia, TINI - La_Original.mp3')).toBe('Emilia, TINI - La_Original.mp3')
  })
  it('guiones con espacio de un solo lado, salvo que haya otro " - " (ahí no se sabe)', () => {
    expect(cleanBase('Por lo que yo te quiero- Rodrigo')).toBe('Por lo que yo te quiero - Rodrigo')
    expect(cleanBase('Dj kass -SCOOBY DOO PAPA')).toBe('Dj kass - SCOOBY DOO PAPA')
    expect(cleanBase('Pity Alvarez- Viejas locas - Legalicenla')).toBe('Pity Alvarez- Viejas locas - Legalicenla')
    expect(cleanBase('Plan B-Fanatica Sensual')).toBe('Plan B-Fanatica Sensual') // sin espacios no se toca ("L-Gante", "Resk-T")
  })
})

describe('caracteres que Windows no deja usar', () => {
  it('solo el caso seguro se arregla solo: "_" pegado a la palabra y seguido de espacio era ":"', () => {
    expect(underscores('Nathy Peluso_ Bzrp Music Sessions, Vol. 36')).toBe('Nathy Peluso: Bzrp Music Sessions, Vol. 36')
    expect(underscores('Nortec_ Bostich')).toBe('Nortec: Bostich')
    for (const v of ["Who's That Chick_ (feat. Rihanna)", '06_00 AM', 'AC_DC', 'Bajan_los_dos', 'La_Original.mp3', 'KAS_ST', '2_2=3', 'El Reja _ El Flecha']) expect(underscores(v)).toBe(v)
  })
  it('los demás "_" quedan dudosos, con la forma más probable para mirarla a mano', () => {
    expect(underscoreDoubt('AC_DC')).toMatchObject({ to: 'AC/DC' })
    expect(underscoreDoubt("Who's That Chick_ (feat. Rihanna)")).toMatchObject({ to: "Who's That Chick? (feat. Rihanna)" })
    expect(underscoreDoubt('¿Qué Tengo Que Hacer_')).toMatchObject({ to: '¿Qué Tengo Que Hacer?' })
    expect(underscoreDoubt('Bajan_los_dos')).toMatchObject({ to: 'Bajan los dos' })
    expect(underscoreDoubt('We Are! (From _One Piece_)')).toMatchObject({ to: 'We Are! (From "One Piece")' })
    expect(underscoreDoubt('06_00 AM')).toMatchObject({ to: '06:00 AM' })
    expect(underscoreDoubt('Glock _ Nena Trampa Deluxe Edition')).toMatchObject({ to: 'Glock / Nena Trampa Deluxe Edition' })
    expect(underscoreDoubt('152_Bee Gees')).toMatchObject({ to: 'Bee Gees' })
    expect(underscoreDoubt('Lalo Ebratt_ Bzrp Music Sessions')).toBeNull() // ese se arregla solo
    expect(underscoreDoubt('Rich B___h')).toBeNull() // censura, no un signo
  })
  it('el disco ".mp3" de Emilia lleva "_" en el título oficial: nunca se toca ni se marca', () => {
    for (const v of ['La_Original.mp3', 'No_se_ve.mp3', 'Emilia, TINI - La_Original.mp3']) {
      expect(underscores(v)).toBe(v)
      expect(underscoreDoubt(v)).toBeNull()
    }
  })
})

describe('feat.', () => {
  it('se escribe siempre "feat." y sin repetir', () => {
    expect(normalizeFeat('Wisin Ft. Ozuna')).toBe('Wisin feat. Ozuna')
    expect(normalizeFeat('Los Nota Lokos Ft Resk-T')).toBe('Los Nota Lokos feat. Resk-T')
    expect(normalizeFeat('Billie Eilish ft.-Khalid')).toBe('Billie Eilish feat. Khalid')
    expect(normalizeFeat('Shkoon feat. Fruiterama feat. Fruiterama')).toBe('Shkoon feat. Fruiterama')
    expect(normalizeFeat('Soft Cell')).toBe('Soft Cell') // "ft" adentro de una palabra no cuenta
  })
  it('sale del título (y va al artista, como se decidió)', () => {
    expect(splitFeat('Dancin (feat. Luvli) (Krono Remix)')).toEqual({ title: 'Dancin (Krono Remix)', feat: 'Luvli' })
    expect(splitFeat('Teca (Remix) [feat. Neo Pistea, Midel, Rei & Zecca]')).toEqual({ title: 'Teca (Remix)', feat: 'Neo Pistea, Midel, Rei & Zecca' })
    expect(splitFeat('Someday featuring AHKI (Original Mix)')).toEqual({ title: 'Someday (Original Mix)', feat: 'AHKI' })
    expect(splitFeat('Bugutu ft.El Verdadero')).toEqual({ title: 'Bugutu', feat: 'El Verdadero' })
    expect(splitFeat('BICI feat Ak4_20, Juhn & Juanka')).toEqual({ title: 'BICI', feat: 'Ak4_20, Juhn & Juanka' })
    expect(splitFeat('Umbrella (Orange Version) ft. JAY-Z')).toEqual({ title: 'Umbrella (Orange Version)', feat: 'JAY-Z' })
  })
  it('no corta de más: el feat. termina en " - " y no se toca si sin paréntesis parece otra cosa', () => {
    expect(splitFeat('DAMAS GRATIS Ft. LA MONA JIMENEZ - LA VAGANCIA CUARTETERA')).toEqual({ title: 'DAMAS GRATIS - LA VAGANCIA CUARTETERA', feat: 'LA MONA JIMENEZ' })
    expect(splitFeat('Adana Twins feat  Glowal   My Computer Original Mix').feat).toBeNull()
    expect(splitFeat('Gasolina').feat).toBeNull()
  })
  it('se suma al artista sin repetir y deja el estilo Beatport en orden', () => {
    expect(mergeFeat('Aaron Smith', 'Luvli')).toBe('Aaron Smith feat. Luvli')
    expect(mergeFeat('Duki feat. DrefQuila', 'DrefQuila')).toBe('Duki feat. DrefQuila')
    expect(mergeFeat('Barbara Ford, SLV (DE)', 'Barbara Ford')).toBe('SLV (DE) feat. Barbara Ford')
    expect(mergeFeat('Guti, Greg Paulus, Chucky De Ipola', 'Greg Paulus feat. Chucky De Ipola')).toBe('Guti feat. Greg Paulus, Chucky De Ipola')
    expect(mergeFeat('Modo Diablo feat. Duki, Ysy A, Neo Pistea', 'Duki, Ysy A & Neo Pistea')).toBe('Modo Diablo feat. Duki, Ysy A, Neo Pistea')
  })
})

describe('el artista repetido adentro del título', () => {
  it('al principio, al final, dos veces y con n.º o feat. en el medio', () => {
    expect(stripArtistFromTitle('Alphaville - Big In Japan', 'Alphaville').title).toBe('Big In Japan')
    expect(stripArtistFromTitle('Traición - Miranda!', 'Miranda!').title).toBe('Traición')
    expect(stripArtistFromTitle('08 Benny Benassi - Satisfaction (Isak Original)', 'Benny Benassi').title).toBe('Satisfaction (Isak Original)')
    expect(stripArtistFromTitle('Beau Didier - Beau Didier - Magalenha', 'Beau Didier').title).toBe('Magalenha')
    expect(stripArtistFromTitle('will.i.am - Scream & Shout', 'will i am').title).toBe('Scream & Shout')
    expect(stripArtistFromTitle('La Factoria  ft. Eddy Lover- Perdoname', 'La Factoria')).toEqual({ title: 'Perdoname', feat: 'Eddy Lover' })
    expect(stripArtistFromTitle('EL ARRIERO    DIVIDIDOS', 'Divididos').title).toBe('EL ARRIERO')
  })
  it('si a la izquierda está el artista con otros nombres, ese es el artista completo', () => {
    expect(stripArtistFromTitle('Emilia, TINI - La_Original.mp3', 'Emilia')).toEqual({ title: 'La_Original.mp3', feat: null, artist: 'Emilia, TINI' })
  })
  it('si el título no empieza ni termina con el artista, no se toca', () => {
    expect(stripArtistFromTitle('Ella Baila Sola', 'Eslabon Armado').title).toBe('Ella Baila Sola')
    expect(stripArtistFromTitle('#Ysya2020 Vol. 6 - Un Flow de Infarto', 'YSY A').title).toBe('#Ysya2020 Vol. 6 - Un Flow de Infarto')
  })
})

describe('basura de YouTube y de páginas', () => {
  it('saca más formas de "video oficial", sellos, hashtags y n.º de catálogo, pero no "(Full Album)"', () => {
    expect(stripJunk('I Wanna Dance With Somebody (Official 4K Video)')).toBe('I Wanna Dance With Somebody')
    expect(stripJunk('Te De Campana (Video Oficial HD)')).toBe('Te De Campana')
    expect(stripJunk('Deseo en la Nuca (Videoclip Oficial)')).toBe('Deseo en la Nuca')
    expect(stripJunk('Believe (Official Music Video) [4K Remaster]')).toBe('Believe')
    expect(stripJunk('Le hachis de Parmentier [La Menace Records]')).toBe('Le hachis de Parmentier')
    expect(stripJunk('30 Grados Ft. Mandale Flow #flowbr #elturko')).toBe('30 Grados Ft. Mandale Flow')
    expect(stripJunk('Freestyle Session #11')).toBe('Freestyle Session #11')
    expect(stripJunk('Magalenha -BEAU003-')).toBe('Magalenha')
    expect(stripJunk('Un Dios Nuevo (Full Album)')).toBe('Un Dios Nuevo (Full Album)')
  })
  it('una página o un "no sé" de otro programa no es un artista', () => {
    expect(isSite('m.youtube.com')).toBe(true)
    expect(isSite('[Www.FlowCumbiero.Com.Ar]')).toBe(true)
    expect(isSite('Artista sconosciuto')).toBe(true)
    expect(isSite('Unknown Artist')).toBe(true)
    expect(isSite('Will.i.am')).toBe(false)
    expect(isSite('Kase.O')).toBe(false)
    expect(isSite('http___vk.com_usuario')).toBe(true)
    // los que se le escapaban en la Música real (repaso de criterios del 24/10)
    expect(isSite('www.delirandocumbia.ya.st')).toBe(true)
    expect(isSite('vk.com/RealDJingNN')).toBe(true)
    expect(isSite('dj.ejemplo@correo.com')).toBe(true)
    expect(isSite('Www.MetropolisCumbiera.Com.Ar')).toBe(true)
    expect(isSite('Mr.Kitty')).toBe(false)
    expect(isSite('R.O.D.')).toBe(false)
    expect(isSite('A.Paul, Temudo')).toBe(false)
    expect(isCatalog('AL046')).toBe(true)
    expect(isCatalog('KASST')).toBe(false)
    expect(isCatalog('T78')).toBe(false)
  })
  it('canales de YouTube y sellos guardados como artista', () => {
    expect(stripChannel('Damas Gratis Oficial')).toBe('Damas Gratis')
    expect(stripChannel('Cristem DJ - CANAL OFICIAL')).toBe('Cristem DJ')
    expect(stripChannel('LaBarraVEVO')).toBe('LaBarra')
    expect(stripChannel('Plan B - Topic')).toBe('Plan B')
    expect(stripChannel('Official')).toBe('Official') // si no queda nada, se deja
    expect(looksLikeLabel('MUEVA Records')).toBe(true)
    expect(looksLikeLabel('Macklemore Music')).toBe(true)
    expect(looksLikeLabel('Daft Punk')).toBe(false)
  })
})

describe('otros arreglos del título', () => {
  it('versión suelta al final va entre paréntesis', () => {
    expect(versionParens('Ven Bailalo - Reggaeton Mix')).toBe('Ven Bailalo (Reggaeton Mix)')
    expect(versionParens('Cosas Imposibles  Digi & Gabo Remix')).toBe('Cosas Imposibles (Digi & Gabo Remix)')
    expect(versionParens('#Ysya2020 Vol. 6 - Un Flow de Infarto')).toBe('#Ysya2020 Vol. 6 - Un Flow de Infarto')
  })
  it('año entre paréntesis al final, números pegados y espacios', () => {
    expect(trailingYear('E.C. Scott (1995)')).toEqual({ value: 'E.C. Scott', year: '1995' })
    expect(trailingYear('85H [2015]')).toEqual({ value: '85H', year: '2015' })
    expect(trailingYear('Summer of 69')).toEqual({ value: 'Summer of 69', year: null })
    expect(gluedNumber('no necesito nada401')).toBe('no necesito nada')
    expect(gluedNumber('Give It 2 Me')).toBe('Give It 2 Me')
    expect(tidySpaces('Mago de la Lluvia ( Ese Tren )')).toBe('Mago de la Lluvia (Ese Tren)')
  })
})

describe('mayúsculas', () => {
  it('pasa a mayúscula inicial lo escrito todo en minúscula o todo en mayúscula, respetando siglas', () => {
    expect(smartCase('nene de antes')).toBe('Nene de Antes')
    expect(smartCase('SE QUE NO SE')).toBe('Se Que No Se')
    expect(smartCase('TRAP DE VERDAD (PROD. CLUB HATS)')).toBe('Trap de Verdad (Prod. Club Hats)')
    expect(smartCase('06:00 AM')).toBe('06:00 AM')
    expect(smartCase('LA PREVIA RKT')).toBe('La Previa RKT')
    expect(smartCase('ELAGGUME x ECKO')).toBe('Elaggume x Ecko')
    expect(smartCase('rafaga - una rafaga de amor')).toBe('Rafaga - Una Rafaga de Amor')
    expect(smartCase('GUSTY DJ')).toBe('Gusty DJ')
  })
  it('sabe qué está todo en minúscula o mayúscula', () => {
    expect(caseKind('bury a friend')).toBe('lower')
    expect(caseKind('CANGURO')).toBe('upper')
    expect(caseKind('SOLTERO x ECKO ft OMAR')).toBe('upper')
    expect(caseKind('Ariana Grande')).toBe('mixed')
    expect(caseKind('86')).toBe('none')
  })
  it('DJ y MC en mayúsculas', () => {
    expect(djMc('Dj Lauuh, Gusty Dj')).toBe('DJ Lauuh, Gusty DJ')
    expect(djMc('Mc Caco')).toBe('MC Caco')
    expect(djMc('McFly')).toBe('McFly')
  })
})

describe('cómo se escribe cada artista en la biblioteca', () => {
  const s = new ArtistSpelling()
  for (const a of ['Babasónicos', 'Babasónicos', 'Babasonicos', 'Ysy A', 'Ysy A', 'Duki', 'Duki', 'Duki', 'DUKI', 'Hernán y La Champions Liga', 'Hernán y La Champions Liga', "Hernan y La Champion's Liga"]) s.addTag(a)
  for (let i = 0; i < 3; i++) s.addFolder('No Te Va Gustar')
  s.addFolder('Patricio Rey y sus Redonditos de Ricota'); s.addFolder('Patricio Rey y Sus Redonditos de Ricota')
  it('gana la forma más usada (con claridad), la de la carpeta o la estilizada', () => {
    expect(s.fix('Babasonicos')).toBe('Babasónicos')
    expect(s.fix('DUKI')).toBe('Duki')
    expect(s.fix('Ysy A, Duki')).toBe('YSY A, Duki') // estilizado: así figura oficialmente
    expect(s.fix("Hernan y La Champion's Liga")).toBe('Hernán y La Champions Liga')
    expect(s.fix('no te va gustar')).toBe('No Te Va Gustar')
  })
  it('si dos carpetas lo escriben distinto, la carpeta no decide', () => {
    expect(s.best('patricio rey y sus redonditos de ricota')).toBeNull()
  })
  it('sabe qué artistas son conocidos', () => {
    expect(s.known('duki')).toBe(true)
    expect(s.known('Rusherking')).toBe(false)
  })
})

describe('reglas nuevas de los perfiles (decididas el 20/10/2026)', () => {
  it('marcas propias: fuera MASTER, MSTRD, 16bit y (FINAL); "LA BATALLA FINAL" y "Got Glint_" quedan', () => {
    expect(stripMarks('New Dawn (Original Mix) MSTRD')).toBe('New Dawn (Original Mix)')
    expect(stripMarks('La Pregunta (Nicolas Ming Edit) 16bit')).toBe('La Pregunta (Nicolas Ming Edit)')
    expect(stripMarks("I Was Made For Lovin' You MASTER")).toBe("I Was Made For Lovin' You")
    expect(stripMarks('BENT COPPERS (FINAL)')).toBe('BENT COPPERS')
    expect(stripMarks('Tema [MASTER 24bit]')).toBe('Tema')
    expect(stripMarks('Tema_MSTRD')).toBe('Tema')
    expect(stripMarks('LA BATALLA FINAL')).toBe('LA BATALLA FINAL') // todo en mayúsculas: "FINAL" es parte del nombre
    expect(stripMarks('The Final Countdown')).toBe('The Final Countdown')
    expect(stripMarks('1_1_21, 6.32 PM (Mastered with Aurora at 50pct)')).toBe('1_1_21, 6.32 PM (Mastered with Aurora at 50pct)')
    expect(stripMarks('Got Glint_')).toBe('Got Glint_') // sin marca no se toca: el "_" es un "?" para mirar a mano
  })
  it('el "(1)" del navegador sale del título solo si el archivo también lo tiene', () => {
    expect(stripCopy('Tak Tiki Tax (1)', 'Fer Palacio - Tak Tiki Tax [www.slider.kz] (1)')).toBe('Tak Tiki Tax')
    expect(stripCopy('Manifesto (3)', 'Setaoc Mass - Manifesto (3)')).toBe('Manifesto')
    expect(stripCopy('Symphony (2)', 'Symphony')).toBe('Symphony (2)')
  })
  it('acentos sin tocar mayúsculas: "Babasonicos" → "Babasónicos", pero "DUKI" o "Ysy A" quedan', () => {
    expect(sameCase('Babasonicos', 'Babasónicos')).toBe(true)
    expect(sameCase("Hernan y La Champion's Liga", 'Hernán y La Champions Liga')).toBe(true)
    expect(sameCase('DUKI', 'Duki')).toBe(false)
    const s = new ArtistSpelling()
    for (const a of ['Babasónicos', 'Babasónicos', 'Babasonicos', 'Duki', 'Duki', 'Duki', 'DUKI', 'Ysy A']) s.addTag(a)
    expect(s.fix('Babasonicos', true)).toBe('Babasónicos')
    expect(s.fix('DUKI', true)).toBe('DUKI')
    expect(s.fix('Ysy A', true)).toBe('Ysy A')
    expect(s.fix('DUKI')).toBe('Duki') // en Rajatabla sí
    expect(s.fix('Ysy A')).toBe('YSY A')
  })
  it('los acentos se agregan pero no se sacan, aunque la carpeta no los tenga (repaso de criterios del 24/10)', () => {
    // la carpeta "Rock/Manuel Rodriguez" y dos tags "Manuel Rodríguez": antes pasaban a "Rodriguez"
    const s = new ArtistSpelling()
    s.addTag('Manuel Rodríguez'); s.addTag('Manuel Rodríguez'); s.addFolder('Manuel Rodriguez')
    expect(s.fix('Manuel Rodríguez', true)).toBe('Manuel Rodríguez')
    // "Totò" (de slider.kz) queda como está: es la banda Toto, pero sacar acentos no es de esta regla
    const t = new ArtistSpelling()
    t.addTag('Toto'); t.addTag('Toto'); t.addTag('Totò')
    expect(t.fix('Totò', true)).toBe('Totò')
    // y agregarlos sigue: la carpeta "Babasónicos" arregla el tag "Babasonicos"
    const b = new ArtistSpelling()
    b.addTag('Babasonicos'); b.addFolder('Babasónicos')
    expect(b.fix('Babasonicos', true)).toBe('Babasónicos')
  })
  it('sets: más de 15 minutos con set/enganchado/mix/live/en vivo/concierto/recital, o más de 40', () => {
    expect(setReason('Pendrive/_ENGANCHANDO CUARTETO MIX NUEVO 2024.mp3', 23 * 60)).toBe('Dura 23 minutos y el nombre dice "enganchando"')
    expect(setReason('Casa Fiesta/Set CasaFiesta.wav', 60 * 60)).toMatch(/Dura 60 minutos: es un set/)
    expect(setReason('Rock/La Renga - En Vivo en Huracán.mp3', 20 * 60)).toBe('Dura 20 minutos y el nombre dice "en vivo"')
    expect(setReason('Rock/Pink Floyd/echoes.mp3', 24 * 60)).toBeNull() // un tema largo, no un set
    expect(setReason('Prog/Artista - Tema Largo (Original Mix).mp3', 17 * 60)).toBeNull() // "(Original Mix)" es la versión del tema
    expect(setReason('Pendrive/ENGANCHADO.mp3', 10 * 60)).toBeNull()
    // enganchados sin palabra de set (corrida del 21/10/2026): por la forma, sin inventarles nombres
    const none = { artist: null, title: null }
    expect(setReason('Pendrive/BATALLA DE CUMBI4S _The La Planta Antonio Rios Emanero Tendencias Colecciones Álbum Popular 2024.mp3', 18 * 60, none)).toBe('Dura 18 minutos y el nombre dice "batalla"')
    expect(setReason('Pendrive/Cumbias 2024 _The La Planta Antonio Rios.mp3', 18 * 60, none)).toMatch(/no tiene artista ni título/)
    expect(setReason('Pendrive/Luck Ra, La Konga, Q Lokura, Valentino Merlo.mp3', 20 * 60, { artist: 'Luck Ra', title: 'x' })).toMatch(/enumera varios artistas/)
    expect(setReason('Rock/Pink Floyd/echoes.mp3', 24 * 60, { artist: 'Pink Floyd', title: 'Echoes' })).toBeNull()
    expect(setReason('Rock/Pink Floyd - Echoes.mp3', 24 * 60, none)).toBeNull() // el nombre dice "Artista - Tema"
    expect(setReason('Rock/La Renga/04 Anaximandro.mp3', 15 * 60 + 1, { artist: 'La Renga', title: 'Anaximandro' })).toBeNull()
  })
})
