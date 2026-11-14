// Los motivos de los nombres oficiales (core/official.ts), en castellano y en inglés (ver @paila/shared/idioma). Se ven en
// "para mirar a mano" y en "se proponen con un aviso"; nunca se escriben en los archivos.
import { cant, num, textos } from '@paila/shared/idioma'

export const T = textos({
  /** Cómo se unen dos fuentes o más: "MusicBrainz y Deezer". */
  y: { es: ' y ', en: ' and ' },
  alias: { es: (lead: string, name: string) => `"${lead}" es otro nombre de ${name}`, en: (lead: string, name: string) => `"${lead}" is another name for ${name}` },
  completo: { es: (name: string) => `el nombre completo es ${name}`, en: (name: string) => `the full name is ${name}` },
  malEscrito: { es: (name: string) => `parece mal escrito: es ${name}`, en: (name: string) => `it looks misspelled: it is ${name}` },
  asiLoEscribe: { es: (src: string) => `así lo escribe ${src}`, en: (src: string) => `that is how ${src} writes it` },
  confirmado: { es: (srcs: string) => `confirmado con el tema en ${srcs}`, en: (srcs: string) => `confirmed with the track on ${srcs}` },
  noCoinciden: { es: 'las fuentes no coinciden', en: 'the sources do not agree' },
  sinDuracion: { es: 'sin poder comparar la duración', en: 'without being able to compare the length' },
  unaFuente: { es: 'una sola fuente', en: 'only one source' },
  comoEn: {
    es: (mayusculas: boolean, src: string) => `${mayusculas ? 'mayúsculas' : 'acentos'} como en ${src}`,
    en: (mayusculas: boolean, src: string) => `${mayusculas ? 'capitals' : 'accents'} as on ${src}`,
  },
  cortado: {
    es: (n: number, src: string) => `el título estaba cortado en ${n} letras (tags viejos); completo según ${src}`,
    en: (n: number, src: string) => `the title was cut off at ${n} letters (old tags); complete according to ${src}`,
  },
  loEscribe: { es: (src: string, x: string) => ` (${src} lo escribe "${x}")`, en: (src: string, x: string) => ` (${src} writes it "${x}")` },
  signos: { es: (src: string, x: string) => `${src} lo escribe "${x}" (cambian signos: miralo)`, en: (src: string, x: string) => `${src} writes it "${x}" (the symbols change: take a look)` },
  acoustid: {
    es: (pct: number, nombres: number, clash: boolean, named: boolean) =>
      `reconocido por el sonido en AcoustID (parecido ${pct} %${nombres > 1 ? `; hay ${nombres} nombres posibles` : ''}${clash ? '; no coincide con lo que ya tenía' : ''}${named ? '; el nombre del archivo dice otra cosa' : ''})`,
    en: (pct: number, nombres: number, clash: boolean, named: boolean) =>
      `recognized by its sound on AcoustID (${pct}% similar${nombres > 1 ? `; there are ${cant(nombres, 'possible name', 'possible names')}` : ''}${clash ? '; it does not match what it already had' : ''}${named ? '; the file name says something else' : ''})`,
  },
  audd: {
    es: (album: string | null) => `reconocido por el sonido con AudD (15 s de audio)${album ? `; disco "${album}"` : ''}`,
    en: (album: string | null) => `recognized by its sound with AudD (${num(15)} s of audio)${album ? `; album "${album}"` : ''}`,
  },
})
