// Engine DJ: sus bibliotecas ("Engine Library/Database2/m.db", Engine DJ 2 en adelante; hm.db, al lado, es el historial y no
// se toca), una por disco. PAILA completa la de la compu (la crea Engine) y la de cada disco, sea de la versión que sea (hasta la
// 4.0 la grilla y los cues van en Track; desde la 4.1, en PerformanceData), escribiendo solo las columnas que esa base tiene.
// Lo tuyo en Engine queda. El formato de cada dato, en core/enginedj.ts.
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import type { PlaylistNode } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
import { beatData, engineCues, engineGrid, engineKey, hasOwnMarks, keepTrackData, loops, quickCues, trackData, type EngineSong } from './enginedj'

// Por qué no se pudo escribir: se muestra en la pantalla. Los nombres que se escriben en Engine ("PAILA", "Sin nombre") no se traducen.
const T = textos({
  vieja: {
    es: 'Esa biblioteca de Engine es de una versión muy vieja (Engine Prime 1): abrila con Engine DJ actualizado, cerralo y volvé a exportar.',
    en: 'That Engine library is from a very old version (Engine Prime 1): open it with an up-to-date Engine DJ, close it and export again.',
  },
  orden: { es: 'Las playlists no quedaron en orden: no se escribió nada.', en: "The playlists didn't end up in order: nothing was written." },
  danada: { es: (por: string) => `La base de Engine no pasó la revisión (${por}): no se escribió nada.`, en: (por: string) => `The Engine database failed its check (${por}): nothing was written.` },
})

// Engine DJ 4 y 5 arman una biblioteca por disco (visto con Engine 5.1, 23/10): los temas de cada disco van en la "Engine
// Library" de ese disco (la de la compu, en Música; la de un disco de afuera, en su raíz), con la ruta relativa a esa carpeta.
// Las playlists son de la biblioteca de la compu y nombran cada tema por la base donde está (databaseUuid) y su número ahí;
// Engine las copia solo a cada disco (marcadas como copia) para que el equipo las vea sin compu.

/** La ruta como la guarda Engine: relativa a la carpeta "Engine Library" si está en el mismo disco; si no, completa. Con "/". */
export function enginePath(abs: string, libDir: string): string {
  const win = /^[A-Za-z]:/.test(abs)
  const p = win ? path.win32 : path.posix
  const same = win ? abs.slice(0, 2).toUpperCase() === libDir.slice(0, 2).toUpperCase() : true
  return (same ? p.relative(libDir, abs) : abs).replace(/\\/g, '/')
}

/** Una playlist no puede llevar ";" (Engine arma las rutas de sus listas con ese signo). */
const listTitle = (s: string) => s.replace(/;/g, ',').trim() || 'Sin nombre'

/** Dónde quedó un tema en Engine: la base (su uuid) y su número ahí. */
export interface EngineRef { uuid: string; id: number }
export interface EngineWrite {
  songs: EngineSong[]
  libDir: string
  now?: Date
  /** Solo en la biblioteca de la compu: las playlists, con cada tema donde quedó (en esta base o en la de su disco). */
  lists?: { nodes: PlaylistNode[]; playlistTracks: Map<number, number[]>; refs: Map<number, EngineRef> }
}
export interface EngineWriteResult { added: number; updated: number; kept: number; grids: number; cues: number; schema: string; uuid: string; refs: Map<number, EngineRef> }

/** Las columnas de una tabla (vacío si no existe). */
const columnsOf = (db: DatabaseSync, table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name))

/**
 * Una biblioteca nueva para un disco que todavía no tiene la suya, igual a la que arma Engine al importar de ese disco: el
 * mismo esquema que la de la compu (`template`, la que creó Engine), su propia identidad y la tapa vacía número 1.
 */
