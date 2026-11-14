// Playlists virtuales: cada tema existe una sola vez en el disco y aparece en todas las playlists que quieras.
// Viven en la base de PAILA: crearlas, ordenarlas o borrarlas nunca toca un archivo de música.
import fs from 'node:fs'
import path from 'node:path'
import { listed, transaction, visible, type Db } from './db'
import { textos } from '@paila/shared/idioma'

/** Los avisos cuando no se puede (el .m3u8 que se exporta no lleva textos de PAILA: solo los nombres de cada tema). */
const T = textos({
  sinNombre: { es: 'La playlist necesita un nombre', en: 'The playlist needs a name' },
  enCarpeta: { es: 'Solo se puede crear dentro de una carpeta', en: 'It can only be created inside a folder' },
  vacio: { es: 'El nombre no puede quedar vacío', en: "The name can't be empty" },
  adentro: { es: 'No se puede mover una carpeta adentro de sí misma', en: "A folder can't be moved inside itself" },
  aMano: { es: 'Solo las playlists comunes aceptan temas a mano', en: 'Only regular playlists accept tracks by hand' },
})

export type PlaylistKind = 'list' | 'folder' | 'smart'

/** Reglas de una playlist inteligente. Todas las que estén puestas tienen que cumplirse. */
export interface SmartRules {
  text?: string // en artista, título, álbum, género o carpeta
  genre?: string // el género contiene
  bpmMin?: number
  bpmMax?: number
  gradeMin?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' // nota mínima (B = B o mejor)
  camelot?: string // por ejemplo "8A"
  addedDays?: number // vistos por primera vez en los últimos N días
  kind?: string // colección (por defecto, música)
}

export interface PlaylistNode { id: number; parentId: number | null; name: string; kind: PlaylistKind; rules: SmartRules | null; count: number; position: number }
/** Dónde estaba un tema en una playlist. `kept`: la copia que tomó su lugar al mandarlo a la papelera (para devolvérselo). */
export interface Membership { playlist_id: number; position: number; kept?: number }

