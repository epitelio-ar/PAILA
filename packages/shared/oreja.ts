// La oreja-termómetro del Inicio: cuánta "cera" tiene la Música según las notas de calidad, y en qué nivel (de 5) queda la oreja.
import { tr } from '@paila/shared/idioma'
// Diseño y razones: docs/diseno/salto-mezcla.md. Los dibujos son apps/paila/ui/src/assets/oreja-1..5.png.

/** Cuánto ensucia cada nota: A+ y A nada, B un poco, C más, D bastante, F mucho. */
export const CERA_NOTA: Record<string, number> = { 'A+': 0, A: 0, B: 1, C: 2, D: 3, F: 4 }

/** Los cinco niveles, de más limpia a más sucia, con la limpieza mínima (0–100) de cada uno. */
export const NIVELES_OREJA = [
  { nombre: tr({ es: 'Limpia', en: 'Clean' }), desde: 92, frase: tr({ es: 'Tu música suena impecable.', en: 'Your music sounds spotless.' }) },
  { nombre: tr({ es: 'Un poquito', en: 'A little' }), desde: 72, frase: tr({ es: 'Apenas un poco de cera.', en: 'Just a little wax.' }) },
  { nombre: tr({ es: 'Algo', en: 'Some' }), desde: 60, frase: tr({ es: 'Hay algo de cera para sacar.', en: "There's some wax to clean out." }) },
  { nombre: tr({ es: 'Bastante', en: 'Quite a lot' }), desde: 40, frase: tr({ es: 'Bastante cera: hay mucho para mejorar.', en: "Quite a lot of wax: there's plenty to improve." }) },
  { nombre: tr({ es: 'Desastre', en: 'Disaster' }), desde: 0, frase: tr({ es: 'Hay más cera que oreja.', en: "There's more wax than ear." }) },
] as const

export interface Oreja {
  /** Limpieza de 0 a 100 (100 = todo en A): sube cuando mejorás temas. null si no hay nada analizado. */
  limpieza: number | null
  /** Nivel de la oreja: 0 = limpia … 4 = desastre. */
  nivel: number
  /** Temas analizados que cuentan (con nota). */
  analizados: number
}

/**
 * La limpieza es el promedio de cera de los temas analizados, dado vuelta y llevado a 0–100. Dos topes para que el promedio
 * no engañe: "Limpia" solo si casi no hay D ni F (menos del 2 %), y si más del 15 % está en F queda por lo menos en "Bastante".
 */
export function oreja(porNota: Record<string, number>): Oreja {
  let n = 0, puntos = 0
  for (const [g, c] of Object.entries(porNota)) if (g in CERA_NOTA) { n += c; puntos += c * CERA_NOTA[g] }
  if (!n) return { limpieza: null, nivel: 0, analizados: 0 }
  const limpieza = Math.round(100 - (puntos / (n * 4)) * 100)
  let nivel = NIVELES_OREJA.findIndex((x) => limpieza >= x.desde)
  if (nivel === 0 && ((porNota.D ?? 0) + (porNota.F ?? 0)) / n >= 0.02) nivel = 1
  if ((porNota.F ?? 0) / n > 0.15 && nivel < 3) nivel = 3
  return { limpieza, nivel, analizados: n }
}

/**
 * Cuántos temas analizados hacen falta para dar un veredicto de la Música (revisión del 02/11, hallazgo 6): 50, o el 10 % si la
 * colección es chica (nunca menos de 5, ni más que los temas que hay). Con 1 tema de 300 la oreja decía "un desastre de cera" con el
 * 0,3 % de los datos: hasta llegar a ese mínimo se dice "escuchando…".
 */
export function minimoParaVeredicto(total: number): number {
  return Math.min(total, Math.max(5, Math.min(50, Math.ceil(total * 0.1))))
}
