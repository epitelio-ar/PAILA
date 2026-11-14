// Perfiles de nombres del asistente "Arreglar nombres y tags" (MASTERPLAN-2, sección 4.1; decisiones del 20/10/2026).
// Cada perfil es una lista de reglas; cada regla se ve en la pantalla con su explicación y un ejemplo, y se puede prender o
// apagar una por una. Lo comparten el núcleo (core/tidy.ts) y la interfaz. Los textos van en castellano y en inglés: se
// leen en el idioma de ahora cada vez (getters), así que sirven también en el proceso principal, que cambia sin reiniciar.

import { tr } from './idioma'

export type TidyRule = 'rotos' | 'basura' | 'vinilo' | 'aprendidas' | 'feat' | 'repetidos' | 'djmc' | 'copias' | 'acentos' | 'diccionario' | 'mayusculas' | 'marcas' | 'oficial'
export type TidyProfile = 'minimo' | 'prolijo' | 'rajatabla' | 'oficial'

type Par = { es: string; en: string }
type Ejemplo = [string, string]

export interface RuleInfo { key: TidyRule; label: string; help: string; example: [string, string]; always?: boolean }
/** Una regla con sus textos en los dos idiomas (el ejemplo puede ser el mismo en los dos: son nombres). */
function regla(key: TidyRule, label: Par, help: Par, example: Ejemplo | { es: Ejemplo; en: Ejemplo }, always?: boolean): RuleInfo {
  return {
    key,
    ...(always ? { always } : {}),
    get label() { return tr(label) },
    get help() { return tr(help) },
    get example() { return Array.isArray(example) ? example : tr(example) },
  }
}

