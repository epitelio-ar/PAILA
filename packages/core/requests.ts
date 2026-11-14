// "Traer una lista de otro lado" (MASTERPLAN-2, 4b): alguien pasa la playlist de Spotify de un evento y PAILA la arma
// con lo que tenés. Vista previa (nada se guarda) → "Crear la playlist": una playlist con el nombre del pedido, en el orden
// de la lista, y lo que falta o está en baja calidad va a la lista «Faltan o suenan mal», marcado con el nombre del pedido. Lo que
// después llega por la Bandeja entra solo a esa playlist (`sync`). Solo cambia la base, nunca archivos; se deshace desde
// el Historial (o desde la misma pantalla).
import fs from 'node:fs'
import path from 'node:path'
import { transaction, visible, type Db } from './db'
import { setReason } from './sets'
import { nameGuess } from './inbox'
import { parseList, spotifyLink, type ListEntry } from './listparse'
import { ListMatcher, lowQuality, requestTitle, type LibTrack } from './listmatch'
import { ArtistDict } from './artistdict'
import { deezerIndex } from './listdeezer'
import { OnlineCache } from './online/http'
import { artistKey } from './official-findings'
import { relate } from './official'
import type { ArtistHit } from './online/hits'
import type { Playlists } from './playlists'
import type { Wanted } from './wanted'
import type { HistoryDetailRow, HistoryEntry, RequestCounts, RequestDecision, RequestDetail, RequestFile, RequestItem, RequestMatchKind, RequestPreview, RequestState, RequestSummary } from '@paila/shared/types'
import { idioma } from '@paila/shared/idioma'
import { T } from './requests.textos'
import { syncArrived } from './requests-sync'
import { addVersion, dropVersion, othersUse, sameName, updateItems, versionOf, versionPairs } from './requests-update'
import { Q } from './wanted.textos'

const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'tta'])
/** Lo seguro (entra solo): mismo ISRC, misma ruta, mismo archivo en otra carpeta, la misma huella, mismos artistas y título (exacto) o llegó por la Bandeja. */
export const SURE: RequestMatchKind[] = ['isrc', 'ruta', 'archivo', 'huella', 'exacto', 'llego']
const SURE_SQL = SURE.map((k) => `'${k}'`).join(', ')

/** Un tema de otro lado ya leído (rekordbox.xml, pendrive): como una línea de la lista, más el tamaño del archivo si se sabe. */
export interface ForeignEntry extends ListEntry { size?: number | null }

/** Lo que dice la persona de un tema manda; si no dijo nada, lo seguro entra y lo probable queda para confirmar. */
export function stateOf(kind: RequestMatchKind, decision: RequestDecision | null, file: { low: boolean } | null): RequestState {
  if (!file || kind === 'none' || decision === 'no') return 'falta'
  if (decision === 'si' || decision === 'ambos' || SURE.includes(kind)) return file.low ? 'baja' : 'tenes'
  return 'revisar'
}
const count = (items: { state: RequestState }[]): RequestCounts => {
  const c: RequestCounts = { tenes: 0, baja: 0, falta: 0, revisar: 0 }
  for (const i of items) c[i.state]++
  return c
}

interface Row extends LibTrack { kbps: number | null; label: string | null }
/** Un tema que entra a un pedido: como viene de la vista previa, con el id del archivo. */
export type NewItem = Pick<RequestItem, 'position' | 'artist' | 'title' | 'album' | 'duration' | 'isrc' | 'kind' | 'why' | 'decision'> & { fileId: number | null }
export interface Saved { id: number; requestId: number; position: number; artist: string; title: string; album: string | null; duration: number | null; isrc: string | null; kind: RequestMatchKind; fileId: number | null; decision: RequestDecision | null; why: string; wantedId: number | null; wantedCreated: number }

export class Requests {
  constructor(private db: Db, private playlists: Playlists, private wanted: Wanted, private pathOf: (id: number) => string | null) {}

  // ---------- la biblioteca, como la mira el emparejador ----------

