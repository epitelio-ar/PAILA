// Historial único: junta en una sola lista todo lo que PAILA hizo sobre archivos (tags y nombres, papelera, organizador,
// limpieza de Espacio, reemplazos, conversiones y "Mejorar playlist"), y lo copiado afuera (pendrive, celular, otros programas:
// history-copies.ts), del más nuevo al más viejo.
// Leer es solo lectura sobre los registros de cada módulo; deshacer llama al deshacer que ya tiene cada uno. Cada tipo de
// tanda se arma en su archivo: history-files.ts (tags, papelera, organizador) y history-replace.ts (reemplazos y
// conversiones); los textos comunes, en history-text.ts. Las partes de cada Aplicar van juntas y cada tanda sabe qué vino después y la
// toca: deshacerla deshace antes eso, de lo más nuevo a lo más viejo, y al final se sacan las carpetas vacías que había creado PAILA
// (core/history-cadena.ts, core/restos.ts). "Volver a como estaba": un punto por cada Aplicar (`puntos`, `volver`).
import { enPaila, temaEnPaila, type Db } from './db'
import type { Changes } from './changes'
import type { Trash } from './trash'
import type { Organizer } from './organizer'
import type { Replacer } from './replace'
import type { Improver } from './improve'
import { purgeEntries, purgeId, purgedFiles } from './purge'
import type { HistoryDetail, HistoryDetailRow, HistoryEntry, HistoryKind, HistoryPunto, HistoryRef, HistoryUndoResult } from '@paila/shared/types'
import { agrupar, encadenar, huellasAlDia, puntos, tandasAplicar } from './history-cadena'
import { C } from './history-cadena.textos'
import { sacarCreadas } from './restos'
import { EmptyDirs } from './emptydirs'
import { gainText } from './foldercover'
import { seratoText } from './seratotag'
import { FIELD, H, bare, base, cap, dirOf } from './history-text'
import { moveEntries, tagEntries, trashEntries } from './history-files'
import { repBlock, repGroups, replacementEntries } from './history-replace'
import { copyDetail, copyEntries } from './history-copies'
import { listBackups } from './ops/backup'

export interface HistoryDeps {
  changes: Changes
  trash: Trash
  organizer: Organizer
  replacer: Replacer
  improver: Improver
  /** Listas traídas de otro lado (core/requests.ts): solo cambian la base. */
  requests?: { history(): HistoryEntry[]; undo(id: number): number; historyDetail(id: number): HistoryDetailRow[] }
  /** Playlists traídas de Rekordbox o de un pendrive, de a tanda (core/listimport.ts): solo cambian la base. */
  imports?: { history(): HistoryEntry[]; undo(id: number): number; historyDetail(id: number): HistoryDetailRow[] }
  /** Temas de la Bandeja pasados a tu Música (core/inboxadd.ts). */
  added?: { history(): HistoryEntry[]; undo(id: number): Promise<HistoryUndoResult>; historyDetail(id: number): HistoryDetailRow[] }
  /** Lo sacado de un ZIP o RAR a una carpeta al lado (core/archive/extract.ts). */
  archives?: { history(): HistoryEntry[]; undo(id: number): Promise<HistoryUndoResult>; historyDetail(id: number): HistoryDetailRow[] }
  /** Un ZIP o RAR que ya estaba abierto afuera, mandado a la papelera de PAILA (core/archive/papelera.ts). */
  archiveTrash?: { history(): HistoryEntry[]; undo(id: number): Promise<HistoryUndoResult>; historyDetail(id: number): HistoryDetailRow[] }
  /** La acapella y el instrumental que sacó Separar voz (core/stems/separar.ts). */
  separar?: { history(): HistoryEntry[]; undo(id: number): Promise<HistoryUndoResult>; historyDetail(id: number): HistoryDetailRow[] }
  /** Las carpetas vacías que se sacaron desde Espacio (core/emptydirs.ts): deshacer las vuelve a crear. */
  carpetas?: { history(): HistoryEntry[]; undo(id: number): Promise<HistoryUndoResult>; historyDetail(id: number): HistoryDetailRow[] }
  listas?: /* playlists fusionadas o limpiadas (core/playlistops.ts) */ { entries(): HistoryEntry[]; undo(id: number): number; detail(id: number): { rel: string; what: string; before: string | null; after: string | null; undone: boolean }[] }
  /** Carpeta de música de un disco conectado, o null. */
  rootPath: (rootId: number) => string | null
}

const DETAIL_LIMIT = 500

