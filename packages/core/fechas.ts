// La fecha de modificación de cada archivo que escribe Cambios pendientes (decisión del autor del 13/11: "deshacer devuelve también la
// fecha de cada archivo, no solo su contenido"). Al aplicar se anota la fecha que tenía antes de escribirlo, junto a la que le quedó
// (tabla `fechas`, v59). Al deshacer, si el archivo sigue con la fecha que le dejó PAILA, vuelve a la de antes, exacta (en nanosegundos:
// robocopy la ve igual). Si lo tocó otro después, la fecha queda la de hoy. Lo usa core/changes-file.ts. Test: tests/deshacer-cadena.test.ts.
import fs from 'node:fs'
import type { Db } from './db'

/** Cómo está el archivo antes de escribirlo: la fecha exacta y la que guarda la base (en milisegundos). */
export function fechaDe(file: string): { ns: bigint; ms: number } | null {
  try { const st = fs.statSync(file, { bigint: true }); return { ns: st.mtimeNs, ms: Number(fs.statSync(file).mtimeMs) } } catch { return null }
}

/**
 * Después de escribir `file` (`st`: cómo quedó). Al aplicar ('tags'), anota la fecha de antes. Al deshacer ('deshacer-tags'), si antes de
 * escribir tenía la fecha que le dejó PAILA, le devuelve la que tenía antes de aquella vez. Devuelve cómo quedó (con la fecha final).
 */
export function fechaTrasEscribir(db: Db, op: 'tags' | 'deshacer-tags', fileId: number, file: string, antes: { ns: bigint; ms: number } | null, st: fs.Stats): fs.Stats {
  if (!antes) return st
  if (op === 'tags') {
    db.prepare('INSERT OR REPLACE INTO fechas (file_id, despues, antes) VALUES (?, ?, ?)').run(fileId, st.mtimeMs, String(antes.ns))
    return st
  }
  const r = db.prepare('SELECT antes FROM fechas WHERE file_id = ? AND despues = ?').get(fileId, antes.ms) as { antes: string } | undefined
  if (!r) return st
  const s = Number(BigInt(r.antes)) / 1e9 // así vuelve exacta (probado en NTFS y en exFAT)
  fs.utimesSync(file, st.atimeMs / 1000, s)
  db.prepare('DELETE FROM fechas WHERE file_id = ? AND despues = ?').run(fileId, antes.ms)
  return fs.statSync(file)
}
