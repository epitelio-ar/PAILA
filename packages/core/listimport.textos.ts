// Los textos de "Traer las playlists de Rekordbox o de un pendrive" (core/listimport.ts), en castellano y en inglés (ver
// @paila/shared/idioma). NO están acá, y quedan como están: el `label` "Pendrive …" (se guarda y la pantalla lo reconoce
// con /^Pendrive/) y los nombres de las playlists y carpetas que se crean ("De Rekordbox", "Del pendrive", "Sin nombre").
import { cant, textos } from '@paila/shared/idioma'

export const T = textos({
  noPendrive: {
    es: 'En esa carpeta no hay un pendrive de Rekordbox: tiene que tener PIONEER/rekordbox/export.pdb.',
    en: "There's no Rekordbox USB drive in that folder: it has to have PIONEER/rekordbox/export.pdb.",
  },
  xmlVacio: { es: 'Ese rekordbox.xml no tiene temas ni playlists.', en: 'That rekordbox.xml has no tracks or playlists.' },
  pendriveVacio: { es: 'El pendrive no tiene temas ni playlists.', en: 'The USB drive has no tracks or playlists.' },
  vencio: { es: 'La vista previa venció: volvé a elegir el archivo.', en: 'The preview expired: choose the file again.' },
  fueraDeBiblioteca: {
    es: 'Está en tu compu, pero no en tu biblioteca de PAILA (un video, un proyecto o una carpeta que no agregaste)',
    en: "It's on your computer, but not in your PAILA library (a video, a project or a folder you didn't add)",
  },
  suenaIgual: { es: 'Suena igual que tu archivo (la huella del sonido coincide)', en: 'It sounds the same as your file (the sound fingerprint matches)' },
  playlistNoEsta: { es: 'Esa playlist no está en la vista previa', en: "That playlist isn't in the preview" },
  elegi: { es: 'Elegí al menos una playlist con temas', en: 'Choose at least one playlist with tracks' },
  tandaNoEsta: { es: 'Esa tanda ya no está', en: 'That batch is no longer there' },
  tandaDeshecha: { es: 'Esa tanda ya se deshizo', en: 'That batch was already undone' },
  yaDeshecho: { es: 'Ya se deshizo', en: 'Already undone' },
  resumen: {
    es: (xml: boolean, label: string, listas: number, enListas: number, total: number, toGet: number, grids: number, cues: number) => {
      const from = xml ? 'de Rekordbox (rekordbox.xml)' : `del ${label.replace(/^Pendrive/, 'pendrive')}`
      return `Se ${listas === 1 ? 'trajo 1 playlist' : `trajeron ${listas} playlists`} ${from} — ${enListas} de ${total} temas en las playlists${toGet ? `; ${toGet} a la lista «Faltan o suenan mal»` : ''}${grids ? `; grilla de ${grids} temas` : ''}${cues ? `; cues de ${cues}` : ''}`
    },
    en: (xml: boolean, label: string, listas: number, enListas: number, total: number, toGet: number, grids: number, cues: number) => {
      const from = xml ? 'from Rekordbox (rekordbox.xml)' : `from the ${label.replace(/^Pendrive/, 'USB drive')}`
      return `Brought in ${listas === 1 ? '1 playlist' : `${listas} playlists`} ${from} — ${enListas} of ${cant(total, 'track', 'tracks')} in the playlists${toGet ? `; ${toGet} to the "Missing or low quality" list` : ''}${grids ? `; beat grid for ${cant(grids, 'track', 'tracks')}` : ''}${cues ? `; cues for ${cues}` : ''}`
    },
  },
  deTemas: { es: (n: number, total: number) => `${n} de ${total} temas`, en: (n: number, total: number) => `${n} of ${cant(total, 'track', 'tracks')}` },
  noLosTenes: { es: (n: number) => `${n} no los tenés`, en: (n: number) => `${n} you don't have` },
})
