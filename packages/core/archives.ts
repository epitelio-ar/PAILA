// ZIP y RAR de la biblioteca (masterplan 3, punto 4): el escaneo los encuentra y acá se anota qué tienen adentro, leyendo
// solo sus índices (no se descomprime nada para escanear). Escuchar un tema saca solo ese a una carpeta de caché; analizar
// saca de a uno a una carpeta temporal, lo lee y lo borra (archive/analyze.ts). Sacarlos al lado: archive/extract.ts.
// Los sample packs se ven pero nunca se tocan.
import fs from 'node:fs'
import path from 'node:path'
import { transaction, visible, type Db } from './db'
import { commonDir, extOf } from './files'
import { archiveFormat, extractEntries, listArchive, type LibRunner, type Listing } from './archive/read'
import { isAudioName, isCompanion, isJunk } from './archive/names'
import type { ArchiveEntryRow, ArchiveStatus, ArchiveSummary, CollectionKind } from '@paila/shared/types'
import { T as A } from './archive/textos'
import { textos } from '@paila/shared/idioma'

// Lo que se muestra de cada comprimido (la nota se guarda en la base al leerlo, en el idioma de ese momento; nada la compara:
// la pantalla mira `status` y `samplePack`). Las palabras que reconocen un sample pack son datos: no se traducen.
const T = textos({
  carpetaProduccion: { es: 'Está en una carpeta de producción (sample packs)', en: "It's in a production folder (sample packs)" },
  nombreSample: { es: (b: string) => `Por el nombre parece un sample pack ("${b}")`, en: (b: string) => `By its name it looks like a sample pack ("${b}")` },
  carpetasSample: { es: (d: string) => `Tiene carpetas de sample pack (${d})`, en: (d: string) => `It has sample pack folders (${d})` },
  sinMusica: { es: 'No tiene música adentro', en: 'There is no music inside' },
  noEsta: { es: 'Ese comprimido ya no está en la biblioteca', en: 'That archive is no longer in the library' },
  sinDisco: { es: 'El disco de ese comprimido no está conectado', en: "The disk with that archive isn't connected" },
  yaNoEsta: { es: 'El comprimido ya no está: volvé a escanear', en: "The archive isn't there anymore: scan again" },
  cambio: { es: 'El comprimido cambió desde el escaneo: se volvió a leer, probá de nuevo', en: 'The archive changed since the scan: PAILA read it again, try again' },
  temaNoEsta: { es: 'Ese tema ya no está en el comprimido', en: "That track isn't in the archive anymore" },
})

/** Un comprimido que vio el escaneo. */
export interface FoundArchive { rootId: number; rel: string; abs: string; size: number; mtime: number; kind: CollectionKind }

// Nombres de material de producción. Más angosto que el de las carpetas (core/collections.ts): "Pack Reggaetón 2010" o
// "Instrumentales y Acapellas" son discos, no sample packs. "Kit" y "construction" solos tampoco ("Construction Time Again" de
// Depeche Mode): con lo que los hace de producción ("Drum Kit", "Construction Kit"; repaso de criterios del 24/10).
const SAMPLE_NAME = /\b(samples?|sample ?packs?|loops?|one.?shots?|(?:drum|sample|sound|construction|producer).?kits?|presets?|stems|multitracks?)\b/i
const SAMPLE_DIR = /^(808s?|kicks?|snares?|hi.?hats?|hats|claps?|percs?|percussion|fx|sfx|loops?|one.?shots?|samples?|drums?|melod(y|ies)|presets?|vox|vocal.?chops|risers?|crashes|cymbals?|toms?|rims?|shakers?|snaps?)$/i

/** ¿Es un sample pack? Por la carpeta (colección "producción"), por el nombre o por lo que tiene (carpetas de 808, kicks…). */
export function samplePack(rel: string, kind: CollectionKind, names: string[]): string | null {
  if (kind === 'produccion') return T.carpetaProduccion
  const base = path.posix.basename(rel).replace(/\.[^.]+$/, '')
  if (SAMPLE_NAME.test(base)) return T.nombreSample(base)
  const dirs = new Set(names.flatMap((n) => n.split('/').slice(0, -1)).filter((d) => SAMPLE_DIR.test(d.trim())).map((d) => d.toLowerCase()))
  if (dirs.size >= 2) return T.carpetasSample([...dirs].slice(0, 3).join(', '))
  return null
}

