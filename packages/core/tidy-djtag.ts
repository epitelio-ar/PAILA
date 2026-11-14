// "Arreglar nombres y tags", paso 9: borra del tag el BPM y el tono que seguro están mal (pedido del autor el 24/10, después
// del ensayo general del punto 1). No escribe lo que mide PAILA: solo saca lo que sobra. Un BPM o un tono que solo no coincide
// con lo de PAILA queda como está: muchas veces es el relativo o una quinta, y no se sabe quién tiene razón ("Corregir BPM y
// tono", docs/PENDIENTES.md). Lee lo que tiene escrito cada tema de `file_djtag` (core/djtag.ts). Es basura segura:
//  - un BPM sin ningún número ("?", "-") o fuera de 40–250 ("0", "0000", "11", "19188"), salvo que lo que mide PAILA sea ese,
//    el doble o la mitad (un tema lento de 35 BPM medido en 70);
//  - el mismo BPM en 4 temas o más de una carpeta, cuando lo que mide PAILA no se le parece en la mayoría de los medidos (ni
//    igual, ni el doble o la mitad, ni 3/2 o 2/3, los errores de medición más comunes): el disco "Pet Sounds" que decía 192 en
//    todos. En un disco así se salva el tema donde PAILA mide ese BPM, el doble o la mitad (le copiaron a todos el del primero),
//    y los que no se midieron solo si no se salvó ninguno; una carpeta que dice ese BPM en el nombre ("Cachengue 100 BPM") no
//    se toca;
//  - un tono que no se lee de ninguna forma ("0", "13A", "?", "Unknown"); "La menor", "Fis-Dur" o "Am7" se leen y quedan.
import { parseKey } from './analysis/bench'
import type { Db } from './db'
import { ASF, NO_WRITE } from './tagio'
import type { TidyCtx } from './tidy'
import { folderOf } from './tidy-steps'
import { cant, lista, num, textos } from '@paila/shared/idioma'

// lo que se ve debajo del paso, en la pantalla (los valores del tag no se traducen)
const T = textos({
  rango: { es: (n: number, ej: string) => `${num(n)} con un BPM imposible (${ej})`, en: (n: number, ej: string) => `${num(n)} with an impossible BPM (${ej})` },
  carpeta: {
    es: (n: number, bpm: string, disco: string, otros: number) => `${num(n)} con el mismo BPM en todo un disco, que no se parece a lo que mide PAILA (${bpm} en «${disco}»${otros ? ` y ${cant(otros, 'disco más', 'discos más')}` : ''})`,
    en: (n: number, bpm: string, disco: string, otros: number) => `${num(n)} with the same BPM across a whole album that doesn't look like what PAILA measures (${bpm} in «${disco}»${otros ? ` and ${cant(otros, 'more album', 'more albums')}` : ''})`,
  },
  tono: { es: (n: number, ej: string) => `${cant(n, 'tono que no se puede leer', 'tonos que no se pueden leer')} (${ej})`, en: (n: number, ej: string) => `${cant(n, 'key that cannot be read', 'keys that cannot be read')} (${ej})` },
})

/** El BPM del tag como número; 'basura' si no tiene ningún número ("?", "-"); null si tiene números pero raros ("120-130": no se sabe). */
export function tagBpm(v: string): number | 'basura' | null {
  const s = v.trim()
  if (!/\d/.test(s)) return 'basura'
  const m = s.replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(bpm)?$/i)
  return m ? Number(m[1]) : null
}

/** ¿Un BPM que no puede ser? Sin números, o fuera de 40–250 (salvo que PAILA mida ese, el doble o la mitad). */
export function junkBpm(v: string | null, paila: number[] = []): boolean {
  if (v == null) return false
  const b = tagBpm(v)
  if (b === 'basura') return true
  if (b == null || (b >= 40 && b <= 250)) return false
  return !paila.some((p) => near(b, p) || near(b * 2, p) || near(b / 2, p))
}

