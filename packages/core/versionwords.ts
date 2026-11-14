// Las palabras que dicen que un tema es otra versión (remix, edit, en vivo, remaster…) y las que son créditos o partes
// ("feat.", "Vol. 2"), en un solo lugar. Las usan Duplicados (dupnames.ts), las palabras aprendidas (junkwords.ts), las
// listas (listmatch.ts), Arreglar nombres (names.ts), la lista «Faltan o suenan mal» (wanted.ts), los discos completos
// (albumcheck.ts) y las otras búsquedas de NAPIA (sockseek/reintento.ts): una palabra nueva acá vale para todos. Cada uno
// elige qué grupos mira y, si alguna no le sirve, la deja afuera con su motivo.

/** Las palabras, en minúscula y sin tildes (las tildes se aceptan solas: "versión", "acústico"). */
export const VERSION_GROUPS = {
  /** Otra mezcla o edición de la misma grabación. */
  mezcla: ['remix', 'rmx', 'mix', 'edit', 're-edit', 'reedit', 'rework', 'reworx', 'rebassed', 'dub', 'bootleg', 'vip', 'flip', 'refix', 'mashup', 'remezcla', 'version', 'extended', 'club', 'radio'],
  /** Grabado en vivo. */
  vivo: ['live', 'en vivo', 'vivo', 'en directo', 'directo'],
  /** Otra grabación del mismo tema (además de en vivo). */
  grabacion: ['unplugged', 'acoustic', 'acustico', 'acustica', 'instrumental', 'acapella', 'acappella', 'accapella', 'a cappella', 'cappella', 'demo', 'karaoke', 'orchestral', 'sinfonico', 'alternate', 'outtake'],
  /** La misma grabación, remasterizada. */
  remaster: ['remaster', 'remastered', 'remasterizado', 'remasterizada'],
  /** Cómo salió publicada o quién la canta ("Single Version", "Mono", un "Cover"). */
  tipo: ['single', 'mono', 'stereo', 'cover'],
  /** Créditos: quién más participa o la produjo. */
  credito: ['feat', 'ft', 'featuring', 'with', 'con', 'prod', 'produced'],
  /** Partes o lugar en un disco. */
  parte: ['original', 'reprise', 'intro', 'outro', 'vol', 'part', 'pt', 'cd', 'disc', 'lado', 'side'],
} as const satisfies Record<string, readonly string[]>

export type VersionGroup = keyof typeof VERSION_GROUPS
export const ALL_VERSION_GROUPS = Object.keys(VERSION_GROUPS) as VersionGroup[]

const ACCENTS: Record<string, string> = { a: '[aá]', e: '[eé]', i: '[ií]', o: '[oó]', u: '[uúü]' }
const pattern = (w: string) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&').replace(/[aeiou]/g, (v) => ACCENTS[v])

export interface VersionOpts {
  /** Palabras de esos grupos que no sirven en ese lugar. */
  except?: readonly string[]
  /** Palabras que solo sirven en ese lugar. */
  extra?: readonly string[]
  /** Dónde tiene que estar: en cualquier lado (sola, como palabra entera), al principio o al final del texto. */
  at?: 'start' | 'end'
  /** Se suman a la "i" (por ejemplo "g" para reemplazar todas). */
  flags?: string
}

/** Las palabras de esos grupos, sin las de `except` y con las de `extra`. */
export function versionWords(groups: readonly VersionGroup[], opts: Pick<VersionOpts, 'except' | 'extra'> = {}): string[] {
  const out = new Set<string>([...groups.flatMap((g) => VERSION_GROUPS[g]), ...(opts.extra ?? [])])
  for (const w of opts.except ?? []) out.delete(w)
  return [...out]
}

/** Una expresión que encuentra esas palabras enteras, sin importar mayúsculas ni tildes. */
export function versionRe(groups: readonly VersionGroup[], opts: VersionOpts = {}): RegExp {
  const alt = `(?:${versionWords(groups, opts).map(pattern).join('|')})`
  const src = opts.at === 'start' ? `^\\s*${alt}\\b` : opts.at === 'end' ? `\\b${alt}$` : `\\b${alt}\\b`
  return new RegExp(src, `i${opts.flags ?? ''}`)
}
