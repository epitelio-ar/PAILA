// Orden de confianza para nombres y tags (DECISIONES, 27/10: el ejemplo "couch"): 1) lo que eligió la persona a mano, 2) cómo
// lo publicó el autor (Completar desde internet, el paso Oficial de Arreglar nombres, Géneros), 3) las reglas automáticas
// (mayúsculas, acentos, diccionario). Lo de abajo nunca pisa lo de arriba sin preguntar, y una segunda herramienta del mismo
// nivel tampoco pisa a la primera ("se queda lo primero y la segunda pregunta"): lo que quería poner queda "para mirar a mano"
// (tabla `held_changes`), con el motivo ("lo puso Completar desde internet"). Se anota quién propuso cada cambio pendiente
// (`pending_meta`) y quién puso cada valor aplicado (`journal_source`); lo de antes de esto no tiene dueño y no traba nada.
import type { Db } from './db'
import { TAG_FIELDS } from './tagio'
import { textos } from '@paila/shared/idioma'
import type { TidyReview } from '@paila/shared/types'

export type Origen = 'mano' | 'internet' | 'oficial' | 'generos' | 'reglas'
const NIVEL: Record<Origen, number> = { mano: 1, internet: 2, oficial: 2, generos: 2, reglas: 3 }

const T = textos({
  mano: { es: 'lo pusiste a mano', en: 'you set it by hand' },
  internet: { es: 'lo puso Completar desde internet', en: 'Fill in from the internet set it' },
  oficial: { es: 'lo puso Arreglar nombres (nombres oficiales)', en: 'Fix names set it (official names)' },
  generos: { es: 'lo puso Géneros', en: 'Genres set it' },
  reglas: { es: 'lo puso Arreglar nombres', en: 'Fix names set it' },
  motivo: {
    es: (quien: string, valor: string | null) => `Ya tiene un valor y ${quien}${valor ? ` ("${valor}")` : ''}: ¿cambiarlo?`,
    en: (quien: string, valor: string | null) => `It already has a value and ${quien}${valor ? ` ("${valor}")` : ''}: change it?`,
  },
})

/** Los datos que cuidan el orden: los nombres y tags, y el nombre del archivo. Las tapas, el volumen o los recortes no. */
const CUIDADOS = new Set<string>([...TAG_FIELDS, 'filename'])
export const cuidado = (field: string) => CUIDADOS.has(field)

const esOrigen = (s: string | null | undefined): s is Origen => !!s && s in NIVEL

/** ¿`nuevo` pisaría lo que puso `viejo`? Lo de la persona siempre manda; si no, solo pisa lo de menos confianza. */
export function pisa(nuevo: Origen, viejo: Origen | null): boolean {
  if (!viejo || nuevo === 'mano' || nuevo === viejo) return true
  return NIVEL[nuevo] < NIVEL[viejo]
}

/**
 * Quién puso lo que hoy tiene (o tiene propuesto) un dato: lo pendiente, si hay; si no, lo último aplicado, siempre que siga
 * igual (si alguien lo cambió por fuera de PAILA, ya no es de nadie). `actual`: el valor de hoy en la base.
 */
export function puesto(db: Db, fileId: number, field: string, actual: string | null): { origen: Origen; valor: string | null } | null {
  const p = db.prepare('SELECT p.after AS v, m.source AS s FROM pending_changes p LEFT JOIN pending_meta m ON m.file_id = p.file_id AND m.field = p.field WHERE p.file_id = ? AND p.field = ?')
    .get(fileId, field) as { v: string | null; s: string | null } | undefined
  if (p) return esOrigen(p.s) ? { origen: p.s, valor: p.v } : null
  const j = db.prepare(`SELECT j.after AS v, s.source AS s FROM journal j LEFT JOIN journal_source s ON s.journal_id = j.id
    WHERE j.file_id = ? AND j.field = ? AND j.undone_at IS NULL ORDER BY j.id DESC LIMIT 1`).get(fileId, field) as { v: string | null; s: string | null } | undefined
  if (!j || !esOrigen(j.s) || (j.v ?? '') !== (actual ?? '')) return null
  return { origen: j.s, valor: j.v }
}

