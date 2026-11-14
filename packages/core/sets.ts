// Sets y en vivo: los temas largos que son un set, un enganchado, un recital o un disco entero en un solo archivo.
// Decidido el 20/10/2026: "si dice set es un set, no siempre será 'mi set' pero es un set". Se proponen para la
// colección "Sets y en vivo" y ni el asistente de nombres ni el Organizador les inventan "Artista - Título".
import { textos } from '@paila/shared/idioma'

// El porqué se ve en la pantalla; quien lo usa solo mira si hay uno o no (null), así que se puede traducir.
const T = textos({
  largo: { es: (m: number) => `Dura ${m} minutos: es un set, un enganchado, un recital o un disco entero en un solo archivo`, en: (m: number) => `It lasts ${m} minutes: it's a set, a mix, a concert or a whole album in a single file` },
  palabra: { es: (m: number, w: string) => `Dura ${m} minutos y el nombre dice "${w}"`, en: (m: number, w: string) => `It lasts ${m} minutes and the name says "${w}"` },
  artistas: { es: (m: number) => `Dura ${m} minutos y el nombre enumera varios artistas: parece un enganchado`, en: (m: number) => `It lasts ${m} minutes and the name lists several artists: it looks like a mix` },
  sinTags: { es: (m: number) => `Dura ${m} minutos, no tiene artista ni título y el nombre no dice "Artista - Tema": parece un enganchado o un set`, en: (m: number) => `It lasts ${m} minutes, it has no artist or title and the name doesn't say "Artist - Track": it looks like a mix or a set` },
})

/** Más de 15 minutos con una de estas palabras en el nombre (del archivo o de su carpeta). */
const SET_MINUTES = 15
/** Más de 40 minutos es un set (o un disco entero) diga lo que diga el nombre. */
const LONG_MINUTES = 40
// "enganchado", "enganchados" y hasta "ENGANCHANDO" (así estaba escrito en un nombre)
// (los bordes miran solo letras y números: en "_ENGANCHANDO" el "_" no es parte de la palabra)
// (21/10/2026) también los nombres de enganchados que no dicen "set": "BATALLA DE CUMBI4S", "medley", "popurrí", "previa"
const WORDS = /(?<![\p{L}\p{N}])(?:sets?|enganch(?:ad|and)\p{L}*|mix|megamix|mixtape|medley|popurr[ií]|batalla|previa|live|en vivo|concierto|recital)(?![\p{L}\p{N}])/iu
// "(Original Mix)", "[Extended Mix]": la versión de un tema, no un enganchado
const VERSION_MIX = /[([][^)\]]*\bmix\b[^)\]]*[)\]]/gi

/**
 * Por qué este tema es un set (o null si no lo parece). `rel` = ruta relativa; `seconds` = duración; `tags` = artista y
 * título de los tags, para mirar la forma: un archivo largo sin artista ni título cuyo nombre no dice "Artista - Tema" es un
 * enganchado ("BATALLA DE CUMBI4S _The La Planta Antonio Rios…"), y "Echoes" de Pink Floyd (24 minutos, con sus tags) no.
 */
export function setReason(rel: string, seconds: number | null | undefined, tags?: { artist: string | null; title: string | null }): string | null {
  const mins = (seconds ?? 0) / 60
  if (mins <= SET_MINUTES) return null
  const m = Math.round(mins)
  if (mins > LONG_MINUTES) return T.largo(m)
  const base = rel.replace(/\.[^./]+$/, '')
  const w = base.replace(VERSION_MIX, '').match(WORDS)
  if (w) return T.palabra(m, w[0].toLowerCase())
  const file = base.slice(base.lastIndexOf('/') + 1)
  if ((file.match(/,/g) ?? []).length >= 3) return T.artistas(m)
  if (tags && !tags.artist?.trim() && !tags.title?.trim() && !/\s[-–]\s/.test(file)) return T.sinTags(m)
  return null
}