const STATUS_NOTE = (s: ArchiveStatus): string | null => (s === 'clave' ? A.claveNoAbre : s === 'sin-musica' ? T.sinMusica : null)

/** Lee el índice de un comprimido y guarda qué tiene. Lo leído de cada tema se conserva si el tema sigue igual. */
export function saveListing(db: Db, a: FoundArchive): number {
  let l: Listing | null = null, error: string | null = null
  try { l = listArchive(a.abs) } catch (e) { error = (e as Error).message }
  const files = l?.entries.filter((e) => !e.dir && !isJunk(e.name)) ?? []
  const audio = files.filter((e) => isAudioName(e.name))
  const status: ArchiveStatus = error ? 'roto' : l!.locked ? 'clave' : l!.missing ? 'falta-parte' : !audio.length ? 'sin-musica'
    : audio.every((e) => e.encrypted) ? 'clave' : 'ok'
  const sample = samplePack(a.rel, a.kind, files.map((e) => e.name))
  const note = error ?? (l?.missing ? A.faltaParte(l.missing) : STATUS_NOTE(status)) ?? sample
  const now = new Date().toISOString()
  return transaction(db, () => {
    db.prepare(`INSERT INTO archives (root_id, rel_path, size, mtime, format, kind, sample_pack, status, note, volumes, solid, listed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(root_id, rel_path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime,
      format = excluded.format, kind = excluded.kind, sample_pack = excluded.sample_pack, status = excluded.status, note = excluded.note,
      volumes = excluded.volumes, solid = excluded.solid, listed_at = excluded.listed_at, missing_at = NULL`)
      .run(a.rootId, a.rel, a.size, a.mtime, archiveFormat(a.rel) ?? 'zip', a.kind, sample ? 1 : 0, status, note, l?.volumes.length ?? 1, l?.solid ? 1 : 0, now)
    const id = (db.prepare('SELECT id FROM archives WHERE root_id = ? AND rel_path = ?').get(a.rootId, a.rel) as { id: number }).id
    // lo leído antes se conserva para el mismo tema (mismo nombre y tamaño)
    const old = new Map((db.prepare('SELECT * FROM archive_entries WHERE archive_id = ?').all(id) as Record<string, unknown>[]).map((r) => [`${r.name}|${r.size}`, r]))
    db.prepare('DELETE FROM archive_entries WHERE archive_id = ?').run(id)
    const ins = db.prepare(`INSERT INTO archive_entries (archive_id, idx, name, size, audio, companion, blocked, codec, sample_rate, bits, channels, kbps,
      duration, artist, title, album, track, year, genre, grade, grade_is, grade_why, bpm, musical_key, read_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const READ = ['codec', 'sample_rate', 'bits', 'channels', 'kbps', 'duration', 'artist', 'title', 'album', 'track', 'year', 'genre', 'grade', 'grade_is', 'grade_why', 'bpm', 'musical_key', 'read_at', 'error']
    for (const e of files) {
      const o = old.get(`${e.name}|${e.size}`)
      ins.run(id, e.index, e.name, e.size, isAudioName(e.name) ? 1 : 0, isCompanion(e.name) ? 1 : 0, e.blocked, ...(READ.map((k) => (o?.[k] ?? null)) as never[]))
    }
    return id
  })
}

/**
 * Lo que vio el escaneo: lo nuevo o cambiado se vuelve a listar (solo el índice: milisegundos aunque pese gigas) y lo que
 * ya no está en un disco que se recorrió entero queda marcado. Nunca frena el escaneo: un comprimido roto queda "roto".
 */
export function syncArchives(db: Db, found: FoundArchive[], scannedRoots: number[], unreadable: Set<number>): { listed: number } {
  const known = new Map((db.prepare('SELECT id, root_id AS rootId, rel_path AS rel, size, mtime, kind, missing_at AS missing FROM archives').all() as
    { id: number; rootId: number; rel: string; size: number; mtime: number; kind: string; missing: string | null }[]).map((r) => [`${r.rootId}|${r.rel}`, r]))
  let listed = 0
  const seen = new Set<string>()
  for (const a of found) {
    const key = `${a.rootId}|${a.rel}`
    seen.add(key)
    const k = known.get(key)
    if (k && k.size === a.size && Math.abs(k.mtime - a.mtime) < 2 && k.kind === a.kind) {
      if (k.missing) db.prepare('UPDATE archives SET missing_at = NULL WHERE id = ?').run(k.id)
      continue
    }
    saveListing(db, a); listed++
  }
  const now = new Date().toISOString()
  const gone = db.prepare('UPDATE archives SET missing_at = ? WHERE id = ? AND missing_at IS NULL')
  for (const [key, k] of known) if (!seen.has(key) && scannedRoots.includes(k.rootId) && !unreadable.has(k.rootId)) gone.run(now, k.id)
  return { listed }
}

type ArchiveRow = { id: number; rootId: number; rel: string; size: number; mtime: number; format: 'zip' | 'rar'; samplePack: number; status: ArchiveStatus; note: string | null; volumes: number; solid: number }
const ARCHIVE_COLS = 'a.id, a.root_id AS rootId, a.rel_path AS rel, a.size, a.mtime, a.format, a.sample_pack AS samplePack, a.status, a.note, a.volumes, a.solid'

export class Archives {
  constructor(readonly db: Db, private rootPath: (rootId: number) => string | null) {}

  /**
   * ¿Ya está afuera, en tu Música? Mismo tamaño exacto y formato, o el mismo nombre con un tamaño parecido (±5 %): un tema
   * sacado al que después le escribieron tags pesa unos bytes más ("Divididos - El 38", +128 bytes, corrida del 23/10).
   */
  private outsideMatcher(): (name: string, size: number) => boolean {
    const sizes = new Set<string>(), names = new Map<string, number[]>()
    for (const r of this.db.prepare(`SELECT f.rel_path AS rel, f.size, f.ext FROM files f WHERE ${visible('f')}`).all() as { rel: string; size: number; ext: string }[]) {
      sizes.add(`${r.size}|${r.ext.toLowerCase()}`)
      const b = path.posix.basename(r.rel).toLowerCase()
      names.set(b, [...(names.get(b) ?? []), r.size])
    }
    return (name, size) => sizes.has(`${size}|${extOf(name)}`) || (names.get(path.posix.basename(name).toLowerCase()) ?? []).some((s) => Math.abs(s - size) <= size * 0.05)
  }

  list(): ArchiveSummary[] {
    const outside = this.outsideMatcher()
    const rows = this.db.prepare(`SELECT ${ARCHIVE_COLS} FROM archives a WHERE a.missing_at IS NULL ORDER BY a.rel_path`).all() as ArchiveRow[]
    const ents = this.db.prepare('SELECT archive_id AS a, name, size, audio, duration, read_at AS readAt FROM archive_entries').all() as { a: number; name: string; size: number; audio: number; duration: number | null; readAt: string | null }[]
    const by = new Map<number, typeof ents>()
    for (const e of ents) by.set(e.a, [...(by.get(e.a) ?? []), e])
    // la última tanda sacada (sin deshacer) de cada comprimido: la carpeta que tienen en común sus archivos
    const batches = new Map<number, { batch: number; dirs: string[] }>()
    for (const r of this.db.prepare('SELECT archive_id AS a, batch, rel FROM archive_extracted WHERE undone_at IS NULL ORDER BY batch').all() as { a: number; batch: number; rel: string }[]) {
      const b = batches.get(r.a)
      if (!b || b.batch !== r.batch) batches.set(r.a, { batch: r.batch, dirs: [path.posix.dirname(r.rel)] }); else b.dirs.push(path.posix.dirname(r.rel))
    }
    const last = new Map([...batches].map(([a, b]) => [a, commonDir(b.dirs)]))
    return rows.map((r) => {
      const es = by.get(r.id) ?? [], audio = es.filter((e) => e.audio)
      const ex = last.get(r.id)
      return {
        id: r.id, rootId: r.rootId, rel: r.rel, name: path.posix.basename(r.rel), folder: path.posix.dirname(r.rel) === '.' ? '' : path.posix.dirname(r.rel),
        size: r.size, format: r.format, volumes: r.volumes, solid: !!r.solid, samplePack: !!r.samplePack, status: r.status, note: r.note,
        files: es.length, audio: audio.length, audioBytes: audio.reduce((s, e) => s + e.size, 0), read: audio.filter((e) => e.readAt).length,
        seconds: Math.round(audio.reduce((s, e) => s + (e.duration ?? 0), 0)),
        outside: audio.filter((e) => outside(e.name, e.size)).length,
        extractedTo: ex ?? null, available: !!this.rootPath(r.rootId),
      }
    })
  }

  entries(archiveId: number): ArchiveEntryRow[] {
    const outside = this.outsideMatcher()
    const rs = this.db.prepare('SELECT * FROM archive_entries WHERE archive_id = ? ORDER BY name COLLATE NOCASE').all(archiveId) as Record<string, never>[]
    return rs.map((r) => ({
      id: r.id, archiveId, idx: r.idx, name: path.posix.basename(r.name), folder: path.posix.dirname(r.name) === '.' ? '' : path.posix.dirname(r.name),
      size: r.size, audio: !!r.audio, companion: !!r.companion, blocked: r.blocked, codec: r.codec, sampleRate: r.sample_rate, bits: r.bits,
      channels: r.channels, kbps: r.kbps, duration: r.duration, artist: r.artist, title: r.title, album: r.album, track: r.track, year: r.year,
      genre: r.genre, grade: r.grade, gradeIs: r.grade_is, gradeWhy: r.grade_why ? JSON.parse(r.grade_why) : [], bpm: r.bpm, key: r.musical_key,
      readAt: r.read_at, error: r.error, outside: !!r.audio && outside(r.name, r.size),
    }))
  }

  /** El comprimido de hoy: su ruta, y su índice (si cambió desde el escaneo, se vuelve a listar y se avisa). */
  open(archiveId: number): { row: ArchiveRow; abs: string; listing: Listing } {
    const row = this.db.prepare(`SELECT ${ARCHIVE_COLS}, a.kind FROM archives a WHERE a.id = ?`).get(archiveId) as (ArchiveRow & { kind: CollectionKind }) | undefined
    if (!row) throw new Error(T.noEsta)
    const root = this.rootPath(row.rootId)
    if (!root) throw new Error(T.sinDisco)
    const abs = path.join(root, ...row.rel.split('/'))
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { throw new Error(T.yaNoEsta) }
    if (st.size !== row.size || Math.abs(st.mtimeMs - row.mtime) > 2000) {
      saveListing(this.db, { rootId: row.rootId, rel: row.rel, abs, size: st.size, mtime: Math.round(st.mtimeMs), kind: row.kind })
      throw new Error(T.cambio)
    }
    return { row, abs, listing: listArchive(abs) }
  }

  /**
   * Saca un tema a la carpeta de caché para escucharlo (se reusa si ya está; quedan los últimos 12). Devuelve la ruta.
   */
  async prepare(entryId: number, cacheDir: string, runner?: LibRunner): Promise<string> {
    const e = this.db.prepare('SELECT archive_id AS a, idx, name, size, blocked FROM archive_entries WHERE id = ?').get(entryId) as { a: number; idx: number; name: string; size: number; blocked: string | null } | undefined
    if (!e) throw new Error(T.temaNoEsta)
    if (e.blocked) throw new Error(e.blocked)
    const { row, listing } = this.open(e.a)
    const out = path.join(cacheDir, `${e.a}-${e.idx}-${row.size}-${Math.round(row.mtime)}.${extOf(e.name) || 'bin'}`)
    if (fs.existsSync(out)) { fs.utimesSync(out, new Date(), new Date()); return out }
    fs.mkdirSync(cacheDir, { recursive: true })
    const tmp = out + '.tmp'
    const [r] = await extractEntries(listing, [{ index: e.idx, dest: tmp }], { runner })
    if (r.error) { fs.rmSync(tmp, { force: true }); throw new Error(r.error) }
    fs.renameSync(tmp, out)
    const old = fs.readdirSync(cacheDir).filter((n) => !n.endsWith('.tmp')).map((n) => ({ n, t: fs.statSync(path.join(cacheDir, n)).mtimeMs })).sort((x, y) => y.t - x.t)
    for (const o of old.slice(12)) fs.rmSync(path.join(cacheDir, o.n), { force: true })
    return out
  }
}
