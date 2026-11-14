// Organizar sobre el estado futuro (MASTERPLAN-5, etapa 2): la vista previa de Organizar mira los temas como van a quedar después de
// aplicar lo que está para aplicar, no como están hoy. Los nombres y tags propuestos (y no fallados) ya cuentan, y lo que va a la
// papelera ya no ocupa lugar. Así no hace falta acertar el orden (primero nombres, después carpetas): "Aplicar" lo ordena solo
// (core/aplicar.ts) y al mover vuelve a calcular el lugar con los tags ya escritos.
import path from 'node:path'
import type { Db } from './db'
import type { TagRow } from './organizer'
import { sinApagarCambio, sinApagarProp } from './revision-apagados'

const CAMPOS = new Set(['title', 'artist', 'albumArtist', 'album', 'track', 'year', 'genre', 'filename', 'extension'])

/** Los temas como van a quedar (con `futuro` en false, tal cual). */
export function conFuturo(db: Db, rows: TagRow[], futuro: boolean): TagRow[] {
  if (!futuro) return rows
  // lo destildado en Ordenar no cuenta: el tema se queda donde está con el nombre de hoy (core/revision-apagados.ts)
  const fuera = new Set((db.prepare(`SELECT file_id AS id FROM propuestas p WHERE tipo = 'papelera' AND error IS NULL AND ${sinApagarProp('p')}`).all() as { id: number }[]).map((r) => r.id))
  const cambios = new Map<number, Map<string, string | null>>()
  for (const c of db.prepare(`SELECT p.file_id AS id, p.field, p.after FROM pending_changes p
    LEFT JOIN pending_meta m ON m.file_id = p.file_id AND m.field = p.field WHERE m.error IS NULL AND ${sinApagarCambio('p')}`).all() as { id: number; field: string; after: string | null }[]) {
    if (!CAMPOS.has(c.field)) continue
    const m = cambios.get(c.id) ?? new Map<string, string | null>()
    m.set(c.field, c.after); cambios.set(c.id, m)
  }
  return rows.filter((r) => !fuera.has(r.id)).map((r) => {
    const m = cambios.get(r.id)
    if (!m) return r
    const t: TagRow = { ...r }
    for (const k of ['title', 'artist', 'albumArtist', 'album', 'track', 'year', 'genre'] as const) if (m.has(k)) t[k] = m.get(k) ?? null
    // un nombre de archivo o una extensión nuevos cambian el lugar de hoy (lo que ya está bien no se mueve)
    if (m.has('filename') || m.has('extension')) {
      const ext = m.get('extension') ?? path.posix.extname(r.rel).slice(1)
      const name = m.get('filename') ?? path.posix.basename(r.rel, path.posix.extname(r.rel))
      const dir = path.posix.dirname(r.rel)
      t.rel = `${dir === '.' ? '' : `${dir}/`}${name}${ext ? `.${ext}` : ''}`
      if (m.has('extension')) t.ext = (m.get('extension') ?? r.ext).toLowerCase()
    }
    return t
  })
}
