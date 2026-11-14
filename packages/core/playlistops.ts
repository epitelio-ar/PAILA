// Fusionar, limpiar y borrar playlists (pedidos del 22/10 y del 24/10). Repetido = el mismo archivo o el mismo tema en otra
// calidad (mismo artista y título, misma versión, duración ±3 s: sameSong); queda la mejor versión (pickKeeper, la misma
// regla de Duplicados). Solo cambia listas de la base de PAILA, nunca un archivo, y cada operación queda anotada
// (playlist_ops) con lo necesario para deshacerla desde el Historial. Los pedidos de "Traer una lista" siguen a su playlist:
// al fusionar sacando las originales pasan a la nueva (si no, la lista «Faltan o suenan mal» "Solo de esta playlist" dejaba de ver
// lo que falta: uso real del 24/10) y al borrar quedan sueltos hasta que se deshaga.
import { transaction, type Db } from './db'
import { pickKeeper } from './duplicates'
import { sameSong, titleParts } from './listmatch'
import type { Playlists } from './playlists'
import type { CleanPreview, DupItem, HistoryEntry, MergePreview, PlaylistOpBatch, PlaylistOpDetailRow } from '@paila/shared/types'
import { cant, lista, textos } from '@paila/shared/idioma'

/** Lo que se ve en la pantalla y en el Historial (los resúmenes se arman al mostrarlos). 'repetido' y 'desaparecido' son claves. */
const T = textos({
  dosListas: { es: 'Elegí al menos dos playlists para fusionar', en: 'Choose at least two playlists to merge' },
  noExiste: { es: 'Una de las playlists ya no existe', en: 'One of the playlists no longer exists' },
  carpetas: { es: 'Las carpetas no se fusionan: elegí playlists', en: "Folders can't be merged: choose playlists" },
  borrada: { es: '(playlist borrada)', en: '(deleted playlist)' },
  repetidos: {
    es: (n: number) => (n === 1 ? '1 tema repetido en otra calidad' : `${n} temas repetidos en otra calidad`),
    en: (n: number) => (n === 1 ? '1 track repeated in another quality' : `${n} tracks repeated in another quality`),
  },
  desaparecidos: { es: (n: number) => (n === 1 ? '1 desaparecido' : `${n} desaparecidos`), en: (n: number) => `${n} missing` },
  limpia: {
    es: (pl: string, n: number, partes: string[]) => `De la playlist ${pl} se ${n === 1 ? 'sacó' : 'sacaron'} ${partes.join(' y ')}`,
    en: (pl: string, _n: number, partes: string[]) => `Removed ${lista(partes)} from the playlist ${pl}`,
  },
  sacados: { es: (n: number) => `${n} repetidos en otra calidad sacados`, en: (n: number) => `${n} repeated in another quality removed` },
  originales: { es: 'las originales se sacaron', en: 'the originals were removed' },
  fusion: {
    es: (srcs: string[], pl: string, kept: number, extra: string) => `Se fusionaron ${srcs.join(', ')} en ${pl} (${kept} temas${extra ? `; ${extra}` : ''})`,
    en: (srcs: string[], pl: string, kept: number, extra: string) => `Merged ${srcs.join(', ')} into ${pl} (${cant(kept, 'track', 'tracks')}${extra ? `; ${extra}` : ''})`,
  },
  yaDeshecho: { es: 'Ya se deshizo', en: 'Already undone' },
  yaNoEsta: { es: '(tema que ya no está)', en: '(track no longer there)' },
  desaparecido: { es: 'Desaparecido', en: 'Missing' },
  repetido: { es: 'Repetido', en: 'Repeated' },
  queda: { es: (n: string) => `queda ${n}`, en: (n: string) => `keeps ${n}` },
  borro: {
    es: (pl: string, temas: number, carpeta: boolean) => `Se borró ${carpeta ? 'la carpeta' : 'la playlist'} ${pl} (${temas === 1 ? '1 tema' : `${temas} temas`}; los archivos no se tocan)`,
    en: (pl: string, temas: number, carpeta: boolean) => `Deleted the ${carpeta ? 'folder' : 'playlist'} ${pl} (${cant(temas, 'track', 'tracks')}; the files aren't touched)`,
  },
})