  private rows(ids?: number[]): Row[] {
    const where = ids ? `f.id IN (${ids.map(() => '?').join(',') || 'NULL'})` : `${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar')`
    return (this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, f.ext, f.kbps, f.artist, f.title, f.duration, f.album, a.grade, a.flags, a.is_label AS label, i.isrc
       FROM files f LEFT JOIN analysis a ON a.file_id = f.id LEFT JOIN file_isrc i ON i.file_id = f.id WHERE ${where}`,
    ).all(...(ids ?? [])) as unknown as Row[])
  }

  private matcher(entries: ListEntry[]): ListMatcher {
    const lib = this.rows().filter((r) => !setReason(r.rel, r.duration, r)).map((r) => ({ ...r, guess: nameGuess(r.rel) }))
    const cache = new OnlineCache(this.db)
    // los alias de MusicBrainz ("Balvin" es J Balvin) que ya se buscaron en "Completar desde internet"
    // (una vez por nombre: el mismo artista aparece en muchos temas)
    const seen = new Map<string, string[]>()
    const aliases = (name: string) => {
      let v = seen.get(name)
      if (!v) {
        v = (cache.get<ArtistHit[]>('musicbrainz', artistKey(name))?.data ?? [])
          .filter((h) => h.score >= 90 && (relate(name, h.name, h.aliases) === 'same' || relate(name, h.name, h.aliases) === 'alias')).flatMap((h) => [h.name, ...h.aliases])
        seen.set(name, v)
      }
      return v
    }
    let byPath: Map<string, number> | undefined
    if (entries.some((e) => e.path)) {
      // la misma ruta vale para cualquier tema visible: un sample, un set largo o algo para revisar también es tuyo (corrida del 22/10)
      byPath = new Map()
      for (const r of this.db.prepare(`SELECT f.id FROM files f WHERE ${visible('f')}`).all() as { id: number }[]) { const p = this.pathOf(r.id); if (p) byPath.set(path.resolve(p).toLowerCase(), r.id) }
    }
    // los ISRC del pedido que Deezer ya contestó (core/listdeezer.ts): solo si la lista trae alguno
    const deezer = entries.some((e) => e.isrc) ? deezerIndex(this.db, lib) : undefined
    return new ListMatcher(lib, { dict: new ArtistDict(this.db).map(), aliases, byPath, deezer })
  }

  private file(r: Row | undefined): RequestFile | null {
    if (!r) return null
    const fmt = `${r.ext.toUpperCase()}${r.kbps && !LOSSLESS.has(r.ext.toLowerCase()) ? ` ${r.kbps} kbps` : ''}`
    const q = Q[idioma()]
    const quality = r.grade ? `${fmt} · ${q.nota} ${r.grade}${r.label && !r.label.startsWith(r.ext.toUpperCase()) ? ` (${r.label})` : ''}` : `${fmt} · ${q.sinAnalizar}`
    return { id: r.id, rel: r.rel, artist: r.artist, title: r.title, duration: r.duration, ext: r.ext, grade: r.grade, quality, low: lowQuality(r) }
  }

  // ---------- vista previa ----------

  /** Lee la lista y la empareja con la biblioteca. No guarda nada. */
  previewFile(file: string): RequestPreview { return this.preview(fs.readFileSync(file, 'utf8'), file) }

  /** Lee la lista y la empareja con la biblioteca. No guarda nada. */
  preview(text: string, fileName?: string, name?: string): RequestPreview {
    const parsed = parseList(text, fileName)
    if (spotifyLink(text) && parsed.entries.length <= 1) throw new Error(T.linkSpotify)
    if (!parsed.entries.length) throw new Error(T.sinTemas)
    const items = this.match(parsed.entries)
    const withIsrc = (this.db.prepare('SELECT COUNT(*) AS n FROM file_isrc WHERE isrc IS NOT NULL').get() as { n: number }).n
    const base = fileName ? path.basename(fileName, path.extname(fileName)) : `Lista pegada (${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })})`
    const final = name?.trim() || base
    return { name: final, source: parsed.source, items, counts: count(items), skipped: parsed.skipped, withIsrc, existing: sameName(this.db, final) }
  }

  /**
   * Empareja temas ya leídos con la biblioteca. Además de lo de una lista: si la ruta no está pero hay un archivo con el mismo
   * nombre y el mismo tamaño, es el mismo archivo en otra carpeta (seguro; con copias, la de la carpeta más parecida). No guarda nada.
   */
  match(entries: ForeignEntry[]): RequestItem[] {
    const m = this.matcher(entries)
    let byFile: Map<string, number[]> | undefined
    if (entries.some((e) => e.size)) {
      byFile = new Map()
      for (const r of this.db.prepare(`SELECT f.id, f.rel_path AS rel, f.size FROM files f WHERE ${visible('f')} AND f.error IS NULL`).all() as { id: number; rel: string; size: number }[]) {
        const k = `${path.posix.basename(r.rel).toLowerCase()}|${r.size}`
        byFile.set(k, [...(byFile.get(k) ?? []), r.id])
      }
    }
    const relOf = byFile ? new Map((this.db.prepare(`SELECT f.id, f.rel_path AS rel FROM files f WHERE ${visible('f')}`).all() as { id: number; rel: string }[]).map((r) => [r.id, r.rel.toLowerCase().split('/')])) : null
    /** Cuántas carpetas del final coinciden ("Pack/CR 78/01.wav" con "Sample Packs/Pack/CR 78/01.wav": 3). */
    const tail = (a: string[], b: string[]) => { let k = 0; while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++; return k }
    const found = entries.map((e) => {
      const r = m.match(e)
      if (r.kind === 'ruta' || !e.size || !e.path || !byFile) return { e, r }
      const parts = e.path.replace(/\\/g, '/').toLowerCase().split('/')
      // mismo nombre y mismo tamaño: el mismo archivo; si hay copias (un sample pack repetido), la de la carpeta más parecida
      const same = [...(byFile.get(`${parts[parts.length - 1]}|${e.size}`) ?? [])].sort((a, b) => tail(relOf!.get(b) ?? [], parts) - tail(relOf!.get(a) ?? [], parts) || a - b)
      return same.length ? { e, r: { kind: 'archivo' as const, fileId: same[0], why: T.mismoArchivo, copies: same.length - 1 } } : { e, r }
    })
    const files = this.files(found.map((x) => x.r.fileId).filter((x): x is number => x != null))
    return found.map(({ e, r }) => {
      const file = r.fileId != null ? files.get(r.fileId) ?? null : null
      return { id: 0, position: e.position, artist: e.artist, title: e.title, album: e.album, duration: e.duration, isrc: e.isrc, kind: r.kind, why: r.why, file, decision: null, state: stateOf(r.kind, null, file), copies: r.copies }
    })
  }

  /** Cómo se muestra cada tema de la biblioteca en un pedido (calidad, nota, si es mala calidad). */
  files(ids: number[]): Map<number, RequestFile> {
    return new Map(this.rows(ids).map((r) => [r.id, this.file(r)!]))
  }

  // ---------- crear y decidir ----------

  /** Guarda el pedido con lo que decidió la persona, arma la playlist y suma lo que falta a la lista «Faltan o suenan mal». */
  create(p: { name: string; source: string; items: NewItem[]
    /** Con una tanda de playlists traídas (core/listimport.ts): la carpeta donde va y la tanda (se deshace junta). */
    parentId?: number; importId?: number
    /** Los de mala calidad también van a la lista «Faltan o suenan mal» (en "Traer una lista", sí; al traer de Rekordbox, solo si se pide). */
    lowToWanted?: boolean }): RequestDetail {
    if (!p.items.length) throw new Error(T.pedidoVacio)
    let id = 0
    transaction(this.db, () => {
      const pl = p.parentId != null ? this.playlists.create(p.name.trim() || 'Playlist', 'list', p.parentId) : this.playlists.create(this.freeName(p.name.trim() || 'Pedido'))
      id = Number(this.db.prepare('INSERT INTO requests (name, source, playlist_id, created_at) VALUES (?, ?, ?, ?)').run(p.name.trim() || 'Pedido', p.source, pl, new Date().toISOString()).lastInsertRowid)
      if (p.importId != null || p.lowToWanted === false) this.db.prepare('INSERT INTO request_import (request_id, import_id, low_to_wanted) VALUES (?, ?, ?)').run(id, p.importId ?? null, p.lowToWanted === false ? 0 : 1)
      for (const i of [...p.items].sort((a, b) => a.position - b.position)) this.insert(id, i)
      for (const s of this.saved(id)) this.settle(s)
    })
    return this.detail(id)!
  }

  /** Guarda un tema del pedido (sin acomodarlo); con "Los dos", además la versión pedida, enganchada. */
  private insert(requestId: number, i: NewItem, position = i.position): number {
    const fileId = i.fileId != null && this.db.prepare('SELECT 1 FROM files WHERE id = ?').get(i.fileId) ? i.fileId : null
    const ambos = i.decision === 'ambos' && fileId != null
    const id = Number(this.db.prepare('INSERT INTO request_items (request_id, position, artist, title, album, duration, isrc, kind, file_id, decision, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(requestId, position, i.artist, i.title, i.album, i.duration, i.isrc, fileId == null ? 'none' : i.kind, fileId, ambos ? 'si' : i.decision === 'ambos' ? null : i.decision, i.why).lastInsertRowid)
    if (ambos) addVersion(this.db, requestId, id)
    return id
  }

  /** La persona confirma (o no) un probable u otra versión, también después de creado el pedido. */
  decide(itemId: number, decision: RequestDecision | null): RequestDetail {
    const s = this.db.prepare('SELECT request_id AS r, file_id AS f FROM request_items WHERE id = ?').get(itemId) as { r: number; f: number | null } | undefined
    if (!s) throw new Error(T.temaNoEsta)
    transaction(this.db, () => {
      const ambos = decision === 'ambos' && s.f != null
      this.db.prepare('UPDATE request_items SET decision = ? WHERE id = ?').run(ambos ? 'si' : decision === 'ambos' ? null : decision, itemId)
      if (ambos) addVersion(this.db, s.r, itemId)
      else dropVersion(this.db, itemId)
      for (const x of this.saved(s.r)) if (x.id === itemId || versionOf(this.db, x.id) === itemId) this.settle(x)
    })
    return this.detail(s.r)!
  }

  /** Trae otra vez una lista que ya está (mismo nombre): suma lo nuevo y lo que ahora sí tenés (core/requests-update.ts). */
  update(requestId: number, items: NewItem[]): { detail: RequestDetail; added: number; found: number } {
    const r = this.db.prepare('SELECT undone_at AS undone FROM requests WHERE id = ?').get(requestId) as { undone: string | null } | undefined
    if (!r) throw new Error(T.pedidoNoEsta)
    if (r.undone) throw new Error(T.pedidoDeshecho)
    let out = { added: 0, found: 0 }
    transaction(this.db, () => { out = updateItems(this.db, requestId, items, { saved: () => this.saved(requestId), insert: (i, pos) => this.insert(requestId, i, pos), settle: (s) => this.settle(s) }) })
    return { detail: this.detail(requestId)!, ...out }
  }

  private freeName(name: string): string {
    const taken = new Set((this.db.prepare('SELECT name FROM playlists WHERE parent_id IS NULL').all() as { name: string }[]).map((r) => r.name.toLowerCase()))
    if (!taken.has(name.toLowerCase())) return name
    let n = 2
    while (taken.has(`${name} (${n})`.toLowerCase())) n++
    return `${name} (${n})`
  }

  private saved(requestId: number): Saved[] {
    return this.db.prepare(
      `SELECT id, request_id AS requestId, position, artist, title, album, duration, isrc, kind, file_id AS fileId, decision, why, wanted_id AS wantedId, wanted_created AS wantedCreated
       FROM request_items WHERE request_id = ? ORDER BY position`,
    ).all(requestId) as unknown as Saved[]
  }

  /** Deja el tema donde corresponde según su estado: en la playlist o no, y en la lista «Faltan o suenan mal» o no. */
  private settle(s: Saved) {
    const req = this.db.prepare('SELECT r.playlist_id AS pl, COALESCE(x.low_to_wanted, 1) AS low FROM requests r LEFT JOIN request_import x ON x.request_id = r.id WHERE r.id = ?').get(s.requestId) as { pl: number | null; low: number }
    const row = s.fileId != null ? this.rows([s.fileId])[0] : undefined
    const state = stateOf(s.kind, s.decision, row ? { low: lowQuality(row) } : null)
    const inList = state === 'tenes' || state === 'baja'
    if (req.pl != null && s.fileId != null) {
      if (inList) this.place(req.pl, s)
      else if (!this.db.prepare(`SELECT 1 FROM request_items WHERE request_id = ? AND file_id = ? AND id != ? AND (decision = 'si' OR (decision IS NULL AND kind IN (${SURE_SQL})))`).get(s.requestId, s.fileId, s.id)) {
        this.playlists.removeTracks(req.pl, [s.fileId])
      }
    }
    // la fila de la lista «Faltan o suenan mal»: la del tema (baja calidad) o la de un tema que falta
    const link = (wantedId: number | null, created: boolean) => this.db.prepare('UPDATE request_items SET wanted_id = ?, wanted_created = ? WHERE id = ?').run(wantedId, created ? 1 : 0, s.id)
    const drop = () => {
      if (s.wantedId != null && s.wantedCreated && !othersUse(this.db, s)) this.db.prepare("DELETE FROM wanted WHERE id = ? AND status IN ('pendiente', 'pedido')").run(s.wantedId)
      link(null, false)
    }
    if (state === 'baja' && req.low) {
      const before = this.wantedOf(s.fileId!)
      if (s.wantedId != null && s.wantedId === before) return
      if (s.wantedId != null) drop()
      this.wanted.ensure([s.fileId!])
      link(this.wantedOf(s.fileId!), before == null)
    } else if (state === 'falta') {
      if (s.wantedId != null && this.db.prepare('SELECT 1 FROM wanted WHERE id = ? AND file_id IS NULL').get(s.wantedId)) return
      if (s.wantedId != null) drop()
      const title = requestTitle(s.title)
      const had = this.wanted.findMissing(s.artist, title)
      const key = had ?? this.wanted.addMissing(s.artist, title)
      link(Number(key.slice(1)), !had)
    } else if (s.wantedId != null) drop()
  }

  private wantedOf(fileId: number): number | null {
    return (this.db.prepare('SELECT id FROM wanted WHERE file_id = ?').get(fileId) as { id: number } | undefined)?.id ?? null
  }

  /** Pone el tema en la playlist en su lugar de la lista: después del tema anterior del pedido que ya está (la versión pedida de "Los dos", al lado de la tuya). */
  private place(playlistId: number, s: Saved) {
    if (this.db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND file_id = ?').get(playlistId, s.fileId)) return
    const prev = this.db.prepare(
      `SELECT MAX(p.position) AS pos FROM request_items i JOIN playlist_items p ON p.playlist_id = ? AND p.file_id = i.file_id
       WHERE i.request_id = ? AND (i.position < ? OR (i.position = ? AND i.id < ?))`,
    ).get(playlistId, s.requestId, s.position, s.position, s.id) as { pos: number | null }
    const at = prev.pos == null ? 0 : prev.pos + 1
    this.db.prepare('UPDATE playlist_items SET position = position + 1 WHERE playlist_id = ? AND position >= ?').run(playlistId, at)
    this.db.prepare('INSERT INTO playlist_items (playlist_id, file_id, position) VALUES (?, ?, ?)').run(playlistId, s.fileId, at)
  }

  // ---------- lo que llega por la Bandeja ----------

  /** Lo que faltaba y llegó por la Bandeja entra solo a la playlist del pedido (core/requests-sync.ts). Devuelve cuántos entraron. */
  sync(): number {
    return syncArrived(this.db, { rows: () => this.rows(), saved: (id) => this.saved(id), matcher: () => this.matcher([]), settle: (s) => this.settle(s) })
  }

  // ---------- leer, deshacer, Historial ----------

  private items(requestId: number): RequestItem[] {
    const saved = this.saved(requestId)
    const rows = new Map(this.rows(saved.map((s) => s.fileId).filter((x): x is number => x != null)).map((r) => [r.id, r]))
    // "Los dos": el tuyo se muestra con esa decisión y la versión pedida dice de cuál es
    const pairs = versionPairs(this.db, requestId)
    const hasVersion = new Set(pairs.map((p) => p.of)), posOf = new Map(saved.map((s) => [s.id, s.position]))
    const versionOf = new Map(pairs.map((p) => [p.item, posOf.get(p.of) ?? null]))
    return saved.map((s) => {
      const file = this.file(s.fileId != null ? rows.get(s.fileId) : undefined)
      const decision = s.decision === 'si' && hasVersion.has(s.id) ? 'ambos' as const : s.decision
      return { id: s.id, position: s.position, artist: s.artist, title: s.title, album: s.album, duration: s.duration, isrc: s.isrc, kind: s.kind, why: s.why, file, decision, state: stateOf(s.kind, decision, file), copies: 0, versionOf: versionOf.get(s.id) ?? null }
    })
  }

  /** Los pedidos sueltos (sin los de una tanda traída de Rekordbox o un pendrive), o uno solo. */
  private summaries(one?: number): (RequestSummary & { items: RequestItem[] })[] {
    const reqs = this.db.prepare(
      `SELECT r.id, r.name, r.source, r.created_at AS createdAt, r.undone_at IS NOT NULL AS undone, r.playlist_id AS playlistId, p.name AS playlistName FROM requests r LEFT JOIN playlists p ON p.id = r.playlist_id
       WHERE ${one != null ? 'r.id = ?' : 'r.id NOT IN (SELECT request_id FROM request_import WHERE import_id IS NOT NULL)'} ORDER BY r.id DESC`,
    ).all(...(one != null ? [one] : [])) as unknown as (Omit<RequestSummary, 'counts' | 'total' | 'undone'> & { undone: number })[]
    return reqs.map((r) => { const items = this.items(r.id); return { ...r, undone: !!r.undone, counts: count(items), total: items.length, items } })
  }

  list(): RequestSummary[] { return this.summaries().map(({ items: _, ...r }) => r) }
  detail(id: number): RequestDetail | null { return this.summaries(id)[0] ?? null }

  /** Deshace el pedido: borra su playlist y lo que sumó a la lista «Faltan o suenan mal» (si todavía no lo pediste ni llegó). */
  undo(id: number): number {
    const r = this.db.prepare('SELECT playlist_id AS pl, undone_at AS undone FROM requests WHERE id = ?').get(id) as { pl: number | null; undone: string | null } | undefined
    if (!r) throw new Error(T.pedidoNoEsta)
    if (r.undone) throw new Error(T.pedidoDeshecho)
    const items = this.saved(id)
    transaction(this.db, () => {
      if (r.pl != null) this.playlists.remove(r.pl)
      for (const s of items) if (s.wantedId != null && s.wantedCreated && !othersUse(this.db, s)) this.db.prepare("DELETE FROM wanted WHERE id = ? AND status IN ('pendiente', 'pedido')").run(s.wantedId)
      this.db.prepare('UPDATE requests SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    })
    return items.length
  }

  history(): HistoryEntry[] {
    return this.summaries().map((r) => {
      const c = r.counts, inList = c.tenes + c.baja, toGet = c.falta + c.baja
      const summary = T.resumen(r.name, r.source, inList, r.total, toGet, c.revisar)
      return { kind: 'pedido' as const, id: r.id, at: r.createdAt, files: r.total, summary, undone: r.undone, canUndo: !r.undone, whyNot: r.undone ? T.yaDeshecho : null, note: r.playlistId == null && !r.undone ? T.borradaAMano : null }
    })
  }

  historyDetail(id: number): HistoryDetailRow[] {
    const label: Record<RequestState, string> = { tenes: T.tenes, baja: T.baja, falta: T.falta, revisar: T.revisar }
    return (this.detail(id)?.items ?? []).map((i) => ({ name: `${i.position}. ${i.artist ? `${i.artist} - ` : ''}${i.title}`, folder: '', what: label[i.state], before: null, after: i.file && i.state !== 'falta' ? path.posix.basename(i.file.rel) : null, undone: false }))
  }
}
