// Traer las playlists que ya tenés en Rekordbox (desde su rekordbox.xml) o en un pendrive de CDJ armado por Rekordbox
// (MASTERPLAN-3, 4; solo se leen). Cada playlist pasa a ser una playlist de PAILA con lo que tenés, dentro de una carpeta, y lo que
// no está va a la lista «Faltan o suenan mal», como en "Traer una lista" (core/requests.ts). Cada tema se empareja una sola vez:
// misma ruta, mismo archivo en otra carpeta (nombre y tamaño), ISRC, artista + título + duración y, si el archivo está en esta
// compu, la huella del sonido. Del pendrive se pueden recuperar además la grilla, los cues, las estrellas y el color de cada
// tema (para el rekordbox.xml que exporta PAILA), solo donde no había nada de Rekordbox. Solo cambia la base; la tanda entera
// se deshace junta desde el Historial.
import fs from 'node:fs'
import path from 'node:path'
import { transaction, type Db } from './db'
import { parseRbPlaylists, parseRbXml, type RbCue } from './rbxml'
import { PDB_COLOURS, parsePdb } from './pdb'
import { mergeAnlz, parseAnlz, type Anlz } from './anlz'
import { SURE, stateOf, type ForeignEntry, type Requests } from './requests'
import type { Playlists } from './playlists'
import type { DjData } from './djdata'
import type { GridSegment } from './analysis/grid'
import type { HistoryDetailRow, HistoryEntry, ImportItem, ImportListPreview, ImportPreview, ImportResult, ImportSourceKind, RequestCounts, RequestDecision, RequestFile, RequestItem } from '@paila/shared/types'
import { T } from './listimport.textos'

/** Lo de cabina de un tema del pendrive. */
export interface ForeignDj { grid: GridSegment[]; cues: RbCue[]; stars: number; colour: string | null }
export interface ForeignTrack extends Omit<ForeignEntry, 'position'> { key: string; dj: ForeignDj | null }
export interface ForeignList { key: string; name: string; folders: string[]; tracks: string[] }
/** Una colección de otro lado ya leída: sus temas (una vez cada uno) y sus playlists. */
export interface ForeignLibrary { kind: ImportSourceKind; label: string; origin: string; tracks: ForeignTrack[]; lists: ForeignList[] }

// ---------- leer ----------

/** Un rekordbox.xml (Archivo → Exportar colección en formato xml). */
export function readRbXml(file: string, text = fs.readFileSync(file, 'utf8')): ForeignLibrary {
  const tracks = parseRbXml(text)
  const lists = parseRbPlaylists(text, tracks)
  return {
    kind: 'xml', label: 'Rekordbox', origin: file,
    tracks: tracks.map((t) => ({
      key: t.trackId, artist: t.artist, title: t.name || path.basename(t.path).replace(/\.[^.]+$/, ''), album: t.attrs.Album || null,
      duration: t.seconds || null, isrc: null, path: path.resolve(t.path), size: t.size, dj: null,
    })),
    lists: lists.map((l, i) => ({ key: String(i), name: l.name || 'Sin nombre', folders: l.folders, tracks: l.trackIds })),
  }
}

/** Dónde está el export.pdb a partir de lo que eligió la persona (el pendrive, su carpeta PIONEER o la de rekordbox). */
export function findPdb(folder: string): { root: string; pdb: string } | null {
  for (const [root, rel] of [[folder, 'PIONEER/rekordbox/export.pdb'], [path.dirname(folder), 'PIONEER/rekordbox/export.pdb'], [path.dirname(path.dirname(folder)), 'PIONEER/rekordbox/export.pdb']] as const) {
    const p = path.join(root, rel)
    if (fs.existsSync(p)) return { root, pdb: p }
  }
  return null
}

const readOr = (p: string): Uint8Array | null => { try { return fs.readFileSync(p) } catch { return null } }
const anlzOf = (file: string): Anlz | null => { const b = readOr(file); if (!b) return null; try { return parseAnlz(b) } catch { return null } }