/** Un tono escrito en alguna forma que se entiende: Camelot, Open Key, "Am", "A minor", solfeo ("La menor", "Do#") o en alemán ("Fis-Dur", "H-Moll"). */
const SOLFEO = /^(?:do|re|mi|fa|sol|la|si)\s*(?:#|b|♯|♭|sostenido|bemol)?\s*(?:m|menor|mayor|min|maj|minor|major)?$/i
const ALEMAN = /^[a-h](?:is|es|s)?\s*-?\s*(?:moll|dur|m)?$/i
const NADA = /^(?:unknown|n\/?a|none|null|undefined|desconocido|sin tono|ninguno|key|tono)$/i

/**
 * ¿Un tono que no se puede leer de ninguna forma? Solo lo que seguro no es un tono: sin letras ("0", "?", "-"), un número de
 * Camelot u Open Key que no existe ("13A", "0m") o una palabra de relleno ("Unknown", "N/A"). Lo que empieza con una nota
 * ("Am7", "C Lydian") se deja: es raro, pero se lee.
 */
export function junkKey(v: string | null): boolean {
  if (v == null) return false
  const s = v.trim()
  if (!s) return true // un cuadro vacío o con espacios
  if (parseKey(s) || SOLFEO.test(s) || ALEMAN.test(s) || /^[a-h]/i.test(s)) return false
  return !/\p{L}/u.test(s) || /^\d+\s*[abdm]$/i.test(s) || NADA.test(s)
}

/** Se parecen si están a menos del 3 % (para borrar, mejor de más que de menos). */
const near = (x: number, p: number) => Math.abs(x - p) <= p * 0.03
/** ¿PAILA mide ese BPM, el doble o la mitad? */
const sameTempo = (b: number, paila: number[]) => paila.some((p) => [b, b * 2, b / 2].some((x) => near(x, p)))
/** ¿O algo que se le parece, contando los errores de medición de 3/2 y 2/3? (para decidir si todo el disco es basura) */
const looksLike = (b: number, paila: number[]) => sameTempo(b, paila) || paila.some((p) => [b * 1.5, b / 1.5].some((x) => near(x, p)))

export interface DjJunk {
  id: number; rel: string; field: 'bpm' | 'key'; from: string
  why: 'rango' | 'carpeta' | 'tono'
  /** En 'carpeta': cuántos temas de la carpeta tienen ese BPM, cuántos midió PAILA y en cuántos se le parece. */
  group?: { bpm: number; tracks: number; measured: number; like: number }
}

/** Lo que es basura segura en estos temas (con el motivo de cada uno). Lo usa el paso y la corrida supervisada. */
export function djTagJunk(db: Db, rows: { id: number; rel: string; ext: string }[]): DjJunk[] {
  // a un WMA solo se le escriben los textos y el volumen (core/asftags.ts): el BPM y el tono, no
  const want = new Map(rows.filter((r) => !NO_WRITE.has(r.ext.toLowerCase()) && !ASF.has(r.ext.toLowerCase())).map((r) => [r.id, r]))
  if (!want.size) return []
  // solo lo leído con el archivo como está hoy (tamaño y fecha); lo de PAILA, con su BPM en el rango del género y en el general
  const tags = (db.prepare(
    `SELECT d.file_id AS id, d.bpm, d.music_key AS key, a.bpm AS p1, a.bpm_base AS p2 FROM file_djtag d JOIN files f ON f.id = d.file_id
     LEFT JOIN analysis a ON a.file_id = d.file_id AND a.error IS NULL
     WHERE d.size = f.size AND d.mtime = f.mtime AND (d.bpm IS NOT NULL OR d.music_key IS NOT NULL)`,
  ).all() as { id: number; bpm: string | null; key: string | null; p1: number | null; p2: number | null }[]).filter((t) => want.has(t.id))
  const out: DjJunk[] = []
  const paila = (t: (typeof tags)[number]) => [t.p1, t.p2].filter((x): x is number => x != null && x > 0)
  const groups = new Map<string, { bpm: number; ts: typeof tags }>()
  for (const t of tags) {
    const r = want.get(t.id)!
    if (t.key != null && junkKey(t.key)) out.push({ id: t.id, rel: r.rel, field: 'key', from: t.key, why: 'tono' })
    if (t.bpm == null) continue
    if (junkBpm(t.bpm, paila(t))) { out.push({ id: t.id, rel: r.rel, field: 'bpm', from: t.bpm, why: 'rango' }); continue }
    const b = tagBpm(t.bpm)
    if (typeof b !== 'number' || b < 40 || b > 250) continue
    const k = `${folderOf(r.rel)}|${Math.round(b * 100) / 100}`
    const g = groups.get(k) ?? { bpm: b, ts: [] }
    g.ts.push(t); groups.set(k, g)
  }
  for (const [k, g] of groups) {
    if (g.ts.length < 4) continue
    const folder = k.slice(0, k.lastIndexOf('|'))
    // "Cachengue 100 BPM", "100bpm": ese BPM es a propósito
    if (new RegExp(String.raw`(?:^|\D)${String(Math.round(g.bpm * 100) / 100).replace('.', '[.,]')}\s*bpm`, 'i').test(folder)) continue
    const measured = g.ts.filter((t) => paila(t).length)
    const like = measured.filter((t) => looksLike(g.bpm, paila(t)))
    if (measured.length < 3 || like.length * 2 >= measured.length) continue
    const group = { bpm: g.bpm, tracks: g.ts.length, measured: measured.length, like: like.length }
    const right = measured.filter((t) => sameTempo(g.bpm, paila(t)))
    for (const t of g.ts) {
      if (paila(t).length ? right.includes(t) : right.length > 0) continue
      out.push({ id: t.id, rel: want.get(t.id)!.rel, field: 'bpm', from: t.bpm!, why: 'carpeta', group })
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel) || a.field.localeCompare(b.field))
}

/** El paso: propone borrar cada uno (vacío = se saca del tag). Devuelve qué se encontró, en palabras, para debajo del paso. */
export function cleanDjTags(c: TidyCtx): string | undefined {
  const found = djTagJunk(c.db, c.rows)
  for (const j of found) c.changes.push({ id: j.id, rel: j.rel, field: j.field, from: j.from, to: '', step: 'djtags' })
  if (!found.length) return undefined
  const ej = (xs: DjJunk[]) => lista([...new Set(xs.map((x) => x.from))].slice(0, 4))
  const rango = found.filter((x) => x.why === 'rango'), carpeta = found.filter((x) => x.why === 'carpeta'), tono = found.filter((x) => x.why === 'tono')
  const parts: string[] = []
  if (rango.length) parts.push(T.rango(rango.length, ej(rango)))
  if (carpeta.length) {
    // de ejemplo, el disco con más temas (y cuántos discos más hay)
    const by = new Map<string, DjJunk[]>()
    for (const x of carpeta) by.set(folderOf(x.rel), [...(by.get(folderOf(x.rel)) ?? []), x])
    const [dir, xs] = [...by].sort((a, b) => b[1].length - a[1].length)[0]
    parts.push(T.carpeta(carpeta.length, num(xs[0].group!.bpm, { maximumFractionDigits: 2 }), dir.split('/').pop() || dir, by.size - 1))
  }
  if (tono.length) parts.push(T.tono(tono.length, ej(tono)))
  return parts.join(' · ')
}
