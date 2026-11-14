// Exportar a Traktor, Serato y VirtualDJ, como el rekordbox.xml (core/rekordbox.ts): las mismas playlists, temas, BPM, tono,
// grilla y cues, cada uno en el formato del programa (core/traktor.ts, core/seratofmt.ts, core/virtualdj.ts). Lo que había
// antes en las carpetas de Serato y VirtualDJ se copia aparte primero (nada se pierde); dentro de los archivos de música no
// se escribe acá: la grilla de Serato pasa por Cambios pendientes (`seratoChanges`).
import fs from 'node:fs'
import path from 'node:path'
import { Rekordbox, type DjMarks, type MarkOptions, type Picked } from './rekordbox'
import { buildNml } from './traktor'
import { buildCrate, crateFile, emptyDatabase, encodeBeatGrid, encodeMarkers2 } from './seratofmt'
import { readSerato } from './serato'
import { readSeratoTag, seratoJson } from './seratotag'
import { mergeDatabase, buildList } from './virtualdj'
import { traktorMp3Shift } from './analysis/mp3info'
import type { DjApp, DjExportResult } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'
import { CopyOut, backupStamp, checkOut, keepCopy } from './ops/copy'
import { moveNoClobber } from './safefs'
import { copyDurable } from './journal'
import type { EngineSong } from './enginedj'
import { createEngineDb, writeEngine, type EngineRef, type EngineWriteResult } from './enginedb'

// Lo que se ve en la pantalla. Los nombres que se escriben (la crate "Toda mi Música", "Sin nombre") no se traducen.
const T = textos({
  noSeLeyo: { es: (por: string) => `No se pudo leer (${por})`, en: (por: string) => `Couldn't read it (${por})` },
  yaNoEsta: { es: 'ya no está en esa carpeta', en: "it's no longer in that folder" },
  sinEngine: {
    es: (dir: string) => `No está la biblioteca de Engine DJ (${dir}). Abrí Engine DJ una vez para que la cree, cerralo y volvé a exportar.`,
    en: (dir: string) => `The Engine DJ library isn't there (${dir}). Open Engine DJ once so it creates it, close it and export again.`,
  },
  engineAbierto: {
    es: 'Engine DJ está abierto o se cerró de golpe (su base tiene cambios sin guardar): abrilo, cerralo bien y volvé a exportar.',
    en: 'Engine DJ is open or closed abruptly (its database has unsaved changes): open it, close it properly and export again.',
  },
})

/** Lo que cada programa no lee: no entra (se avisa, como en Rekordbox). */
export const UNSUPPORTED: Record<DjApp, Set<string>> = {
  traktor: new Set(['wma', 'opus', 'webm', 'ape', 'wv', 'tta', 'mka', 'dsf', 'dff']),
  serato: new Set(['wma', 'opus', 'webm', 'ape', 'wv', 'tta', 'mka', 'dsf', 'dff']),
  virtualdj: new Set(['dsf', 'dff']),
  engine: new Set(['wma', 'opus', 'webm', 'ape', 'wv', 'tta', 'mka', 'dsf', 'dff']),
}
export const APP_NAME: Record<DjApp, string> = { traktor: 'Traktor', serato: 'Serato', virtualdj: 'VirtualDJ', engine: 'Engine DJ' }
/** Los formatos donde Serato guarda sus marcas y PAILA sabe escribirlas (en M4A van en otro lado: todavía no). */
export const SERATO_IN_FILE = new Set(['mp3', 'aif', 'aiff', 'wav', 'flac'])

export interface DjExportInput extends MarkOptions { scope: 'todo' | 'playlists'; playlistIds: number[] }

/** "C:" de una ruta (en mayúscula); en Mac, "/Volumes/SSD" para un disco de afuera; "" si es del disco de la compu. */
export const driveOf = (abs: string) => (/^[A-Za-z]:/.test(abs) ? abs.slice(0, 2).toUpperCase() : abs.match(/^\/Volumes\/[^/]+/)?.[0] ?? '')
/** Una carpeta en la raíz de un disco: "F:\_Serato_" o "/Volumes/SSD/_Serato_". */
const atRoot = (drive: string, name: string) => (drive.startsWith('/') ? path.posix.join(drive, name) : `${drive}\\${name}`)
/**
 * La carpeta de VirtualDJ: las versiones de 2021 en adelante usan AppData\Local\VirtualDJ (en Mac, ~/Library/Application
 * Support/VirtualDJ: `localAppData` es esa carpeta de datos); las viejas, Documentos\VirtualDJ (visto con VirtualDJ 2026, 23/10).
 * Gana la que ya tiene su base o su configuración; si ninguna, la de las versiones nuevas.
 */
