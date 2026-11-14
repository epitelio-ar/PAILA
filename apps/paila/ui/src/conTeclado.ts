// Un renglón o una caja que se abre con un clic (no es un <button> porque adentro tiene otros botones): con esto también se
// llega con Tab y se abre con Enter o la barra espaciadora. Va al lado de su onClick, que no cambia (prueba de usabilidad solo
// con teclado, 27/10/2026: en Análisis, Espacio, Discos, ZIP, Traer una lista y Armar un set solo se abrían con el mouse).
import type { KeyboardEvent } from 'react'

export function conTeclado(alApretar: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); alApretar() } },
  }
}