export class History {
  constructor(private db: Db, private deps: HistoryDeps) {
    // un Aplicar puede tener su parte de carpetas vacías (las que dejó el mover): sin Espacio conectado, se arman con las carpetas de música
    deps.carpetas ??= new EmptyDirs(db, () => (db.prepare('SELECT id FROM roots WHERE removed_at IS NULL').all() as { id: number }[])
      .map((r) => ({ id: r.id, path: deps.rootPath(r.id) ?? '', available: !!deps.rootPath(r.id), rules: [] })))
  }
  private memo = {} // las huellas de la última vez (core/history-cadena.ts, huellasAlDia)

  /** Todo, del más nuevo al más viejo. */
  list(): HistoryEntry[] {
    this.online = new Map()
    try {
      const { db } = this, on = this.connected
      const all = [...tagEntries(db, on), ...trashEntries(db, on), ...moveEntries(db, on), ...replacementEntries(db, on), ...this.playlists(), ...(this.deps.listas?.entries() ?? []), ...(this.deps.requests?.history() ?? []), ...(this.deps.imports?.history() ?? []), ...(this.deps.added?.history() ?? []), ...(this.deps.archives?.history() ?? []), ...(this.deps.archiveTrash?.history() ?? []), ...(this.deps.separar?.history() ?? []), ...(this.deps.carpetas?.history() ?? []), ...purgeEntries(this.db), ...copyEntries(this.db)]
      // dónde quedó el respaldo de los archivos de cada tanda de Cambios pendientes (ops/backup.ts)
      const bks = listBackups(db)
      for (const e of all) {
        if (e.kind !== 'tags') continue
        const mine = bks.filter((b) => b.ref === e.id && (b.op === 'tags' || b.op === 'deshacer-tags'))
        if (mine.length) e.backups = mine.map((b) => ({ id: b.id, dir: b.dir, files: b.files, bytes: b.bytes, op: b.op, exists: b.exists, light: b.light }))
      }
      const { lista, partes } = agrupar(db, all)
      lista.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id))
      encadenar(lista, partes, huellasAlDia(db, this.memo))
      return lista
    } finally { this.online = null }
  }

  // Mientras se arma la lista, si un disco está conectado se pregunta una vez por disco (no una vez por tema de cada tanda).
  private online: Map<number, boolean> | null = null
  private connected = (rootId: number): boolean => {
    let v = this.online?.get(rootId)
    if (v == null) { v = !!this.deps.rootPath(rootId); this.online?.set(rootId, v) }
    return v
  }

  /** Qué archivos tocó una tanda y qué les cambió (las primeras 500 filas). */
  detail(kind: HistoryKind, id: number): HistoryDetail {
    const rows = this.detailRows(kind, id)
    return { rows: rows.slice(0, DETAIL_LIMIT), total: rows.length }
  }

  /**
   * Deshace una tanda. Antes vuelve a revisar que se pueda (el estado pudo cambiar desde que se armó la lista). Si después vino algo
   * que la toca, solo con `cadena`: se deshace eso antes, de lo más nuevo a lo más viejo (nunca a medias).
   */
  async undo(kind: HistoryKind, id: number, opts: { cadena?: boolean } = {}): Promise<HistoryUndoResult> {
    const e = this.list().find((x) => x.kind === kind && x.id === id)
    if (!e) throw new Error(H.noEsta)
    if (!e.canUndo) throw new Error(e.whyNot ?? H.noSePuede)
    if (e.cadena?.length && !opts.cadena) throw new Error(C.hayCadena(e.cadena.length))
    return this.enOrden([...(e.cadena ?? []), e])
  }

  /** Los puntos de "Volver a como estaba": uno por cada Aplicar, con lo que deshace. */
  puntos(): HistoryPunto[] { return puntos(this.list()) }

  /** Vuelve a como estaba antes de ese Aplicar: lo deshace a él y todo lo que tocó archivos después, de lo más nuevo a lo más viejo. */
  async volver(tanda: number): Promise<HistoryUndoResult> {
    const p = this.puntos().find((x) => x.tanda === tanda)
    if (!p) throw new Error(C.noEsPunto)
    if (!p.canUndo) throw new Error(p.whyNot ?? H.noSePuede)
    return this.enOrden(p.entradas)
  }

  /** Deshace en ese orden. Si una falla en algo, las más viejas esperan (nada a medias). Al final, las carpetas vacías que creó PAILA. */
  private async enOrden(refs: HistoryRef[]): Promise<HistoryUndoResult> {
    const out: HistoryUndoResult = { done: 0, failed: [] }
    let tandas = 0
    try {
      for (const r of refs) {
        const x = await this.uno(r.kind, r.id)
        out.done += x.done; out.failed.push(...x.failed); tandas++
        if (x.failed.length) break
      }
    } finally {
      const carpetas = sacarCreadas(this.db, this.deps.rootPath)
      if (carpetas) out.carpetas = carpetas
      if (refs.length > 1) out.tandas = tandas
    }
    return out
  }

  /** Un Aplicar: sus partes al revés (reemplazos → tapas → mover → tags → papelera), las que no se deshicieron todavía. */
  private async aplicar(id: number): Promise<HistoryUndoResult> {
    const t = tandasAplicar(this.db).find((x) => x.id === id)
    if (!t) throw new Error(C.sinPartes)
    const out: HistoryUndoResult = { done: 0, failed: [] }
    const viva: Record<string, string> = { tags: 'journal WHERE batch_id = ? AND undone_at IS NULL', papelera: 'trash_log WHERE batch_id = ? AND restored_at IS NULL', organizar: 'moves_log WHERE batch_id = ? AND undone_at IS NULL', carpetas: `empty_dirs_log WHERE batch = ? AND restored_at IS NULL AND ${enPaila('root_id')}`,
      reemplazo: 'replacements WHERE batch = (SELECT batch FROM replacements WHERE id = ?) AND undone_at IS NULL' } // las copias mejores de Sonido
    for (const p of [...t.partes].reverse()) {
      if (!this.db.prepare(`SELECT 1 FROM ${viva[p.kind]} LIMIT 1`).get(p.id)) continue
      const x = await this.uno(p.kind, p.id)
      out.done += x.done; out.failed.push(...x.failed)
      if (x.failed.length) break
    }
    return out
  }

  private async uno(kind: HistoryKind, id: number): Promise<HistoryUndoResult> {
    const { changes, trash, organizer, replacer, improver } = this.deps
    switch (kind) {
      case 'aplicar': return this.aplicar(id)
      case 'tags': {
        const pending = (this.db.prepare(`SELECT COUNT(DISTINCT file_id) AS n FROM journal WHERE batch_id = ? AND undone_at IS NULL AND ${temaEnPaila('file_id')}`).get(id) as { n: number }).n
        const r = await changes.undo(id)
        return { done: pending - r.failed.length, failed: r.failed.map((f) => ({ rel: f.rel, error: f.error })) }
      }
      case 'papelera': { const r = await trash.restore(id); return { done: r.moved, failed: r.failed.map((f) => ({ rel: f.rel, error: f.error })) } }
      case 'organizar': case 'limpieza': {
        const r = await organizer.undo(id)
        return { done: r.moved + r.extras, failed: r.failed }
      }
      case 'reemplazo': case 'conversion': case 'recorte': {
        const group = repGroups(this.db).find((g) => g[0].id === id) ?? []
        const out: HistoryUndoResult = { done: 0, failed: [] }
        // del más nuevo al más viejo, solo los que se pueden
        for (const r of [...group].reverse()) {
          if (r.undone || repBlock(this.db, r, this.connected)) continue
          try { replacer.undo(r.id); out.done++ } catch (err) { out.failed.push({ rel: r.oldRel, error: (err as Error).message }) }
        }
        return out
      }
      case 'playlist': return { done: improver.undo(id), failed: [] }
      case 'pedido': case 'listas': return { done: (kind === 'listas' ? this.deps.listas! : this.deps.requests!).undo(id), failed: [] }
      case 'traidas': return { done: this.deps.imports!.undo(id), failed: [] }
      case 'bandeja': return this.deps.added!.undo(id)
      case 'comprimido': return this.deps.archives!.undo(id)
      case 'comprimido-papelera': return this.deps.archiveTrash!.undo(id)
      case 'separar': return this.deps.separar!.undo(id)
      case 'carpetas': return this.deps.carpetas!.undo(id)
      case 'vaciado': throw new Error(H.vaciarNoSeDeshace)
      case 'copia': throw new Error(H.noSePuede)
    }
  }

  // ---------- Mejorar playlist (improve_log) ----------

  private playlists(): HistoryEntry[] {
    return this.deps.improver.batches().map((b) => {
      // '(playlist borrada)' lo pone core/improve.ts cuando la playlist ya no está: es un dato, no se traduce
      const summary = H.playlist(b.playlistName === '(playlist borrada)' ? null : b.playlistName, b.swaps)
      return { kind: 'playlist' as const, id: b.batchId, at: b.createdAt, files: b.swaps, summary, undone: b.undone, canUndo: !b.undone, whyNot: b.undone ? H.yaDeshizo : null, note: null }
    })
  }

  // ---------- detalle ----------

  private detailRows(kind: HistoryKind, id: number): HistoryDetailRow[] {
    const row = (rel: string, what: string, before: string | null, after: string | null, undone: boolean): HistoryDetailRow => ({ name: base(rel), folder: dirOf(rel), what, before, after, undone })
    switch (kind) {
      case 'aplicar': return (tandasAplicar(this.db).find((t) => t.id === id)?.partes ?? []).flatMap((p) => this.detailRows(p.kind, p.id))
      case 'tags': {
        const rs = this.db.prepare('SELECT rel_path AS rel, field, before, after, undone_at IS NOT NULL AS undone FROM journal WHERE batch_id = ? ORDER BY rel_path, id').all(id) as
          { rel: string; field: string; before: string | null; after: string | null; undone: number }[]
        return rs.map((r) => {
          const show = (v: string | null, which: 'before' | 'after') => r.field === 'cover' || r.field === 'folderCover' ? (v ? (which === 'before' ? H.conTapa : H.tapaNueva) : H.sinTapa)
            : r.field === 'replaygain' ? gainText(v) : r.field === 'serato' ? seratoText(v) : r.field === 'extension' && v ? `.${v}` : v
          return row(r.rel, cap(FIELD[r.field] ? bare(FIELD[r.field]) : r.field), show(r.before, 'before'), show(r.after, 'after'), !!r.undone)
        })
      }
      case 'papelera': {
        const rs = this.db.prepare('SELECT orig_rel AS rel, reason, restored_at IS NOT NULL AS undone FROM trash_log WHERE batch_id = ? ORDER BY orig_rel').all(id) as { rel: string; reason: string | null; undone: number }[]
        return rs.map((r) => row(r.rel, H.aLaPapelera, null, null, !!r.undone))
      }
      case 'organizar': case 'limpieza': {
        const rs = this.db.prepare('SELECT from_rel AS fromRel, to_rel AS toRel, file_id AS fileId, undone_at IS NOT NULL AS undone FROM moves_log WHERE batch_id = ? ORDER BY from_rel').all(id) as
          { fromRel: string; toRel: string; fileId: number | null; undone: number }[]
        return rs.map((r) => kind === 'limpieza'
          ? row(r.fromRel, H.aLaPapelera, null, null, !!r.undone)
          // la carpeta de origen ya va en "antes": no se repite al lado del nombre
          : { ...row(r.fromRel, r.fileId == null ? H.acompana : H.movido, dirOf(r.fromRel) || H.raiz,
            base(r.toRel) !== base(r.fromRel) ? r.toRel : dirOf(r.toRel) || H.raiz, !!r.undone), folder: '' })
      }
      case 'reemplazo': case 'conversion': case 'recorte': {
        const g = repGroups(this.db).find((x) => x[0].id === id) ?? []
        return g.map((r) => row(r.oldRel, r.cls === 'reemplazo' ? H.reemplazado : r.cls === 'recorte' ? H.recortado : H.convertido, base(r.oldRel), base(r.newRel), r.undone))
      }
      case 'playlist': {
        const rs = this.db.prepare(
          `SELECT o.rel_path AS oldRel, n.rel_path AS newRel, l.undone_at IS NOT NULL AS undone FROM improve_log l
           LEFT JOIN files o ON o.id = l.old_file LEFT JOIN files n ON n.id = l.new_file WHERE l.batch_id = ? ORDER BY l.position`,
        ).all(id) as { oldRel: string | null; newRel: string | null; undone: number }[]
        return rs.map((r) => row(r.oldRel ?? H.temaNoEsta, H.versionMejor, r.oldRel && base(r.oldRel), r.newRel ?? H.temaNoEsta, !!r.undone))
      }
      case 'listas': return (this.deps.listas?.detail(id) ?? []).map((r) => row(r.rel, r.what, r.before, r.after, r.undone))
      case 'pedido': return this.deps.requests?.historyDetail(id) ?? []
      case 'traidas': return this.deps.imports?.historyDetail(id) ?? []
      case 'bandeja': return this.deps.added?.historyDetail(id) ?? []
      case 'comprimido': return this.deps.archives?.historyDetail(id) ?? []
      case 'comprimido-papelera': return this.deps.archiveTrash?.historyDetail(id) ?? []
      case 'separar': return this.deps.separar?.historyDetail(id) ?? []
      case 'carpetas': return this.deps.carpetas?.historyDetail(id) ?? []
      case 'copia': return copyDetail(this.db, id)
      case 'vaciado': return purgedFiles(this.db).filter((r) => purgeId(r.at) === id).map((r) => row(r.rel, r.what, null, H.borrado, false))
    }
  }
}
