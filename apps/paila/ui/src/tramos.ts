// Los cinco niveles de la oreja contados en cera (0 = todo en A, 100 = todo en F) para dibujar el termómetro del Inicio.
// Sale de NIVELES_OREJA (@paila/shared/oreja): si cambian los cortes de la limpieza, cambian solos. Lo prueba tests/termometro.test.ts.
import { NIVELES_OREJA } from '@paila/shared/oreja'

/** Limpia 0–8, Un poquito 8–28, Algo 28–40, Bastante 40–60, Desastre 60–100 (cada tramo incluye su "hasta"). */
export const TRAMOS = NIVELES_OREJA.map((x, i) => ({ nombre: x.nombre, desde: i ? 100 - NIVELES_OREJA[i - 1].desde : 0, hasta: 100 - x.desde }))

/** En qué tramo cae un número de cera. Sin los topes de oreja(), es el mismo nivel. */
export const tramoDe = (cera: number) => Math.max(0, TRAMOS.findIndex((t) => cera <= t.hasta))