const GRADE_RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`

export class Playlists {
  constructor(private db: Db, private pathOf: (fileId: number) => string | null) {}

  private row<T>(sql: string, ...p: (string | number | null)[]) { return this.db.prepare(sql).get(...p) as T | undefined }
  private rows<T>(sql: string, ...p: (string | number | null)[]) { return this.db.prepare(sql).all(...p) as unknown as T[] }

  create(name: string, kind: PlaylistKind = 'list', parentId: number | null = null, rules: SmartRules | null = null): number {
    const n = name.trim()
    if (!n) throw new Error(T.sinNombre)
    if (parentId != null && this.row<{ kind: string }>('SELECT kind FROM playlists WHERE id = ?', parentId)?.kind !== 'folder') throw new Error(T.enCarpeta)
    const pos = (this.row<{ m: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS m FROM playlists WHERE parent_id IS ?', parentId)!).m
    const r = this.db.prepare('INSERT INTO playlists (parent_id, name, kind, rules, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(parentId, n, kind, kind === 'smart' ? JSON.stringify(rules ?? {}) : null, pos, new Date().toISOString())
    return Number(r.lastInsertRowid)
  }

  rename(id: number, name: string) { if (!name.trim()) throw new Error(T.vacio); this.db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name.trim(), id) }
  setRules(id: number, rules: SmartRules) { this.db.prepare("UPDATE playlists SET rules = ? WHERE id = ? AND kind = 'smart'").run(JSON.stringify(rules), id) }
  /** Borra la playlist (y lo que tenga adentro si es carpeta). Los temas no se tocan. */
  remove(id: number) { this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id) }

  move(id: number, parentId: number | null) {
    if (parentId != null) {
      // no se puede meter una carpeta dentro de sí misma ni de sus hijas
      for (let p: number | null = parentId; p != null; p = this.row<{ parent_id: number | null }>('SELECT parent_id FROM playlists WHERE id = ?', p)?.parent_id ?? null) if (p === id) throw new Error(T.adentro)
    }
    this.db.prepare('UPDATE playlists SET parent_id = ? WHERE id = ?').run(parentId, id)
  }

  tree(): PlaylistNode[] {
    const nodes = this.rows<{ id: number; parent_id: number | null; name: string; kind: PlaylistKind; rules: string | null; position: number }>('SELECT * FROM playlists ORDER BY position, id')
    return nodes.map((n) => ({
      id: n.id, parentId: n.parent_id, name: n.name, kind: n.kind, rules: n.rules ? JSON.parse(n.rules) : null, position: n.position,
      count: n.kind === 'folder' ? 0 : this.trackIds(n.id).length,
    }))
  }

  /** Agrega temas al final (los que ya estaban no se repiten). Devuelve cuántos se agregaron. */
  addTracks(id: number, fileIds: number[]): number {
    if (this.row<{ kind: string }>('SELECT kind FROM playlists WHERE id = ?', id)?.kind !== 'list') throw new Error(T.aMano)
    let added = 0
    transaction(this.db, () => {
      let pos = (this.row<{ m: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS m FROM playlist_items WHERE playlist_id = ?', id)!).m
      for (const f of fileIds) {
        const r = this.db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, file_id, position) VALUES (?, ?, ?)').run(id, f, pos)
        if (Number(r.changes)) { pos++; added++ }
      }
    })
    return added
  }

  removeTracks(id: number, fileIds: number[]) {
    transaction(this.db, () => { for (const f of fileIds) this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND file_id = ?').run(id, f) })
    this.renumber(id)
  }

  /** Pone el tema en una nueva posición (0 = primero). */
  moveTrack(id: number, fileId: number, to: number) {
    const ids = this.trackIds(id).filter((f) => f !== fileId)
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, fileId)
    this.setOrder(id, ids)
  }

  setOrder(id: number, fileIds: number[]) {
    transaction(this.db, () => { fileIds.forEach((f, i) => this.db.prepare('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND file_id = ?').run(i, id, f)) })
  }

  private renumber(id: number) { this.setOrder(id, this.trackIds(id)) }

  /** Los temas de la playlist, en orden. Las inteligentes se calculan en el momento. */
  trackIds(id: number): number[] {
    const p = this.row<{ kind: PlaylistKind; rules: string | null }>('SELECT kind, rules FROM playlists WHERE id = ?', id)
    if (!p) return []
    if (p.kind === 'folder') return this.rows<{ id: number }>('SELECT id FROM playlists WHERE parent_id = ?', id).flatMap((c) => this.trackIds(c.id))
    if (p.kind === 'smart') return this.smart(p.rules ? JSON.parse(p.rules) : {})
    // los desaparecidos siguen en la lista (la tabla los muestra marcados) y vuelven solos si el escaneo los encuentra
    return this.rows<{ file_id: number }>(`SELECT i.file_id FROM playlist_items i JOIN files f ON f.id = i.file_id WHERE i.playlist_id = ? AND ${listed('f')} ORDER BY i.position`, id).map((r) => r.file_id)
  }

  /** Pasa las apariciones de un tema en playlists a otro (el que se queda). Devuelve lo movido, para poder restaurarlo. */
  mergeFile(fromId: number, toId: number): Membership[] {
    const moved = this.rows<Membership>('SELECT playlist_id, position FROM playlist_items WHERE file_id = ?', fromId)
    transaction(this.db, () => {
      for (const m of moved) {
        const has = this.row<{ n: number }>('SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ? AND file_id = ?', m.playlist_id, toId)!.n
        if (has) this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND file_id = ?').run(m.playlist_id, fromId)
        else { this.db.prepare('UPDATE playlist_items SET file_id = ? WHERE playlist_id = ? AND file_id = ?').run(toId, m.playlist_id, fromId); m.kept = toId }
      }
    })
    return moved
  }

  /**
   * Vuelve a poner un tema en las playlists donde estaba (si ya no están, las ignora). Donde la copia que se quedó había
   * ocupado su lugar, se lo devuelve (antes quedaban los dos en la lista).
   */
  restoreMemberships(fileId: number, moved: Membership[]) {
    transaction(this.db, () => {
      for (const m of moved) {
        if (!this.row('SELECT 1 FROM playlists WHERE id = ?', m.playlist_id)) continue
        // si la copia que se quedó había tomado su lugar (y sigue ahí), se lo devuelve: la playlist queda como estaba
        if (m.kept != null && Number(this.db.prepare('UPDATE OR IGNORE playlist_items SET file_id = ? WHERE playlist_id = ? AND file_id = ? AND position = ?')
          .run(fileId, m.playlist_id, m.kept, m.position).changes) > 0) continue
        this.db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, file_id, position) VALUES (?, ?, ?)').run(m.playlist_id, fileId, m.position)
      }
    })
  }

  /** En qué playlists comunes está un tema. */
  playlistsOf(fileId: number): { id: number; name: string }[] {
    return this.rows<{ id: number; name: string }>('SELECT p.id, p.name FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE i.file_id = ? ORDER BY p.name', fileId)
  }

  smart(r: SmartRules): number[] {
    const where: string[] = ['f.error IS NULL', visible('f')]
    const args: (string | number)[] = []
    where.push('f.kind = ?'); args.push(r.kind ?? 'musica')
    if (r.text) for (const w of r.text.split(/\s+/).filter(Boolean)) {
      where.push("(COALESCE(f.artist,'') || ' ' || COALESCE(f.title,'') || ' ' || COALESCE(f.album,'') || ' ' || COALESCE(f.genre,'') || ' ' || f.rel_path) LIKE ? ESCAPE '\\'"); args.push(like(w))
    }
    if (r.genre) { where.push("f.genre LIKE ? ESCAPE '\\'"); args.push(like(r.genre)) }
    if (r.bpmMin != null) { where.push('a.bpm >= ?'); args.push(r.bpmMin) }
    if (r.bpmMax != null) { where.push('a.bpm <= ?'); args.push(r.bpmMax) }
    if (r.camelot) { where.push('a.camelot = ?'); args.push(r.camelot.toUpperCase()) }
    if (r.gradeMin) {
      const ok = Object.entries(GRADE_RANK).filter(([, v]) => v <= GRADE_RANK[r.gradeMin!]).map(([k]) => k)
      where.push(`a.grade IN (${ok.map(() => '?').join(',')})`); args.push(...ok)
    }
    if (r.addedDays != null) { where.push('f.probed_at >= ?'); args.push(new Date(Date.now() - r.addedDays * 86_400_000).toISOString()) }
    return this.rows<{ id: number }>(
      `SELECT f.id FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(f.artist, ''), COALESCE(f.title, ''), f.rel_path`, ...args).map((x) => x.id)
  }

  // ---------- exportar e importar ----------

  /** Escribe un .m3u8 (UTF-8) con rutas absolutas, o relativas a la carpeta del archivo si `relative`. Solo escribe el archivo de la lista. */
  exportM3u8(id: number, dest: string, opts: { relative?: boolean } = {}): number {
    const lines = ['#EXTM3U']
    let n = 0
    for (const fid of this.trackIds(id)) {
      const abs = this.pathOf(fid)
      if (!abs) continue
      const f = this.row<{ artist: string | null; title: string | null; duration: number | null }>('SELECT artist, title, duration FROM files WHERE id = ?', fid)!
      const label = [f.artist, f.title ?? path.basename(abs, path.extname(abs))].filter(Boolean).join(' - ')
      lines.push(`#EXTINF:${Math.round(f.duration ?? -1)},${label}`)
      lines.push(opts.relative ? path.relative(path.dirname(dest), abs) : abs)
      n++
    }
    fs.writeFileSync(dest, lines.join('\r\n') + '\r\n', 'utf8')
    return n
  }

  /** Crea una playlist común desde un .m3u/.m3u8: empareja por ruta con lo que ya está en la biblioteca. */
  importM3u(file: string, name?: string, parentId: number | null = null): { id: number; found: number; missing: string[] } {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    const dir = path.dirname(file)
    const all = this.rows<{ id: number }>('SELECT id FROM files').map((r) => r.id)
    const byPath = new Map<string, number>()
    for (const id of all) { const p = this.pathOf(id); if (p) byPath.set(path.resolve(p).toLowerCase(), id) }
    const ids: number[] = []
    const missing: string[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const id = byPath.get(path.resolve(dir, line).toLowerCase())
      if (id != null) ids.push(id); else missing.push(line)
    }
    const pl = this.create(name ?? path.basename(file, path.extname(file)), 'list', parentId)
    this.addTracks(pl, ids)
    return { id: pl, found: ids.length, missing }
  }
}
