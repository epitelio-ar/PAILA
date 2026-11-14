// Vocabulario de géneros: la lista cerrada de estilos que PAILA puede proponer (los de Discogs, más unos pocos de
// Beatport y de acá), cada uno con su género general, y las otras formas de escribirlos (etiquetas de Last.fm).
// Lo que no está en la lista no es un género para PAILA: así no se cuelan "seen live", "favorites" ni "argentina".

/**
 * Cada género general con sus estilos. Un estilo es "Nombre" o "Nombre=otra forma=otra forma" (las otras formas se
 * comparan sin mayúsculas, acentos ni signos). El primer género que nombra un estilo es su género general.
 */
const TREE: Record<string, string> = {
  Electronic: `Electronic=electronica=electronic music=edm=electronic dance music|House=house music|Deep House|Tech House|Techno|Minimal=minimal techno|Minimal House|Melodic House & Techno=melodic techno=melodic house=melodic house and techno|
    Afro House|Organic House|Progressive House|Electro House|Bass House=g house|Big Room|Future House|Tropical House|Acid House|Hard House|Tribal House=!tribal|Garage House|Ghetto House|Hip-House|Italo House|Euro House|
    Acid=acid techno|Dub Techno|Deep Techno|Hard Techno=industrial techno|Detroit Techno|Schranz|Trance=vocal trance=uplifting trance|Progressive Trance|Psytrance=psy-trance=psy trance=psychedelic trance=goa=goa trance|Tech Trance|Hard Trance|
    Drum n Bass=drum and bass=dnb=d and b=drumnbass=liquid funk=liquid drum and bass|Jungle|Breakbeat=breaks|Progressive Breaks|Big Beat|Broken Beat|Dubstep=brostep|Future Bass|Bass Music|UK Garage=2 step=2-step|Speed Garage|Grime|UK Funky|Bassline|
    Downtempo|Chillout=chill out|Lounge|Trip Hop=trip-hop|Ambient|Dark Ambient|Drone|IDM|Glitch|Leftfield|Experimental|!Abstract|Electro|Electroclash|EBM|Industrial|Darkwave=dark wave|Synthwave=retrowave|Vaporwave|Chiptune=8-bit|
    Nu Disco=nudisco=nu-disco|Indie Dance|Disco|Italo Disco=italo-disco=italo|Euro Disco=euro-disco|Hi NRG=hi-nrg|Eurodance|Eurobeat|Hands Up|Happy Hardcore|Hardstyle|Jumpstyle|Gabber|Speedcore|Breakcore|
    Footwork|Juke|Ghettotech|Baltimore Club|Jersey Club|Amapiano|Gqom|Kuduro|Moombahton|New Beat|Berlin-School|Witch House|Hyperpop|Synth Pop=synthpop=synth-pop=electropop=electro pop|New Wave=new romantic`,
  Rock: `Rock=rock music|Rock Nacional=rock argentino=rock nacional argentino|Rock en Español=rock en espanol=rock latino=latin rock|Alternative Rock=alternative=alt rock|Indie Rock|Indie|Classic Rock|Hard Rock|Pop Rock|Soft Rock|AOR|Blues Rock|Folk Rock|Country Rock|Southern Rock|
    Rock & Roll=rock and roll=rock n roll=rocknroll=rock 'n' roll|Rockabilly|Psychobilly|Garage Rock|Surf=surf rock|Psychedelic Rock=psychedelic=psychedelia|Acid Rock|Prog Rock=progressive rock|Art Rock|Space Rock|Krautrock|Symphonic Rock|Glam=glam rock|
    Punk=punk rock|Pop Punk|Post-Punk=post punk|Hardcore=hardcore punk|Post-Hardcore=post hardcore|Emo|Oi|Ska Punk|Grunge|Britpop=brit pop|Shoegaze|Dream Pop|Post Rock=post-rock|Math Rock|Noise Rock|Noise|Lo-Fi=lofi|Stoner Rock|Goth Rock=gothic rock=goth=gothic|Coldwave|!Mod|Power Pop|Pub Rock|
    Metal|Heavy Metal|Thrash=thrash metal|Death Metal|Black Metal|Doom Metal|Power Metal|Speed Metal|Nu Metal=nu-metal|Metalcore|Deathcore|Sludge Metal|Gothic Metal|Folk Metal|Symphonic Metal|Progressive Metal|Alternative Metal|Funk Metal|Grindcore|Crust`,
  Pop: `Pop=pop music|Indie Pop|Latin Pop=pop latino|Baroque Pop|Europop|Dance Pop=dance-pop|Chanson|Schlager|City Pop|J-pop=jpop|K-pop=kpop|Bubblegum|Teen Pop|Art Pop|Chamber Pop`,
  // Horrorcore, Gangsta y Conscious dicen de qué habla el tema, no cómo suena: cuentan como Hip Hop (corrida del 23/10: Dillom salía "Horrorcore")
  'Hip Hop': `Hip Hop=hip-hop=hiphop=rap=hip hop rap=horrorcore=gangsta=gangsta rap=thug rap=!conscious=conscious hip hop|Trap|Latin Trap=trap latino|Drill|Boom Bap|G-Funk|Pop Rap|Cloud Rap|Phonk|Crunk|Miami Bass|Jazzy Hip-Hop=jazz rap|Turntablism|Instrumental Hip Hop`,
  Latin: `Latin=latin music=latino|Reggaeton=reggaetón=regueton=reguetón=reggaeton latino|Dembow|RKT|Cumbia=cumbia villera=cumbia santafesina=cumbia argentina=cumbia colombiana|Cuarteto|Guaracha|Salsa|Merengue|Bachata|Bolero|!Son|Mambo|Cha-Cha=cha cha cha|Rumba|Timba|Boogaloo|
    Tango|Milonga|Candombe|Murga|Chacarera|Zamba|Samba|Bossa Nova=bossanova|MPB|Forró|Axé|Funk Carioca=baile funk=funk brasileiro=brazilian funk|Vallenato|Champeta|Ranchera|Mariachi|Norteño|Corridos=corridos tumbados|Banda|Tejano|Nueva Canción=nueva cancion|Trova=nueva trova|Latin Jazz`,
  'Funk / Soul': `Funk|Soul|R&B=rnb=rnb/swing=contemporary r&b=r and b=contemporary rnb|Neo Soul=neo-soul|Rhythm & Blues=rhythm and blues|Disco Funk|Boogie|P.Funk=p-funk|New Jack Swing|Gospel|Afrobeat|Afrobeats|Minneapolis Sound|Motown|Northern Soul`,
  Jazz: `Jazz|Smooth Jazz|Acid Jazz|Jazz-Funk=jazz funk|Fusion=jazz fusion|Jazz-Rock|Bop=bebop|Hard Bop|Cool Jazz|Free Jazz|!Modal|Swing|Big Band|Gypsy Jazz=manouche|Soul-Jazz|Contemporary Jazz|Vocal Jazz|Dixieland|Ragtime|Easy Listening|Nu Jazz=future jazz`,
  Reggae: `Reggae|Roots Reggae|Dub|Dancehall|Ragga|Ska|Rocksteady|Lovers Rock|Reggae-Pop|Calypso|Soca`,
  Blues: `Blues|Delta Blues|Chicago Blues|Electric Blues|Country Blues|Texas Blues|Jump Blues|Boogie Woogie|Piano Blues`,
  Classical: `Classical=classical music|Baroque|!Romantic|Classical Period|Contemporary Classical=!contemporary|Modern Classical|Neo-Classical=neoclassical|Opera|Choral|Renaissance|Medieval|Impressionist|Minimalism`,
  Folk: `Folk|Folklore=folclore=folklore argentino=folk argentino=musica folklorica|Country|Bluegrass|Americana|Celtic|Flamenco|Fado|Andean=andina=musica andina|Polka|Klezmer|Highlife|Soukous|Zouk|Cajun`,
  Soundtrack: `Soundtrack=score=film score=original soundtrack=ost=stage & screen|Musical|!Theme`,
  'New Age': `New Age=new-age|Meditation`,
}