export const RULES: RuleInfo[] = [
  regla('rotos', { es: 'Caracteres rotos', en: 'Broken characters' }, {
    es: 'Letras que otro programa leyó mal. Si una letra se perdió del todo, se recupera del nombre del archivo.',
    en: 'Letters another program read wrong. If a letter got lost completely, it comes back from the file name.',
  }, ['GarcÃ­a', 'García'], true),
  regla('basura', { es: 'Basura de páginas y de YouTube', en: 'Junk from websites and YouTube' }, {
    es: 'Lo que agregan los sitios de descarga y los videos: [www.slider.kz], y2mate.com, (Official Video), (Letra), [HD], hashtags, el sello entre corchetes al final, y "Oficial" o "VEVO" pegado al artista. También lee bien lo que completa desde el nombre del archivo (sin el n.º de tema, el "(1)" de copia ni el artista repetido).',
    en: 'What download sites and videos add: [www.slider.kz], y2mate.com, (Official Video), (Letra), [HD], hashtags, the label in brackets at the end, and "Oficial" or "VEVO" stuck to the artist. It also reads properly what it fills in from the file name (without the track number, the "(1)" of a copy or the repeated artist).',
  }, ['LOBA (Official Video) [www.slider.kz]', 'LOBA'], true),
  regla('vinilo', { es: 'Sacar "VINYL ONLY" y la cara del vinilo', en: 'Remove "VINYL ONLY" and the vinyl side' }, {
    es: 'Lo que agregan las tiendas de vinilos: "VINYL ONLY" en el título, el álbum o el artista, y la cara y el lugar del disco ("A1", "B2") adelante. Se saca del nombre y el dato no se pierde: PAILA anota que el tema es de vinilo y su cara (se ve en la ficha del tema). La cara se saca solo con pruebas (el n.º de tema dice lo mismo, dice "vinyl", o hay otras caras en la carpeta); si no, queda para mirar a mano. Destildala si preferís dejarlo en el nombre.',
    en: 'What vinyl shops add: "VINYL ONLY" in the title, the album or the artist, and the side and spot on the record ("A1", "B2") at the start. It comes out of the name and the info is not lost: PAILA notes that the track is from vinyl and its side (you can see it in the track details). The side only comes out with proof (the track number says the same, it says "vinyl", or there are other sides in the folder); if not, it stays for you to look at by hand. Untick it if you would rather keep it in the name.',
  }, ['A1 Bodeler — Philypop VINYL ONLY', 'Bodeler — Philypop']),
  regla('aprendidas', { es: 'Palabras que PAILA aprendió a sacar', en: 'Words PAILA learned to remove' }, {
    es: 'Además de la lista fija de basura, PAILA aprende de tu biblioteca: compara el nombre de cada archivo con el nombre oficial de los temas que reconoció con seguridad por el sonido (AcoustID, con la misma duración) y anota lo que sobra en muchos artistas y carpetas distintas. Nunca aprende datos de versión (Remix, Live, Edit, feat.) ni algo que esté en un nombre oficial. Cada palabra se ve abajo con ejemplos: se puede apagar o marcar "No es basura". Necesita buscar primero en internet con la clave de AcoustID.',
    en: 'Besides the fixed junk list, PAILA learns from your library: it compares the name of each file with the official name of the tracks it recognized for sure by their sound (AcoustID, with the same length) and notes what is left over across many different artists and folders. It never learns version info (Remix, Live, Edit, feat.) or anything that is in an official name. Each word shows below with examples: you can turn it off or mark it "Not junk". It needs a search on the internet first, with the AcoustID key.',
  }, { es: ['Tema [Zona Descargas]', 'Tema'], en: ['Track [Zona Descargas]', 'Track'] }),
  regla('feat', { es: '"feat." siempre igual y en el artista', en: '"feat." always the same and in the artist' }, {
    es: '"Ft", "ft.-", "Feat" o "featuring" pasan a "feat.", el invitado va al artista y el título queda limpio. Un invitado repetido se escribe una sola vez.',
    en: '"Ft", "ft.-", "Feat" or "featuring" become "feat.", the guest goes to the artist and the title stays clean. A repeated guest is written only once.',
  }, ['Aaron Smith — Dancin (feat. Luvli)', 'Aaron Smith feat. Luvli — Dancin']),
  regla('repetidos', { es: 'Artista repetido en el título', en: 'Artist repeated in the title' }, {
    es: 'El título que repite el nombre del artista adelante o atrás (pasa mucho con lo bajado de YouTube).',
    en: 'A title that repeats the name of the artist at the start or at the end (it happens a lot with things downloaded from YouTube).',
  }, ['Alphaville — Alphaville - Big In Japan', 'Alphaville — Big In Japan']),
  regla('djmc', { es: 'DJ y MC en mayúsculas', en: 'DJ and MC in capitals' }, {
    es: '"Dj" y "Mc" van siempre en mayúsculas. Es lo único de mayúsculas que se toca en este perfil.',
    en: '"Dj" and "Mc" always go in capitals. It is the only thing about capitals that this profile touches.',
  }, ['Dj Lauuh', 'DJ Lauuh']),
  regla('copias', { es: 'El "(1)" del navegador', en: 'The "(1)" from the browser' }, {
    es: 'El "(1)", "(2)" que agrega el navegador o Windows cuando bajás dos veces el mismo archivo. Se saca del título; el nombre del archivo lo conserva, porque si no chocaría con el original (es un duplicado: pasalo por Duplicados).',
    en: 'The "(1)", "(2)" that your browser or Windows adds when you download the same file twice. It comes out of the title; the file name keeps it, because otherwise it would clash with the original (it is a duplicate: run it through Duplicates).',
  }, ['Tak Tiki Tax (1)', 'Tak Tiki Tax']),
  regla('acentos', { es: 'El mismo artista con y sin acentos', en: 'The same artist with and without accents' }, {
    es: 'Si un artista aparece escrito de dos formas que solo cambian en acentos o signos, queda como lo escribiste en tus carpetas o como aparece más veces. Las mayúsculas no se tocan.',
    en: 'If an artist is written in two ways that only differ in accents or marks, it stays the way you wrote it in your folders or the way it shows up most. Capitals are not touched.',
  }, ['Babasonicos', 'Babasónicos']),
  regla('diccionario', { es: 'Tu diccionario de artistas', en: 'Your artist dictionary' }, {
    es: 'Cada vez que corregís un artista a mano ("Balvin" → "J Balvin") PAILA se lo acuerda y lo propone solo en los demás temas. Lo ves, lo cambiás y lo exportás en Configuración.',
    en: 'Every time you fix an artist by hand ("Balvin" → "J Balvin") PAILA remembers it and suggests it on its own in your other tracks. You can see it, change it and export it in Settings.',
  }, ['Balvin', 'J Balvin']),
  regla('mayusculas', { es: 'Mayúsculas parejas', en: 'Even capitals' }, {
    es: 'Artistas y títulos escritos todo en minúscula o todo en mayúscula pasan a mayúscula inicial, respetando siglas (DJ, MC, AM) y nombres estilizados (CA7RIEL, YSY A, TINI, WOS). El mismo artista con distintas mayúsculas se unifica. Ojo: hay artistas que escriben sus títulos en mayúsculas a propósito.',
    en: 'Artists and titles written all in lowercase or all in capitals switch to an initial capital, respecting acronyms (DJ, MC, AM) and stylized names (CA7RIEL, YSY A, TINI, WOS). The same artist with different capitals is made the same. Careful: some artists write their titles in capitals on purpose.',
  }, ['WOS — CANGURO', 'WOS — Canguro']),
  regla('oficial', { es: 'Nombres oficiales (internet)', en: 'Official names (internet)' }, {
    es: 'Artistas y títulos como figuran en las bases de datos de música (MusicBrainz, Deezer, Discogs): otro nombre del mismo artista, letras o acentos que faltan, títulos cortados en 30 letras. Un tema cuenta como confirmado si la fuente lo tiene con la misma duración. Los títulos van como los escribe MusicBrainz, mayúsculas incluidas. Nunca se sacan acentos ni signos. Lo dudoso no se propone: va a "para mirar a mano". Hace falta buscar primero en internet.',
    en: 'Artists and titles as they appear in music databases (MusicBrainz, Deezer, Discogs): another name for the same artist, missing letters or accents, titles cut off at 30 letters. A track counts as confirmed if the source has it with the same length. Titles go the way MusicBrainz writes them, capitals included. Accents and marks are never removed. Anything doubtful is not suggested: it goes to "to look at by hand". You need to search on the internet first.',
  }, ['Los Redondos', 'Patricio Rey y sus Redonditos de Ricota']),
  regla('marcas', { es: 'Fuera las marcas propias', en: 'Remove your own marks' }, {
    es: 'Lo que se agrega al exportar o masterizar y no es parte del nombre: MASTER, MSTRD, 16bit, 24bit, (FINAL). Solo en el título: el nombre del archivo la conserva (te sirve para distinguir tu master).',
    en: 'What gets added when exporting or mastering and is not part of the name: MASTER, MSTRD, 16bit, 24bit, (FINAL). Only in the title: the file name keeps it (it helps you tell your master apart).',
  }, ['New Dawn (Original Mix) MSTRD', 'New Dawn (Original Mix)']),
]

