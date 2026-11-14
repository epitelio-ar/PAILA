// «Traer una lista»: pegar un CSV de Exportify no es pegar un link de Spotify (hallazgo 7, 02/11): el CSV nombra «spotify:album:…» en cada fila.
import { describe, expect, it } from 'vitest'
import { linkDeSpotify } from '../apps/paila/ui/src/listaLink'

describe('linkDeSpotify', () => {
  it('un link solo, de playlist o disco', () => {
    expect(linkDeSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toBe('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
    expect(linkDeSpotify('  spotify:album:4aawyAB9vmqN3uQ7FjRGTy \n')).toBe('spotify:album:4aawyAB9vmqN3uQ7FjRGTy')
  })
  it('un CSV de Exportify pegado entero no es un link', () => {
    const csv = ['Track URI,Track Name,Album URI,Artist Name(s)', 'spotify:track:1,Tema,spotify:album:4aawyAB9vmqN3uQ7FjRGTy,Soda Stereo', 'spotify:track:2,Otro,spotify:album:4aawyAB9vmqN3uQ7FjRGTy,Soda Stereo'].join('\n')
    expect(linkDeSpotify(csv)).toBeNull()
  })
  it('un CSV de un solo renglón con la cabecera tampoco, ni texto cualquiera', () => {
    expect(linkDeSpotify('Soda Stereo - De música ligera')).toBeNull()
    expect(linkDeSpotify('')).toBeNull()
  })
})