/** Un pendrive armado por Rekordbox: el export.pdb y, de cada tema, su análisis (grilla y cues). Solo lee. */
export function readPendrive(folder: string): ForeignLibrary {
  const at = findPdb(folder)
  if (!at) throw new Error(T.noPendrive)
  const db = parsePdb(fs.readFileSync(at.pdb))
  const inDrive = (p: string) => path.join(at.root, ...p.split('/').filter(Boolean))
  const tracks: ForeignTrack[] = db.tracks.map((t) => {
    let dj: ForeignDj | null = null
    if (t.analyzePath) {
      const dat = inDrive(t.analyzePath)
      const a = mergeAnlz(anlzOf(dat), anlzOf(dat.replace(/\.DAT$/i, '.EXT')))
      dj = { grid: a.grid, cues: a.cues, stars: t.rating, colour: PDB_COLOURS[t.colorId] ?? null }
    } else if (t.rating || t.colorId) dj = { grid: [], cues: [], stars: t.rating, colour: PDB_COLOURS[t.colorId] ?? null }
    return {
      key: String(t.id), artist: t.artist, title: t.title || t.fileName.replace(/\.[^.]+$/, ''), album: t.album || null,
      duration: t.seconds || null, isrc: t.isrc || null, path: t.path ? inDrive(t.path) : null, size: t.size || null, dj,
    }
  })
  const byId = new Map(db.playlists.map((p) => [p.id, p]))
  const chain = (parent: number): string[] => {
    const out: string[] = []
    for (let p = byId.get(parent), n = 0; p && n < 32; p = byId.get(p.parentId), n++) out.unshift(p.name)
    return out
  }
  // en el orden del árbol de Rekordbox: cada carpeta con lo suyo adentro
  const kids = new Map<number, typeof db.playlists>()
  for (const p of db.playlists) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p])
  const ordered: typeof db.playlists = []
  const walk = (parent: number, depth: number) => { for (const p of kids.get(parent) ?? []) { ordered.push(p); if (p.folder && depth < 32) walk(p.id, depth + 1) } }
  walk(0, 0)
  const lists = ordered.filter((p) => !p.folder).map((p) => ({ key: String(p.id), name: p.name || 'Sin nombre', folders: chain(p.parentId), tracks: p.trackIds.map(String) }))
  // "Pendrive E:" si es un disco entero; si es una carpeta (una copia del pendrive), su nombre
  const drive = path.parse(path.resolve(at.root)).root
  const label = path.resolve(at.root) === drive ? `Pendrive ${drive.replace(/[\\/]+$/, '')}` : `Pendrive «${path.basename(at.root)}»`
  return { kind: 'pendrive', label, origin: at.root, tracks, lists }
}

// ---------- vista previa, crear y deshacer ----------

const zero = (): RequestCounts => ({ tenes: 0, baja: 0, falta: 0, revisar: 0 })
const HOW_KEYS = ['ruta', 'archivo', 'huella', 'isrc', 'exacto', 'probable', 'version', 'none'] as const

/** `outside`: del XML, lo que no está en la biblioteca pero sí en esta compu (un video, un proyecto, una carpeta que no se agregó): no va a la lista «Faltan o suenan mal». */
interface Prepared { lib: ForeignLibrary; items: Map<string, RequestItem>; outside: Map<string, RequestItem>; byKey: Map<string, ForeignTrack>; printed: boolean }
interface DjDone { grids: number[]; cues: number[]; meta: number[]; stamp: string }

export class ListImports {
  private prepared = new Map<string, Prepared>()
  private seq = 0

  constructor(private db: Db, private requests: Requests, private playlists: Playlists, private dj: DjData) {}

  /**
   * Empareja la colección con la biblioteca (`match`: lo de core/requests.ts, en otro hilo si hace falta) y la deja lista para
   * crear. No guarda nada.
   */
  async preview(lib: ForeignLibrary, match: (entries: ForeignEntry[]) => RequestItem[] | Promise<RequestItem[]> = (e) => this.requests.match(e)): Promise<ImportPreview> {
    if (!lib.lists.length && !lib.tracks.length) throw new Error(lib.kind === 'xml' ? T.xmlVacio : T.pendriveVacio)
    const used = new Set(lib.lists.flatMap((l) => l.tracks))
    // solo los temas que están en alguna playlist (la colección entera ya la tiene PAILA o no hace falta)
    const tracks = lib.tracks.filter((t) => used.has(t.key))
    const got = await match(tracks.map((t, i) => ({ ...t, position: i + 1 })))
    const items = new Map(tracks.map((t, i) => [t.key, got[i]]))
    const token = `${Date.now()}-${++this.seq}`
    this.prepared.clear() // una vista previa por vez
    const p: Prepared = { lib, items, outside: new Map(), byKey: new Map(lib.tracks.map((t) => [t.key, t])), printed: false }
    this.prepared.set(token, p)
    this.setOutside(p)
    return this.summary(token)
  }

