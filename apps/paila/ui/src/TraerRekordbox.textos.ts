// Los textos de "Traer tus playlists de Rekordbox" (TraerRekordbox.tsx), en castellano y en inglés (ver @paila/shared/idioma).
import { textos, num, plural } from '@paila/shared/idioma'

/** Las ⓘ de esta sección (la clave de cada forma de encontrar un tema es la misma que usa el núcleo). */
export const TRAER_TIPS = textos({
  xml: {
    es: 'El rekordbox.xml es un archivo que Rekordbox arma con toda tu colección y tus playlists. Se hace en Rekordbox: Archivo → Exportar colección en formato xml. También podés soltarlo en la ventana de PAILA.',
    en: 'The rekordbox.xml is a file that Rekordbox builds with your whole collection and playlists. You make it in Rekordbox: File → Export Collection in xml format. You can also drop it onto the PAILA window.',
  },
  pendrive: {
    es: 'Un pendrive (o disco) que preparaste con Rekordbox para tocar en las CDJ: tiene una carpeta PIONEER con la lista de temas, las playlists, la grilla y los cue points. PAILA solo lo lee: no se toca nada.',
    en: 'A USB drive (or disk) that you prepared with Rekordbox to play on CDJs: it has a PIONEER folder with the track list, the playlists, the beat grid and the cue points. PAILA only reads it: nothing is touched.',
  },
  isrc: {
    es: 'Mismo ISRC: el código único que lleva cada grabación publicada (como un documento del tema). Si coincide, es la misma grabación.',
    en: 'Same ISRC: the unique code carried by every released recording (like an ID for the track). If it matches, it is the same recording.',
  },
  ruta: {
    es: 'Misma ruta: el tema está en la misma carpeta y con el mismo nombre que en Rekordbox.',
    en: 'Same path: the track is in the same folder and has the same name as in Rekordbox.',
  },
  archivo: {
    es: 'Mismo archivo: mismo nombre y mismo tamaño, aunque esté en otra carpeta (por ejemplo, la copia del pendrive).',
    en: 'Same file: same name and same size, even if it is in another folder (for example, the copy on the USB drive).',
  },
  huella: {
    es: 'Por cómo suena: PAILA escuchó el archivo y su huella del sonido (un resumen de cómo suena, como una huella digital) coincide con la de un tema tuyo.',
    en: 'By how it sounds: PAILA listened to the file and its sound fingerprint (a summary of how it sounds, like a fingerprint) matches one of your tracks.',
  },
  exacto: {
    es: 'Exacto por nombre: el mismo artista y el mismo título, nombre por nombre (sin contar mayúsculas, tildes ni el "feat."), la misma versión y la misma duración (±3 s). Entra solo.',
    en: 'Exact by name: the same artist and the same title, name by name (ignoring capitals, accents and "feat."), the same version and the same length (±3 s). It goes in by itself.',
  },
  probable: {
    es: 'Por nombre: mismo artista y título, y dura lo mismo (±3 s). Confirmalo: a veces hay dos temas que se llaman igual.',
    en: 'By name: same artist and title, and the same length (±3 s). Confirm it: sometimes two tracks have the same name.',
  },
  version: {
    es: 'Otra versión: el nombre coincide, pero dura distinto o uno es remix, en vivo o acústico.',
    en: 'Other version: the name matches, but the length is different or one is a remix, live or acoustic.',
  },
  none: {
    es: 'No lo tenés en tu biblioteca: va a la lista «Faltan o suenan mal», marcado con el nombre de la playlist.',
    en: 'You don\'t have it in your library: it goes to the "Missing or low quality" list, marked with the playlist name.',
  },
  baja: {
    es: 'Mala calidad: nota D o F, un MP3 inflado (de pocos kbps re-codificado a más) o un FLAC falso. Si lo sumás, aparece en la lista «Faltan o suenan mal» para buscar una versión mejor.',
    en: 'Poor quality: grade D or F, an inflated MP3 (a low-kbps file re-encoded to more) or a fake FLAC. If you add it, it shows up in the "Missing or low quality" list so you can look for a better version.',
  },
  dj: {
    es: 'Lo que Rekordbox guardó de cada tema en el pendrive: la grilla, los cue points, las estrellas y el color. Así no se pierde si se te rompe la compu: PAILA lo pone en el rekordbox.xml que exporta. Si ya trajiste tu rekordbox.xml, gana lo de ahí.',
    en: 'What Rekordbox saved for each track on the USB drive: the beat grid, the cue points, the stars and the color. That way it isn\'t lost if your computer breaks: PAILA puts it in the rekordbox.xml it exports. If you already imported your rekordbox.xml, what\'s in there wins.',
  },
})

/** Cómo se encontró cada tema (en este orden). */
export const HOW = textos({
  ruta: { es: 'misma ruta', en: 'same path' },
  archivo: { es: 'mismo archivo', en: 'same file' },
  huella: { es: 'por cómo suena', en: 'by how it sounds' },
  isrc: { es: 'mismo ISRC', en: 'same ISRC' },
  exacto: { es: 'exactos por nombre', en: 'exact by name' },
  probable: { es: 'por nombre (para confirmar)', en: 'by name (to confirm)' },
  version: { es: 'otra versión', en: 'other version' },
  none: { es: 'no los tenés', en: 'you don\'t have them' },
})