export interface ProfileInfo { key: TidyProfile; label: string; help: string; rules: TidyRule[]; soon?: string }
const MINIMO: TidyRule[] = ['rotos', 'basura', 'vinilo']
const PROLIJO: TidyRule[] = [...MINIMO, 'aprendidas', 'feat', 'repetidos', 'djmc', 'copias', 'acentos', 'diccionario']
const RAJATABLA: TidyRule[] = [...PROLIJO, 'mayusculas', 'marcas']
// Oficial = Prolijo + los nombres de internet, títulos incluidos como los escribe MusicBrainz (decidido el 20/10/2026).
const OFICIAL: TidyRule[] = [...PROLIJO, 'oficial']
const perfil = (key: TidyProfile, label: Par, rules: TidyRule[], help: Par): ProfileInfo =>
  ({ key, rules, get label() { return tr(label) }, get help() { return tr(help) } })
export const PROFILES: ProfileInfo[] = [
  perfil('minimo', { es: 'Mínimo', en: 'Minimal' }, MINIMO, {
    es: 'Solo arregla lo que está roto: caracteres rotos y basura de páginas. Para el que ya tiene su sistema.',
    en: 'Only fixes what is broken: broken characters and junk from websites. For whoever already has their own system.',
  }),
  perfil('prolijo', { es: 'Prolijo', en: 'Neat' }, PROLIJO, {
    es: 'Además "feat." parejo, DJ y MC, artistas repetidos, el "(1)" del navegador y tu diccionario de artistas. Respeta las mayúsculas como vienen.',
    en: 'Also an even "feat.", DJ and MC, repeated artists, the "(1)" from the browser and your artist dictionary. It keeps capitals the way they come.',
  }),
  perfil('rajatabla', { es: 'Estricto', en: 'Strict' }, RAJATABLA, {
    es: 'Además mayúsculas parejas en todo y fuera las marcas propias ("MASTER", "16bit"). Todo igual, sin excepciones.',
    en: 'Also even capitals everywhere and your own marks removed ("MASTER", "16bit"). Everything the same, no exceptions.',
  }),
  perfil('oficial', { es: 'Oficial', en: 'Official' }, OFICIAL, {
    es: 'Prolijo, y además los nombres como figuran en las bases de datos de música: "J Balvin", "Patricio Rey y sus Redonditos de Ricota". Los títulos, como los escribe MusicBrainz. Necesita buscar en internet.',
    en: 'Neat, plus the names as they appear in music databases: "J Balvin", "Patricio Rey y sus Redonditos de Ricota". Titles, the way MusicBrainz writes them. It needs a search on the internet.',
  }),
]
/** El perfil por defecto respeta las mayúsculas como vienen ("hay artistas que ponen los títulos en mayúsculas"). */
export const DEFAULT_PROFILE: TidyProfile = 'prolijo'
export const rulesOf = (p: TidyProfile): TidyRule[] => PROFILES.find((x) => x.key === p)?.rules ?? PROLIJO
/** El perfil que coincide exactamente con estas reglas (o null si son "a medida"). */
export function profileOf(rules: Iterable<TidyRule>): TidyProfile | null {
  const s = new Set(rules)
  return PROFILES.find((p) => !p.soon && p.rules.length === s.size && p.rules.every((r) => s.has(r)))?.key ?? null
}