  private get(token: string): Prepared {
    const p = this.prepared.get(token)
    if (!p) throw new Error(T.vencio)
    return p
  }

  /** Del rekordbox.xml, lo que no apareció pero cuyo archivo está en esta compu queda aparte (corrida del 22/10: videos y proyectos). */
  private setOutside(p: Prepared) {
    if (p.lib.kind !== 'xml') return
    for (const [k, i] of p.items) {
      const f = p.byKey.get(k)?.path
      if (i.kind === 'none' && f && fs.existsSync(f)) { p.outside.set(k, { ...i, why: T.fueraDeBiblioteca }); p.items.delete(k) }
    }
  }

  /** Los temas sin pareja segura cuyo archivo está en esta compu: se pueden buscar por la huella del sonido. */
  printable(token: string): { key: string; path: string; duration: number | null }[] {
    const p = this.get(token)
    return [...p.items, ...p.outside].filter(([, i]) => !SURE.includes(i.kind)).map(([k, i]) => ({ key: k, path: p.byKey.get(k)?.path ?? '', duration: i.duration }))
      .filter((x) => x.path && fs.existsSync(x.path))
  }

  /**
   * Busca por huella (`find`: el tema de tu biblioteca que suena igual a ese archivo, o null). Lo que aparece pasa a seguro.
   * Devuelve la vista previa nueva.
   */
  async byPrint(token: string, find: (file: string, duration: number | null) => Promise<number | null>, progress?: (done: number, total: number) => void, cancelled?: () => boolean): Promise<ImportPreview> {
    const p = this.get(token)
    const todo = this.printable(token)
    let done = 0
    for (const t of todo) {
      if (cancelled?.()) break
      const id = await find(t.path, t.duration).catch(() => null)
      const file = id != null ? this.requests.files([id]).get(id) : undefined
      if (file) {
        const i = p.items.get(t.key) ?? p.outside.get(t.key)!
        p.outside.delete(t.key)
        p.items.set(t.key, { ...i, kind: 'huella', file, why: T.suenaIgual, copies: 0, state: stateOf('huella', null, file) })
      }
      progress?.(++done, todo.length)
    }
    p.printed = !cancelled?.()
    return this.summary(token)
  }

  /** Cuántos temas de cada playlist tenés, con qué forma se encontró cada tema y qué se puede recuperar del pendrive. */
  summary(token: string, decisions: Record<string, RequestDecision | null> = {}): ImportPreview {
    const p = this.get(token)
    const how = Object.fromEntries(HOW_KEYS.map((k) => [k, 0])) as ImportPreview['how']
    for (const i of p.items.values()) { const k = i.kind === 'llego' ? 'ruta' : i.kind; how[k]++ }
    const lists: ImportListPreview[] = p.lib.lists.map((l) => {
      const counts = zero()
      for (const k of l.tracks) { const i = p.items.get(k); if (i) counts[this.state(i, decisions[k])]++ }
      return { key: l.key, name: l.name, folders: l.folders, total: l.tracks.filter((k) => p.items.has(k)).length, counts }
    })
    let dj: ImportPreview['dj'] = null
    if (p.lib.kind === 'pendrive') {
      dj = { grids: 0, cues: 0, stars: 0, colours: 0, tracks: 0 }
      for (const [k, i] of p.items) {
        const d = p.byKey.get(k)?.dj
        if (!d || !i.file || this.state(i, decisions[k]) === 'falta' || this.state(i, decisions[k]) === 'revisar') continue
        if (d.grid.length) dj.grids++
        if (d.cues.length) dj.cues++
        if (d.stars) dj.stars++
        if (d.colour) dj.colours++
        if (d.grid.length || d.cues.length || d.stars || d.colour) dj.tracks++
      }
    }
    const printable = p.printed ? 0 : this.printable(token).length
    const outside = { count: p.outside.size, examples: [...p.outside.keys()].slice(0, 4).map((k) => path.basename(p.byKey.get(k)?.path ?? '')) }
    return { token, kind: p.lib.kind, label: p.lib.label, origin: p.lib.origin, tracks: p.items.size, how, lists, dj, printable, printed: p.printed, outside }
  }

  private state(i: RequestItem, d: RequestDecision | null | undefined) { return stateOf(i.kind, d ?? null, i.file) }

  /** Los temas de una playlist, en su orden, para mirarlos y confirmar los probables. */
  items(token: string, key: string): ImportItem[] {
    const p = this.get(token)
    const l = p.lib.lists.find((x) => x.key === key)
    if (!l) throw new Error(T.playlistNoEsta)
    return l.tracks.filter((k) => p.items.has(k)).map((k, n) => ({ ...p.items.get(k)!, key: k, position: n + 1 }))
  }