/** Un tema que desapareció hace más que esto se ofrece sacarlo de la playlist (siempre preguntando). */
export const MISSING_DAYS = 30

interface Row { id: number; rel: string; ext: string; size: number; kbps: number | null; duration: number | null; kind: string; artist: string | null; title: string | null; grade: string | null; missing: string | null }
const toItem = (r: Row): DupItem => ({ id: r.id, rel: r.rel, ext: r.ext, size: r.size, kbps: r.kbps, duration: r.duration, grade: r.grade, kind: r.kind, tagged: !!(r.artist && r.title), artist: r.artist, title: r.title, playlists: [] })

interface RemovedList { row: { id: number; parent_id: number | null; name: string; kind: string; rules: string | null; position: number; created_at: string }; items: { file_id: number; position: number }[] }
type OpData =
  | { type: 'clean'; playlistId: number; playlistName: string; order: number[]; removed: { fileId: number; why: 'repetido' | 'desaparecido'; keptId: number | null }[] }
  | { type: 'merge'; newId: number; name: string; sources: string[]; total: number; kept: number; removedLists: RemovedList[]; dropped: { fileId: number; keptId: number }[]
      /** Los pedidos que pasaron de las originales a la nueva (las tandas viejas no lo tienen). */
      movedRequests?: { id: number; from: number }[] }
  | { type: 'delete'; name: string; folder: boolean; tracks: number; removedLists: RemovedList[]; requests: { id: number; from: number }[] }

export interface SameGroup { keep: number; drop: number[] }

export class PlaylistOps {
  constructor(private db: Db, private playlists: Playlists) {}

