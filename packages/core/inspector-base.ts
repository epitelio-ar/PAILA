// Ayudas del inspector de un tema (core/inspector.ts): consultas que toleran una base más vieja y cómo se muestra un valor.
import type { InspectRow } from '@paila/shared/types'
import type { Db } from './db'

export type Rec = Record<string, unknown>
/** Filas de una consulta; si falta una tabla (una base de una versión anterior), no hay filas. */
export const rowsOf = (db: Db, sql: string, ...p: (string | number)[]): Rec[] => {
  try { return db.prepare(sql).all(...p) as Rec[] } catch { return [] }
}
export const oneOf = (db: Db, sql: string, ...p: (string | number)[]): Rec | undefined => rowsOf(db, sql, ...p)[0]

export const dash = '—'
export const show = (v: unknown): string => (v == null || v === '' ? dash : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v))
export const row = (label: string, v: unknown): InspectRow => ({ label, value: show(v) })
export const json = (v: unknown): unknown[] => { try { return v ? (JSON.parse(String(v)) as unknown[]) : [] } catch { return [] } }
