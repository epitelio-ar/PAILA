// Cambios pendientes de tags: se arman, se ven (antes → después), se aplican en una tanda y se deshacen.
// Nada se escribe en un archivo hasta "Aplicar"; cada escritura se verifica y, si algo falla, se restaura el original.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { temaEnPaila, transaction, type Db } from './db'
import { OpJournal } from './journal'
import type { TrackLike } from './tagactions'
import { COLUMN, TAG_FIELDS, cantWrite, clean, readComment, readCover, readReplayGain, readTags, safeName, type TagField } from './tagio'
import type { FileField, WriteCtx } from './changes-write'
import { changeFile, type FileCtx } from './changes-file'
import { exactRestore } from './changes-undo'
import { CoverStore } from './coverstore'
import { readSeratoTag, seratoText } from './seratotag'
import { djOverSerato, readDjTag } from './djtag'
import { gainText, readFolderCover, writeFolderCover } from './foldercover'; import { tapaAPapelera } from './restos'; import { ahora } from './reloj'
import { changesBackupPlan, saveFolderCovers, startBackup } from './changes-backup'
import { BackupFull } from './ops/backup'
import { TRIM_BATCH, trimText } from './trim'
import type { ApplyResult, BackupPlan, JournalBatch, PendingChange } from '@paila/shared/types'
import { T, motivo } from './changes.textos'
import { cuidado, pisa, puesto, retener, soltar, type Origen } from './confianza'
import { cambioDesde } from './propuestas'
import { dropFailed, dropRow, markFailed, pendingRows, saveRow, tidyMeta, type Pending } from './changes-meta'

/**
 * 'filename' = cambiar el nombre del archivo (sin la extensión); 'extension' = cambiar la extensión (sin el punto), para los
 * archivos cuya extensión no coincide con su formato real. Los dos se aplican antes que los tags. 'cover' = la tapa
 * embebida; 'replaygain' = el volumen parejo (un dato del tag: el audio no se toca); 'folderCover' = el cover.jpg de la
 * carpeta del tema (no es parte del archivo: se escribe aparte, ver core/foldercover.ts). 'comment' = el comentario del
 * tag (el tracklist de un set: core/setlists.ts). 'trim' = recortar los silencios del principio y del final (core/trim.ts):
 * cambia el audio, así que no va al diario de tags sino al Reemplazo (el original queda en la papelera de PAILA). 'bpm', 'key': core/djtag.ts.
 */
export type ChangeField = TagField | 'filename' | 'extension' | 'cover' | 'replaygain' | 'folderCover' | 'comment' | 'serato' | 'trim' | 'bpm' | 'key'
const isRename = (f: ChangeField) => f === 'filename' || f === 'extension'
/** Lo que se escribe adentro del archivo (los tags): en un WMA o un WebM no se puede, y no se propone (choques del 27/10, C4). */
const inFile = (f: ChangeField) => !isRename(f) && f !== 'trim' && f !== 'folderCover'

/** Cómo quedó lo pedido: armados, retenidos "para mirar a mano" (core/confianza.ts) y salteados (no se pueden escribir). */
export interface StageResult { staged: number; held: number; skipped: number }

/** Cuántos archivos se guardan a la vez al aplicar cambios. */
const APPLY_PARALLEL = Math.max(2, Math.min(4, Math.floor(os.availableParallelism() / 2)))

/** Un comentario largo (un tracklist) se muestra en una línea: el principio y cuántos renglones tiene. */
function commentText(v: string | null): string | null {
  if (!v) return v
  const lines = v.split(/\r?\n/).filter((l) => l.trim())
  const first = lines[0].length > 60 ? `${lines[0].slice(0, 60)}…` : lines[0]
  return lines.length > 1 ? T.renglones(first, lines.length) : first
}

export class Changes {
  /** Los temas con sus tags actuales, en el orden de `ids` (para las acciones). */
  tracksFor(ids: number[]): TrackLike[] {
    const q = this.db.prepare('SELECT id, rel_path AS rel, title, artist, album_artist AS albumArtist, album, track, year, genre FROM files WHERE id = ?')
    return ids.map((id) => q.get(id) as unknown as TrackLike).filter(Boolean)
  }

