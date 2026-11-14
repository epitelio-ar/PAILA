// Rango de BPM por género (MASTERPLAN-2, 6.2): que una cumbia no salga a 190 ni un drum & bass a 87. El BPM que se mide
// puede salir al doble o a la mitad; acá se elige cuál de los dos según el género del tema (tag o carpeta). Elegible:
// cada uno puede cambiar los rangos en Configuración (se guardan en `settings`).

import type { BpmStyle } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
export type { BpmStyle }

// Los nombres de fábrica que llevan palabras (se ven y se editan en Configuración; los géneros solos quedan igual). Las
// palabras que reconocen el género (`words`) no se traducen: son las de los tags y las carpetas.
const T = textos({
  dnb: { es: 'Drum & bass y jungle', en: 'Drum & bass and jungle' },
  reggaeton: { es: 'Reggaetón, dembow y RKT', en: 'Reggaeton, dembow and RKT' },
  reggae: { es: 'Reggae y dub', en: 'Reggae and dub' },
  house: { es: 'House, techno y electrónica de pista', en: 'House, techno and dance-floor electronic' },
})

/** Rango por defecto (el de siempre): de 70 a 180. */
export const DEFAULT_RANGE = { min: 70, max: 180 }

/**
 * Estilos de fábrica. El rango de cada uno va de `min` a `2 × min` (una "octava" de tempo): así nunca hay dos lecturas
 * posibles. Ordenados del más específico al más general (gana el primero que coincide).
 */
export const DEFAULT_STYLES: BpmStyle[] = [
  { get name() { return T.dnb }, words: ['drum & bass', 'drum and bass', 'drum n bass', 'drum&bass', 'dnb', 'jungle', 'liquid funk', 'neurofunk'], min: 120 },
  { name: 'Dubstep', words: ['dubstep', 'riddim'], min: 100 },
  { get name() { return T.reggaeton }, words: ['reggaeton', 'reggaetón', 'regueton', 'dembow', 'perreo', 'rkt', 'turreo', 'moombahton', 'latin urban'], min: 80 },
  // Sin trap, rap ni cuarteto: en una colección real de Rekordbox (20/10) esas carpetas tienen temas a 80–100 y a
  // 120–170 a la vez, y ningún rango de una octava les sirve: les va mejor el general (docs/archivo/pruebas/2026-10-20-analisis-2.md).
  { name: 'Cumbia', words: ['cumbia', 'chamame', 'chamamé', 'cachengue', 'guaracha', 'merengue'], min: 75 },
  { get name() { return T.reggae }, words: ['reggae', 'dub', 'ska', 'dancehall'], min: 60 },
  { get name() { return T.house }, words: ['house', 'techno', 'trance', 'minimal', 'tech house', 'progressive', 'electro', 'nu disco', 'nu-disco', 'italo disco', 'disco house', 'edm', 'garage', 'breaks', 'afro house', 'melodic'], min: 95 },
]

/** Normaliza para comparar: minúsculas, sin tildes. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Busca la palabra entera (no "rap" dentro de "trapo", ni "dub" dentro de "dubstep" si dubstep va antes). */
function hasWord(text: string, word: string): boolean {
  const w = norm(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(text)
}

/**
 * El estilo de un tema según su género (tag) y, si no hay, las carpetas donde está. null = no se sabe (rango general).
 * Si el texto nombra dos estilos distintos (una carpeta "Chengue y Trap", un género "Rap/Reggaeton") no se elige: rango general.
 * `folders`: la ruta relativa sin el nombre del archivo ("Electronica/Techno").
 */
export function styleOf(genre: string | null | undefined, folders: string | null | undefined, styles: BpmStyle[] = DEFAULT_STYLES): BpmStyle | null {
  for (const text of [genre, folders]) {
    if (!text) continue
    const t = norm(text)
    const hits = styles.filter((s) => s.words.some((w) => hasWord(t, w)))
    if (hits.length) return hits.length === 1 ? hits[0] : null
  }
  return null
}

/** Lleva un BPM al rango pedido, duplicando o dividiendo por dos. Sin rango: el general (70–180). */
export function foldBpm(bpm: number, min = DEFAULT_RANGE.min, max = DEFAULT_RANGE.max): number {
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return 0
  while (bpm < min) bpm *= 2
  while (bpm >= max) bpm /= 2
  return bpm
}

/** El BPM de un tema puesto en el rango de su estilo. */
export function bpmForStyle(bpm: number, style: BpmStyle | null): number {
  const r = style ? { min: style.min, max: style.min * 2 } : DEFAULT_RANGE
  return Math.round(foldBpm(bpm, r.min, r.max) * 10) / 10
}

/** Lee los estilos guardados por el usuario; si no hay o están mal, los de fábrica. */
export function parseStyles(json: string | null | undefined): BpmStyle[] {
  if (!json) return DEFAULT_STYLES
  try {
    const v = JSON.parse(json) as BpmStyle[]
    const ok = Array.isArray(v) && v.every((s) => s && typeof s.name === 'string' && Array.isArray(s.words) && Number.isFinite(s.min) && s.min >= 40 && s.min <= 200)
    return ok ? v : DEFAULT_STYLES
  } catch { return DEFAULT_STYLES }
}