export function vdjHomeOf(localAppData: string | undefined, documents: string, exists = fs.existsSync): string {
  const cands = [localAppData && path.join(localAppData, 'VirtualDJ'), path.join(documents, 'VirtualDJ')].filter((c): c is string => !!c)
  return cands.find((c) => exists(path.join(c, 'settings.xml')) || exists(path.join(c, 'database.xml'))) ?? cands[0]
}
const stamp = backupStamp

/** Una grilla con un solo BPM (los programas que no aceptan tempo variable): arranca donde arranca, con el BPM general. */
function oneTempo(m: DjMarks): { marks: DjMarks; simplified: boolean } {
  if (!m.grid || new Set(m.grid.segments.map((s) => s.bpm)).size <= 1) return { marks: m, simplified: false }
  return { marks: { ...m, grid: { bpm: m.grid.bpm, segments: [{ ...m.grid.segments[0], bpm: m.grid.bpm }] } }, simplified: true }
}

export class DjExport {
  /**
   * `home`: la carpeta del usuario; `vdjHome`: la carpeta de VirtualDJ en esta compu (`vdjHomeOf`); `bootVolume`: en Mac, el
   * nombre del disco de la Mac ("Macintosh HD"), que Traktor pone en cada ruta.
   */
  constructor(private rb: Rekordbox, private home: string, private vdjHome: string, private bootVolume = '', readonly engineHome = path.join(home, 'Music', 'Engine Library')) {}

  /** Dónde guarda cada programa sus cosas para los temas de un disco: el de la carpeta del usuario, o la raíz de cada disco. */
  seratoDir(drive: string): string { return driveOf(this.home) === drive || !drive ? path.join(this.home, 'Music', '_Serato_') : atRoot(drive, '_Serato_') }
  vdjDir(drive: string): string { return driveOf(this.vdjHome) === drive || !drive ? this.vdjHome : atRoot(drive, 'VirtualDJ') }
  /**
   * Engine DJ: una biblioteca por disco, como las arma Engine 4 y 5. La de la compu (Música\Engine Library) para el disco de la
   * compu; la de la raíz de cada disco de afuera ("D:\Engine Library") para los temas de ese disco.
   */
  engineDir(drive: string): string { return !drive || driveOf(this.engineHome) === drive ? this.engineHome : atRoot(drive, 'Engine Library') }

  private picked(app: DjApp, o: DjExportInput): Picked { return this.rb.pick(o, UNSUPPORTED[app], APP_NAME[app]) }
  private base(app: DjApp, p: Picked): DjExportResult {
    return { app, written: [], backups: [], tracks: p.tracks.length, playlists: p.playlistTracks.size, grids: 0, cues: 0, skipped: p.skipped, simplified: 0 }
  }
  private count(res: DjExportResult, m: DjMarks) { if (m.grid) res.grids++; if (m.cues.length) res.cues++ }

  /** Traktor: un .nml para "Import Another Collection". */
  traktor(o: DjExportInput & { dest: string }): DjExportResult {
    const p = this.picked('traktor', o)
    const res = this.base('traktor', p)
    const tracks = p.tracks.map((t) => {
      const one = oneTempo(this.rb.marks(t.id, o))
      if (one.simplified) res.simplified++
      this.count(res, one.marks)
      const meta = this.rb.dj.meta(t.id)
      return { t, marks: one.marks, offset: t.ext.toLowerCase() === 'mp3' ? traktorMp3Shift(t.abs) : 0, stars: meta?.stars ?? 0, comment: meta?.comments ?? '' }
    })
    // por el motor (ops/copy.ts): si elegiste pisar un .nml, primero una copia en PAILA-respaldos; se escribe entero al lado y
    // recién ahí toma su nombre
    checkOut(this.rb.db, [o.dest])
    const backup = keepCopy(o.dest, path.join(path.dirname(o.dest), 'PAILA-respaldos', stamp()))
    if (backup) res.backups.push(backup)
    new CopyOut(this.rb.db, 'traktor', o.dest).write({ dst: o.dest, replace: true, backup }, buildNml(tracks, p.nodes, p.playlistTracks, new Date(), this.bootVolume))
    res.written.push(o.dest)
    return res
  }

