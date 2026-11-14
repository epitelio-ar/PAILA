// El respaldo liviano de una tanda de Cambios pendientes (core/changes.ts), con el motor (ops/backup.ts): qué archivos se
// van a cambiar por dentro, la vista previa de cuánto ocupa y dónde va, y el cover.jpg de la carpeta, que se copia entero.
import path from 'node:path'
import type { Db } from './db'
import { FOLDER_NAMES, findFile } from './foldercover'
import { StepBackup, planBackup, type BackupItem } from './ops/backup'
import type { BackupPlan } from '@paila/shared/types'

/**
 * Los campos que cambian lo de adentro del archivo: antes de escribirlos va el respaldo. Renombrar no cambia los bytes;
 * recortar va con el Reemplazo, que deja el original en la papelera de PAILA.
 */
const inFile = (f: string) => f !== 'filename' && f !== 'extension' && f !== 'trim'

/** Las tapas de la carpeta del tema (cover.jpg, folder.jpg) que hay hoy, con su ruta relativa a la carpeta de música. */
function folderCovers(db: Db, pathOf: (id: number) => string | null, fileId: number): BackupItem[] {
  const row = db.prepare('SELECT root_id AS rootId, rel_path AS rel FROM files WHERE id = ?').get(fileId) as { rootId: number; rel: string } | undefined
  const abs = pathOf(fileId)
  if (!row || !abs) return []
  const relDir = path.posix.dirname(row.rel)
  return FOLDER_NAMES.slice(0, 2).flatMap((name) => {
    const hit = findFile(path.dirname(abs), name)
    return hit ? [{ rootId: row.rootId, rel: relDir === '.' ? path.basename(hit) : `${relDir}/${path.basename(hit)}`, whole: true }] : []
  })
}

/** Qué archivos de la tanda cambian por dentro: el tema si cambia algo de adentro, y la tapa de la carpeta si se cambia esa. */
function backupItems(db: Db, pathOf: (id: number) => string | null, files: { fileId: number; fields: string[] }[]): BackupItem[] {
  const q = db.prepare('SELECT root_id AS rootId, rel_path AS rel FROM files WHERE id = ?')
  const out: BackupItem[] = []
  for (const f of files) {
    const row = q.get(f.fileId) as { rootId: number; rel: string } | undefined
    if (!row) continue
    if (f.fields.some((x) => inFile(x) && x !== 'folderCover')) out.push(row)
    if (f.fields.includes('folderCover')) out.push(...folderCovers(db, pathOf, f.fileId))
  }
  return out
}

/** La carpeta de música de cada disco (sale de la ruta de hoy de un tema de ese disco). */
export function rootsOf(db: Db, pathOf: (id: number) => string | null) {
  const roots = new Map<number, string | null>()
  const q = db.prepare('SELECT id, rel_path AS rel FROM files WHERE root_id = ? AND trashed_at IS NULL LIMIT 1')
  return (rootId: number) => {
    if (!roots.has(rootId)) {
      const r = q.get(rootId) as { id: number; rel: string } | undefined
      const abs = r ? pathOf(r.id) : null
      roots.set(rootId, abs ? abs.slice(0, abs.length - r!.rel.length - 1) : null)
    }
    return roots.get(rootId) ?? null
  }
}

/** La vista previa: de los cambios pendientes que se van a aplicar. `parallel`: cuántos temas se escriben a la vez. */
export function changesBackupPlan(db: Db, pathOf: (id: number) => string | null, pending: { fileId: number; field: string }[], parallel: number): BackupPlan {
  const byFile = new Map<number, string[]>()
  for (const c of pending) byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c.field])
  return planBackup(db, backupItems(db, pathOf, [...byFile].map(([fileId, fields]) => ({ fileId, fields }))), { rootPath: rootsOf(db, pathOf) }, 'tags', parallel)
}

/** El respaldo de la tanda, antes de tocar el primero (si falta lugar, tira el error y no se toca nada). */
export function startBackup(db: Db, pathOf: (id: number) => string | null, op: string, files: { fileId: number; fields: string[] }[], ref: number, parallel: number): StepBackup {
  return StepBackup.start(db, op, ref, backupItems(db, pathOf, files), { rootPath: rootsOf(db, pathOf) }, parallel)
}

/** El cover.jpg y el folder.jpg de la carpeta del tema, copiados enteros y verificados antes de cambiarlos. */
export async function saveFolderCovers(db: Db, pathOf: (id: number) => string | null, bk: StepBackup, fileId: number) {
  for (const it of folderCovers(db, pathOf, fileId)) await bk.saveWhole(it.rootId, it.rel, fileId)
}
