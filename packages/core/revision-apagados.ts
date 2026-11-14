// Lo destildado en Ordenar (MASTERPLAN-5, etapa 3): un cambio que la persona no quiere ahora sigue en la lista, a la vista y sin
// tildar, en vez de desaparecer. Aplicar lo saltea (core/aplicar.ts), la carpeta de cada tema se calcula sin eso
// (core/organizer-futuro.ts) y volver a tildarlo no pide buscar de nuevo. Vive en la tabla `revision_apagados`.
import type { Db } from './db'

/** Un cambio de tags o de tapa (Cambios pendientes): "c|tema|campo". */
export const claveCambio = (fileId: number, field: string) => `c|${fileId}|${field}`
/** Algo que va a la papelera o se mueve (core/propuestas.ts): "p|tema|tipo". */
export const claveProp = (fileId: number, tipo: string) => `p|${fileId}|${tipo}`

/** Para filtrar en SQL: `alias` es la tabla con file_id y field (pending_changes) o file_id y tipo (propuestas). */
export const sinApagarCambio = (alias: string) => `NOT EXISTS (SELECT 1 FROM revision_apagados ra WHERE ra.clave = 'c|' || ${alias}.file_id || '|' || ${alias}.field)`
export const sinApagarProp = (alias: string) => `NOT EXISTS (SELECT 1 FROM revision_apagados ra WHERE ra.clave = 'p|' || ${alias}.file_id || '|' || ${alias}.tipo)`

export function apagados(db: Db): Set<string> {
  return new Set((db.prepare('SELECT clave FROM revision_apagados').all() as { clave: string }[]).map((r) => r.clave))
}

/** Destilda (o vuelve a tildar, con `si` = false) esas claves. */
export function apagar(db: Db, claves: string[], si = true) {
  const poner = db.prepare('INSERT INTO revision_apagados (clave, at) VALUES (?, ?) ON CONFLICT (clave) DO NOTHING')
  const sacar = db.prepare('DELETE FROM revision_apagados WHERE clave = ?')
  const at = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const k of claves) if (si) poner.run(k, at); else sacar.run(k)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
}

/** Lo destildado que ya no está en ninguna lista (se aplicó por otro lado, se descartó): sale, para que no se junte basura. */
export function limpiarApagados(db: Db) {
  db.exec(`DELETE FROM revision_apagados WHERE
    NOT EXISTS (SELECT 1 FROM pending_changes p WHERE revision_apagados.clave = 'c|' || p.file_id || '|' || p.field) AND
    NOT EXISTS (SELECT 1 FROM propuestas p WHERE revision_apagados.clave = 'p|' || p.file_id || '|' || p.tipo)`)
}
