// La lista de respaldos (core/ops/backup.ts) y qué se hace con ellos a mano (decisión del 24/10): "Borrar" los manda a la
// papelera de PAILA del disco de su música (_PAILA/papelera/<fecha>_respaldo-<operación>_<letras>/), de donde se recuperan desde
// Configuración → Respaldos hasta que se vacíe la papelera. Así sigue siendo cierto que lo único que borra de verdad es Vaciar
// papelera (core/purge.ts). Nunca se mandan solos.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { trashBatch } from '../safefs'
import { textos } from '@paila/shared/idioma'
import type { BackupInfo } from '@paila/shared/types'

const T = textos({
  noEsRespaldo: { es: 'Esa carpeta no es un respaldo de PAILA: no se toca', en: "That folder isn't a PAILA backup: it isn't touched" },
  noEsta: { es: 'Ese respaldo ya no está en la lista', en: "That backup isn't on the list anymore" },
  sinDisco: { es: 'El disco de esa música no está conectado: su papelera tampoco', en: "That music's disk isn't connected: neither is its trash" },
  ocupado: { es: (p: string) => `Ya hay algo en ${p}: PAILA no lo pisa`, en: (p: string) => `There's already something at ${p}: PAILA won't overwrite it` },
  copiaMal: { es: 'La copia a la papelera no quedó igual: el respaldo sigue donde estaba', en: "The copy to the trash didn't come out the same: the backup stays where it was" },
  vaciada: { es: 'Ya no está: se vació la papelera', en: "It's gone: the trash was emptied" },
})

/** Le pone el número de tanda a un respaldo hecho antes de saberlo. */
export function linkBackup(db: Db, ids: number[], ref: number) {
  for (const id of ids) db.prepare('UPDATE backups SET ref = ? WHERE id = ?').run(ref, id)
}

/** Los respaldos de una tanda del Historial (op 'tags' o 'deshacer-tags' con ese número). */
export function backupsOf(db: Db, ops: string[], ref: number): BackupInfo[] {
  return listBackups(db).filter((b) => b.ref === ref && ops.includes(b.op))
}

type Row = { id: number; op: string; ref: number | null; rootId: number | null; dir: string; files: number; bytes: number; createdAt: string; complete: number; kind: string; trashDir: string | null }
// sin fila en backup_state = copias enteras de la 0.5.3 (migración v43)
const SELECT = `SELECT b.id, b.op, b.ref, b.root_id AS rootId, b.dir, b.files, b.bytes, b.created_at AS createdAt, b.complete, COALESCE(s.kind, 'completo') AS kind,
  s.trash_dir AS trashDir FROM backups b LEFT JOIN backup_state s ON s.backup_id = b.id`
const info = ({ kind, trashDir, ...r }: Row): BackupInfo => ({ ...r, complete: !!r.complete, exists: fs.existsSync(trashDir ?? r.dir), light: kind === 'liviano', trashDir })

/** Los respaldos en su lugar (sin los que están en la papelera o se borraron), del más nuevo al más viejo. */
export function listBackups(db: Db): BackupInfo[] {
  return (db.prepare(`${SELECT} WHERE b.deleted_at IS NULL ORDER BY b.id DESC`).all() as Row[]).map(info)
}

/** Los que se mandaron a la papelera y siguen ahí (al vaciarla, desaparecen de la lista). */
export function trashedBackups(db: Db): BackupInfo[] {
  return (db.prepare(`${SELECT} WHERE b.deleted_at IS NOT NULL AND s.trash_dir IS NOT NULL ORDER BY b.deleted_at DESC`).all() as Row[]).map(info).filter((b) => b.exists)
}