  private journal: OpJournal
  readonly covers: CoverStore
  /** Aplica un recorte de silencios (core/trim.ts, con el Reemplazo); lo pone la app. Los recortes van de a uno. */
  trimmer: ((fileId: number, value: string, batch: string) => Promise<void>) | null = null
  private trimming: Promise<unknown> = Promise.resolve()
  /**
   * `backupDir`: la carpeta de datos donde la 0.5.3 dejaba las copias de resguardo mientras escribía un archivo (hoy se escribe
   * en un temporal al lado de la música: core/changes-write.ts); de ahí sale la de las tapas. `covers`: dónde se guardan las
   * tapas (la nueva y la de antes); por defecto, la carpeta "tapas" al lado del resguardo.
   */
  constructor(private db: Db, private pathOf: (fileId: number) => string | null, private ffmpeg: string, backupDir = path.join(os.tmpdir(), 'paila-resguardo'), covers?: CoverStore) {
    this.journal = new OpJournal(db)
    this.covers = covers ?? new CoverStore(path.join(path.dirname(backupDir), 'tapas'))
  }

  /** Valor actual de un campo en la base. */
  private current(fileId: number, field: ChangeField): string | null {
    if (field === 'trim') return null
    if (field === 'bpm' || field === 'key') { const p = this.pathOf(fileId); return p && fs.existsSync(p) ? readDjTag(p)[field] : null }
    if (field === 'cover' || field === 'replaygain' || field === 'folderCover' || field === 'comment' || field === 'serato') {
      const p = this.pathOf(fileId)
      if (!p || !fs.existsSync(p)) return null
      // un MP3 con ceros antes del audio no lo abre la librería de tags: antes se caía todo el armado (volumen parejo de una
      // biblioteca entera; corrida del respaldo liviano, 24/10). Se arma igual: al aplicar se arregla y se verifica el sonido, y
      // deshacer vuelve byte a byte desde el respaldo.
      try {
        return field === 'cover' ? this.covers.compact(readCover(p)) : field === 'replaygain' ? readReplayGain(p) : field === 'serato' ? readSeratoTag(p) : field === 'comment' ? clean(readComment(p)) : readFolderCover(p, this.covers)
      } catch { return null }
    }
    if (field === 'extension') {
      const r = this.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(fileId) as { rel: string } | undefined
      return r ? path.extname(r.rel).slice(1) || null : null // tal cual (".Mp3"), para que deshacer lo deje igual
    }
    if (field === 'filename') {
      const r = this.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(fileId) as { rel: string } | undefined
      return r ? path.basename(r.rel, path.extname(r.rel)) : null
    }
    const r = this.db.prepare(`SELECT ${COLUMN[field]} AS v FROM files WHERE id = ?`).get(fileId) as { v: string | null } | undefined
    return r?.v ?? null
  }

  /**
   * Arma (o reemplaza) un cambio pendiente. Si el valor nuevo es igual al actual, lo quita. `source`: qué herramienta lo propone
   * (el orden de confianza, core/confianza.ts); sin `source`, no cuida ni traba nada (como antes).
   */
  stage(fileIds: number[], field: ChangeField, value: string | null, source?: Origen): StageResult {
    const r: StageResult = { staged: 0, held: 0, skipped: 0 }
    transaction(this.db, () => { for (const id of fileIds) this.count(r, this.stageOne(id, field, value, source)) })
    return r
  }

  /** Arma muchos cambios de una vez. `expect`: lo que tenía el archivo al proponerlo (el BPM o el tono); si ahora dice otra cosa, no se arma. */
  stageMany(items: { id: number; field: ChangeField; value: string | null; expect?: string | null; source?: Origen }[], source?: Origen): StageResult {
    const r: StageResult = { staged: 0, held: 0, skipped: 0 }
    transaction(this.db, () => { for (const i of items) if (i.expect === undefined || this.current(i.id, i.field) === i.expect) this.count(r, this.stageOne(i.id, i.field, i.value, i.source ?? source)) })
    return r
  }

  private count(r: StageResult, s: 'staged' | 'held' | 'skipped' | null) { if (s) r[s]++ }

