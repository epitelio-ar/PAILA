// El aviso de las vistas previas de Organizar y Arreglar nombres: cuántos temas que están en Rekordbox cambian de lugar o de
// nombre de archivo (los cuenta core/rbmoving.ts), y qué hacer para que Rekordbox no los pierda.
import { Aviso, Info, Rico } from '@paila/diseno'
import { num, plural, textos } from '@paila/shared/idioma'

const T = textos({
  lugar: {
    es: (k: number) => `**${num(k)}** ${plural(k, 'tema que está en Rekordbox cambia', 'temas que están en Rekordbox cambian')} de lugar: Rekordbox ${plural(k, 'lo', 'los')} va a perder hasta que vuelvas a importar {info}`,
    en: (k: number) => `**${num(k)}** ${plural(k, 'track that is in Rekordbox moves', 'tracks that are in Rekordbox move')}: Rekordbox will lose ${plural(k, 'it', 'them')} until you import again {info}`,
  },
  nombre: {
    es: (k: number) => `**${num(k)}** ${plural(k, 'tema que está en Rekordbox cambia', 'temas que están en Rekordbox cambian')} de nombre de archivo: Rekordbox ${plural(k, 'lo', 'los')} va a perder hasta que vuelvas a importar {info}`,
    en: (k: number) => `**${num(k)}** ${plural(k, 'track that is in Rekordbox gets', 'tracks that are in Rekordbox get')} a new file name: Rekordbox will lose ${plural(k, 'it', 'them')} until you import again {info}`,
  },
  formato: {
    es: (k: number) => `**${num(k)}** ${plural(k, 'tema que está en Rekordbox pasa', 'temas que están en Rekordbox pasan')} a FLAC: cambia la extensión, Rekordbox ${plural(k, 'lo', 'los')} va a perder hasta que vuelvas a importar, y muchas CDJ no leen FLAC {info}`,
    en: (k: number) => `**${num(k)}** ${plural(k, 'track that is in Rekordbox becomes', 'tracks that are in Rekordbox become')} FLAC: the extension changes, Rekordbox will lose ${plural(k, 'it', 'them')} until you import again, and many CDJs can't play FLAC {info}`,
  },
  tip: {
    es: 'Rekordbox reconoce cada tema por dónde está: la carpeta y el nombre del archivo. Si PAILA lo mueve o le cambia el nombre, en Rekordbox queda como "falta archivo". El camino: después de aplicar, exportá el XML desde Programas de DJ e importalo en Rekordbox; cada tema entra como nuevo, con su grilla, cues y estrellas. Después sacá desde Rekordbox los que quedaron como faltantes.',
    en: 'Rekordbox recognizes each track by where it is: the folder and the file name. If PAILA moves it or renames it, Rekordbox shows it as "file missing". The way through: after applying, export the XML from DJ programs and import it into Rekordbox; each track comes in as new, with its grid, cues and stars. Then remove the ones left as missing from inside Rekordbox.',
  },
})

/**
 * `n`: cuántos temas que están en Rekordbox cambian; `que`: si se mueven (Organizar), cambian de nombre (Arreglar nombres) o
 * de formato (Espacio, WAV → FLAC).
 */
export function AvisoRekordbox({ n, que }: { n: number | undefined; que: 'lugar' | 'nombre' | 'formato' }) {
  if (!n) return null
  return <Aviso tone="atencion" style={{ margin: 'var(--sp-3) 0' }}><Rico texto={T[que](n)} partes={{ info: <Info tip={T.tip} /> }} /></Aviso>
}