  /**
   * Serato: una crate por playlist, todas dentro de la crate "PAILA" (así no pisan las tuyas), en la carpeta _Serato_ del disco
   * de cada tema. Las crates "PAILA…" de antes se mueven a _Serato_\PAILA-respaldos. Con 'todo', también "Toda mi Música".
   */
  serato(o: DjExportInput): DjExportResult {
    const p = this.picked('serato', o)
    const res = this.base('serato', p)
    for (const t of p.tracks) this.count(res, this.rb.marks(t.id, o))
    const lists: { names: string[]; ids: number[] }[] = []
    const nameOf = (id: number | null): string[] => { const n = p.nodes.find((x) => x.id === id); return n ? [...nameOf(n.parentId), n.name] : [] }
    for (const n of p.nodes) lists.push({ names: ['PAILA', ...nameOf(n.id)], ids: n.kind === 'folder' ? [] : p.playlistTracks.get(n.id) ?? [] })
    if (o.scope === 'todo') lists.push({ names: ['PAILA', 'Toda mi Música'], ids: p.tracks.map((t) => t.id) })
    const abs = new Map(p.tracks.map((t) => [t.id, t.abs]))
    const drives = [...new Set(p.tracks.map((t) => driveOf(t.abs)))]
    const when = stamp()
    // por el motor (ops/copy.ts): el candado y los discos antes de empezar; cada archivo entero o nada, con su renglón en el Historial
    checkOut(this.rb.db, drives.map((d) => path.join(this.seratoDir(d), 'Subcrates', 'x.crate')))
    const copies = new CopyOut(this.rb.db, 'serato', drives.map((d) => this.seratoDir(d)).join(', '))
    for (const drive of drives) {
      const sub = path.join(this.seratoDir(drive), 'Subcrates')
      fs.mkdirSync(sub, { recursive: true })
      // sin su base, Serato no mira las crates de ese disco: se crea vacía solo si falta (nunca se toca una que exista)
      const dbv2 = path.join(this.seratoDir(drive), 'database V2')
      if (!fs.existsSync(dbv2)) { copies.write({ dst: dbv2 }, emptyDatabase()); res.written.push(dbv2) }
      const old = fs.readdirSync(sub).filter((f) => /^PAILA(%%.*)?\.crate$/i.test(f))
      if (old.length) {
        const bak = path.join(this.seratoDir(drive), 'PAILA-respaldos', when)
        fs.mkdirSync(bak, { recursive: true })
        for (const f of old) moveNoClobber(path.join(sub, f), path.join(bak, f))
        res.backups.push(bak)
      }
      // la crate "PAILA" y cada carpeta existen aunque no tengan temas: Serato arma el árbol con ellas
      const files = new Map<string, string[]>([[crateFile(['PAILA']), []]])
      for (const l of lists) {
        for (let i = 2; i < l.names.length; i++) if (!files.has(crateFile(l.names.slice(0, i)))) files.set(crateFile(l.names.slice(0, i)), [])
        files.set(crateFile(l.names), l.ids.map((id) => abs.get(id)!).filter((a) => a && driveOf(a) === drive))
      }
      for (const [f, paths] of files) { const dest = path.join(sub, f); copies.write({ dst: dest }, buildCrate(paths)); res.written.push(dest) }
    }
    return res
  }

  /**
   * La grilla y los cues de Serato para escribir dentro de los archivos (los aplica Cambios pendientes, con vista previa y
   * deshacer). Los temas que ya tienen marcas de Serato no se tocan: son tuyas.
   */
  seratoChanges(o: DjExportInput): { items: { id: number; value: string }[]; alreadyIn: number; unreadable: { rel: string; reason: string }[] } {
    const p = this.picked('serato', o)
    const items: { id: number; value: string }[] = []
    let alreadyIn = 0
    const unreadable: { rel: string; reason: string }[] = []
    for (const t of p.tracks) {
      const ext = t.ext.toLowerCase()
      if (!SERATO_IN_FILE.has(ext)) continue
      const m = this.rb.marks(t.id, o)
      const hot = m.cues.filter((c) => c.kind !== 'memory' && c.num >= 0 && c.num <= 7)
      if (!m.grid && !hot.length) continue
      // un archivo que no se puede abrir (se movió por fuera de PAILA, está dañado) no frena a los demás
      let now: { m1?: string; key?: string; bpm?: string }
      try { now = JSON.parse(readSeratoTag(t.abs) ?? '{}') } catch (e) { unreadable.push({ rel: t.rel, reason: T.noSeLeyo((e as NodeJS.ErrnoException).code === 'ENOENT' ? T.yaNoEsta : (e as Error).message) }); continue }
      // las marcas viejas ("Markers_") también son tuyas, y Serato las prefiere: no se tocan
      if (now.m1 || readSerato(t.abs, ext)) { alreadyIn++; continue }
      // el tono y el BPM que ya tenía el archivo se quedan; si no tenía, van los de PAILA (Serato los muestra desde el tag)
      const value = seratoJson({ m2: encodeMarkers2(m, this.rb.dj.meta(t.id)?.colour ?? null).toString('base64'), bg: encodeBeatGrid(m)?.toString('base64'), key: now.key ?? t.musicKey ?? undefined, bpm: now.bpm ?? (m.grid ? m.grid.bpm.toFixed(2) : undefined) })
      if (value) items.push({ id: t.id, value })
    }
    return { items, alreadyIn, unreadable }
  }

