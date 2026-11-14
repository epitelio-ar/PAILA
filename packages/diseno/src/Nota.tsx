// Nota de calidad (A+…F) con su color fijo, y píldora de color por función. Las dos se ven igual en toda la familia.
import type { ReactNode } from 'react'

/** Clase de color de una nota: 'A+' → 'g-Ap'. */
export const claseNota = (g: string) => 'g-' + g.replace('+', 'p')

/** La nota de un tema: un color fijo por nota. Sin nota (todavía sin analizar) se ve un guión gris. */
export function Nota({ grade, big, title }: { grade?: string | null; big?: boolean; title?: string }) {
  return <b className={`grade${big ? ' big' : ''} ${grade ? claseNota(grade) : ''}`} title={title}>{grade ?? '–'}</b>
}

export type TonoPildora = 'neutro' | 'ok' | 'info' | 'atencion' | 'error' | 'acento'
const CLASE_TONO: Record<TonoPildora, string> = { neutro: '', ok: ' pill-green', info: ' pill-blue', atencion: ' pill-amber', error: ' pill-red', acento: ' pill-accent' }

/** Etiqueta corta de color por función (ok, info, atención, error o el acento de la app). */
export function Pildora({ tone = 'neutro', title, children }: { tone?: TonoPildora; title?: string; children: ReactNode }) {
  return <span className={`pill${CLASE_TONO[tone]}`} title={title}>{children}</span>
}
