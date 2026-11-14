// Diccionario de artistas propio (MASTERPLAN-2, 4.4): cada corrección del usuario ("Balvin" → "J Balvin") se recuerda y
// el asistente "Arreglar nombres y tags" la propone sola la próxima vez (regla "Tu diccionario"). Se puede exportar e
// importar (un archivo .json para pasarle a otra persona). Una entrada "X → X" quiere decir "así está bien: no lo cambies".
import type { Db } from './db'
import { artistParts, isSeparator } from './artists'
import { fold, loose } from './names'
import { textos } from '@paila/shared/idioma'

// por qué no se pudo importar un diccionario (se ve en Configuración); el archivo exportado no se traduce: es un formato
const T = textos({
  noSeLee: { es: 'El archivo no es un diccionario de PAILA (no se pudo leer)', en: 'The file is not a PAILA dictionary (it could not be read)' },
  noEs: { es: 'El archivo no es un diccionario de artistas de PAILA', en: 'The file is not a PAILA artist dictionary' },
})

export type DictOrigin = 'edicion' | 'aceptado' | 'importado' | 'a mano'
export interface DictEntry { from: string; to: string; origin: DictOrigin; createdAt: string }
export const DICT_FORMAT = 'paila-diccionario-de-artistas'

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)
/**
 * ¿Parece una corrección del mismo nombre? ("Balvin" → "J Balvin", "Los Redondos" → "Patricio Rey y sus Redonditos de
 * Ricota", "The Weekend" → "The Weeknd"). Si cambia a otro artista ("cumbia" → "Damas Gratis") no se aprende solo:
 * aplicarlo a todos los temas con ese artista sería un error.
 */
export function sameName(from: string, to: string): boolean {
  const a = words(from), b = words(to)
  if (loose(from) === loose(to)) return true
  for (const x of a) for (const y of b) {
    if (x === y && x.length >= 4) return true
    let k = 0
    while (k < x.length && k < y.length && x[k] === y[k]) k++
    if (k >= 5) return true
  }
  // errores de tipeo: casi todas las letras en el mismo orden
  const la = loose(from), lb = loose(to)
  let same = 0
  for (let i = 0, j = 0; i < la.length && j < lb.length; ) { if (la[i] === lb[j]) { same++; i++; j++ } else if (la.length - i > lb.length - j) i++; else j++ }
  return Math.min(la.length, lb.length) >= 5 && same / Math.max(la.length, lb.length) >= 0.8
}

export class ArtistDict {
  constructor(private db: Db) {}

  list(): DictEntry[] {
    return (this.db.prepare('SELECT from_name AS "from", to_name AS "to", origin, created_at AS createdAt FROM artist_dict ORDER BY from_name COLLATE NOCASE').all() as unknown as DictEntry[])
  }
  /** fold(nombre) → cómo se escribe. */
  map(): Map<string, string> { return new Map(this.list().map((e) => [fold(e.from), e.to])) }

  set(from: string, to: string, origin: DictOrigin) {
    const f = from.trim(), t = to.trim()
    if (!f || !t) return
    this.db.prepare('INSERT INTO artist_dict (key, from_name, to_name, origin, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET from_name = excluded.from_name, to_name = excluded.to_name, origin = excluded.origin, created_at = excluded.created_at')
      .run(fold(f), f, t, origin, new Date().toISOString())
  }
  remove(from: string) { this.db.prepare('DELETE FROM artist_dict WHERE key = ?').run(fold(from)) }

  /**
   * Aprende de un cambio de artista hecho por el usuario: el nombre entero o, si los dos tienen las mismas partes
   * ("Balvin feat. Bad Bunny" → "J Balvin feat. Bad Bunny"), cada parte que cambió. Devuelve cuántas entradas guardó.
   */
  learn(from: string | null, to: string | null, origin: DictOrigin): number {
    if (!from?.trim() || !to?.trim() || from.trim() === to.trim()) return 0
    const pa = artistParts(from).filter((p) => !isSeparator(p)).map((p) => p.trim())
    const pb = artistParts(to).filter((p) => !isSeparator(p)).map((p) => p.trim())
    // un invitado agregado ("Emilia" → "Emilia feat. TINI") es de ese tema, no del artista: solo cuenta el principal
    const pairs: [string, string][] = pa.length === pb.length ? pa.map((p, i) => [p, pb[i]]) : pa.length === 1 && pb.length > 1 ? [[pa[0], pb[0]]] : []
    let n = 0
    for (const [a, b] of pairs) if (a !== b && sameName(a, b)) { this.set(a, b, origin); n++ }
    return n
  }

  /** El artista con las correcciones del diccionario (por partes: "Balvin & Bad Bunny" → "J Balvin & Bad Bunny"). */
  static apply(artist: string, dict: Map<string, string>): string {
    if (!dict.size) return artist
    const whole = dict.get(fold(artist))
    if (whole) return whole
    return artistParts(artist).map((p) => (isSeparator(p) ? p : p.replace(p.trim(), dict.get(fold(p.trim())) ?? p.trim()))).join('')
  }

  export(): string {
    return JSON.stringify({ formato: DICT_FORMAT, version: 1, exportado: new Date().toISOString(), artistas: this.list().map(({ from, to }) => ({ de: from, a: to })) }, null, 2)
  }

  /** Suma las entradas de un archivo exportado. Las que ya tenés y dicen otra cosa no se pisan (se cuentan como choques). */
  import(text: string): { added: number; same: number; clashes: { from: string; mine: string; theirs: string }[] } {
    let j: { formato?: string; artistas?: { de?: string; a?: string }[] }
    try { j = JSON.parse(text) } catch { throw new Error(T.noSeLee) }
    if (j.formato !== DICT_FORMAT || !Array.isArray(j.artistas)) throw new Error(T.noEs)
    const mine = this.map()
    let added = 0, same = 0
    const clashes: { from: string; mine: string; theirs: string }[] = []
    for (const e of j.artistas) {
      if (typeof e.de !== 'string' || typeof e.a !== 'string' || !e.de.trim() || !e.a.trim()) continue
      const have = mine.get(fold(e.de))
      if (have === e.a.trim()) same++
      else if (have) clashes.push({ from: e.de, mine: have, theirs: e.a })
      else { this.set(e.de, e.a, 'importado'); mine.set(fold(e.de), e.a.trim()); added++ }
    }
    return { added, same, clashes }
  }
}
