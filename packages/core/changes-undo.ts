// Deshacer byte a byte una tanda de Cambios pendientes (respaldo liviano, 24/10): si el archivo sigue exactamente como lo dejó
// esa tanda, el de antes se rearma desde lo que guardó su respaldo (core/ops/delta.ts) y se compara la huella con la del
// original. Con los respaldos completos de la 0.5.3 se usa la copia, si se puede comprobar que es la de antes de esa tanda
// (mismo sonido, y distinta del archivo de hoy solo en lo que cambió la tanda, con los valores de antes). Si no se puede,
// core/changes.ts vuelve a escribir los tags de antes, como siempre (el sonido y los tags vuelven; los bytes, quizás no).
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import { pcmHash } from './audiohash'
import type { CoverStore } from './coverstore'
import { fileSha1, rebuild } from './ops/delta'
import { readSeratoTag } from './seratotag'
import { TAG_FIELDS, exact, readComment, readCover, readReplayGain, readTags } from './tagio'
import type { WritePlan } from './changes-write'

/** Lo que tiene escrito un archivo en cada campo que puede cambiar Cambios pendientes, como lo anota el diario. */
function fields(file: string, covers: CoverStore): Record<string, string | null> {
  const t = readTags(file, { exact: true }) as Record<string, string | null>
  return { ...t, cover: covers.compact(readCover(file)), replaygain: readReplayGain(file), comment: readComment(file), serato: readSeratoTag(file) }
}
const sameValue = (k: string, a: string | null, b: string | null) =>
  k === 'track' || k === 'year' ? (a ? parseInt(a, 10) : 0) === (b ? parseInt(b, 10) : 0) : exact(a) === exact(b)

/**
 * Cómo dejar el archivo byte a byte como antes de la tanda `batchId`, o undefined si no hay respaldo para eso. `rows`: los
 * cambios de ese tema en esa tanda que se están deshaciendo (todos los que tiene: si alguno ya se deshizo antes, no aplica).
 */
export function exactRestore(db: Db, ffmpeg: string, covers: CoverStore, batchId: number, fileId: number, rows: { field: string; before: string | null; rel: string }[]): WritePlan['restore'] {
  const undone = (db.prepare("SELECT COUNT(*) AS n FROM journal WHERE batch_id = ? AND file_id = ? AND undone_at IS NOT NULL AND field != 'folderCover'").get(batchId, fileId) as { n: number }).n
  if (undone > 0) return undefined
  const light = db.prepare(
    `SELECT b.dir, f.path, f.pos, f.old_sha1 AS oldSha1, f.new_size AS newSize FROM backup_files f JOIN backups b ON b.id = f.backup_id
     WHERE b.op = 'tags' AND b.ref = ? AND f.file_id = ? AND b.deleted_at IS NULL AND f.kind IN ('cambio', 'entero') ORDER BY f.id DESC LIMIT 1`,
  ).get(batchId, fileId) as { dir: string; path: string; pos: number | null; oldSha1: string; newSize: number | null } | undefined
  if (light) {
    const delta = path.join(light.dir, ...light.path.split('/'))
    if (!fs.existsSync(delta)) return undefined
    return async (tmp, file) => {
      if (light.newSize != null && fs.statSync(file).size !== light.newSize) return false
      return (await rebuild(delta, file, tmp, light.pos ?? 0)) === light.oldSha1
    }
  }
  // un respaldo completo (0.5.3): la copia de cada archivo con la ruta que tenía antes de la tanda
  const rootId = (db.prepare('SELECT root_id AS r FROM files WHERE id = ?').get(fileId) as { r: number } | undefined)?.r
  // (sin fila en backup_state = copias enteras: migración v43)
  const full = db.prepare(`SELECT dir FROM backups b WHERE op = 'tags' AND ref = ? AND complete = 1 AND deleted_at IS NULL AND (root_id = ? OR root_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM backup_state s WHERE s.backup_id = b.id) ORDER BY id DESC LIMIT 1`).get(batchId, rootId ?? null) as { dir: string } | undefined
  const copy = full && rows[0] ? path.join(full.dir, ...rows[0].rel.split('/')) : null
  if (!copy || !fs.existsSync(copy)) return undefined
  return async (tmp, file) => {
    // ninguna tanda posterior cambió este tema, y nadie lo tocó por afuera desde que lo escribió PAILA
    if (db.prepare('SELECT 1 FROM journal WHERE file_id = ? AND batch_id > ? AND undone_at IS NULL LIMIT 1').get(fileId, batchId)) return false
    const f = db.prepare('SELECT size, mtime FROM files WHERE id = ?').get(fileId) as { size: number; mtime: number }
    const st = fs.statSync(file)
    if (st.size !== f.size || st.mtimeMs !== f.mtime) return false
    // la copia tiene los valores de antes en lo que cambió la tanda, y lo mismo que hoy en todo lo demás
    const was = fields(copy, covers), now = fields(file, covers)
    const before = new Map(rows.map((r) => [r.field, r.before]))
    for (const k of [...TAG_FIELDS, 'cover', 'replaygain', 'comment', 'serato']) {
      if (!sameValue(k, was[k], before.has(k) ? before.get(k)! : now[k])) return false
    }
    // y el mismo sonido
    const [a, b] = await Promise.all([pcmHash(ffmpeg, copy), pcmHash(ffmpeg, file)])
    if (a !== b) return false
    fs.copyFileSync(copy, tmp)
    return (await fileSha1(tmp)) === (await fileSha1(copy))
  }
}