  /** null si se le pueden escribir tags; si no, por qué (un WMA, un WebM que se llama .mp3). */
  private cantWriteTo(id: number): string | null {
    const f = this.db.prepare('SELECT ext, codec FROM files WHERE id = ?').get(id) as { ext: string; codec: string | null } | undefined
    return f ? cantWrite(f, () => this.pathOf(id)) : null
  }

  private stageOne(id: number, field: ChangeField, value: string | null, source?: Origen): 'staged' | 'held' | 'skipped' | null {
    if (!isRename(field) && !['cover', 'replaygain', 'folderCover', 'comment', 'serato', 'trim', 'bpm', 'key'].includes(field) && !(TAG_FIELDS as readonly string[]).includes(field)) throw new Error(`Campo desconocido: ${field}`)
    let after = clean(value)
    if (field === 'cover' || field === 'folderCover') after = this.covers.compact(after)
    if (field === 'extension') {
      after = after && after.toLowerCase().replace(/^\./, '')
      if (!after || !/^[a-z0-9]{2,5}$/.test(after)) throw new Error(T.extensionInvalida(String(value)))
    }
    if (isRename(field) || field === 'trim') {
      const k = this.db.prepare('SELECT kind FROM files WHERE id = ?').get(id) as { kind: string } | undefined
      // Regla del producto: los sample packs nunca se renombran ni se recortan.
      if (k?.kind === 'produccion') throw new Error(field === 'trim' ? T.samplePacksRecorte : T.samplePacks)
      if (field === 'filename') after = after && safeName(after)
      if (!after) return null
    }
    // a un WMA o un WebM no se le escriben tags: proponerlos dejaba un cambio que fallaba en cada Aplicar (C4)
    if (inFile(field) && this.cantWriteTo(id)) return 'skipped'
    // en la papelera (Duplicados) no recibe propuestas de una búsqueda hecha antes (prueba de desorden, 27/10/2026)
    if ((this.db.prepare('SELECT trashed_at AS t FROM files WHERE id = ?').get(id) as { t: string | null } | undefined)?.t) return 'skipped'
    const before = this.current(id, field)
    // lo que puso una herramienta de más confianza (o la primera del mismo nivel) no se pisa: queda para mirar a mano
    if (source && cuidado(field)) {
      const ya = puesto(this.db, id, field, before)
      if (ya && (ya.valor ?? null) !== after && !pisa(source, ya.origen)) { retener(this.db, id, field, after, source, ya.origen); return 'held' }
      if (source === 'mano') soltar(this.db, id, field)
    }
    if ((before ?? null) === after) { dropRow(this.db, id, field); return null }
    saveRow(this.db, id, field, before, after, source ?? null)
    return 'staged'
  }

  discard(ids?: number[]) {
    if (!ids) this.db.exec('DELETE FROM pending_changes')
    else transaction(this.db, () => { for (const id of ids) this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(id) })
    tidyMeta(this.db)
  }

  /** Lo que no se pudo aplicar la última vez (se muestra aparte, con "Sacarlos"): se saca de lo pendiente. */
  discardFailed() { dropFailed(this.db) }

  /** Lo pendiente para mostrar: las tapas se describen con palabras, no con sus bytes. */
  list(): PendingChange[] {
    return this.rawList().map(({ source: _, ...c }) => c).map((c) => c.field === 'cover' || c.field === 'folderCover' ? { ...c, before: c.before ? T.conTapa : T.sinTapa, after: c.after ? T.tapaNueva : T.sinTapa }
      : c.field === 'replaygain' ? { ...c, before: gainText(c.before), after: gainText(c.after) }
      : c.field === 'serato' ? { ...c, before: seratoText(c.before), after: seratoText(c.after) }
      : c.field === 'trim' ? { ...c, ...trimText(c.after) }
      : c.field === 'comment' ? { ...c, before: commentText(c.before), after: commentText(c.after) } : c)
  }

  private rawList(): Pending[] { return pendingRows(this.db) }

