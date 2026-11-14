// Problemas que PAILA detecta en los temas (calidad falsa, sin tags, dañado...), con su explicación, y las notas.
import type { Grade, Track } from '@paila/shared/types'
import { GRADES, PROBLEM_TESTS, hasFlag, type ProblemKey } from '@paila/shared/trackinfo'
import { GRADE_SCORE } from '@paila/shared/tableview'
import { textos } from '@paila/shared/idioma'

// Qué temas entran en cada problema está en shared/trackinfo.ts (también lo usa el proceso principal).
export { GRADES, GRADE_SCORE, hasFlag, type ProblemKey }

const T = textos({
  fakeLosslessL: { es: 'Lossless falsos', en: 'Fake lossless' },
  fakeLosslessH: { es: 'Dicen ser FLAC/WAV/AIFF (sin pérdida), pero adentro tienen un MP3 convertido: ocupan mucho y suenan como el MP3.', en: "They say they're FLAC/WAV/AIFF (lossless), but inside they're a converted MP3: they take up a lot of space and sound like the MP3." },
  asRecordedL: { es: 'Suenan como fueron grabados', en: 'Sound as recorded' },
  asRecordedH: { es: 'No llegan hasta arriba de todo, pero sin ningún rastro de MP3: los agudos bajan de a poco (vinilos, cintas, masters viejos o nuevos) o se cortan donde lo dice el disco (los sacó un programa para CD o vienen de una tienda). PAILA los da por buenos (B): no hace falta hacer nada.', en: "They don't reach the very top, but there's no trace of MP3: the highs fade out gradually (vinyl, tapes, old or new masters) or cut off where the disc itself does (ripped with a CD program or bought from a store). PAILA counts them as good (B): there's nothing to do." },
  mp3likeL: { es: 'Pueden venir de un MP3', en: 'May come from an MP3' },
  mp3likeH: { es: 'Sin pérdida que suenan completos, pero los agudos se cortan de golpe en 19,5 kHz, justo donde los corta un MP3 de muy buena calidad (unos 256 kbps). Pueden ser el master (algunos CD vienen así) o un MP3 que alguien pasó a FLAC: no hay ningún otro rastro. Para escuchar están bien (B); si querés el original sin pérdida, buscalo con NAPIA o la Bandeja.', en: "Lossless files that sound complete, but the highs cut off sharply at 19.5 kHz, right where a very good MP3 (about 256 kbps) cuts them. They may be the master (some CDs come like that) or an MP3 someone converted to FLAC: there's no other trace. They're fine for listening (B); if you want the lossless original, look for it with NAPIA or the Inbox." },
  upscaledL: { es: 'MP3 inflados', en: 'Inflated MP3s' },
  upscaledH: { es: 'Dicen tener más kbps de los que tienen de verdad: alguien pasó un MP3 de mala calidad a uno "de 320".', en: 'They claim more kbps than they really have: someone turned a poor-quality MP3 into a "320".' },
  fakeHiresL: { es: 'Hi-Res falsos', en: 'Fake Hi-Res' },
  fakeHiresH: { es: 'Dicen ser de alta resolución (96 kHz o 24 bits) pero tienen calidad de CD. No suenan mejor y ocupan el doble.', en: "They say they're high resolution (96 kHz or 24 bits) but they're CD quality. They don't sound better and take up twice the space." },
  lowL: { es: 'Calidad baja (D o F)', en: 'Low quality (D or F)' },
  lowH: { es: 'Temas que con auriculares o un buen equipo se nota que suenan mal: conviene conseguir una versión mejor.', en: 'Tracks that clearly sound bad on headphones or a good sound system: you should get a better version.' },
  damagedL: { es: 'Dañados', en: 'Damaged' },
  damagedH: { es: 'Archivos que no se pueden leer enteros: pueden cortarse o hacer ruido en medio del tema.', en: "Files that can't be read all the way through: they may cut out or make noise in the middle of the track." },
  noTagsL: { es: 'Sin tags', en: 'No tags' },
  noTagsH: { es: 'Les falta el artista o el título adentro del archivo. Rekordbox y los pendrives los muestran mal.', en: 'They have no artist or title inside the file. Rekordbox and USB sticks show them wrong.' },
  missingL: { es: 'Desaparecidos', en: 'Missing' },
  missingH: { es: 'No se encontraron en el disco en el último escaneo (¿los borraste, o el disco estaba desconectado?). PAILA no los borra: siguen en tus playlists y vuelven solos si reaparecen, aunque estén en otra carpeta o con otro nombre.', en: "They weren't found on the disk in the last scan (did you delete them, or was the disk unplugged?). PAILA doesn't delete them: they stay in your playlists and come back on their own if they reappear, even in another folder or under another name." },
  rekordboxL: { es: 'Rekordbox no los lee', en: "Rekordbox can't read them" },
  rekordboxH: { es: 'WMA, OGG, Opus y WebM no se pueden cargar en Rekordbox ni en los CDJ. Hay que convertirlos.', en: "WMA, OGG, Opus and WebM can't be loaded in Rekordbox or on CDJs. They need to be converted." },
  bpmL: { es: 'BPM dudoso', en: 'Doubtful BPM' },
  bpmH: { es: 'PAILA mide el BPM de dos maneras y en estos temas no coinciden (ni al doble ni a la mitad). Contra Rekordbox, en esos casos se acierta solo 1 de cada 6: conviene revisarlo a oído.', en: "PAILA measures the BPM two ways and for these tracks they don't match (not even double or half). Compared with Rekordbox, it's right only 1 time in 6 in those cases: check it by ear." },
  silenceL: { es: 'Silencio largo al empezar o al terminar', en: 'Long silence at the start or end' },
  silenceH: { es: 'Tardan 2 segundos o más en arrancar, o quedan 5 segundos o más callados al final (más que la pausa normal entre temas de un CD). En una playlist o en aleatorio se nota como un hueco. Se pueden recortar sin perder calidad, con vista previa y deshacer.', en: 'They take 2 seconds or more to start, or stay silent for 5 seconds or more at the end (longer than the usual gap between CD tracks). In a playlist or on shuffle it feels like a hole. They can be trimmed without losing quality, with a preview and undo.' },
  gAplus: { es: 'Hi-Res real: más calidad que un CD.', en: 'Real Hi-Res: better quality than a CD.' },
  gA: { es: 'Calidad CD real (sin pérdida de verdad).', en: 'Real CD quality (truly lossless).' },
  gB: { es: 'MP3/AAC de buena calidad (256–320 kbps reales). Suena muy bien para escuchar y para tocar.', en: 'Good-quality MP3/AAC (256–320 real kbps). Sounds great for listening and for playing out.' },
  gC: { es: 'Calidad media (~192 kbps), o dudosa: un vinilo o master viejo con los agudos que bajan de a poco, o un archivo de 32 kHz. Con auriculares o un buen equipo se nota.', en: 'Medium quality (~192 kbps), or doubtful: an old vinyl or master with highs that fade out gradually, or a 32 kHz file. You can hear it on headphones or a good sound system.' },
  gD: { es: 'Calidad baja o dudosa. Conviene reemplazarlo.', en: 'Low or doubtful quality. You should replace it.' },
  gF: { es: 'Calidad muy baja, falsa o archivo dañado. Hay que reemplazarlo.', en: 'Very low quality, fake or a damaged file. It needs to be replaced.' },
})

