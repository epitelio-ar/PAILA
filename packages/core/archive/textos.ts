// Los textos de los lectores de ZIP y RAR (archive/read.ts, zipread.ts, rarread.ts, libarchive.ts), en castellano y en
// inglés (ver @paila/shared/idioma): por qué un tema de adentro no se puede abrir o sacar. Se guardan en la base (lo que tiene
// cada comprimido) en el idioma del momento y solo se muestran. Los nombres de lo que se saca no pasan por acá: no cambian.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  clave: { es: 'Tiene clave', en: 'It has a password' },
  claveNoAbre: { es: 'Tiene clave: PAILA no lo puede abrir', en: "It has a password: PAILA can't open it" },
  faltaParte: { es: (p: string) => `Falta la parte ${p}`, en: (p: string) => `Part ${p} is missing` },
  solidoPartido: {
    es: 'Está en un rar "sólido" partido en varias partes: sacalo con otro programa',
    en: 'It\'s in a "solid" rar split into several parts: take it out with another program',
  },
  noEsZipNiRar: { es: 'No es un ZIP ni un RAR', en: "It isn't a ZIP or a RAR" },
  cancelado: { es: 'Cancelado', en: 'Cancelled' },
  lectorCerrado: { es: (code: number) => `El lector de comprimidos se cerró (código ${code})`, en: (code: number) => `The archive reader closed (code ${code})` },
  noAdentro: { es: 'No se encontró adentro del comprimido', en: "It wasn't found inside the archive" },
  noDesdeAdentro: { es: 'No se puede abrir desde adentro', en: "It can't be opened from inside" },
  noSePudo: { es: 'No se pudo sacar', en: "Couldn't take it out" },
  // zip
  zipSinIndice: { es: 'No es un zip o está cortado (no tiene el índice del final)', en: "It isn't a zip or it's cut short (it's missing the index at the end)" },
  zipCortado: { es: 'El zip está cortado (falta una parte del final)', en: "The zip is cut short (part of the end is missing)" },
  zipIndiceDanado: { es: 'El índice del zip está dañado', en: "The zip's index is damaged" },
  zipSinArchivo: { es: 'El zip está dañado: no se encontró el archivo donde dice el índice', en: "The zip is damaged: the file wasn't where the index says" },
  zipOtroLector: { es: 'Este archivo del zip necesita otro lector', en: 'This file in the zip needs another reader' },
  zipNoCoincide: { es: 'El zip está dañado: lo que salió no coincide con lo que dice el zip', en: "The zip is damaged: what came out doesn't match what the zip says" },
  zipNoSacar: { es: (m: string) => `No se pudo sacar del zip: ${m}`, en: (m: string) => `Couldn't take it out of the zip: ${m}` },
  // rar
  rarDanado: { es: 'El rar está dañado (encabezado roto)', en: 'The rar is damaged (broken header)' },
  rarSiguiente: { es: 'No se sabe cómo se llama la parte siguiente', en: "PAILA can't tell what the next part is called" },
  rarNoParte: { es: (n: string) => `"${n}" no es una parte de este rar`, en: (n: string) => `"${n}" isn't a part of this rar` },
  rarNoEs: { es: 'No es un rar (o es uno muy viejo)', en: "It isn't a rar (or it's a very old one)" },
  rarCortado: { es: 'El rar está cortado', en: 'The rar is cut short' },
  // libarchive
  muyGrande: {
    es: 'Es muy grande para abrirlo desde adentro (hace falta leer más de 1,5 GB): sacalo entero con otro programa',
    en: "It's too big to open from inside (it would mean reading more than 1.5 GB): take it all out with another program",
  },
  sinMemoria: { es: 'No hay memoria suficiente para abrirlo', en: "There isn't enough memory to open it" },
  cortado: { es: 'El comprimido está cortado', en: 'The archive is cut short' },
  noLeer: { es: (m: string) => `No se pudo leer el comprimido: ${m}`, en: (m: string) => `Couldn't read the archive: ${m}` },
  noDescomprimir: { es: (m: string) => `No se pudo descomprimir: ${m}`, en: (m: string) => `Couldn't decompress it: ${m}` },
  danado: { es: 'el comprimido está dañado', en: 'the archive is damaged' },
})