  private rowsOf(ids: number[]): Map<number, Row> {
    const out = new Map<number, Row>()
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500)
      const rs = this.db.prepare(
        `SELECT f.id, f.rel_path AS rel, f.ext, f.size, f.kbps, f.duration, f.kind, f.artist, f.title, a.grade, f.missing_at AS missing
         FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id IN (${part.map(() => '?').join(',')})`,
      ).all(...part) as unknown as Row[]
      for (const r of rs) out.set(r.id, r)
    }
    return out
  }

  /**
   * Agrupa los temas que son el mismo (en otra calidad) y elige cuál queda. `ids` en el orden de la lista. Los que no se
   * encuentran en disco (desaparecidos) solo ganan si no hay otra copia.
   */
  private sameSongs(ids: number[], rows: Map<number, Row>): SameGroup[] {
    const buckets = new Map<string, Row[]>()
    for (const id of ids) {
      const r = rows.get(id)
      if (!r?.artist || !r.title) continue
      const k = titleParts(r.title).base
      if (k) buckets.set(k, [...(buckets.get(k) ?? []), r])
    }
    const groups: SameGroup[] = []
    for (const b of buckets.values()) {
      const used = new Set<number>()
      for (let i = 0; i < b.length; i++) {
        if (used.has(b[i].id)) continue
        const g = [b[i]]
        for (let j = i + 1; j < b.length; j++) {
          if (!used.has(b[j].id) && g.some((x) => sameSong({ artist: x.artist!, title: x.title!, duration: x.duration }, { artist: b[j].artist!, title: b[j].title!, duration: b[j].duration }))) g.push(b[j])
        }
        if (g.length < 2) continue
        for (const x of g) used.add(x.id)
        const alive = g.filter((x) => !x.missing)
        const keep = pickKeeper((alive.length ? alive : g).map(toItem))
        groups.push({ keep, drop: g.filter((x) => x.id !== keep).map((x) => x.id) })
      }
    }
    return groups
  }

  // ---------- limpiar una playlist ----------

  /** Qué saca "Limpiar": los repetidos en otra calidad (queda la mejor) y, aparte, los desaparecidos hace rato. */
  previewClean(playlistId: number): CleanPreview {
    const ids = this.playlists.trackIds(playlistId)
    const rows = this.rowsOf(ids)
    const groups = this.sameSongs(ids, rows).map((g) => ({ keep: toItem(rows.get(g.keep)!), drop: g.drop.map((d) => toItem(rows.get(d)!)) }))
    const limit = new Date(Date.now() - MISSING_DAYS * 86_400_000).toISOString()
    const dropped = new Set(groups.flatMap((g) => g.drop.map((d) => d.id)))
    const missing = ids.map((id) => rows.get(id)).filter((r): r is Row => !!r && !!r.missing && r.missing < limit && !dropped.has(r.id)).map(toItem)
    return { playlistId, total: ids.length, groups, missing }
  }

  /** Saca de la playlist los temas elegidos (tienen que venir de la vista previa) y lo anota para deshacer. */
  clean(playlistId: number, dropIds: number[]): { batchId: number | null; removed: number } {
    const prev = this.previewClean(playlistId)
    const why = new Map<number, { why: 'repetido' | 'desaparecido'; keptId: number | null }>()
    for (const g of prev.groups) for (const d of g.drop) why.set(d.id, { why: 'repetido', keptId: g.keep.id })
    for (const m of prev.missing) why.set(m.id, { why: 'desaparecido', keptId: null })
    const todo = [...new Set(dropIds)].filter((id) => why.has(id))
    if (!todo.length) return { batchId: null, removed: 0 }
    const data: OpData = {
      type: 'clean', playlistId, playlistName: this.nameOf(playlistId), order: this.playlists.trackIds(playlistId),
      removed: todo.map((fileId) => ({ fileId, ...why.get(fileId)! })),
    }
    this.playlists.removeTracks(playlistId, todo)
    return { batchId: this.log(data), removed: todo.length }
  }

  // ---------- fusionar playlists ----------

  private plan(listIds: number[]) {
    const all: number[] = []
    for (const id of listIds) all.push(...this.playlists.trackIds(id))
    const first = [...new Set(all)] // el mismo archivo en varias listas
    const rows = this.rowsOf(first)
    const groups = this.sameSongs(first, rows)
    const pos = new Map(first.map((id, i) => [id, i]))
    const dropped = groups.flatMap((g) => g.drop.map((fileId) => ({ fileId, keptId: g.keep })))
    // el que queda ocupa el lugar de la primera aparición del tema
    const place = new Map<number, number>()
    for (const g of groups) place.set(g.keep, Math.min(pos.get(g.keep)!, ...g.drop.map((d) => pos.get(d)!)))
    const gone = new Set(dropped.map((d) => d.fileId))
    const order = first.filter((id) => !gone.has(id)).sort((a, b) => (place.get(a) ?? pos.get(a)!) - (place.get(b) ?? pos.get(b)!) || pos.get(a)! - pos.get(b)!)
    return { total: all.length, sameFile: all.length - first.length, order, dropped, rows }
  }

  /** Cuántos temas quedarían al fusionar y cuántos se sacan por repetidos. */
  previewMerge(listIds: number[]): MergePreview {
    const m = this.plan(listIds)
    return {
      playlists: listIds.map((id) => ({ id, name: this.nameOf(id), count: this.playlists.trackIds(id).length })),
      total: m.total, unique: m.order.length, sameFile: m.sameFile, otherQuality: m.dropped.length,
      examples: m.dropped.slice(0, 8).map((d) => ({ drop: toItem(m.rows.get(d.fileId)!), keep: toItem(m.rows.get(d.keptId)!) })),
    }
  }

  /** Arma una playlist nueva con los temas de las elegidas, sin repetidos. Con `removeOriginals`, las originales se sacan (se pueden volver a poner). */
  merge(listIds: number[], name: string, removeOriginals: boolean, parentId: number | null = null): { id: number; added: number; batchId: number } {
    if (new Set(listIds).size < 2) throw new Error(T.dosListas)
    for (const id of listIds) {
      const k = this.db.prepare('SELECT kind FROM playlists WHERE id = ?').get(id) as { kind: string } | undefined
      if (!k) throw new Error(T.noExiste)
      if (k.kind === 'folder') throw new Error(T.carpetas)
    }
    const m = this.plan(listIds)
    let id = 0, batchId = 0
    transaction(this.db, () => {
      id = this.playlists.create(name, 'list', parentId)
      this.playlists.addTracks(id, m.order)
      const sources = listIds.map((s) => this.nameOf(s))
      const removedLists: RemovedList[] = []
      const movedRequests: { id: number; from: number }[] = []
      if (removeOriginals) for (const src of listIds) {
        removedLists.push(this.snapshot(src))
        // sus pedidos pasan a la nueva: lo que llega después entra ahí y la lista «Faltan o suenan mal» la sigue viendo
        movedRequests.push(...this.requestsOf([src]))
        this.db.prepare('UPDATE requests SET playlist_id = ? WHERE playlist_id = ?').run(id, src)
        this.playlists.remove(src)
      }
      batchId = this.log({ type: 'merge', newId: id, name: name.trim(), sources, total: m.total, kept: m.order.length, removedLists, dropped: m.dropped, movedRequests })
    })
    return { id, added: m.order.length, batchId }
  }

  // ---------- borrar una playlist ----------

  /** Cuántos pedidos de "Traer una lista" quedarían sin playlist al borrarla (con lo que tenga adentro, si es carpeta). */
  requestsIfRemoved(id: number): number { return this.requestsOf(this.subtree(id)).length }

  /** Borra la playlist (o la carpeta con lo de adentro) y lo anota: se deshace desde el Historial, con sus pedidos enganchados. */
  remove(id: number): number | null {
    const row = this.db.prepare('SELECT kind FROM playlists WHERE id = ?').get(id) as { kind: string } | undefined
    if (!row) return null
    let batchId = 0
    transaction(this.db, () => {
      const ids = this.subtree(id)
      const removedLists = ids.map((x) => this.snapshot(x))
      const tracks = new Set(removedLists.flatMap((l) => l.items.map((i) => i.file_id))).size
      batchId = this.log({ type: 'delete', name: this.nameOf(id), folder: row.kind === 'folder', tracks, removedLists, requests: this.requestsOf(ids) })
      this.playlists.remove(id)
    })
    return batchId
  }

  /** La playlist y, si es carpeta, todo lo de adentro: las de arriba antes que las de adentro (así se vuelven a poner). */
  private subtree(id: number): number[] {
    const out = [id]
    for (let i = 0; i < out.length; i++) for (const c of this.db.prepare('SELECT id FROM playlists WHERE parent_id = ? ORDER BY position, id').all(out[i]) as { id: number }[]) out.push(c.id)
    return out
  }
  private snapshot(id: number): RemovedList {
    const row = this.db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as unknown as RemovedList['row']
    const items = this.db.prepare('SELECT file_id, position FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(id) as unknown as RemovedList['items']
    return { row, items }
  }
  private requestsOf(ids: number[]): { id: number; from: number }[] {
    return this.db.prepare(`SELECT id, playlist_id AS "from" FROM requests WHERE undone_at IS NULL AND playlist_id IN (${ids.map(() => '?').join(',') || 'NULL'})`).all(...ids) as unknown as { id: number; from: number }[]
  }
  /** Vuelve a poner las playlists sacadas (las carpetas antes que lo de adentro) y les devuelve sus pedidos. */
  private restore(lists: RemovedList[], requests: { id: number; from: number }[]) {
    for (const l of lists) {
      const parentOk = l.row.parent_id != null && this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(l.row.parent_id)
      this.db.prepare('INSERT OR IGNORE INTO playlists (id, parent_id, name, kind, rules, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(l.row.id, parentOk ? l.row.parent_id : null, l.row.name, l.row.kind, l.row.rules, l.row.position, l.row.created_at)
      for (const it of l.items) if (this.db.prepare('SELECT 1 FROM files WHERE id = ?').get(it.file_id)) this.db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, file_id, position) VALUES (?, ?, ?)').run(l.row.id, it.file_id, it.position)
    }
    for (const r of requests) if (this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(r.from)) this.db.prepare('UPDATE requests SET playlist_id = ? WHERE id = ?').run(r.from, r.id)
  }

  private nameOf(id: number) { return (this.db.prepare('SELECT name FROM playlists WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? T.borrada }

  // ---------- historial y deshacer ----------

  private log(data: OpData): number {
    const r = this.db.prepare('INSERT INTO playlist_ops (kind, data, created_at) VALUES (?, ?, ?)').run(data.type, JSON.stringify(data), new Date().toISOString())
    return Number(r.lastInsertRowid)
  }

  batches(): PlaylistOpBatch[] {
    const rs = this.db.prepare('SELECT id, data, created_at AS at, undone_at IS NOT NULL AS undone FROM playlist_ops ORDER BY id DESC').all() as unknown as { id: number; data: string; at: string; undone: number }[]
    return rs.map((r) => {
      const d = JSON.parse(r.data) as OpData
      const pl = (name: string) => `«${name}»`
      if (d.type === 'clean') {
        const rep = d.removed.filter((x) => x.why === 'repetido').length, gone = d.removed.length - rep
        const parts = [rep ? T.repetidos(rep) : '', gone ? T.desaparecidos(gone) : ''].filter(Boolean)
        return { id: r.id, at: r.at, undone: !!r.undone, files: d.removed.length, summary: T.limpia(pl(d.playlistName), d.removed.length, parts) }
      }
      if (d.type === 'delete') return { id: r.id, at: r.at, undone: !!r.undone, files: d.tracks, summary: T.borro(pl(d.name), d.tracks, d.folder) }
      const extra = [d.dropped.length ? T.sacados(d.dropped.length) : '', d.removedLists.length ? T.originales : ''].filter(Boolean).join('; ')
      return { id: r.id, at: r.at, undone: !!r.undone, files: d.kept, summary: T.fusion(d.sources.map(pl), pl(d.name), d.kept, extra) }
    })
  }

  /** Las tandas como entradas del Historial. */
  entries(): HistoryEntry[] {
    return this.batches().map((b) => ({ kind: 'listas' as const, id: b.id, at: b.at, files: b.files, summary: b.summary, undone: b.undone, canUndo: !b.undone, whyNot: b.undone ? T.yaDeshecho : null, note: null }))
  }

  detail(id: number): PlaylistOpDetailRow[] {
    const r = this.db.prepare('SELECT data, undone_at IS NOT NULL AS undone FROM playlist_ops WHERE id = ?').get(id) as unknown as { data: string; undone: number } | undefined
    if (!r) return []
    const d = JSON.parse(r.data) as OpData
    if (d.type === 'delete') return []
    const gone = d.type === 'clean' ? d.removed.map((x) => ({ fileId: x.fileId, keptId: x.keptId, why: x.why })) : d.dropped.map((x) => ({ ...x, why: 'repetido' as const }))
    const rows = this.rowsOf([...gone.map((g) => g.fileId), ...gone.map((g) => g.keptId).filter((k): k is number => k != null)])
    return gone.map((g) => {
      const f = rows.get(g.fileId), k = g.keptId != null ? rows.get(g.keptId) : null
      return { rel: f?.rel ?? T.yaNoEsta, what: g.why === 'desaparecido' ? T.desaparecido : T.repetido, before: f?.rel.split('/').pop() ?? null, after: k ? T.queda(k.rel.split('/').pop()!) : null, undone: !!r.undone }
    })
  }

  /** Devuelve la playlist a como estaba. Devuelve cuántos temas o playlists volvieron. */
  undo(id: number): number {
    const r = this.db.prepare('SELECT data FROM playlist_ops WHERE id = ? AND undone_at IS NULL').get(id) as unknown as { data: string } | undefined
    if (!r) return 0
    const d = JSON.parse(r.data) as OpData
    let n = 0
    transaction(this.db, () => {
      if (d.type === 'clean') {
        if (this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(d.playlistId)) {
          const ins = this.db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, file_id, position) VALUES (?, ?, 999999)')
          for (const x of d.removed) if (this.db.prepare('SELECT 1 FROM files WHERE id = ?').get(x.fileId) && Number(ins.run(d.playlistId, x.fileId).changes)) n++
          // el orden de antes; lo que se agregó después queda al final
          const now = this.playlists.trackIds(d.playlistId)
          const was = new Set(d.order), isNow = new Set(now)
          this.playlists.setOrder(d.playlistId, [...d.order.filter((f) => isNow.has(f)), ...now.filter((f) => !was.has(f))])
        }
      } else if (d.type === 'delete') {
        this.restore(d.removedLists, d.requests)
        n = d.removedLists.length
      } else {
        this.playlists.remove(d.newId)
        this.restore(d.removedLists, d.movedRequests ?? [])
        n = d.removedLists.length || 1
      }
      this.db.prepare('UPDATE playlist_ops SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    })
    return n
  }
}