  /**
   * Escribe todo lo pendiente (o solo `ids`). Un archivo que falla se restaura y no frena a los demás; lo suyo queda pendiente con
   * el motivo, y "todo lo pendiente" ya no lo incluye (antes fallaba en cada Aplicar: C4). Para volver a probarlo, se pide por `ids`.
   */
  async apply(ids?: number[], opts: { onProgress?: (p: { done: number; total: number; current: string; errors: number }) => void; isCancelled?: () => boolean } = {}): Promise<ApplyResult> {
    const all = this.rawList().filter((c) => (ids ? ids.includes(c.id) : !c.error))
    const byFile = new Map<number, Pending[]>()
    for (const c of all) byFile.set(c.fileId, [...(byFile.get(c.fileId) ?? []), c])
    const res: ApplyResult = { batchId: null, applied: 0, failed: [] }
    if (!byFile.size) return res
    const batchId = ((this.db.prepare('SELECT COALESCE(MAX(batch_id), 0) AS m FROM journal').get() as { m: number }).m) + 1
    // el respaldo liviano de la tanda (si falta lugar, no arranca nada): cada archivo guarda lo que cambia antes de reemplazarse
    const bk = startBackup(this.db, this.pathOf, 'tags', [...byFile].map(([fileId, cs]) => ({ fileId, fields: cs.map((c) => c.field) })), batchId, APPLY_PARALLEL)
    let stopped = false
    const trimBatch = `${TRIM_BATCH}${Date.now()}`
    let done = 0
    // Varios archivos a la vez: casi todo el tiempo es ffmpeg verificando el audio, y cada archivo es independiente
    // (su temporal propio, renombre sin pausas en el medio). Todo esto ya corre con el candado de operaciones tomado.
    const queue = [...byFile]
    const one = async (fileId: number, all: Pending[]) => {
      const rel = all[0].rel
      opts.onProgress?.({ done, total: byFile.size, current: rel, errors: res.failed.length })
      try {
        // ¿sigue siendo el archivo que se miró al proponerlo? Si cambió (lo editaste afuera, se reemplazó), no se escribe (riesgo 2)
        const cambio = all.map((c) => cambioDesde(this.pathOf(fileId), this.db.prepare('SELECT size, mtime FROM pending_base WHERE file_id = ? AND field = ?').get(fileId, c.field) as { size: number; mtime: number } | undefined)).find(Boolean)
        if (cambio) { markFailed(this.db, all, cambio); res.failed.push({ fileId, rel, error: cambio }); done++; return }
        let cs = all
        const kind = (this.db.prepare('SELECT kind FROM files WHERE id = ?').get(fileId) as { kind: string } | undefined)?.kind
        // el cover.jpg de la carpeta va aparte (no es parte del archivo) y queda en el diario como un cambio más
        const folder = cs.find((c) => c.field === 'folderCover')
        if (folder) {
          if (kind === 'produccion') throw new Error(T.samplePacksTapas)
          await saveFolderCovers(this.db, this.pathOf, bk, fileId)
          this.journalRow(batchId, fileId, rel, folder, writeFolderCover(this.pathOf(fileId), folder.after, this.covers))
          res.applied++; res.batchId = batchId
          cs = cs.filter((c) => c !== folder)
        }
        if (!cs.length) { done++; return }
        // El recorte cambia el audio: va PRIMERO, con el Reemplazo (y de a uno, para no pisarse), y después los tags sobre el
        // archivo recortado. Al revés, escribir los tags cambiaba el tamaño y el recorte se negaba siempre con "El archivo
        // cambió" (choques del 27/10, C1). Si el recorte falla, los tags se escriben igual.
        const trim = cs.find((c) => c.field === 'trim')
        cs = cs.filter((c) => c !== trim)
        if (trim) {
          try {
            if (!this.trimmer) throw new Error(T.sinRecortar)
            const run = this.trimming.then(() => this.trimmer!(fileId, trim.after!, trimBatch))
            this.trimming = run.catch(() => {})
            await run
            this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(trim.id)
            res.applied++
            // lo que el recorte dejó sin valor (las marcas de Serato, si cortó el principio) ya no está pendiente: no se escribe
            const still = new Set((this.db.prepare('SELECT id FROM pending_changes WHERE file_id = ?').all(fileId) as { id: number }[]).map((r) => r.id))
            cs = cs.filter((c) => still.has(c.id))
          } catch (e) {
            markFailed(this.db, [trim], motivo(e))
            res.failed.push({ fileId, rel, error: motivo(e) })
          }
        }
        if (!cs.length) { done++; return }
        const rename = cs.find((c) => c.field === 'filename'), ext = cs.find((c) => c.field === 'extension')
        // se vuelve a mirar al aplicar: la carpeta pudo pasar a ser de samples después de proponer el cambio
        if ((rename || ext) && kind === 'produccion') throw new Error(T.samplePacks)
        const tagCs = cs.filter((c) => !isRename(c.field as ChangeField))
        const tags = djOverSerato(Object.fromEntries(tagCs.map((c) => [c.field, c.after])) as Partial<Record<FileField, string | null>>)
        // El "antes" del diario es lo que el archivo tiene escrito de verdad, no la lectura de la base: un WAV con dos zonas
        // de tags, o una letra que ffprobe leyó mal ("Cada d�a"), hacían que deshacer dejara el archivo distinto (corrida
        // supervisada de la Fase C sobre la copia completa, 20/10/2026).
        let actual: Record<string, string | null> | null = null
        const p = tagCs.length ? this.pathOf(fileId) : null
        try { if (p) actual = { ...readTags(p, { exact: true }), ...('replaygain' in tags ? { replaygain: readReplayGain(p) } : {}), ...('comment' in tags ? { comment: readComment(p) } : {}), ...('serato' in tags ? { serato: readSeratoTag(p) } : {}), ...('bpm' in tags || 'key' in tags ? readDjTag(p) : {}) } as unknown as Record<string, string | null> } catch { actual = null }
        const beforeOf = (c: PendingChange) => (actual && c.field in actual ? actual[c.field] : c.before)
        await changeFile(this.f, 'tags', fileId, rename || ext ? { base: rename?.after ?? null, ext: ext?.after ?? null } : null, tags, () => {
          for (const c of cs) this.journalRow(batchId, fileId, rel, c, beforeOf(c))
        }, bk)
        res.applied += cs.length
        res.batchId = batchId
      } catch (e) {
        // el respaldo pasó lo previsto: se frena la tanda (lo demás sigue pendiente, sin marcarlo como fallado)
        if (e instanceof BackupFull) stopped = true
        else markFailed(this.db, all.filter((c) => c.field !== 'trim'), motivo(e))
        res.failed.push({ fileId, rel, error: motivo(e) })
      }
      done++
    }
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (opts.isCancelled?.() || stopped) break
        await one(...next)
      }
    }
    try { await Promise.all(Array.from({ length: Math.min(APPLY_PARALLEL, queue.length) }, worker)) } finally { bk.finish(); tidyMeta(this.db) }
    opts.onProgress?.({ done, total: byFile.size, current: '', errors: res.failed.length })
    return res
  }

  /** Anota un cambio aplicado en el diario y lo saca de lo pendiente. */
  private journalRow(batchId: number, fileId: number, rel: string, c: Pending, before: string | null) {
    const j = this.db.prepare('INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(batchId, fileId, rel, c.field, before, c.after, ahora())
    // quién lo puso: el orden de confianza lo mira después (core/confianza.ts)
    if (c.source) this.db.prepare('INSERT INTO journal_source (journal_id, source) VALUES (?, ?)').run(Number(j.lastInsertRowid), c.source)
    this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(c.id)
  }

  batches(): JournalBatch[] {
    return (this.db.prepare(
      `SELECT batch_id AS batchId, MIN(applied_at) AS appliedAt, COUNT(DISTINCT file_id) AS files, COUNT(*) AS changes,
              MIN(undone_at IS NOT NULL) AS undone
       FROM journal GROUP BY batch_id ORDER BY batch_id DESC`,
    ).all() as { batchId: number; appliedAt: string; files: number; changes: number; undone: number }[]).map((b) => ({ ...b, undone: !!b.undone }))
  }

  /** La vista previa del respaldo: cuántos archivos, cuánto ocupa y dónde va (de los cambios elegidos, o de todos). */
  backupPlan(ids?: number[]): BackupPlan {
    return changesBackupPlan(this.db, this.pathOf, this.rawList().filter((x) => !ids || ids.includes(x.id)), APPLY_PARALLEL)
  }

  /**
   * Deshace una tanda. Si el archivo sigue como lo dejó la tanda, vuelve byte a byte a como estaba (desde su respaldo liviano:
   * core/changes-undo.ts); si no, se vuelven a escribir los valores de antes.
   */
  async undo(batchId: number): Promise<ApplyResult> {
    const rows = this.db.prepare(`SELECT id, file_id AS fileId, rel_path AS rel, field, before, after FROM journal WHERE batch_id = ? AND undone_at IS NULL AND ${temaEnPaila('file_id')} ORDER BY id DESC`)
      .all(batchId) as { id: number; fileId: number; rel: string; field: ChangeField; before: string | null; after: string | null }[]
    const res: ApplyResult = { batchId, applied: 0, failed: [] }
    const byFile = new Map<number, typeof rows>()
    for (const r of rows) byFile.set(r.fileId, [...(byFile.get(r.fileId) ?? []), r])
    // deshacer también vuelve a escribir los archivos: su respaldo liviano, igual que al aplicar
    const bk = startBackup(this.db, this.pathOf, 'deshacer-tags', [...byFile].map(([fileId, rs]) => ({ fileId, fields: rs.map((r) => r.field) })), batchId, 1), quitar = tapaAPapelera(this.db)
    // Primero los cover.jpg de carpeta, estrictamente del último al primero: en una carpeta con varios discos, varios temas de la
    // tanda cambian el mismo cover.jpg, y en otro orden volvía el de otro disco (corrida del respaldo liviano, 24/10). Van aparte
    // porque las filas de tags de cada tema se anotan después, cuando termina de escribirse el archivo.
    try {
      for (const r of rows.filter((x) => x.field === 'folderCover')) {
        try {
          await saveFolderCovers(this.db, this.pathOf, bk, r.fileId)
          writeFolderCover(this.pathOf(r.fileId), r.before, this.covers, quitar(r.fileId, this.pathOf(r.fileId) ?? ''))
          this.db.prepare('UPDATE journal SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), r.id)
          res.applied++
        } catch (e) {
          res.failed.push({ fileId: r.fileId, rel: r.rel, error: motivo(e) })
          if (e instanceof BackupFull) return res
        }
      }
      for (const [fileId, all] of byFile) {
        const rs = all.filter((r) => r.field !== 'folderCover')
        if (!rs.length) continue
        try {
          const tagRs = rs.filter((r) => !isRename(r.field))
          const tags = Object.fromEntries(tagRs.map((r) => [r.field, r.before])) as Partial<Record<FileField, string | null>>
          const nameBack = rs.find((r) => r.field === 'filename'), extBack = rs.find((r) => r.field === 'extension')
          const restore = tagRs.length ? exactRestore(this.db, this.ffmpeg, this.covers, batchId, fileId, tagRs) : undefined
          await changeFile(this.f, 'deshacer-tags', fileId, nameBack || extBack ? { base: nameBack?.before ?? null, ext: extBack?.before ?? null } : null, tags, () => {
            const t = new Date().toISOString()
            for (const r of rs) this.db.prepare('UPDATE journal SET undone_at = ? WHERE id = ?').run(t, r.id)
          }, bk, restore)
          res.applied += rs.length
        } catch (e) {
          res.failed.push({ fileId, rel: all[0].rel, error: motivo(e) })
          if (e instanceof BackupFull) break // el respaldo pasó lo previsto: lo demás queda para deshacer después
        }
      }
    } finally { bk.finish() }
    return res
  }

  /** Lo que necesita cambiar un tema (core/changes-file.ts) y la escritura segura (core/changes-write.ts). */
  private get f(): FileCtx {
    const w: WriteCtx = { db: this.db, ffmpeg: this.ffmpeg, journal: this.journal, covers: this.covers }
    return { db: this.db, pathOf: this.pathOf, journal: this.journal, w }
  }
}
