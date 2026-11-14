// "Dejar como está" por tema (MASTERPLAN-5, 3.1): lo que la persona decide no tocar en una parte del estado de la colección
// (core/estado.ts) no vuelve a contar ni a aparecer. Vive en la base (tabla dejar_como_esta), así que viaja con "Pasar a otra compu".
// También guarda la regla de carpetas elegida, con la que se cuenta "fuera de su carpeta".
import type { Db } from './db'
import { DEFAULT_RULE } from './organizer' // se usa al llamar: el ciclo con organizer.ts no molesta
import { GRUPOS_ESTADO, type GrupoEstado, type OrganizeOptions } from '@paila/shared/types'

/** Los temas que la persona dejó como están en esa parte. */
export function dejadosDe(db: Db, grupo: GrupoEstado): Set<number> {
  return new Set((db.prepare('SELECT file_id AS id FROM dejar_como_esta WHERE grupo = ?').all(grupo) as { id: number }[]).map((r) => r.id))
}

/** Marca (o desmarca, con `si` = false) esos temas como "dejar como está" en esa parte. 'todos' con `si` = false: vuelven todos. */
export function dejarComoEsta(db: Db, grupo: GrupoEstado, ids: number[] | 'todos', si = true) {
  if (!GRUPOS_ESTADO.includes(grupo)) throw new Error(`Parte desconocida: ${grupo}`)
  if (ids === 'todos') { if (!si) db.prepare('DELETE FROM dejar_como_esta WHERE grupo = ?').run(grupo); return }
  const poner = db.prepare('INSERT INTO dejar_como_esta (file_id, grupo, at) VALUES (?, ?, ?) ON CONFLICT (file_id, grupo) DO NOTHING')
  const sacar = db.prepare('DELETE FROM dejar_como_esta WHERE file_id = ? AND grupo = ?')
  const at = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const id of ids) if (si) poner.run(id, grupo, at); else sacar.run(id, grupo)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
}

const CLAVE_REGLA = 'organizar.regla'
export const hayRegla = (db: Db) => !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(CLAVE_REGLA)
/** La regla con que se ordenó la última vez (la anota Organizar al aplicar); si nunca se ordenó, la de fábrica. */
export function reglaElegida(db: Db): OrganizeOptions {
  const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(CLAVE_REGLA) as { value: string } | undefined)?.value
  try { const o = v ? (JSON.parse(v) as OrganizeOptions) : null; if (o?.rule) return { rule: o.rule, dest: o.dest ?? '', ...(o.soloCarpetas ? { soloCarpetas: true } : {}) } } catch { /* rota: la de fábrica */ }
  return { rule: DEFAULT_RULE, dest: 'Biblioteca' } // idioma-ok: la carpeta que PAILA crea (no se traduce)
}
export function guardarRegla(db: Db, o: OrganizeOptions) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(CLAVE_REGLA, JSON.stringify({ rule: o.rule, dest: o.dest, ...(o.soloCarpetas ? { soloCarpetas: true } : {}) }))
}
