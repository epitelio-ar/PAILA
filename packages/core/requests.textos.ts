// Los textos de "Traer una lista de otro lado" (core/requests.ts), en castellano y en inglés (ver @paila/shared/idioma).
// Los nombres que PAILA les pone a las playlists ("Lista pegada…", "Pedido", "Playlist") NO están acá: son nombres de
// playlists (se pueden exportar) y quedan como están.
import { cant, textos } from '@paila/shared/idioma'

export const T = textos({
  linkSpotify: {
    es: 'Es un link de Spotify: PAILA no lee la página de Spotify. Bajá el CSV de la playlist en Chosic o Exportify y traelo acá',
    en: "That's a Spotify link: PAILA doesn't read the Spotify page. Download the playlist's CSV from Chosic or Exportify and bring it here",
  },
  sinTemas: {
    es: 'No se encontró ningún tema en la lista: fijate que tenga un "Artista - Título" por línea o las columnas de un CSV de Spotify',
    en: 'No tracks were found in the list: check that it has one "Artist - Title" per line or the columns of a Spotify CSV',
  },
  mismoArchivo: { es: 'Es el mismo archivo (mismo nombre y tamaño), en otra carpeta', en: "It's the same file (same name and size), in another folder" },
  versionPedida: {
    es: 'La versión que pide la lista (elegiste «Los dos»: la tuya ya está en la playlist). Cuando llegue, entra al lado',
    en: 'The version the list asks for (you chose «Both»: yours is already in the playlist). When it arrives, it goes in next to it',
  },
  pedidoVacio: { es: 'El pedido no tiene temas', en: 'The request has no tracks' },
  temaNoEsta: { es: 'Ese tema ya no está en el pedido', en: "That track is no longer in the request" },
  yaEnMusica: { es: (n: string) => `Ya está en tu Música y en la playlist «${n}»`, en: (n: string) => `It's already in your Music and in the playlist «${n}»` },
  pedidoNoEsta: { es: 'Ese pedido ya no está', en: "That request is no longer there" },
  pedidoDeshecho: { es: 'Ese pedido ya se deshizo', en: 'That request was already undone' },
  resumen: {
    es: (n: string, src: string, inList: number, total: number, toGet: number, revisar: number) =>
      `Se trajo la lista «${n}» (${src}): playlist con ${inList} de ${total} temas${toGet ? `; ${toGet} a la lista «Faltan o suenan mal»` : ''}${revisar ? `; ${revisar} sin confirmar` : ''}`,
    en: (n: string, src: string, inList: number, total: number, toGet: number, revisar: number) =>
      `Brought in the list «${n}» (${src}): playlist with ${inList} of ${cant(total, 'track', 'tracks')}${toGet ? `; ${toGet} to the "Missing or low quality" list` : ''}${revisar ? `; ${revisar} not confirmed` : ''}`,
  },
  yaDeshecho: { es: 'Ya se deshizo', en: 'Already undone' },
  borradaAMano: { es: 'La playlist ya se borró a mano', en: 'The playlist was already deleted by hand' },
  tenes: { es: 'Lo tenés', en: 'You have it' },
  baja: { es: 'En mala calidad', en: 'Poor quality' },
  falta: { es: 'No lo tenés', en: "You don't have it" },
  revisar: { es: 'Sin confirmar', en: 'Not confirmed' },
})
