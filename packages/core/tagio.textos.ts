// Los errores de leer y escribir tags (core/tagio.ts), en castellano y en inglés (ver @paila/shared/idioma). Se ven en la
// lista de lo que no se pudo aplicar; nunca se escriben en los archivos.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  imagen: { es: 'La imagen tiene que ser JPG o PNG', en: 'The image has to be a JPG or a PNG' },
  id3v1: { es: 'El tag viejo del final (ID3v1) desapareció al guardar', en: 'The old tag at the end (ID3v1) disappeared when saving' },
  reacomodar: { es: (det: string) => `No se pudo reacomodar el M4A (${det})`, en: (det: string) => `Couldn't rearrange the M4A (${det})` },
  noSeLee: {
    es: (det: string) => `El audio de este archivo no se puede leer entero (${det}). No se tocó: puede estar dañado`,
    en: (det: string) => `The audio of this file cannot be read all the way through (${det}). It was not touched: it may be damaged`,
  },
  noSeLeeDespues: { es: (what: string) => `El audio no se puede leer después de ${what}`, en: (what: string) => `The audio cannot be read after ${what}` },
  sonidoCambio: { es: (what: string) => `El sonido cambió al ${what} (la huella del audio no coincide)`, en: (what: string) => `The sound changed when ${what} (the audio fingerprint does not match)` },
  noSeEscriben: { es: (ext: string) => `No se escriben tags en .${ext} (se rompe el archivo): convertilo primero`, en: (ext: string) => `Tags are not written to .${ext} files (it breaks the file): convert it first` },
  yaNoEsta: { es: 'El archivo ya no está', en: 'The file is no longer there' },
  esWebm: { es: (ext: string) => `Se llama .${ext} pero por dentro es un video WebM (como los que se bajan de YouTube): no se le pueden escribir tags; convertilo primero`, en: (ext: string) => `It is called .${ext} but inside it is a WebM video (like the ones downloaded from YouTube): tags cannot be written to it; convert it first` },
  porDentro: {
    es: (ext: string, real: string) => `Se llama .${ext} pero por dentro es ${real}. No se tocó: corregí la extensión en "Arreglar nombres y tags" → Extensiones equivocadas, y volvé a intentar`,
    en: (ext: string, real: string) => `It is called .${ext} but inside it is ${real}. It was not touched: fix the extension in "Fix names and tags" → Wrong extensions, and try again`,
  },
  wmaCampo: { es: (k: string) => `En un WMA solo se escriben los datos de texto y el volumen parejo (no ${k}): convertilo primero`, en: (k: string) => `In a WMA only the text data and the even volume are written (not ${k}): convert it first` },
  wmaConTapa: { es: 'Este WMA trae la tapa adentro: al guardarle los tags se perdería como tapa, así que no se tocan; convertilo primero', en: 'This WMA has the cover inside: saving its tags would lose it as a cover, so they are not touched; convert it first' },
  wmaFfmpeg: { es: (det: string) => `No se pudieron guardar los tags del WMA (${det})`, en: (det: string) => `Couldn't save the WMA tags (${det})` },
  noSeCopian: { es: (ext: string) => `No se pueden copiar tags a un .${ext}: convertilo primero`, en: (ext: string) => `Tags cannot be copied to a .${ext} file: convert it first` },
  noSeCopiaron: { es: (det: string) => `No se pudieron copiar los tags al archivo nuevo (${det})`, en: (det: string) => `Couldn't copy the tags to the new file (${det})` },
  /** Lo que se estaba haciendo, para "El sonido cambió al …". */
  alCopiar: { es: 'copiarle los tags al archivo nuevo', en: 'copying the tags to the new file' },
})