export function createEngineDb(template: string, file: string) {
  const src = new DatabaseSync(template, { readOnly: true })
  let ddl: { sql: string }[], info: Record<string, unknown> | undefined, version: number
  try {
    ddl = src.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as { sql: string }[]
    info = src.prepare('SELECT schemaVersionMajor, schemaVersionMinor, schemaVersionPatch FROM Information ORDER BY id LIMIT 1').get() as Record<string, unknown> | undefined
    version = Number((src.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  } finally { src.close() }
  if (!info) throw new Error(T.vieja)
  const db = new DatabaseSync(file)
  try {
    db.exec('BEGIN')
    for (const d of ddl) db.exec(d.sql)
    const cols = columnsOf(db, 'Information')
    const v: Record<string, unknown> = { ...info, uuid: randomUUID(), currentPlayedIndiciator: randomBytes(8).readBigInt64BE() }
    const keys = Object.keys(v).filter((k) => cols.has(k))
    db.prepare(`INSERT INTO Information (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => v[k] as never))
    if (columnsOf(db, 'AlbumArt').has('id')) db.prepare('INSERT INTO AlbumArt (id, hash, albumArt) VALUES (1, NULL, NULL)').run()
    db.exec('COMMIT')
    db.exec(`PRAGMA user_version = ${version}`)
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw e
  } finally { db.close() }
}

/**
 * Completa una base de Engine (un archivo m.db: el que se le pasa es la copia temporal, nunca la de Engine). Los temas nuevos
 * entran con sus datos, BPM, tono, grilla y cues; los que Engine ya tenía, si no tienen grilla ni cues propios, reciben los de
 * PAILA. Con `lists` (la biblioteca de la compu), las playlists van dentro de una playlist "PAILA" (la de una exportación
 * anterior se reemplaza entera); en la de un disco se saca la copia vieja de "PAILA" que hizo Engine, que la vuelve a copiar.
 * Todo en una transacción y verificado al final: si algo no da, tira un error y la base queda como estaba.
 */
export function writeEngine(file: string, w: EngineWrite): EngineWriteResult {
  const db = new DatabaseSync(file)
  try {
    const info = db.prepare('SELECT uuid, schemaVersionMajor AS ma, schemaVersionMinor AS mi, schemaVersionPatch AS pa FROM Information ORDER BY id LIMIT 1').get() as { uuid: string; ma: number; mi: number; pa: number } | undefined
    const track = columnsOf(db, 'Track')
    if (!info || info.ma < 2 || !track.has('path')) throw new Error(T.vieja)
    const perfTable = !track.has('beatData') && columnsOf(db, 'PerformanceData').has('beatData')
    const perf = perfTable ? columnsOf(db, 'PerformanceData') : track
    const res: EngineWriteResult = { added: 0, updated: 0, kept: 0, grids: 0, cues: 0, schema: `${info.ma}.${info.mi}.${info.pa}`, uuid: info.uuid, refs: new Map() }
    const secs = Math.floor((w.now ?? new Date()).getTime() / 1000)
    const stamp = (w.now ?? new Date()).toISOString().slice(0, 19).replace('T', ' ')

    const lastId = () => Number((db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id)
    db.exec('BEGIN')
    // los temas que Engine ya conoce, por su ruta (en Windows sin distinguir mayúsculas)
    const fold = /^[A-Za-z]:/.test(w.libDir) ? (s: string) => s.toLowerCase() : (s: string) => s
    const known = new Map<string, number>()
    for (const r of db.prepare('SELECT id, path FROM Track').all() as { id: number; path: string | null }[]) if (r.path) known.set(fold(r.path), r.id)

    const insertCols = ['playOrder', 'length', 'bpm', 'year', 'path', 'filename', 'bitrate', 'bpmAnalyzed', 'albumArtId', 'fileBytes', 'title', 'artist', 'album', 'genre', 'comment', 'key', 'rating', 'isPlayed', 'fileType', 'isAnalyzed', 'dateCreated', 'dateAdded', 'isAvailable', 'isMetadataOfPackedTrackChanged', 'isPerfomanceDataOfPackedTrackChanged', 'isMetadataImported', 'pdbImportKey', 'isBeatGridLocked', 'streamingFlags', 'explicitLyrics', 'lastEditTime'].filter((c) => track.has(c))
    const hasArt = !!db.prepare('SELECT 1 FROM AlbumArt WHERE id = 1').get()

    for (const s of w.songs) {
      const t = s.t
      const sr = t.sr || 44100
      const samples = Math.round((t.duration ?? 0) * sr)
      const key = engineKey(t.musicKey)
      const grid = engineGrid(s.marks, s.offset, sr, samples)
      const c = engineCues(s.marks, s.offset, sr, grid)
      const bpm = s.marks.grid?.bpm ?? t.bpm ?? null
      const rel = enginePath(t.abs, w.libDir)
      let id = known.get(fold(rel))
      let fill = true
      let prior: Uint8Array | null = null
      if (id == null) {
        const v: Record<string, unknown> = {
          playOrder: parseInt(t.track ?? '', 10) || null, length: Math.round(t.duration ?? 0), bpm: bpm ? Math.round(bpm) : null, year: parseInt(t.year ?? '', 10) || null,
          path: rel, filename: path.basename(t.abs), bitrate: t.kbps ? Math.round(t.kbps) : null, bpmAnalyzed: bpm, albumArtId: hasArt ? 1 : null, fileBytes: t.size,
          title: t.title ?? path.parse(t.abs).name, artist: t.artist, album: t.album, genre: t.genre, comment: s.comment || null, key,
          rating: Math.max(0, Math.min(100, s.stars * 20)), isPlayed: 0, fileType: t.ext.toLowerCase(),
          // sin la onda (PAILA no la tiene): Engine la dibuja al analizar; la grilla de PAILA va con candado para que no la cambie
          isAnalyzed: 0, dateCreated: secs, dateAdded: secs, isAvailable: 1, isMetadataOfPackedTrackChanged: 0, isPerfomanceDataOfPackedTrackChanged: 0,
          isMetadataImported: 1, pdbImportKey: 0, isBeatGridLocked: grid.length ? 1 : 0, streamingFlags: 0, explicitLyrics: 0, lastEditTime: secs,
        }
        db.prepare(`INSERT INTO Track (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`).run(...insertCols.map((k) => v[k] as never))
        id = lastId()
        // de qué base salió (las de Engine lo completan solas; por las dudas, si no lo hicieron)
        if (track.has('originTrackId')) db.prepare("UPDATE Track SET originDatabaseUuid = ?, originTrackId = id WHERE id = ? AND (IFNULL(originTrackId, 0) = 0 OR IFNULL(originDatabaseUuid, '') = '')").run(info.uuid, id)
        known.set(fold(rel), id)
        res.added++
      } else {
        const own = db.prepare(`SELECT trackData AS d, beatData AS b, quickCues AS q, loops AS l FROM ${perfTable ? 'PerformanceData WHERE trackId' : 'Track WHERE id'} = ?`).get(id) as
          { d: Uint8Array | null; b: Uint8Array | null; q: Uint8Array | null; l: Uint8Array | null } | undefined
        prior = own?.d ?? null
        if (own && hasOwnMarks(own.b, own.q, own.l)) { res.kept++; fill = false } else {
          const sets = ['bpm = ?', 'bpmAnalyzed = ?', ...(key != null ? ['key = ?'] : []), ...(track.has('isBeatGridLocked') ? ['isBeatGridLocked = ?'] : [])]
          db.prepare(`UPDATE Track SET ${sets.join(', ')} WHERE id = ?`).run(...([bpm ? Math.round(bpm) : null, bpm, ...(key != null ? [key] : []), ...(track.has('isBeatGridLocked') ? [grid.length ? 1 : 0] : []), id] as never[]))
          res.updated++
        }
      }
      res.refs.set(t.id, { uuid: info.uuid, id })
      if (!fill) continue
      if (grid.length) res.grids++
      if (c.pads.some(Boolean) || c.loops.length) res.cues++
      const data: Record<string, Buffer> = { trackData: keepTrackData(prior, key) ?? trackData(sr, samples, key), beatData: beatData(sr, samples, grid), quickCues: quickCues(c.pads, c.main), loops: loops(c.loops) }
      const cols = Object.keys(data).filter((k) => perf.has(k))
      if (perfTable) db.prepare('INSERT OR IGNORE INTO PerformanceData (trackId) VALUES (?)').run(id)
      db.prepare(`UPDATE ${perfTable ? 'PerformanceData' : 'Track'} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE ${perfTable ? 'trackId' : 'id'} = ?`).run(...cols.map((k) => data[k]), id)
    }

    // la playlist "PAILA" de antes se va entera (lo de adentro primero: Engine borra solo un nivel por vez). En un disco, solo
    // la copia que hizo Engine (isPersisted = 0): una "PAILA" propia de ese disco, si alguien la armó ahí, queda
    const copyOnly = !w.lists && columnsOf(db, 'Playlist').has('isPersisted')
    const old = db.prepare(`SELECT id FROM Playlist WHERE title = 'PAILA' AND parentListId = 0${copyOnly ? ' AND IFNULL(isPersisted, 0) = 0' : ''}`).get() as { id: number } | undefined
    if (old) {
      const all: number[] = []
      const walk = (pid: number) => { for (const r of db.prepare('SELECT id FROM Playlist WHERE parentListId = ?').all(pid) as { id: number }[]) walk(r.id); all.push(pid) }
      walk(old.id)
      for (const lid of all) { db.prepare('DELETE FROM PlaylistEntity WHERE listId = ?').run(lid); db.prepare('DELETE FROM Playlist WHERE id = ?').run(lid) }
    }
    const listOf = new Map<number | null, number>()
    if (w.lists) {
      const { nodes, playlistTracks } = w.lists
      const refs = new Map([...w.lists.refs, ...res.refs])
      // cada lista nueva va al final de su carpeta: Engine encadena el orden solo (nextListId) al agregarla
      const addList = (title: string, parent: number): number => {
        let name = listTitle(title)
        for (let i = 2; db.prepare('SELECT 1 FROM Playlist WHERE title = ? AND parentListId = ?').get(name, parent); i++) name = `${listTitle(title)} (${i})`
        db.prepare('INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES (?, ?, 1, 0, ?, 1)').run(name, parent, stamp)
        return lastId()
      }
      const root = addList('PAILA', 0)
      listOf.set(null, root)
      const addEntity = db.prepare('INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference) VALUES (?, ?, ?, 0, 0)')
      const link = db.prepare('UPDATE PlaylistEntity SET nextEntityId = ? WHERE listId = ? AND nextEntityId = 0 AND id <> ?')
      const place = (n: PlaylistNode): number => {
        const have = listOf.get(n.id)
        if (have != null) return have
        const parent = n.parentId != null && nodes.some((x) => x.id === n.parentId) ? place(nodes.find((x) => x.id === n.parentId)!) : root
        const lid = addList(n.name, parent)
        listOf.set(n.id, lid)
        return lid
      }
      for (const n of nodes) {
        const lid = place(n)
        if (n.kind === 'folder') continue
        const seen = new Set<string>()
        for (const fid of playlistTracks.get(n.id) ?? []) {
          const r = refs.get(fid)
          if (!r || seen.has(`${r.uuid}:${r.id}`)) continue // Engine no deja el mismo tema dos veces en una lista
          seen.add(`${r.uuid}:${r.id}`)
          addEntity.run(lid, r.id, r.uuid)
          const eid = lastId()
          link.run(eid, lid, eid)
        }
      }
    }

    // verificar antes de confirmar: cada carpeta con su orden entero (una sola lista al final) y cada lista con el suyo
    const ours = [...new Set(listOf.values())].join(', ')
    const broken = ours && (db.prepare(`SELECT parentListId FROM Playlist WHERE parentListId IN (0, ${ours}) GROUP BY parentListId HAVING SUM(nextListId = 0) <> 1`).get()
      ?? db.prepare(`SELECT listId FROM PlaylistEntity WHERE listId IN (${ours}) GROUP BY listId HAVING SUM(nextEntityId = 0) <> 1`).get())
    if (broken) throw new Error(T.orden)
    db.exec('COMMIT')
    const ok = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
    if (ok !== 'ok') throw new Error(T.danada(ok))
    return res
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw e
  } finally { db.close() }
}
