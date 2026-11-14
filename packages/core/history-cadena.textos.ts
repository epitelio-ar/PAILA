// Los textos del deshacer encadenado y de "Volver a como estaba" (core/history-cadena.ts, core/history.ts), en castellano y en inglés.
import { cant, num, textos } from '@paila/shared/idioma'
import { joinY } from './history-text'

const minus = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export const C = textos({
  aplicaste: {
    es: (total: number, partes: string[]) => `Aplicaste ${cant(total, 'cambio', 'cambios')}: ${joinY(partes)}`,
    en: (total: number, partes: string[]) => `Applied ${cant(total, 'change', 'changes')}: ${joinY(partes)}`,
  },
  pPapelera: { es: (n: number) => `${num(n)} a la papelera`, en: (n: number) => `${num(n)} to the trash` },
  pTags: { es: (n: number) => `${num(n)} de nombres y tags`, en: (n: number) => `${num(n)} names and tags` },
  pMover: { es: (n: number) => `${cant(n, 'tema movido', 'temas movidos')}`, en: (n: number) => `${cant(n, 'track moved', 'tracks moved')}` },
  pTapas: { es: (n: number) => `${cant(n, 'tapa', 'tapas')}`, en: (n: number) => `${cant(n, 'cover', 'covers')}` },
  pReemplazos: { es: (n: number) => `${cant(n, 'copia mejor', 'copias mejores')}`, en: (n: number) => `${cant(n, 'better copy', 'better copies')}` },
  pCarpetas: { es: (n: number) => `${cant(n, 'carpeta vacía sacada', 'carpetas vacías sacadas')}`, en: (n: number) => `${cant(n, 'empty folder removed', 'empty folders removed')}` },
  hayCadena: {
    es: (n: number) => `Después de esta ${n === 1 ? 'vino otra tanda que la toca' : `vinieron ${num(n)} tandas que la tocan`}: se deshacen juntas o no se deshace (para no dejarla a medias)`,
    en: (n: number) => `After this one came ${n === 1 ? 'another batch that touches it' : `${num(n)} batches that touch it`}: they're undone together or not at all (so it isn't left half-done)`,
  },
  cadenaNoSe: {
    es: (summary: string, why: string | null) => `Para deshacer esta hay que deshacer antes «${summary}», y esa no se puede${why ? `: ${minus(why)}` : ''}`,
    en: (summary: string, why: string | null) => `To undo this one, «${summary}» has to be undone first, and it can't be${why ? `: ${minus(why)}` : ''}`,
  },
  puntoNoSe: {
    es: (summary: string, why: string | null) => `No se puede volver ahí: «${summary}» no se puede deshacer${why ? ` (${minus(why)})` : ''}`,
    en: (summary: string, why: string | null) => `Can't go back there: «${summary}» can't be undone${why ? ` (${minus(why)})` : ''}`,
  },
  noEsPunto: { es: 'Ese punto ya no está: alguien deshizo ese Aplicar', en: "That point is gone: that Apply was already undone" },
  sinPartes: { es: 'Las partes de este Aplicar ya no están en el Historial', en: "This Apply's parts are no longer in the History" },
})