/** Lo mismo que `puesto`, de toda la biblioteca de una vez (para Arreglar nombres, que mira miles de temas). Clave "id|campo". */
export function puestos(db: Db): Map<string, { origen: Origen; valor: string | null; pendiente: boolean }> {
  const out = new Map<string, { origen: Origen; valor: string | null; pendiente: boolean }>()
  try {
    for (const j of db.prepare(`SELECT j.file_id AS id, j.field, j.after AS v, s.source AS s FROM journal j JOIN journal_source s ON s.journal_id = j.id
      WHERE j.undone_at IS NULL ORDER BY j.id`).all() as { id: number; field: string; v: string | null; s: string }[]) {
      if (esOrigen(j.s)) out.set(`${j.id}|${j.field}`, { origen: j.s, valor: j.v, pendiente: false })
    }
    for (const p of db.prepare('SELECT p.file_id AS id, p.field, p.after AS v, m.source AS s FROM pending_changes p LEFT JOIN pending_meta m ON m.file_id = p.file_id AND m.field = p.field')
      .all() as { id: number; field: string; v: string | null; s: string | null }[]) {
      const k = `${p.id}|${p.field}`
      if (esOrigen(p.s)) out.set(k, { origen: p.s, valor: p.v, pendiente: true })
      else out.delete(k) // lo pendiente sin dueño reemplaza a lo aplicado
    }
  } catch { /* base sin estas tablas (una copia vieja de solo lectura) */ }
  return out
}

/** El motivo, en palabras: "Ya tiene un valor y lo puso Completar desde internet ("Vogue"): ¿cambiarlo?". */
export const motivo = (origen: Origen, valor: string | null) => T.motivo(T[origen], valor)

/** Guarda lo que una herramienta quiso cambiar sobre un dato de más confianza: queda "para mirar a mano". */
export function retener(db: Db, fileId: number, field: string, value: string | null, source: Origen, over: Origen) {
  db.prepare(`INSERT INTO held_changes (file_id, field, value, source, over, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (file_id, field, source) DO UPDATE SET value = excluded.value, over = excluded.over, at = excluded.at`)
    .run(fileId, field, value, source, over, new Date().toISOString())
}

/** La persona ya decidió (lo aceptó o lo dejó como está): deja de estar para mirar. */
export function soltar(db: Db, fileId: number, field: string) {
  try { db.prepare('DELETE FROM held_changes WHERE file_id = ? AND field = ?').run(fileId, field) } catch { /* base sin la tabla */ }
}

/**
 * Lo retenido, para la lista "para mirar a mano" de Arreglar nombres. `valorDe`: el valor de hoy del dato en el archivo
 * (undefined = ese tema no se muestra ahí). Si lo que quería poner ya es lo que tiene, no se muestra (y se suelta).
 */
export function retenidos(db: Db, valorDe: (id: number, field: string) => string | null | undefined): TidyReview[] {
  let rows: { id: number; rel: string; field: string; value: string | null; source: string; over: string }[] = []
  try {
    rows = db.prepare(`SELECT h.file_id AS id, f.rel_path AS rel, h.field, h.value, h.source, h.over FROM held_changes h JOIN files f ON f.id = h.file_id
      WHERE f.trashed_at IS NULL ORDER BY f.rel_path`).all() as typeof rows
  } catch { return [] }
  const out: TidyReview[] = []
  for (const r of rows) {
    if (!esOrigen(r.over) || r.value == null) continue
    const enArchivo = valorDe(r.id, r.field)
    if (enArchivo === undefined) continue
    // lo que tiene ahora: lo pendiente, si hay (lo que puso la herramienta de más confianza), o lo del archivo
    const p = db.prepare('SELECT after FROM pending_changes WHERE file_id = ? AND field = ?').get(r.id, r.field) as { after: string | null } | undefined
    const hoy = p ? p.after : enArchivo
    if ((hoy ?? '') === r.value) { soltar(db, r.id, r.field); continue }
    out.push({ id: r.id, rel: r.rel, field: r.field as TidyReview['field'], from: hoy, to: r.value, why: motivo(r.over, hoy), staged: false, ...(r.source === 'internet' || r.source === 'oficial' ? { origin: 'oficial' as const } : {}) })
  }
  return out
}