  private freeName(name: string): string {
    const taken = new Set((this.db.prepare('SELECT name FROM playlists WHERE parent_id IS NULL').all() as { name: string }[]).map((r) => r.name.toLowerCase()))
    if (!taken.has(name.toLowerCase())) return name
    let n = 2
    while (taken.has(`${name} (${n})`.toLowerCase())) n++
    return `${name} (${n})`
  }

  /**
   * Crea las playlists elegidas dentro de una carpeta nueva ("De Rekordbox", "Del pendrive"), con las carpetas de adentro
   * como en Rekordbox; lo que falta va a la lista «Faltan o suenan mal». `withDj`: del pendrive, la grilla, los cues, las estrellas y
   * el color de los temas que tenés, donde no había nada de Rekordbox. `lowToWanted`: los de mala calidad también van a la Lista
   * para conseguir (de fábrica no: con una colección entera serían cientos).
   */
  create(token: string, keys: string[], decisions: Record<string, RequestDecision | null>, withDj = false, lowToWanted = false): ImportResult {
    const p = this.get(token)
    const chosen = p.lib.lists.filter((l) => keys.includes(l.key) && l.tracks.some((k) => p.items.has(k)))
    if (!chosen.length) throw new Error(T.elegi)
    const now = new Date().toISOString()
    let importId = 0, folderId = 0
    const out: ImportResult = { id: 0, playlists: 0, inLists: 0, toGet: 0, folderName: '', dj: { grids: 0, cues: 0 } }
    transaction(this.db, () => {
      out.folderName = this.freeName(p.lib.kind === 'xml' ? 'De Rekordbox' : 'Del pendrive')
      folderId = this.playlists.create(out.folderName, 'folder')
      importId = Number(this.db.prepare('INSERT INTO list_imports (kind, label, origin, folder_id, created_at) VALUES (?, ?, ?, ?, ?)').run(p.lib.kind, p.lib.label, p.lib.origin, folderId, now).lastInsertRowid)
      const folders = new Map<string, number>([['', folderId]])
      const folderOf = (chain: string[]): number => {
        const k = chain.join('\u0000')
        let id = folders.get(k)
        if (id == null) { id = this.playlists.create(chain[chain.length - 1] || 'Carpeta', 'folder', folderOf(chain.slice(0, -1))); folders.set(k, id) }
        return id
      }
      for (const l of chosen) {
        const items = l.tracks.filter((k) => p.items.has(k)).map((k, n) => {
          const i = p.items.get(k)!
          return { ...i, position: n + 1, decision: decisions[k] ?? null, fileId: i.file?.id ?? null }
        })
        const d = this.requests.create({ name: l.name, source: p.lib.kind === 'xml' ? 'rekordbox.xml' : p.lib.label, items, parentId: folderOf(l.folders), importId, lowToWanted })
        out.playlists++
        out.inLists += d.counts.tenes + d.counts.baja
      }
      out.toGet = this.toGet(importId)
      if (withDj && p.lib.kind === 'pendrive') {
        const done = this.recoverDj(p, decisions, now)
        out.dj = { grids: done.grids.length, cues: done.cues.length }
        this.db.prepare('UPDATE list_imports SET dj = ? WHERE id = ?').run(JSON.stringify(done), importId)
      }
    })
    out.id = importId
    return out
  }

  /** Guarda lo de cabina del pendrive en los temas que tenés, solo donde no había nada de Rekordbox. */
  private recoverDj(p: Prepared, decisions: Record<string, RequestDecision | null>, stamp: string): DjDone {
    const done: DjDone = { grids: [], cues: [], meta: [], stamp }
    const seen = new Set<number>()
    for (const [k, i] of p.items) {
      const d = p.byKey.get(k)?.dj
      const s = this.state(i, decisions[k])
      if (!d || !i.file || (s !== 'tenes' && s !== 'baja') || seen.has(i.file.id)) continue
      seen.add(i.file.id)
      const r = this.dj.recoverRekordbox(i.file.id, d, stamp, this.size(i.file))
      if (r.grid) done.grids.push(i.file.id)
      if (r.cues) done.cues.push(i.file.id)
      if (r.meta) done.meta.push(i.file.id)
    }
    return done
  }
  private size(f: RequestFile) { return (this.db.prepare('SELECT size FROM files WHERE id = ?').get(f.id) as { size: number } | undefined)?.size ?? null }