/** Mueve una carpeta sin pisar nada. A otro disco: se copia, se compara archivo por archivo y recién ahí se saca de donde estaba. */
function moveDir(from: string, to: string) {
  if (fs.existsSync(to)) throw new Error(T.ocupado(to))
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try { fs.renameSync(from, to); return } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e }
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false })
  const sizes = (d: string) => (fs.readdirSync(d, { recursive: true }) as string[]).map((f) => [f, fs.statSync(path.join(d, f))] as const)
    .filter(([, st]) => st.isFile()).map(([f, st]) => `${f}|${st.size}`).sort().join('\n')
  if (sizes(from) !== sizes(to)) { fs.rmSync(to, { recursive: true, force: true }); throw new Error(T.copiaMal) }
  fs.rmSync(from, { recursive: true, force: true })
}

/**
 * Manda a la papelera de PAILA los respaldos que eligió la persona. `roots`: las carpetas de música conectadas (la papelera es
 * la del disco de la música del respaldo). Por seguridad, solo carpetas anotadas como respaldo, con el nombre que les pone PAILA,
 * que no contengan ninguna carpeta de música ni estén adentro de una fuera de _PAILA.
 */
export function trashBackups(db: Db, ids: number[], roots: { id: number; path: string }[]): { moved: number; bytes: number; failed: { rel: string; error: string }[] } {
  const res = { moved: 0, bytes: 0, failed: [] as { rel: string; error: string }[] }
  const all = new Map(listBackups(db).map((b) => [b.id, b]))
  const norm = (p: string) => path.resolve(p).toLowerCase() + path.sep
  const paila = /^[a-z-]+-\d{8}-\d{6}(-\d+)?$/i
  for (const id of ids) {
    const b = all.get(id)
    if (!b) { res.failed.push({ rel: String(id), error: T.noEsta }); continue }
    const d = norm(b.dir)
    const named = paila.test(path.basename(b.dir)) || paila.test(path.basename(path.dirname(b.dir)))
    const holdsMusic = roots.some((r) => norm(r.path).startsWith(d))
    const insideMusic = roots.some((r) => d.startsWith(norm(r.path)) && !d.startsWith(norm(path.join(r.path, '_PAILA'))))
    if (!named || holdsMusic || insideMusic) { res.failed.push({ rel: b.dir, error: T.noEsRespaldo }); continue }
    try {
      let trash: string | null = null
      if (b.exists) {
        const root = roots.find((r) => r.id === b.rootId) ?? roots.find((r) => d.startsWith(norm(r.path)))
        if (!root) throw new Error(T.sinDisco)
        // con la carpeta elegida y varios discos, la del disco se llama "<disco>-<n>": va con el nombre de la tanda
        const name = paila.test(path.basename(b.dir)) ? path.basename(b.dir) : `${path.basename(path.dirname(b.dir))}-${path.basename(b.dir)}`
        trash = path.join(root.path, '_PAILA', 'papelera', trashBatch(`respaldo-${b.op}`), name)
        moveDir(b.dir, trash)
      }
      db.prepare('UPDATE backups SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id)
      db.prepare('INSERT INTO backup_state (backup_id, kind, trash_dir) VALUES (?, ?, ?) ON CONFLICT (backup_id) DO UPDATE SET trash_dir = excluded.trash_dir')
        .run(id, b.light ? 'liviano' : 'completo', trash)
      res.moved++; res.bytes += b.bytes
    } catch (e) { res.failed.push({ rel: b.dir, error: (e as Error).message }) }
  }
  return res
}

/** Lo saca de la papelera y lo vuelve a poner donde estaba (con eso vuelve a servir para deshacer byte a byte). */
export function restoreBackup(db: Db, id: number) {
  const b = trashedBackups(db).find((x) => x.id === id)
  if (!b?.trashDir) throw new Error(T.vaciada)
  moveDir(b.trashDir, b.dir)
  try { fs.rmdirSync(path.dirname(b.trashDir)) } catch { /* la tanda de la papelera todavía tiene otras cosas */ }
  db.prepare('UPDATE backups SET deleted_at = NULL WHERE id = ?').run(id)
  db.prepare('UPDATE backup_state SET trash_dir = NULL WHERE backup_id = ?').run(id)
}
