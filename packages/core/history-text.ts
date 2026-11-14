// Cómo se escriben las cosas en el Historial (core/history.ts, history-files.ts, history-replace.ts), en castellano y en
// inglés (ver @paila/shared/idioma): nombres de campos, "1 tema" / "3 temas", nombre y carpeta de un archivo, "a, b y c" y
// los resúmenes de cada tanda. Se arman al leer la lista (no se guardan): salen en el idioma de ahora. Solo se muestran.
import path from 'node:path'
import { cant, idioma, lista, num as numero, textos } from '@paila/shared/idioma'

/** Cómo se nombra cada campo en un resumen ("Se cambió el género de…"). */
export const FIELD: Readonly<Record<string, string>> = textos({
  title: { es: 'el título', en: 'the title' }, artist: { es: 'el artista', en: 'the artist' }, albumArtist: { es: 'el artista del álbum', en: 'the album artist' },
  album: { es: 'el álbum', en: 'the album' }, track: { es: 'el número de tema', en: 'the track number' }, year: { es: 'el año', en: 'the year' },
  genre: { es: 'el género', en: 'the genre' }, cover: { es: 'la tapa', en: 'the cover' }, filename: { es: 'el nombre del archivo', en: 'the file name' },
  extension: { es: 'la extensión', en: 'the extension' }, replaygain: { es: 'el volumen parejo', en: 'the even volume' },
  folderCover: { es: 'el cover.jpg de la carpeta', en: "the folder's cover.jpg" }, comment: { es: 'el comentario', en: 'the comment' },
  serato: { es: 'la grilla y los cues de Serato', en: 'the Serato grid and cues' },
  bpm: { es: 'el BPM del tag', en: 'the BPM in the tag' }, key: { es: 'el tono del tag', en: 'the key in the tag' },
})
export const FIELD_ORDER = ['artist', 'title', 'albumArtist', 'album', 'track', 'year', 'genre', 'cover', 'folderCover', 'replaygain', 'comment', 'serato', 'bpm', 'key', 'filename', 'extension']
/** El campo sin el artículo ("género", "genre"). */
export const bare = (s: string) => s.replace(/^(el|la|the) /, '')
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const P = textos({
  tema: { es: 'tema', en: 'track' }, temas: { es: 'temas', en: 'tracks' },
  archivo: { es: 'archivo', en: 'file' }, archivos: { es: 'archivos', en: 'files' },
})
export const num = (x: number) => numero(x)
export const temas = (x: number) => cant(x, P.tema, P.temas)
export const archivos = (x: number) => cant(x, P.archivo, P.archivos)
export const base = (rel: string) => path.posix.basename(rel)
export const dirOf = (rel: string) => { const d = path.posix.dirname(rel); return d === '.' ? '' : d }
/** "a, b y c" (en castellano, siempre con "y", como siempre) / "a, b and c". */
export const joinY = (xs: string[]) => idioma() === 'en' ? lista(xs) : (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

/** ¿Está conectado el disco de esta carpeta de música? (el Historial pregunta una vez por disco) */
export type Connected = (rootId: number) => boolean

/** Los textos de las tandas del Historial. */
export const H = textos({
  // comunes
  yaDeshizo: { es: 'Ya se deshizo', en: 'Already undone' },
  yaRestauro: { es: 'Ya se restauró', en: 'Already restored' },
  parteDeshecha: { es: 'Una parte de esta tanda ya se deshizo', en: 'Part of this batch was already undone' },
  discoTemas: { es: 'El disco de estos temas no está conectado', en: "The disk with these tracks isn't connected" },
  discoArchivos: { es: 'El disco de estos archivos no está conectado', en: "The disk with these files isn't connected" },
  aLaPapelera: { es: 'A la papelera', en: 'To the trash' },
  // history.ts
  noEsta: { es: 'Esa tanda ya no está en el historial', en: 'That batch is no longer in the History' },
  noSePuede: { es: 'Esa tanda no se puede deshacer', en: "That batch can't be undone" },
  vaciarNoSeDeshace: { es: 'Vaciar la papelera borra de verdad: no se puede deshacer', en: "Emptying the trash deletes for real: it can't be undone" },
  playlist: {
    es: (name: string | null, n: number) => `En ${name == null ? 'una playlist que ya no está' : `la playlist «${name}»`} se ${n === 1 ? 'cambió 1 tema por una versión mejor' : `cambiaron ${temas(n)} por versiones mejores`}`,
    en: (name: string | null, n: number) => `In ${name == null ? 'a playlist that no longer exists' : `the playlist «${name}»`}, ${n === 1 ? '1 track was swapped for a better version' : `${temas(n)} were swapped for better versions`}`,
  },
  conTapa: { es: 'con tapa', en: 'with cover' }, tapaNueva: { es: 'tapa nueva', en: 'new cover' }, sinTapa: { es: 'sin tapa', en: 'no cover' },
  acompana: { es: 'Acompaña al disco', en: 'Goes with the album' }, movido: { es: 'Movido', en: 'Moved' }, raiz: { es: '(raíz)', en: '(main folder)' },
  reemplazado: { es: 'Reemplazado', en: 'Replaced' }, convertido: { es: 'Convertido', en: 'Converted' },
  temaNoEsta: { es: '(tema que ya no está)', en: '(track no longer there)' }, versionMejor: { es: 'Versión mejor', en: 'Better version' },
  borrado: { es: 'borrado', en: 'deleted' },
  // tags, nombres, extensiones y tapas
  extension: { es: (who: string) => `Se corrigió la extensión de ${who}`, en: (who: string) => `Fixed the extension of ${who}` },
  renombro: { es: (who: string) => `Se renombró ${who}`, en: (who: string) => `Renamed ${who}` },
  renombraron: { es: (n: number) => `Se renombraron ${archivos(n)}`, en: (n: number) => `Renamed ${archivos(n)}` },
  cambio: { es: (what: string, who: string) => `Se cambió ${what} de ${who}`, en: (what: string, who: string) => `Changed ${what} of ${who}` },
  cambiaron: { es: (what: string, who: string) => `Se cambiaron ${what} de ${who}`, en: (what: string, who: string) => `Changed ${what} of ${who}` },
  datos: {
    es: (n: number, some: string, who: string) => `Se cambiaron ${num(n)} datos (${some}…) de ${who}`,
    en: (n: number, some: string, who: string) => `Changed ${num(n)} details (${some}…) of ${who}`,
  },
  yaNoEstan: { es: 'Algunos de estos temas ya no están en la biblioteca', en: 'Some of these tracks are no longer in the library' },
  // carpetas que sacaste de PAILA (roots.removed_at): lo de ahí ya no se toca, ni para deshacer
  carpetaQuitada: {
    es: (nombres: string) => `Estos temas son de una carpeta que sacaste de PAILA (${nombres}): ya no se tocan`,
    en: (nombres: string) => `These tracks are from a folder you removed from PAILA (${nombres}): they aren't touched anymore`,
  },
  quedanFuera: {
    es: (n: number, nombres: string) => n === 1 ? `Uno de estos temas es de una carpeta que sacaste de PAILA (${nombres}): ese queda como está` : `Algunos de estos temas (${num(n)}) son de una carpeta que sacaste de PAILA (${nombres}): esos quedan como están`,
    en: (n: number, nombres: string) => n === 1 ? `One of these tracks is from a folder you removed from PAILA (${nombres}): it stays as it is` : `Some of these tracks (${num(n)}) are from a folder you removed from PAILA (${nombres}): those stay as they are`,
  },
  // papelera
  mando: { es: (name: string, why: string) => `Se mandó «${name}» a la papelera${why}`, en: (name: string, why: string) => `Sent «${name}» to the trash${why}` },
  mandaron: { es: (n: number, why: string) => `Se mandaron ${temas(n)} a la papelera${why}`, en: (n: number, why: string) => `Sent ${temas(n)} to the trash${why}` },
  noRestaurables: {
    es: (n: number) => `${cap(temas(n))} ya no se ${n === 1 ? 'puede' : 'pueden'} restaurar: se vació la papelera`,
    en: (n: number) => `${cap(temas(n))} can no longer be restored: the trash was emptied`,
  },
  yaRestaurados: {
    es: (n: number) => `${cap(temas(n))} ya se ${n === 1 ? 'restauró' : 'restauraron'}`,
    en: (n: number) => `${cap(temas(n))} ${n === 1 ? 'was' : 'were'} already restored`,
  },
  // organizador y limpieza de Espacio
  limpiezaUno: { es: (name: string) => `Se mandó «${name}» (no es música) a la papelera`, en: (name: string) => `Sent «${name}» (not music) to the trash` },
  limpiezaVarios: { es: (n: number) => `Se mandaron ${archivos(n)} que no son música a la papelera`, en: (n: number) => `Sent ${archivos(n)} that aren't music to the trash` },
  aNuevas: { es: 'a carpetas nuevas', en: 'to new folders' },
  a: { es: (dir: string) => `a ${dir}`, en: (dir: string) => `to ${dir}` },
  movio: { es: (name: string, where: string) => `Se movió «${name}» ${where}`, en: (name: string, where: string) => `Moved «${name}» ${where}` },
  movieron: { es: (n: number, where: string) => `Se movieron ${temas(n)} ${where}`, en: (n: number, where: string) => `Moved ${temas(n)} ${where}` },
  acompanan: { es: (n: number) => ` (y ${archivos(n)} que los acompañan: tapas, .cue…)`, en: (n: number) => ` (and ${archivos(n)} that go with them: covers, .cue…)` },
  todosCambiaron: {
    es: 'Todos estos temas cambiaron de lugar, de nombre o se mandaron a la papelera después: deshacé primero lo más nuevo',
    en: 'All these tracks were moved, renamed or sent to the trash afterwards: undo the newest first',
  },
  algunosCambiaron: {
    es: (n: number) => `${cap(temas(n))} cambiaron de lugar, de nombre o están en la papelera desde entonces: esos quedan donde están`,
    en: (n: number) => `${cap(temas(n))} were moved, renamed or sent to the trash since then: those stay where they are`,
  },
  // reemplazos y conversiones
  temaNoEstaBib: { es: 'El tema ya no está en la biblioteca', en: 'The track is no longer in the library' },
  reemplazadoDespues: { es: 'Este tema se volvió a reemplazar después: deshacé primero ese reemplazo', en: 'This track was replaced again later: undo that replacement first' },
  enPapelera: { es: 'El tema está en la papelera: restauralo primero', en: 'The track is in the trash: restore it first' },
  desaparecido: { es: 'PAILA no encuentra el archivo del tema (figura como desaparecido)', en: "PAILA can't find the track's file (it shows as missing)" },
  discoTema: { es: 'El disco de este tema no está conectado', en: "The disk with this track isn't connected" },
  autoVarios: {
    es: (n: number) => `Se reemplazaron solos ${temas(n)} por versiones mejores (Bandeja, modo automático)`,
    en: (n: number) => `${cap(temas(n))} were replaced with better versions on their own (Inbox, automatic mode)`,
  },
  autoUno: {
    es: (name: string) => `Se reemplazó solo «${name}» por una versión mejor (Bandeja, modo automático)`,
    en: (name: string) => `«${name}» was replaced with a better version on its own (Inbox, automatic mode)`,
  },
  todos: {
    es: (n: number) => `Se reemplazaron ${temas(n)} por versiones mejores (Bandeja, «Reemplazar todos»)`,
    en: (n: number) => `Replaced ${temas(n)} with better versions (Inbox, «Replace all»)`,
  },
  reemplazo: { es: (name: string, by: string | null) => `Se reemplazó «${name}» por ${by == null ? 'otra versión' : `«${by}»`}`, en: (name: string, by: string | null) => `Replaced «${name}» with ${by == null ? 'another version' : `«${by}»`}` },
  paso: { es: (name: string, from: string, to: string) => `Se pasó «${name}» de ${from} a ${to}`, en: (name: string, from: string, to: string) => `Converted «${name}» from ${from} to ${to}` },
  pasaron: { es: (n: number, from: string, to: string) => `Se pasaron ${temas(n)} de ${from} a ${to}`, en: (n: number, from: string, to: string) => `Converted ${temas(n)} from ${from} to ${to}` },
  paraRekordbox: { es: ' (para que Rekordbox los lea)', en: ' (so Rekordbox can read them)' },
  // recortar silencios (core/trim.ts)
  recortes: { es: (n: number) => `Se recortaron los silencios de ${temas(n)}`, en: (n: number) => `Trimmed the silences of ${temas(n)}` },
  recorte: { es: (name: string) => `Se recortó el silencio de «${name}»`, en: (name: string) => `Trimmed the silence of «${name}»` },
  recortado: { es: 'Silencio recortado', en: 'Silence trimmed' },
  noDeshacibles: {
    es: (n: number, why: string) => `${cap(temas(n))} no se ${n === 1 ? 'puede' : 'pueden'} deshacer (${why}): esos quedan como están`,
    en: (n: number, why: string) => `${cap(temas(n))} can't be undone (${why}): those stay as they are`,
  },
})
