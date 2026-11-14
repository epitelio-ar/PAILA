// Los textos de recortar silencios (core/trim.ts, core/trimfile.ts y core/trimmp3.ts), en castellano y en inglés (ver
// @paila/shared/idioma): por qué un tema no se recorta, el antes y el después de Cambios pendientes, y por qué no se pudo
// recortar un archivo. Nada de esto se escribe en los archivos.
import { textos } from '@paila/shared/idioma'

const formatos = { es: 'solo MP3, FLAC, WAV y AIFF', en: 'only MP3, FLAC, WAV and AIFF' }

export const T = textos({
  // por qué no se propone (la lista "No se recortan")
  samplePacks: { es: 'Los sample packs no se recortan', en: 'Sample packs are never trimmed' },
  soloMusica: { es: 'Solo se recortan los temas de la Música y de Para revisar', en: 'Only tracks in Music and To review are trimmed' },
  formato: {
    es: (ext: string) => `Los .${ext} no se recortan sin recodificar (por ahora, ${formatos.es})`,
    en: (ext: string) => `.${ext} files can't be trimmed without re-encoding (for now, ${formatos.en})`,
  },
  otroFormato: {
    es: (ext: string, codec: string) => `Dice ser .${ext} pero adentro es otro formato (${codec}): primero hay que arreglar la extensión o convertirlo`,
    en: (ext: string, codec: string) => `It says .${ext} but it's another format inside (${codec}): fix the extension or convert it first`,
  },
  sinDisco: { es: 'El disco no está conectado o el archivo ya no está', en: "The drive isn't connected or the file is no longer there" },
  noSeLeyo: { es: (why: string) => `No se pudo leer: ${why}`, en: (why: string) => `It couldn't be read: ${why}` },
  todoSilencio: { es: 'Todo el tema está en silencio', en: 'The whole track is silent' },
  golpe: {
    es: (lado: 'start' | 'end' | 'both') => `Hay un ruido suelto que se oye en el silencio ${lado === 'start' ? 'del principio' : lado === 'end' ? 'del final' : 'del principio y del final'} (un clic, o el comienzo del tema siguiente): de ese lado no se corta`,
    en: (lado: 'start' | 'end' | 'both') => `There's an audible stray noise in the silence at the ${lado === 'start' ? 'start' : lado === 'end' ? 'end' : 'start and end'} (a click, or the start of the next track): that side isn't trimmed`,
  },
  soloFinal: { es: 'Solo el final: tiene marcas de Rekordbox o Serato (cues, grilla) que se correrían', en: 'Only the end: it has Rekordbox or Serato marks (cues, beatgrid) that would shift' },
  corto: {
    es: 'Lo callado del todo es corto: el tema se apaga (o arranca) muy despacito, o tiene un ruido de fondo bajito (una cinta, un vinilo, el público), y eso no se corta',
    en: "The fully silent part is short: the track fades out (or in) very slowly, or has a quiet background noise (a tape, a vinyl, a crowd), and that isn't trimmed",
  },
  // el antes y el después en Cambios pendientes
  dura: { es: (d: string) => `Dura ${d}`, en: (d: string) => `Lasts ${d}` },
  queda: {
    es: (d: string, inicio: string | null, fin: string | null) => `Dura ${d}: sin ${[inicio && `${inicio} al empezar`, fin && `${fin} al terminar`].filter(Boolean).join(' y ')} de silencio`,
    en: (d: string, inicio: string | null, fin: string | null) => `Lasts ${d}: without ${[inicio && `${inicio} at the start`, fin && `${fin} at the end`].filter(Boolean).join(' and ')} of silence`,
  },
  // al aplicar
  noEnBiblioteca: { es: 'El tema ya no está en la biblioteca', en: 'The track is no longer in the library' },
  cambio: { es: 'El archivo cambió desde la vista previa: volvé a buscar los silencios', en: 'The file changed since the preview: search for the silences again' },
  marcasNuevas: {
    es: 'Después de proponer el recorte se trajeron marcas de Rekordbox o Serato (cues, grilla): cortar el principio las correría. Volvé a buscar los silencios',
    en: 'Rekordbox or Serato marks (cues, beatgrid) were brought in after the trim was proposed: cutting the start would shift them. Search for the silences again',
  },
  // al cortar el archivo (core/trimfile.ts y core/trimmp3.ts)
  rf64: { es: 'WAV de más de 4 GB (RF64): no se recorta', en: 'WAV over 4 GB (RF64): not trimmed' },
  noWav: { es: 'No es un WAV común', en: 'Not a regular WAV' },
  noAiff: { es: 'No es un AIFF común', en: 'Not a regular AIFF' },
  noFlac: { es: 'No es un FLAC', en: 'Not a FLAC' },
  faltaAudio: { es: (f: string) => `Al ${f} le falta el formato o el audio`, en: (f: string) => `The ${f} is missing its format or its audio` },
  comprimido: { es: (f: string) => `${f} con audio comprimido adentro: no se recorta`, en: (f: string) => `${f} with compressed audio inside: not trimmed` },
  hojaCue: { es: 'El FLAC tiene una hoja de cue adentro: no se recorta el principio', en: "The FLAC has a cue sheet inside: the start isn't trimmed" },
  ffmpeg: { es: (code: number | null) => `ffmpeg terminó con código ${code}`, en: (code: number | null) => `ffmpeg ended with code ${code}` },
  noVerifica: { es: 'No se pudo verificar el audio', en: "The audio couldn't be verified" },
  masLargo: { es: 'El MP3 recortado dura más que el original: no se usa', en: 'The trimmed MP3 is longer than the original: not used' },
  noSuenaIgual: { es: (f: string) => `El ${f} recortado no suena igual que el original: no se usa`, en: (f: string) => `The trimmed ${f} doesn't sound the same as the original: not used` },
  noDura: { es: 'El MP3 recortado no dura lo que tenía que durar: no se usa', en: "The trimmed MP3 doesn't last as long as it should: not used" },
  noFormato: { es: (ext: string) => `Los .${ext} no se recortan (${formatos.es})`, en: (ext: string) => `.${ext} files aren't trimmed (${formatos.en})` },
  sinCuadros: { es: 'No se encontraron cuadros de MP3 que se puedan recortar sin recodificar', en: "No MP3 frames were found that can be trimmed without re-encoding" },
  roto: { es: 'El MP3 tiene partes rotas: no se recorta sin recodificar', en: "The MP3 has broken parts: it isn't trimmed without re-encoding" },
  vbri: { es: 'MP3 con cabecera VBRI (Fraunhofer): no se recorta', en: 'MP3 with a VBRI header (Fraunhofer): not trimmed' },
  casiNada: { es: 'Quedaría casi nada del tema: no se recorta', en: 'Almost nothing of the track would be left: not trimmed' },
  algoEntre: { es: 'El MP3 tiene algo entre los tags y el audio: no se recorta sin recodificar', en: "The MP3 has something between the tags and the audio: it isn't trimmed without re-encoding" },
})