  /** Deshace la tanda: borra sus playlists (y sus carpetas, si quedaron vacías), lo que sumó a la lista «Faltan o suenan mal» y lo de cabina. */
  undo(id: number): number {
    const imp = this.db.prepare('SELECT folder_id AS folder, undone_at AS undone, dj FROM list_imports WHERE id = ?').get(id) as { folder: number | null; undone: string | null; dj: string | null } | undefined
    if (!imp) throw new Error(T.tandaNoEsta)
    if (imp.undone) throw new Error(T.tandaDeshecha)
    const reqs = this.db.prepare('SELECT r.id, r.playlist_id AS pl FROM requests r JOIN request_import x ON x.request_id = r.id WHERE x.import_id = ? AND r.undone_at IS NULL').all(id) as { id: number; pl: number | null }[]
    transaction(this.db, () => {
      // las carpetas donde estaban (antes de borrar las playlists)
      const parents = new Set<number>()
      for (const r of reqs) {
        for (let pl = r.pl; pl != null; ) {
          const up = (this.db.prepare('SELECT parent_id AS p FROM playlists WHERE id = ?').get(pl) as { p: number | null } | undefined)?.p ?? null
          if (up != null) parents.add(up)
          pl = up
        }
      }
      for (const r of reqs) this.requests.undo(r.id)
      if (imp.folder != null) parents.add(imp.folder)
      // de la más adentro a la de afuera: solo las que quedaron vacías (si guardaste algo tuyo ahí, queda)
      const depth = (f: number) => { let n = 0; for (let x: number | null = f; x != null && n < 64; n++) x = (this.db.prepare('SELECT parent_id AS p FROM playlists WHERE id = ?').get(x) as { p: number | null } | undefined)?.p ?? null; return n }
      for (const f of [...parents].sort((a, b) => depth(b) - depth(a))) {
        if (!this.db.prepare('SELECT 1 FROM playlists WHERE parent_id = ?').get(f)) this.db.prepare("DELETE FROM playlists WHERE id = ? AND kind = 'folder'").run(f)
      }
      if (imp.dj) this.dj.undoRecovered(JSON.parse(imp.dj) as DjDone)
      this.db.prepare('UPDATE list_imports SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    })
    return reqs.length
  }

  /** Cuántos temas de la tanda quedaron en la lista «Faltan o suenan mal». */
  private toGet(importId: number): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT i.wanted_id) AS n FROM request_items i JOIN request_import x ON x.request_id = i.request_id WHERE x.import_id = ? AND i.wanted_id IS NOT NULL').get(importId) as { n: number }).n
  }

  history(): HistoryEntry[] {
    const rows = this.db.prepare('SELECT id, kind, label, created_at AS at, undone_at AS undone, dj FROM list_imports ORDER BY id DESC').all() as { id: number; kind: ImportSourceKind; label: string; at: string; undone: string | null; dj: string | null }[]
    return rows.map((r) => {
      const reqs = this.db.prepare('SELECT request_id AS id FROM request_import WHERE import_id = ?').all(r.id) as { id: number }[]
      const c = zero()
      let total = 0
      for (const q of reqs) { const d = this.requests.detail(q.id); if (d) { total += d.total; for (const k of Object.keys(c) as (keyof RequestCounts)[]) c[k] += d.counts[k] } }
      const dj = r.dj ? JSON.parse(r.dj) as DjDone : null
      const toGet = r.undone ? c.falta : this.toGet(r.id)
      const summary = T.resumen(r.kind === 'xml', r.label, reqs.length, c.tenes + c.baja, total, toGet, dj?.grids.length ?? 0, dj?.cues.length ?? 0)
      return { kind: 'traidas' as const, id: r.id, at: r.at, files: total, summary, undone: !!r.undone, canUndo: !r.undone, whyNot: r.undone ? T.yaDeshecho : null, note: null }
    })
  }

  historyDetail(id: number): HistoryDetailRow[] {
    const reqs = this.db.prepare('SELECT request_id AS id FROM request_import WHERE import_id = ? ORDER BY request_id').all(id) as { id: number }[]
    return reqs.map((q) => this.requests.detail(q.id)).filter((d) => !!d).map((d) => ({
      name: d!.name, folder: '', what: T.deTemas(d!.counts.tenes + d!.counts.baja, d!.total), before: null, after: d!.counts.falta ? T.noLosTenes(d!.counts.falta) : null, undone: d!.undone,
    }))
  }
}