  /**
   * VirtualDJ: su base (database.xml, la del disco de cada tema) con BPM, tono, grilla y cues, y una lista por playlist en
   * "Mis Listas" ("PAILA - …"). Los temas que VirtualDJ ya tenía con grilla o cues propios quedan como estaban. Antes, una copia de la base.
   */
  virtualdj(o: DjExportInput): DjExportResult {
    const p = this.picked('virtualdj', o)
    const res = this.base('virtualdj', p)
    res.kept = 0
    const when = stamp()
    const drives = [...new Set(p.tracks.map((t) => driveOf(t.abs)))]
    // por el motor (ops/copy.ts): el candado y los discos antes de empezar; cada archivo entero o nada, con su renglón en el Historial
    checkOut(this.rb.db, [...drives.map((d) => path.join(this.vdjDir(d), 'database.xml')), path.join(this.vdjHome, 'MyLists', 'x.vdjfolder')])
    const copies = new CopyOut(this.rb.db, 'virtualdj', this.vdjHome)
    const backup = (file: string, root: string) => {
      if (!fs.existsSync(file)) return
      const bak = path.join(root, 'PAILA-respaldos', when)
      fs.mkdirSync(bak, { recursive: true })
      const to = path.join(bak, path.basename(file))
      moveNoClobber(file, to)
      res.backups.push(to)
    }
    for (const drive of drives) {
      const root = this.vdjDir(drive)
      const dbFile = path.join(root, 'database.xml')
      const before = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf8') : null
      const songs = p.tracks.filter((t) => driveOf(t.abs) === drive).map((t) => {
        // VirtualDJ decodifica los MP3 como ffmpeg (sin el relleno del principio): el tiempo de PAILA
        const one = oneTempo(this.rb.marks(t.id, o))
        if (one.simplified) res.simplified++
        this.count(res, one.marks)
        return { t, marks: one.marks, offset: -this.rb.dj.rbShift(t.id) }
      })
      const merged = mergeDatabase(before, songs)
      res.kept! += merged.kept
      fs.mkdirSync(root, { recursive: true })
      // lo de antes, copiado aparte; la base nueva se escribe entera al lado y recién ahí toma su nombre (nunca queda a medias)
      const backup = before != null ? keepCopy(dbFile, path.join(root, 'PAILA-respaldos', when)) : null
      if (backup) res.backups.push(backup)
      copies.write({ dst: dbFile, replace: true, backup }, merged.xml)
      res.written.push(dbFile)
    }
    // las listas van en "Mis Listas" de la carpeta de VirtualDJ. Ahí no hay carpetas (visto con VirtualDJ 2026, 23/10): cada
    // lista va suelta, con su camino en el nombre ("PAILA - Fiestas - Casamiento"); las "PAILA - …" de antes se guardan aparte
    const lists = path.join(this.vdjHome, 'MyLists')
    for (const f of fs.existsSync(lists) ? fs.readdirSync(lists).filter((x) => /^PAILA - .*\.vdjfolder$/i.test(x)) : []) backup(path.join(lists, f), this.vdjHome)
    const abs = new Map(p.tracks.map((t) => [t.id, t]))
    const dirOf = (id: number | null): string[] => { const n = p.nodes.find((x) => x.id === id); return n ? [...dirOf(n.parentId), safe(n.name)] : [] }
    for (const n of p.nodes) {
      if (n.kind === 'folder') continue
      const file = path.join(lists, `${['PAILA', ...dirOf(n.id)].join(' - ')}.vdjfolder`)
      copies.write({ dst: file, replace: true }, buildList((p.playlistTracks.get(n.id) ?? []).map((id) => abs.get(id)!).filter(Boolean)))
      res.written.push(file)
    }
    return res
  }

