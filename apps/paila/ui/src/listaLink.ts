// El link de Spotify que alguien pegó en «Traer una lista» (y nada más que eso). Un CSV de Exportify también nombra
// «spotify:album:…» en cada fila: pegado entero NO es un link, es la lista (hallazgo 7 de la revisión del 02/11).
const SPOTIFY = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(?:playlist|album)\/[A-Za-z0-9]+|spotify:(?:playlist|album):[A-Za-z0-9]+/

/** El link, si lo pegado es un solo renglón con un link de una playlist o un disco de Spotify; si no, null. */
export function linkDeSpotify(texto: string): string | null {
  const renglones = texto.split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
  if (renglones.length !== 1) return null
  return renglones[0].match(SPOTIFY)?.[0] ?? null
}