export interface GenreInfo { name: string; parent: string }
/** `strict`: esa forma solo vale si viene de Discogs o MusicBrainz ("Romantic" es un período de la música clásica, pero en Last.fm es un ánimo). */
const BY_KEY = new Map<string, GenreInfo & { strict: boolean }>()
const PARENTS = new Set(Object.keys(TREE))

/** La forma de comparar: sin mayúsculas, acentos ni signos, y "&" como "and" ("Drum & Bass" = "drum and bass"). */
export const genreKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '')

// "!" adelante de un nombre o de otra forma: solo vale desde Discogs o MusicBrainz (ver `strict`)
for (const [parent, list] of Object.entries(TREE)) {
  for (const item of list.split('|')) {
    const words = item.split('=').map((x) => x.trim())
    const name = words[0].replace(/^!/, '')
    if (!name) continue
    for (const w of words) { const k = genreKey(w); if (!BY_KEY.has(k)) BY_KEY.set(k, { name, parent, strict: w.startsWith('!') }) }
  }
}

/**
 * El género de la lista que es esta etiqueta, o null si no es un género ("seen live", "argentina", un año…).
 * `loose`: la etiqueta la puso cualquiera (Last.fm), así que las formas dudosas no cuentan.
 */
export function canonGenre(tag: string, loose = false): GenreInfo | null {
  const g = BY_KEY.get(genreKey(tag))
  return g && !(loose && g.strict) ? { name: g.name, parent: g.parent } : null
}

/** ¿Es uno de los géneros generales (Electronic, Rock, Latin…)? */
export const isParent = (name: string) => PARENTS.has(name)
/** Los géneros generales, en el orden de la lista. */
export const PARENT_GENRES = [...PARENTS]

/** El género general de un nombre que da Discogs como "genre" ("Funk / Soul", "Folk, World, & Country", "Stage & Screen"). */
export function discogsParent(g: string): string | null {
  const k = genreKey(g)
  if (k === 'folkworldandcountry') return 'Folk'
  if (k === 'stageandscreen') return 'Soundtrack'
  if (k === 'funksoul') return 'Funk / Soul'
  const c = canonGenre(g)
  return c && isParent(c.name) ? c.name : null
}

/**
 * Lo que un programa deja en el género cuando no sabe ("Other", "Unknown", "genre", el número de un tag viejo "(12)",
 * una letra suelta): cuenta como vacío. Un género de verdad, aunque esté mal escrito, nunca cae acá.
 */
export function isJunkGenre(v: string | null | undefined): boolean {
  const t = (v ?? '').trim()
  if (!t) return true
  if (/^\(?\d{1,3}\)?$/.test(t) || t.length === 1) return true
  return JUNK.has(genreKey(t))
}
const JUNK = new Set(['other', 'others', 'otro', 'otros', 'unknown', 'unknowngenre', 'desconocido', 'genre', 'genero', 'default', 'none', 'nogenre', 'singenero', 'misc', 'miscellaneous', 'general', 'music', 'musica', 'audio', 'blank', 'na', 'unclassifiable', 'unclassified', 'various', 'varios', 'tag', 'undefined', 'null'])