export const STATE_LABEL = textos({
  tenes: { es: 'Lo tenés', en: 'You have it' },
  baja: { es: 'En mala calidad', en: 'Poor quality' },
  revisar: { es: 'Para confirmar', en: 'To confirm' },
  falta: { es: 'No lo tenés', en: 'You don\'t have it' },
})

export const T = textos({
  intro: {
    es: 'Tus playlists de Rekordbox pasan a ser **playlists de PAILA**, armadas con lo que tenés. Lo que no tenés va a la lista **Faltan o suenan mal**. PAILA **solo lee**: Rekordbox y el pendrive no se tocan.',
    en: 'Your Rekordbox playlists become **PAILA playlists**, built with what you have. What you don\'t have goes to the **Missing or low quality** list. PAILA **only reads**: Rekordbox and the USB drive are not touched.',
  },
  verHistorial: { es: 'Ver el Historial', en: 'See History' },
  leyendo: { es: 'Leyendo…', en: 'Reading…' },
  desdeXml: { es: 'Desde mi rekordbox.xml…', en: 'From my rekordbox.xml…' },
  desdePendrive: { es: 'Desde un pendrive de CDJ…', en: 'From a CDJ USB drive…' },
  hayPendrive: { es: (d: string) => `Hay un pendrive de Rekordbox en ${d}`, en: (d: string) => `There is a Rekordbox USB drive at ${d}` },
  pendriveDe: { es: (d: string) => `Pendrive ${d}`, en: (d: string) => `USB drive ${d}` },
  deTuXml: { es: 'De tu rekordbox.xml', en: 'From your rekordbox.xml' },
  delPendrive: { es: (resto: string) => `Del pendrive${resto}`, en: (resto: string) => `From the USB drive${resto}` },
  delOtro: { es: (l: string) => `Del ${l}`, en: (l: string) => `From ${l}` },
  resumenPrev: {
    es: (l: number, t: number) => `${num(l)} playlists con ${num(t)} temas distintos.`,
    en: (l: number, t: number) => `${num(l)} ${plural(l, 'playlist', 'playlists')} with ${num(t)} different ${plural(t, 'track', 'tracks')}.`,
  },
  imprimibles: {
    es: (k: number, m: number) => `${num(k)} temas que no aparecieron están en esta compu: PAILA los puede escuchar y buscarlos por cómo suenan {info} (unos ${m} min).`,
    en: (k: number, m: number) => `${num(k)} ${plural(k, 'track that didn\'t turn up is', 'tracks that didn\'t turn up are')} on this computer: PAILA can listen to ${k === 1 ? 'it' : 'them'} and look ${k === 1 ? 'it' : 'them'} up by how they sound {info} (about ${m} min).`,
  },
  buscarSuenan: { es: 'Buscar por cómo suenan', en: 'Search by how they sound' },
  cortar: { es: 'Cortar', en: 'Stop' },
  unidad: { es: 'temas', en: 'tracks' },
  afuera: {
    es: (k: number, ej: string) => `${num(k)} ${k === 1 ? 'archivo está' : 'archivos están'} en tu compu pero no en tu biblioteca de PAILA (por ejemplo ${ej}): quedan afuera de las playlists y no van a la lista «Faltan o suenan mal» {info}`,
    en: (k: number, ej: string) => `${num(k)} ${k === 1 ? 'file is' : 'files are'} on your computer but not in your PAILA library (for example ${ej}): ${k === 1 ? 'it is' : 'they are'} left out of the playlists and ${k === 1 ? 'doesn\'t' : 'don\'t'} go to the "Missing or low quality" list {info}`,
  },
  afueraTip: {
    es: 'Suelen ser videos, proyectos o una carpeta que todavía no agregaste a PAILA. Si son música, agregá su carpeta (abajo a la izquierda, Agregar carpeta) y volvé a traer la playlist.',
    en: 'They are usually videos, projects or a folder you haven\'t added to PAILA yet. If it is music, add its folder (bottom left, Add folder) and import the playlist again.',
  },
  recuperarDj: {
    es: (k: number) => `Recuperar también lo de cabina de ${num(k)} temas que tenés`,
    en: (k: number) => `Also recover the booth data for ${num(k)} ${plural(k, 'track', 'tracks')} you have`,
  },
  detalleDj: {
    es: (g: number, c: number, s: number, col: number) => `Grilla {grilla}: ${num(g)} · cue points {cue}: ${num(c)} · estrellas: ${num(s)} · color: ${num(col)}`,
    en: (g: number, c: number, s: number, col: number) => `Beat grid {grilla}: ${num(g)} · cue points {cue}: ${num(c)} · stars: ${num(s)} · color: ${num(col)}`,
  },
  sumarBaja: {
    es: (k: number) => `Sumar también los ${num(k)} de mala calidad a la lista «Faltan o suenan mal»`,
    en: (k: number) => `Also add the ${num(k)} poor-quality ${plural(k, 'one', 'ones')} to the "Missing or low quality" list`,
  },
  sumarBajaDetalle: {
    es: 'Entran igual a las playlists. Si no lo marcás, a la Lista va solo lo que no tenés.',
    en: 'They still go into the playlists. If you don\'t tick this, only what you don\'t have goes to the "Missing or low quality" list.',
  },
  traerNombre: { es: (nombre: string) => `Traer ${nombre}`, en: (nombre: string) => `Import ${nombre}` },
  vacia: { es: 'vacía', en: 'empty' },
  deTotal: { es: (a: number, b: number) => `${num(a)} de ${num(b)}`, en: (a: number, b: number) => `${num(a)} of ${num(b)}` },
  paraConfirmar: { es: (k: number) => `${num(k)} para confirmar`, en: (k: number) => `${num(k)} to confirm` },
  paraConseguir: { es: (k: number) => `${num(k)} para conseguir`, en: (k: number) => `${num(k)} to get` },
  cerrar: { es: 'Cerrar', en: 'Close' },
  verTemas: { es: 'Ver temas', en: 'See tracks' },
  traerTitle: {
    es: 'Crea las playlists en una carpeta nueva y suma lo que falta a la lista «Faltan o suenan mal». Se deshace desde el Historial.',
    en: 'Creates the playlists in a new folder and adds what is missing to the "Missing or low quality" list. You can undo it from History.',
  },
  trayendo: { es: 'Trayendo…', en: 'Importing…' },
  traer: {
    es: (k: number) => (k === 1 ? 'Traer 1 playlist' : `Traer ${num(k)} playlists`),
    en: (k: number) => (k === 1 ? 'Import 1 playlist' : `Import ${num(k)} playlists`),
  },
  confirmarProbables: { es: 'Confirmar los probables', en: 'Confirm the likely ones' },
  confirmarProbablesTitle: {
    es: 'Dice que sí a todos los «por nombre» (mismo artista, título y duración). Las «otra versión» se confirman de a una.',
    en: 'Says yes to all the "by name" ones (same artist, title and length). The "other version" ones are confirmed one at a time.',
  },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  totales: {
    es: (have: number, total: number, get: number, check: number) => `${num(have)} de ${num(total)} temas a las playlists${get ? ` · ${num(get)} a la lista «Faltan o suenan mal»` : ''}${check ? ` · ${num(check)} sin confirmar (quedan afuera)` : ''}`,
    en: (have: number, total: number, get: number, check: number) => `${num(have)} of ${num(total)} ${plural(total, 'track', 'tracks')} to the playlists${get ? ` · ${num(get)} to the "Missing or low quality" list` : ''}${check ? ` · ${num(check)} unconfirmed (left out)` : ''}`,
  },
  listo: {
    es: (carpeta: string, pl: number, tm: number, toGet: number, g: number, c: number) => `Listo: en la carpeta «${carpeta}» quedaron ${num(pl)} playlists con ${num(tm)} temas.${toGet ? ` ${num(toGet)} fueron a la lista «Faltan o suenan mal».` : ''}${g || c ? ` Se recuperó la grilla de ${num(g)} temas y los cues de ${num(c)}.` : ''} Se deshace desde el Historial.`,
    en: (carpeta: string, pl: number, tm: number, toGet: number, g: number, c: number) => `Done: the folder "${carpeta}" now has ${num(pl)} ${plural(pl, 'playlist', 'playlists')} with ${num(tm)} ${plural(tm, 'track', 'tracks')}.${toGet ? ` ${num(toGet)} went to the "Missing or low quality" list.` : ''}${g || c ? ` Recovered the beat grid of ${num(g)} ${plural(g, 'track', 'tracks')} and the cues of ${num(c)}.` : ''} You can undo it from History.`,
  },
  toast: {
    es: (pl: number, carpeta: string) => `${num(pl)} playlists traídas a «${carpeta}»`,
    en: (pl: number, carpeta: string) => `${num(pl)} ${plural(pl, 'playlist', 'playlists')} imported to "${carpeta}"`,
  },
  // la lista de temas de una playlist
  cargando: { es: 'Cargando…', en: 'Loading…' },
  enRekordbox: { es: 'En Rekordbox', en: 'In Rekordbox' },
  enTuBiblioteca: { es: 'En tu biblioteca', en: 'In your library' },
  laNota: { es: 'La nota de calidad', en: 'The quality grade' },
  esEste: { es: 'Es este', en: 'This is it' },
  esEsteTitle: { es: 'Es el mismo tema: entra a la playlist', en: 'It is the same track: it goes into the playlist' },
  noEs: { es: 'No es', en: 'Not it' },
  noEsTitle: { es: 'No es: va a la lista «Faltan o suenan mal»', en: 'It is not: it goes to the "Missing or low quality" list' },
  confirmado: { es: 'Confirmado', en: 'Confirmed' },
  descartado: { es: 'Descartado', en: 'Discarded' },
  cambiar: { es: 'cambiar', en: 'change' },
})
