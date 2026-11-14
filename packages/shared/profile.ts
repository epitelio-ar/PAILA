// "Herramientas para DJ y producción": una sola opción, apagada de fábrica (decidido el 22/10: sin perfiles, "pero que no esté
import { tr } from '@paila/shared/idioma'
// demasiado escondido"). Reemplaza al perfil de uso de antes (escuchar / DJ / producción). Puro, sin interfaz.
// Prende las columnas de BPM y tono, la sección "Para DJs", el botón Cabina y el rango de BPM por género. Nunca esconde
// nada para siempre: se prende y apaga desde la barra lateral, Configuración y Ctrl+K.

/** Dónde se guarda (tabla `settings`): '1' prendidas, '0' apagadas; sin valor = todavía no se decidió. */
export const DJ_TOOLS_SETTING = 'dj_tools'

/** Cuándo se le ofreció prenderlas (una sola vez, o nunca si ya las prendió o apagó a mano). */
export const DJ_TOOLS_OFFERED = 'dj_tools.ofrecido'

/** Lo de antes: el perfil de uso y su pregunta de una vez. Solo se leen para pasar a quien ya había elegido. */
export const LEGACY_USE_PROFILE = 'use_profile'
export const USE_PROFILE_ASKED = 'use_profile.preguntado'

export const DJ_TOOLS_NAME = tr({ es: 'Herramientas para DJ y producción', en: 'DJ and production tools' })
export const DJ_TOOLS_HELP = tr({ es: 'Suma el BPM y el tono en la tabla y en la ficha, la sección "DJ y producción" de la barra lateral (programas de DJ, armar un set, qué lee tu equipo), el botón Cabina y el rango de BPM por género. Si no pinchás ni producís, no las necesitás. Se prenden y se apagan cuando quieras.', en: "Adds BPM and key to the table and the track details, the \"DJ and production\" section in the sidebar (DJ software, building a set, what your gear can read), the Booth button and the BPM range by genre. If you don't DJ or produce, you don't need them. Turn them on and off whenever you like." })

/** Lo guardado en `settings.dj_tools`: true / false, o null si todavía no se decidió. */
export function parseDjTools(raw: string | null | undefined): boolean | null {
  return raw === '1' ? true : raw === '0' ? false : null
}

/** Quien ya había elegido DJ o producción queda con las herramientas prendidas; quien dijo "ver todo" en la pregunta, también. */
export function legacyDjTools(rawUses: string | null | undefined, asked: string | null | undefined): boolean {
  if (rawUses) {
    try {
      const v = JSON.parse(rawUses) as unknown
      if (Array.isArray(v)) return v.includes('dj') || v.includes('produccion')
    } catch { /* se ignora lo que no se entiende */ }
  }
  return !!asked // "Ahora no (ver todo)": había pedido ver todo
}

/** Lo que vale: lo decidido ahora, o si no, lo que salga de la elección de antes (sin nada de antes: apagadas). */
export function resolveDjTools(stored: string | null | undefined, rawUses: string | null | undefined, asked: string | null | undefined): boolean {
  return parseDjTools(stored) ?? legacyDjTools(rawUses, asked)
}

/** Lo que PAILA mira en la biblioteca para saber si pinchás (core/djsignals.ts lo saca de la base). */
export interface DjSignals {
  /** Temas visibles. */
  tracks: number
  /** Temas con el BPM o el tono ya escritos (en el tag o en el nombre del archivo). */
  withBpmOrKey: number
  /** Nombres de las carpetas de la biblioteca (cada tramo del camino). */
  folders: string[]
  /** Se trajo un rekordbox.xml (o lo de Serato). */
  imported: boolean
}

/** Muchos temas con BPM o tono: al menos tantos, y una parte importante de la biblioteca. */
export const OFFER_MIN_TRACKS = 50
export const OFFER_MIN_SHARE = 0.2

const DJ_FOLDER = /^_?(sets?|dj ?sets?|rekordbox|serato|pioneer)_?$/i

/** Por qué parece que pinchás (frases para mostrar). Vacío = no se ofrece. */
export function djOfferReasons(s: DjSignals): string[] {
  const why: string[] = []
  if (s.withBpmOrKey >= OFFER_MIN_TRACKS && s.tracks > 0 && s.withBpmOrKey / s.tracks >= OFFER_MIN_SHARE) why.push('muchos de tus temas ya traen el BPM o el tono')
  const folder = s.folders.find((f) => DJ_FOLDER.test(f.trim()))
  if (folder) why.push(`tenés una carpeta «${folder.trim()}»`)
  if (s.imported) why.push('trajiste datos de Rekordbox o Serato')
  return why
}

/** Frase de ejemplo para explicar la calidad: con las herramientas prendidas suma el equipo de cabina. */
export function qualityExample(djTools: boolean): string {
  const home = 'Con auriculares o un buen equipo se nota la diferencia'
  return djTools ? `${home}, y en un equipo grande de cabina todavía más.` : `${home}.`
}

/** Columnas que se ven de entrada en la tabla de temas. */
export function defaultColumns<K extends string>(djTools: boolean, base: readonly K[], dj: readonly K[]): K[] {
  return djTools ? [...base, ...dj] : [...base]
}
