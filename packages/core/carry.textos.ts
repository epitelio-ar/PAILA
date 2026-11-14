// Los textos de "Llevar la música" al celular (core/carry.ts), en castellano y en inglés (ver @paila/shared/idioma). Solo
// lo que se ve en la pantalla: los nombres que se escriben en el destino ("Playlist", "Artista desconocido", "tema 3") no.
import { cant, num, textos } from '@paila/shared/idioma'

const gbEn = (b: number) => num(b / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const T = textos({
  originalOjo: { es: (ext: string) => `Original: se copia tal cual, pero ojo: muchos celulares no leen .${ext}`, en: (ext: string) => `Original: it's copied as is, but watch out: many phones don't play .${ext}` },
  original: { es: 'Original: se copia tal cual, sin convertir', en: "Original: it's copied as is, without converting" },
  sinPerdida: { es: (fmt: string, k: number) => `${fmt} sin pérdida: se achica a ${k} kbps y ocupa mucho menos`, en: (fmt: string, k: number) => `Lossless ${fmt}: it's shrunk to ${k} kbps and takes up much less space` },
  yaEs: {
    es: (fmt: string, src: number | null) => `Ya es ${fmt}${src ? ` de ${src} kbps` : ''}: se copia tal cual (no se agranda)`,
    en: (fmt: string, src: number | null) => `It's already ${src ? `${src} kbps ` : ''}${fmt}: it's copied as is (it isn't made bigger)`,
  },
  seAchica: {
    es: (fmt: string, src: number, k: number, pct: number) => `${fmt} de ${src} kbps: se achica a ${k} y ocupa ${pct} % menos`,
    en: (fmt: string, src: number, k: number, pct: number) => `${src} kbps ${fmt}: it's shrunk to ${k} and takes up ${pct}% less`,
  },
  noLeen: {
    es: (ext: string, fmt: string, k: number) => `Muchos celulares no leen .${ext}: se pasa a ${fmt} de ${k} kbps`,
    en: (ext: string, fmt: string, k: number) => `Many phones don't play .${ext}: it's turned into ${k} kbps ${fmt}`,
  },
  yaNoEnBiblioteca: { es: 'Ya no está en la biblioteca', en: "It's no longer in the library" },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  yaNoEsta: { es: 'El archivo ya no está', en: 'The file is no longer there' },
  formatosRaros: {
    es: (n: number) => `${n} ${n === 1 ? 'tema está' : 'temas están'} en formatos que muchos celulares no leen (WMA, AIFF…): con una calidad que no sea Original se convierten solos`,
    en: (n: number) => `${cant(n, 'track is', 'tracks are')} in formats many phones don't play (WMA, AIFF…): with any quality other than Original they're converted automatically`,
  },
  sinLugarCompu: {
    es: (falta: number, hay: number) => `No alcanza el lugar en la compu para preparar los temas antes de pasarlos: hacen falta ${(falta / 1e9).toFixed(2)} GB y hay ${(hay / 1e9).toFixed(2)} GB libres`,
    en: (falta: number, hay: number) => `There isn't enough space on the computer to get the tracks ready before sending them: ${gbEn(falta)} GB are needed and there are ${gbEn(hay)} GB free`,
  },
  sinLugar: {
    es: (falta: number, hay: number) => `No alcanza el lugar: hacen falta ${(falta / 1e9).toFixed(2)} GB y hay ${(hay / 1e9).toFixed(2)} GB libres`,
    en: (falta: number, hay: number) => `There isn't enough space: ${gbEn(falta)} GB are needed and there are ${gbEn(hay)} GB free`,
  },
  dentroAviso: {
    es: 'El destino está dentro de tu biblioteca: elegí otra carpeta (si no, PAILA va a ver las copias como temas repetidos)',
    en: "The destination is inside your library: choose another folder (otherwise PAILA will see the copies as duplicate tracks)",
  },
  dentro: { es: 'El destino está dentro de tu biblioteca: elegí otra carpeta', en: 'The destination is inside your library: choose another folder' },
  noSePisa: { es: 'Ya hay un archivo con ese nombre y es distinto: no se pisa', en: "There's already a different file with that name: it isn't overwritten" },
  sinDiscoOArchivo: { es: 'El disco no está conectado o el archivo ya no está', en: "The drive isn't connected or the file is no longer there" },
  incompleta: { es: 'La copia quedó incompleta', en: 'The copy came out incomplete' },
  sinTags: { es: (e: string) => `No se pudieron poner los tags en la copia (${e})`, en: (e: string) => `Couldn't put the tags on the copy (${e})` },
  cortado: {
    es: (real: string, dice: string) => `El original ya está cortado: se escucha hasta ${real} aunque dice durar ${dice}. La copia suena igual que el original.`,
    en: (real: string, dice: string) => `The original is already cut short: it plays up to ${real} even though it says it lasts ${dice}. The copy sounds the same as the original.`,
  },
  noDura: { es: (a: string, b: string) => `La copia convertida no dura lo mismo (${a} s → ${b} s)`, en: (a: string, b: string) => `The converted copy doesn't have the same length (${a} s → ${b} s)` },
  tapaCarpeta: { es: 'Se le puso en la copia la tapa de su carpeta.', en: 'The cover from its folder was added to the copy.' },
})