  /**
   * Engine DJ (core/enginedj.ts): los temas de cada disco, con BPM, tono, grilla y cues, en la biblioteca de ese disco; las
   * playlists, dentro de una playlist "PAILA" en la de la compu. La de la compu tiene que existir (la crea Engine DJ la primera
   * vez que se abre); a un disco que no tiene la suya se le arma una igual (como hace Engine al importar de ese disco). Antes,
   * la carpeta Database2 de cada una se copia aparte entera; cada base se arma en una copia al lado y recién verificada toma
   * su lugar. Primero los discos (las playlists necesitan saber dónde quedó cada tema) y al final la de la compu.
   */
  async engine(o: DjExportInput): Promise<DjExportResult> {
    const p = this.picked('engine', o)
    const res = this.base('engine', p)
    res.kept = 0
    res.created = []
    const home = engineDb(this.engineHome)
    if (!fs.existsSync(home)) throw new Error(T.sinEngine(this.engineHome))
    const groups = new Map<string, Picked['tracks']>([[this.engineHome, []]])
    for (const t of p.tracks) { const lib = this.engineDir(driveOf(t.abs)); groups.set(lib, [...(groups.get(lib) ?? []), t]) }
    const order = [...groups.keys()].filter((l) => l !== this.engineHome).concat(this.engineHome)
    // por el motor (ops/copy.ts): el candado y los discos antes de empezar
    checkOut(this.rb.db, order.map(engineDb))
    // con cambios a medio guardar al lado (Engine abierto, o cerrado de golpe), reemplazar la base los perdería o la rompería
    const pending = (f: string) => [`${f}-wal`, `${f}-journal`].some((x) => { try { return fs.statSync(x).size > 0 } catch { return false } })
    if (order.some((lib) => pending(engineDb(lib)))) throw new Error(T.engineAbierto)
    const copies = new CopyOut(this.rb.db, 'engine', order.join(', '))
    const when = stamp()
    const refs = new Map<number, EngineRef>()
    for (const lib of order) {
      const file = engineDb(lib)
      const songs: EngineSong[] = groups.get(lib)!.map((t) => {
        // Engine lee los MP3 sin el relleno del principio, como ffmpeg (medido con Engine 5.1, 23/10): el tiempo de PAILA
        const one = oneTempo(this.rb.marks(t.id, o))
        if (one.simplified) res.simplified++
        const meta = this.rb.dj.meta(t.id)
        return { t, marks: one.marks, offset: -this.rb.dj.rbShift(t.id), stars: meta?.stars ?? 0, comment: meta?.comments ?? '' }
      })
      const lists = lib === this.engineHome ? { nodes: p.nodes, playlistTracks: p.playlistTracks, refs } : undefined
      let out: EngineWriteResult | null = null
      if (fs.existsSync(file)) {
        const bak = path.join(lib, 'PAILA-respaldos', when, 'Database2')
        copyTree(path.dirname(file), bak)
        res.backups.push(bak)
        await copies.file({ dst: file, replace: true, backup: path.join(bak, 'm.db') }, (tmp) => {
          fs.copyFileSync(file, tmp)
          out = writeEngine(tmp, { songs, libDir: lib, lists })
        })
      } else {
        // un disco sin biblioteca de Engine: una nueva, con el mismo esquema que la de la compu (nunca se pisa nada)
        await copies.file({ dst: file }, (tmp) => {
          createEngineDb(home, tmp)
          out = writeEngine(tmp, { songs, libDir: lib, lists })
        })
        res.created.push(lib)
      }
      const w = out as EngineWriteResult | null
      if (w) { res.kept += w.kept; res.grids += w.grids; res.cues += w.cues; for (const [k, v] of w.refs) refs.set(k, v) }
      res.written.push(file)
    }
    return res
  }
}

/** La base de una biblioteca de Engine DJ (Engine DJ 2 en adelante). */
export const engineDb = (lib: string) => path.join(lib, 'Database2', 'm.db')

/** Una carpeta entera, archivo por archivo y al disco (la copia de la base de Engine antes de tocarla). */
function copyTree(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.includes('.paila-tmp')) continue
    if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(to, e.name))
    else if (e.isFile()) copyDurable(path.join(from, e.name), path.join(to, e.name))
  }
}

const safe = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() || 'Sin nombre'
