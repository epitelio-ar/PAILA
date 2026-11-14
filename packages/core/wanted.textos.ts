// Los textos de la lista «Faltan o suenan mal» que arma el núcleo (core/wanted.ts), en castellano y en inglés (ver @paila/shared/idioma).
import { textos, type Idioma } from '@paila/shared/idioma'

/**
 * La calidad de hoy y lo que conviene conseguir, en el idioma elegido (también en el .csv exportado, que lo lee una persona).
 * WantedList.tsx saca "· nota X" / "· grade X".
 */
export const Q = {
  es: {
    sinAnalizar: 'sin analizar', nota: 'nota', noLoTenes: 'No lo tenés', elTema: 'El tema (en la mejor calidad que consigas)',
    deVerdad: 'FLAC o WAV de verdad (calidad CD)', puedeMp3: 'El original sin pérdida (FLAC o WAV de una tienda o del CD)', flac: 'FLAC (calidad CD) o, si no hay, MP3 320 kbps',
    rekordbox: (ext: string) => `El mismo tema en MP3 320, AIFF o FLAC (Rekordbox no lee .${ext})`, mejor: 'Una versión mejor',
  },
  en: {
    sinAnalizar: 'not analyzed', nota: 'grade', noLoTenes: "You don't have it", elTema: 'The track (in the best quality you can get)',
    deVerdad: 'A real FLAC or WAV (CD quality)', puedeMp3: 'The lossless original (FLAC or WAV from a store or the CD)', flac: "FLAC (CD quality) or, if there isn't one, MP3 320 kbps",
    rekordbox: (ext: string) => `The same track in MP3 320, AIFF or FLAC (Rekordbox can't read .${ext})`, mejor: 'A better version',
  },
} satisfies Record<Idioma, unknown>

export const T = textos({
  estadoDesconocido: { es: 'Estado desconocido', en: 'Unknown status' },
  temaDesconocido: { es: 'Tema desconocido', en: 'Unknown track' },
  faltaTitulo: { es: 'Falta el título', en: 'The title is missing' },
  // el .csv exportado sale en el idioma de la app (lo lee una persona; decidido el 23/10). "Traer una lista" lee los dos.
  csvHead: {
    es: 'Artista;Título;Álbum;Duración;Calidad actual;Conviene conseguir;Estado;Pedido',
    en: 'Artist;Title;Album;Duration;Current quality;Worth getting;Status;Request',
  },
  pedido: { es: 'pedido', en: 'requested' },
  nuevo: { es: 'nuevo', en: 'new' },
})
