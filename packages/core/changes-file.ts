// Cambiar un tema de Cambios pendientes (core/changes.ts): renombrar y/o escribir los tags de forma segura
// (core/changes-write.ts), con el diario antes de tocar nada y la base al final, en una sola transacción. Lo usan aplicar y
// deshacer; cada archivo deja su respaldo liviano (core/ops/backup.ts) antes de reemplazarse.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import type { OpJournal } from './journal'
import { moveNoClobber } from './safefs'
import { checkOrThrow } from './ops/run'
import { COLUMN, checkWritable, clean, type TagField } from './tagio'
import { restoreFrom, writeSafe, type FileField, type WriteCtx, type WritePlan } from './changes-write'
import { workName, type SavedFile, type StepBackup } from './ops/backup'
import { T } from './changes.textos'
import { followDjTag } from './djtag'
import { reestampar } from './propuestas'
import { fechaDe, fechaTrasEscribir } from './fechas'

export interface FileCtx { db: Db; pathOf: (fileId: number) => string | null; journal: OpJournal; w: WriteCtx }

/** El temporal de un tema mientras se escribe: en el mismo disco, en _PAILA/escribiendo (el escaneo no lo mira). */
export const workDir = (root: string) => path.join(root, '_PAILA', 'escribiendo')

/**
 * Cambia un tema: renombra (nombre nuevo sin extensión y/o extensión nueva sin punto; null = queda como está) y escribe los
 * tags verificados. Antes de tocar nada se anota en el diario; la base se actualiza (`annotate` incluido) recién al final,
 * en una sola transacción que también borra la anotación y anota el respaldo. Si algo falla, se vuelve todo atrás (el
 * contenido, desde el respaldo liviano). Si PAILA se corta en el medio, al abrir core/recovery.ts deja el archivo como estaba.
 * Nunca pisa otro archivo. `restore`: para deshacer byte a byte (core/changes-undo.ts).
 */
export async function changeFile(
  c: FileCtx, op: 'tags' | 'deshacer-tags', fileId: number, rename: { base: string | null; ext: string | null } | null,
  tags: Partial<Record<FileField, string | null>>, annotate: () => void, bk: StepBackup, restore?: WritePlan['restore'],
) {
  const from = c.pathOf(fileId)
  if (!from) throw new Error(T.sinDisco)
  const row = c.db.prepare('SELECT root_id AS rootId, rel_path AS rel FROM files WHERE id = ?').get(fileId) as { rootId: number; rel: string }
  // nombre nuevo (si hay que renombrar)
  let to = from
  if (rename) {
    const oldExt = path.extname(from)
    const name = (rename.base ?? path.basename(from, oldExt)) + (rename.ext != null ? `.${rename.ext}` : oldExt)
    to = path.join(path.dirname(from), name)
    if (to !== from) {
      if (!fs.existsSync(from)) throw new Error(T.yaNoEsta)
      if (fs.existsSync(to) && to.toLowerCase() !== from.toLowerCase()) throw new Error(T.yaExiste(name))
    }
  }
  const hasTags = Object.keys(tags).length > 0
  const antes = hasTags ? fechaDe(from) : null // la fecha del archivo: deshacer la devuelve (core/fechas.ts)
  // Deshacer "Extensiones equivocadas" junto con tags (un M4A que se llamaba .mp3): el nombre de antes vuelve a mentir.
  // Los tags se escriben primero, con el nombre de hoy (el que dice la verdad), y después se renombra (corrida del 21/10/2026).
  let tagsFirst = false
  if (hasTags) {
    try { checkWritable(to, from) } catch (e) {
      if (to === from) throw e
      checkWritable(from, from)
      tagsFirst = true
    }
  }
  const sep = row.rel.includes('\\') ? '\\' : '/'
  const newRel = (row.rel.includes(sep) ? row.rel.slice(0, row.rel.lastIndexOf(sep) + 1) : '') + path.basename(to)
  const root = from.slice(0, from.length - row.rel.length)
  // chequeos centrales del motor de operaciones (candado, sample packs); el disco ya se sabe conectado (`from`)
  checkOrThrow(c.db, { kind: 'escribir', op, rootId: row.rootId, fileId, src: row.rel, dst: newRel, data: null }, { rootPath: (id) => (id === row.rootId ? root : null) })
  // dónde se trabaja: el temporal al lado (mismo disco) y lo de antes en la carpeta del respaldo (si pasó lo previsto, frena acá)
  const written = tagsFirst ? row.rel : newRel
  const plan: WritePlan | null = hasTags
    ? { tmp: path.join(workDir(root), workName(fileId, path.extname(tagsFirst ? from : to))), delta: bk.target(row.rootId), rel: written, restore }
    : null
  const jid = c.journal.begin({ op, rootId: row.rootId, fileId, src: row.rel, dst: newRel, backup: plan?.delta ?? null, data: { fields: Object.keys(tags).concat(rename ? ['filename'] : []), tmp: plan?.tmp ?? null } })
  let renamed = false
  let w: Awaited<ReturnType<typeof writeSafe>> | null = null
  try {
    if (tagsFirst) w = await writeSafe(c.w, jid, fileId, from, tags, plan!)
    if (to !== from) { moveNoClobber(from, to); renamed = true }
    if (hasTags && !tagsFirst) w = await writeSafe(c.w, jid, fileId, to, tags, plan!)
    const saved: SavedFile | null = w?.saved ?? null
    c.journal.done(jid, () => {
      if (renamed) c.db.prepare('UPDATE files SET rel_path = ?, ext = ? WHERE id = ?').run(newRel, path.extname(to).slice(1).toLowerCase(), fileId)
      if (w) {
        const st = fechaTrasEscribir(c.db, op, fileId, to, antes, w.st)
        followDjTag(c.db, fileId, st, tags) // lo leído del BPM y el tono sigue valiendo (antes de anotar el tamaño nuevo)
        const cols = Object.entries(tags).filter(([k]) => k in COLUMN)
        const sets = cols.map(([k]) => `${COLUMN[k as TagField]} = ?`)
        const vals = cols.map(([, v]) => clean(v as string | null))
        c.db.prepare(`UPDATE files SET ${[...sets, 'size = ?', 'mtime = ?'].join(', ')} WHERE id = ?`).run(...vals, st.size, st.mtimeMs, fileId)
        // El audio no cambió: que el análisis no se repita solo por haber tocado los tags.
        c.db.prepare('UPDATE analysis SET src_size = ?, src_mtime = ? WHERE file_id = ?').run(st.size, st.mtimeMs, fileId)
        // y la huella sigue siendo la misma: queda lista para el próximo guardado
        if (w.md5) c.db.prepare('UPDATE analysis SET audio_md5 = ?, audio_size = ?, audio_mtime = ? WHERE file_id = ?').run(w.md5, st.size, st.mtimeMs, fileId)
        reestampar(c.db, fileId) // lo escribió PAILA: lo que queda propuesto de este tema pasa a la versión nueva
      }
      if (saved) bk.record(row.rootId, fileId, written, saved)
      annotate()
    })
  } catch (e) {
    // El original no se tocó si la escritura no terminó. Si ya se había reemplazado (falló el renombre o la base), vuelve desde
    // el respaldo liviano; si eso también falla, la anotación del diario queda y la recuperación lo arregla al abrir.
    try {
      if (w && !(await restoreFrom(plan!.delta, w.saved.pos!, renamed ? to : from, path.join(workDir(root), workName(fileId, path.extname(to)))))) throw e
      if (renamed) moveNoClobber(to, from)
      c.journal.drop(jid)
    } catch { /* queda anotado para la recuperación */ }
    throw e
  }
}
