// Las pestañas que avanzan de izquierda a derecha (DECISIONES 01/11, opción D de docs/diseno/repensar-usabilidad.md): cada
// pantalla vive en una pestaña, y adentro las partes van en el orden en que conviene hacerlas. La barra de pestañas
// (Pestanas.tsx) y la barra lateral (Sidebar.tsx, que muestra las partes de la pestaña elegida) salen de acá.
import { tr } from '@paila/shared/idioma'
import type { IconName } from './icons'
import type { PageKey } from './nav'
import type { ClaveEstado } from './Estado.lista'

export type SeccionId = 'inicio' | 'musica' | 'ordenar' | 'sonido' | 'llevar' | 'dj'

export interface Seccion {
  id: SeccionId
  label: string
  help: string
  /** Las pantallas, en orden. Las de DJ se ven solo con las herramientas para DJ prendidas. */
  partes: PageKey[]
  /** Pantallas que son detalle de esta pestaña: la pestaña se ve marcada cuando estás en ellas, pero no tienen renglón en la barra
   * lateral (se llega desde un botón de la pestaña). */
  detalle?: PageKey[]
  /** Las partes del estado de la colección que dicen si la pestaña está hecha (sin partes: no muestra estado). */
  pasos: ClaveEstado[]
  /** Pestaña fija (sin número): lleva este ícono en vez del número del paso. */
  icono?: IconName
}

/** Las pantallas que se ven solo con las herramientas para DJ prendidas. */
export const SOLO_DJ: ReadonlySet<PageKey> = new Set<PageKey>(['rekordbox', 'setbuilder', 'separar', 'tracklist'])

/** Las herramientas sueltas (MASTERPLAN-5, etapa 6): no son parte de ningún trabajo de las pestañas. Viven en un grupo plegado
 * de la barra lateral («Herramientas») y no marcan ninguna pestaña. */
export const HERRAMIENTAS: readonly PageKey[] = ['stats', 'space', 'comprimidos']

/** Las pestañas que se ven solo con las herramientas para DJ prendidas (todas sus partes son de DJ). */
export const PESTANA_SOLO_DJ: ReadonlySet<SeccionId> = new Set<SeccionId>(['dj'])

/** MASTERPLAN-5, 1 (DECISIONES 02/11): Inicio · Tu música · Ordenar · Sonido · Llevar · DJ. */
export const SECCIONES: Seccion[] = [
  { id: 'inicio', icono: 'home', label: tr({ es: 'Inicio', en: 'Home' }), help: tr({ es: 'PAILA escucha tu música y te cuenta cómo está: el estado y los problemas', en: 'PAILA listens to your music and tells you how it is: the status and the problems' }), partes: ['home', 'problemas'], detalle: ['progress'], pasos: ['escuchar'] },
  { id: 'musica', icono: 'note', label: tr({ es: 'Tu música', en: 'Your music' }), help: tr({ es: 'Tus temas, tus playlists (también para traer una lista de otro programa) y lo que suena', en: 'Your tracks, your playlists (also to bring in a list from another program) and what is playing' }), partes: ['library', 'playlists', 'escuchando'], detalle: ['requests', 'folderpl'], pasos: [] },
  { id: 'ordenar', label: tr({ es: 'Ordenar', en: 'Organize' }), help: tr({ es: 'Todo lo que PAILA propone para tu música en una sola lista; abajo, cada herramienta por separado (repetidos, nombres, internet, tapas y carpetas)', en: 'Everything PAILA suggests for your music in a single list; below, each tool on its own (repeats, names, internet, covers and folders)' }), partes: ['ordenar', 'dups', 'online', 'tidy', 'albums', 'organize'], pasos: ['repetidos', 'internet', 'nombres', 'tapas', 'carpetas'] },
  { id: 'sonido', label: tr({ es: 'Sonido', en: 'Sound' }), help: tr({ es: 'Conseguir mejores copias de lo que suena mal (con NAPIA), el volumen parejo y los silencios', en: 'Get better copies of what sounds bad (with NAPIA), even volume and silences' }), partes: ['sonido', 'wishlist', 'inbox', 'volumen', 'silencios'], pasos: ['sonido'] },
  { id: 'llevar', label: tr({ es: 'Llevar', en: 'Take along' }), help: tr({ es: 'Llevar tu música al celular, al auto o al pendrive', en: 'Take your music to your phone, your car or a USB drive' }), partes: ['carry'], pasos: [] },
  { id: 'dj', icono: 'headphones', label: tr({ es: 'DJ', en: 'DJ' }), help: tr({ es: 'Las herramientas para DJ y producción: programas de DJ, grilla y cue points, armar un set, separar voz y el tracklist de un set', en: 'The DJ and production tools: DJ software, beat grid and cue points, building a set, separating vocals and the tracklist of a set' }), partes: ['rekordbox', 'setbuilder', 'separar', 'tracklist'], pasos: [] },
]

/** Las pestañas que se ven: la de DJ solo con las herramientas para DJ prendidas. */
export const pestanasVisibles = (djTools: boolean) => SECCIONES.filter((s) => djTools || !PESTANA_SOLO_DJ.has(s.id))

/** La pestaña de una pantalla (null: Historial, Papelera, Configuración, las herramientas sueltas y el modo avanzado: no son pasos). La ficha va con Tu música. */
export function seccionDe(page: PageKey): Seccion | null {
  if (page === 'ficha') return SECCIONES.find((s) => s.id === 'musica')!
  return SECCIONES.find((s) => s.partes.includes(page) || s.detalle?.includes(page)) ?? null
}

/** Las partes que se ven de una pestaña. */
export const partesDe = (s: Seccion, djTools: boolean) => s.partes.filter((p) => djTools || !SOLO_DJ.has(p))

/** Hecha: todos sus pasos están hechos. Sin pasos, nunca se muestra como hecha. */
export const hecha = (s: Seccion, hechos: ReadonlySet<ClaveEstado>) => s.pasos.length > 0 && s.pasos.every((p) => hechos.has(p))

/** La última parte que abriste de cada pestaña: tocar la pestaña vuelve ahí (si no, a la primera). */
const ULTIMA = 'paila.seccion.ultima'
export function ultimaParte(s: Seccion, djTools: boolean): PageKey {
  const partes = partesDe(s, djTools)
  try { const p = (JSON.parse(localStorage.getItem(ULTIMA) ?? '{}') as Record<string, PageKey>)[s.id]; if (p && partes.includes(p)) return p } catch { /* sin almacenamiento */ }
  return partes[0]
}
export function recordarParte(page: PageKey) {
  const s = seccionDe(page)
  if (!s) return
  try { const m = JSON.parse(localStorage.getItem(ULTIMA) ?? '{}') as Record<string, PageKey>; m[s.id] = page; localStorage.setItem(ULTIMA, JSON.stringify(m)) } catch { /* sin almacenamiento */ }
}