export interface Problem { key: ProblemKey; label: string; help: string; test: (t: Track) => boolean; quality?: boolean }

// Las tarjetas de Inicio. Cada una filtra la tabla al hacerle clic.
export const PROBLEMS: Problem[] = [
  { key: 'fake_lossless', label: T.fakeLosslessL, quality: true, test: PROBLEM_TESTS.fake_lossless, help: T.fakeLosslessH },
  { key: 'as_recorded', label: T.asRecordedL, quality: true, test: PROBLEM_TESTS.as_recorded, help: T.asRecordedH },
  { key: 'mp3like', label: T.mp3likeL, quality: true, test: PROBLEM_TESTS.mp3like, help: T.mp3likeH },
  { key: 'upscaled', label: T.upscaledL, quality: true, test: PROBLEM_TESTS.upscaled, help: T.upscaledH },
  { key: 'fake_hires', label: T.fakeHiresL, quality: true, test: PROBLEM_TESTS.fake_hires, help: T.fakeHiresH },
  { key: 'low', label: T.lowL, quality: true, test: PROBLEM_TESTS.low, help: T.lowH },
  { key: 'damaged', label: T.damagedL, quality: true, test: PROBLEM_TESTS.damaged, help: T.damagedH },
  { key: 'no_tags', label: T.noTagsL, test: PROBLEM_TESTS.no_tags, help: T.noTagsH },
  { key: 'missing', label: T.missingL, test: PROBLEM_TESTS.missing, help: T.missingH },
  { key: 'rekordbox', label: T.rekordboxL, test: PROBLEM_TESTS.rekordbox, help: T.rekordboxH },
  { key: 'bpm_doubtful', label: T.bpmL, test: PROBLEM_TESTS.bpm_doubtful, help: T.bpmH },
  { key: 'silence', label: T.silenceL, test: PROBLEM_TESTS.silence, help: T.silenceH },
]

export const GRADE_HELP: Record<Grade, string> = {
  'A+': T.gAplus, A: T.gA, B: T.gB, C: T.gC, D: T.gD, F: T.gF,
}
