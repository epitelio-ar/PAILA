// Vaciar la papelera: la ÚNICA forma de borrar de verdad en PAILA, siempre a mano y con doble confirmación en la pantalla.
// Solo toca lo que está DENTRO de <carpeta de música>/_PAILA/papelera (o la de una carpeta que se le unió adentro). Lo que se borra queda anotado en la base (purged_at):
// desde ahí, restaurar o deshacer explica que ya no se puede.
import fs from 'node:fs'
import path from 'node:path'
import { transaction, type Db } from './db'
import { kindFor, type Rule } from './collections'
import { OpJournal } from './journal'
import { checkOrThrow } from './ops/run'
import type { HistoryEntry, PurgeResult, TrashFolder, TrashSummary, TrashUsage } from '@paila/shared/types'
import { cant, idioma, textos } from '@paila/shared/idioma'

// Lo que se muestra (Espacio → Papelera, Historial). Las carpetas de la papelera (_PAILA/papelera/…_tanda-3_…) no se traducen.
const T = textos({
  purgado: {
    es: (d: string) => `Ya no se puede: se vació la papelera el ${d} y ese archivo se borró para siempre`,
    en: (d: string) => `Can't anymore: the trash was emptied on ${d} and that file was deleted for good`,
  },
  temasMandaste: { es: (why: string | null) => `Temas que mandaste a la papelera${why ? ` (${why})` : ''}`, en: (why: string | null) => `Tracks you sent to the trash${why ? ` (${why})` : ''}` },
  originalLargo: { es: 'Original de un reemplazo o una conversión (WAV → FLAC, WMA → MP3…)', en: 'Original of a replacement or a conversion (WAV → FLAC, WMA → MP3…)' },
  limpiezaLargo: { es: 'Limpieza de Espacio (archivos que no eran música)', en: "Space cleanup (files that weren't music)" },
  zipAbierto: { es: 'ZIP o RAR que ya estaba abierto afuera', en: 'ZIP or RAR that was already opened outside' },
  deshecho: { es: 'Archivo nuevo de un reemplazo que deshiciste', en: 'New file from a replacement you undid' },
  original: { es: 'Original de un reemplazo o una conversión', en: 'Original of a replacement or a conversion' },
  limpieza: { es: 'Limpieza de Espacio', en: 'Space cleanup' },
  otros: { es: 'Otros archivos de la papelera', en: 'Other files in the trash' },
  separado: { es: 'Acapella e instrumental que separaste (deshecho)', en: 'Acapella and instrumental you separated (undone)' },
  tapas: { es: 'Tapas que había puesto PAILA (deshecho)', en: 'Covers PAILA had added (undone)' },
  respaldos: { es: 'Respaldos que mandaste a la papelera (se recuperan desde Configuración → Respaldos)', en: 'Backups you sent to the trash (they can be recovered from Settings → Backups)' },
  noDentro: { es: 'no está dentro de la papelera de PAILA', en: "it isn't inside PAILA's trash" },
  noSeToco: { es: (m: string) => `No se tocó: ${m}`, en: (m: string) => `Not touched: ${m}` },
  samplePack: { es: 'Es de un sample pack: PAILA no lo borra', en: "It's from a sample pack: PAILA doesn't delete it" },
  fuera: { es: 'fuera de la papelera', en: 'outside the trash' },
  temaPapelera: { es: 'Tema de la papelera', en: 'Track from the trash' },
  originalCorto: { es: 'Original de un reemplazo o conversión', en: 'Original of a replacement or conversion' },
  vacio: {
    es: (n: number) => `Se vació la papelera: se ${n === 1 ? 'borró' : 'borraron'} para siempre ${cant(n, 'archivo', 'archivos')}`,
    en: (n: number) => `The trash was emptied: ${cant(n, 'file', 'files')} ${n === 1 ? 'was' : 'were'} deleted for good`,
  },
  noSeDeshace: { es: 'Vaciar la papelera borra de verdad: no se puede deshacer', en: "Emptying the trash deletes for real: it can't be undone" },
})

type TrashFolderKind = TrashFolder['kind']

interface RootLike { id: number; path: string; available: boolean; rules: { rel: string; kind: string }[] }

const TRASH_DIR = '_PAILA/papelera'

/** "20/10/2026" (o "10/20/2026" en inglés), sin depender del idioma de la PC. */
export function fecha(iso: string): string {
  const d = new Date(iso)
  const dia = String(d.getDate()).padStart(2, '0'), mes = String(d.getMonth() + 1).padStart(2, '0')
  return idioma() === 'en' ? `${mes}/${dia}/${d.getFullYear()}` : `${dia}/${mes}/${d.getFullYear()}`
}
/** Mensaje para lo que se quiere restaurar o deshacer después de vaciar la papelera. */
export const purgedMsg = (iso: string) => T.purgado(fecha(iso))

/** Recorre una carpeta sin seguir accesos directos (symlinks/junctions): solo archivos reales. */
function walk(abs: string, rel: string, out: { rel: string; size: number }[]) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const a = path.join(abs, e.name), r = rel ? `${rel}/${e.name}` : e.name
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) walk(a, r, out)
    else if (e.isFile()) { try { out.push({ rel: r, size: fs.lstatSync(a).size }) } catch { /* sigue */ } }
  }
}

/** ¿`child` está dentro de `parent` (y no es la misma)? */
function inside(parent: string, child: string) {
  const r = path.relative(parent, child)
  return !!r && !r.startsWith('..') && !path.isAbsolute(r)
}

/** `col` empieza con el prefijo (que se pasa dos veces). Sin LIKE: "_" y "%" de los nombres no son comodines. */
const under = (col: string) => `substr(${col}, 1, length(?)) = ?`

/**
 * Las papeleras de una carpeta de música: la suya y la de cada carpeta que se le unió adentro ("Rock/_PAILA/papelera",
 * core/rootmerge.ts): sus temas siguen ahí y se pueden restaurar o vaciar igual.
 */
function trashDirs(db: Db, rootId: number): string[] {
  const nested = (col: string) => `instr(${col}, '/${TRASH_DIR}/') > 0`
  const rows = db.prepare(
    `SELECT t.trash_rel AS r FROM trash_log t JOIN files f ON f.id = t.file_id WHERE f.root_id = ? AND ${nested('t.trash_rel')}
     UNION SELECT r.old_trash_rel FROM replacements r JOIN files f ON f.id = r.file_id WHERE f.root_id = ? AND ${nested('r.old_trash_rel')}
     UNION SELECT to_rel FROM moves_log WHERE root_id = ? AND ${nested('to_rel')}
     UNION SELECT trash_rel FROM archive_trashed WHERE root_id = ? AND ${nested('trash_rel')}`,
  ).all(rootId, rootId, rootId, rootId) as { r: string }[]
  return [...new Set([TRASH_DIR, ...rows.map(({ r }) => r.slice(0, r.indexOf(`/${TRASH_DIR}/`) + TRASH_DIR.length + 1))])]
}

function folderDate(db: Db, rootId: number, root: string, trash: string, folder: string): string {
  // las tandas nuevas llevan fecha y hora en el nombre ("2026-10-20_01-15-07_tanda-3_k9x2")
  const m = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)_/.exec(folder)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString()
  // las viejas ("3", "r5", "limpieza-2"): la fecha que guardó la base, o la de la carpeta
  const p = `${trash}/${folder}/`
  const q = db.prepare(
    `SELECT MIN(d) AS d FROM (
       SELECT t.created_at AS d FROM trash_log t JOIN files f ON f.id = t.file_id WHERE f.root_id = ? AND ${under('t.trash_rel')}
       UNION ALL SELECT r.created_at FROM replacements r JOIN files f ON f.id = r.file_id WHERE f.root_id = ? AND ${under('r.old_trash_rel')}
       UNION ALL SELECT created_at FROM moves_log WHERE root_id = ? AND ${under('to_rel')}
       UNION ALL SELECT at FROM archive_trashed WHERE root_id = ? AND ${under('trash_rel')})`,
  ).get(rootId, p, p, rootId, p, p, rootId, p, p, rootId, p, p) as { d: string | null }
  if (q.d) return q.d
  try { const st = fs.statSync(path.join(root, ...trash.split('/'), folder)); return new Date(st.birthtimeMs || st.mtimeMs).toISOString() } catch { return new Date().toISOString() }
}

function folderKind(db: Db, rootId: number, trash: string, folder: string): { kind: TrashFolderKind; label: string } {
  const p = `${trash}/${folder}/`
  const t = db.prepare(`SELECT MIN(t.reason) AS reason, COUNT(*) AS n FROM trash_log t JOIN files f ON f.id = t.file_id WHERE f.root_id = ? AND ${under('t.trash_rel')}`).get(rootId, p, p) as { reason: string | null; n: number }
  if (t.n) return { kind: 'temas', label: T.temasMandaste(t.reason) }
  if (db.prepare(`SELECT 1 FROM replacements r JOIN files f ON f.id = r.file_id WHERE f.root_id = ? AND ${under('r.old_trash_rel')}`).get(rootId, p, p)) {
    return { kind: 'reemplazo', label: T.originalLargo }
  }
  if (db.prepare(`SELECT 1 FROM moves_log WHERE root_id = ? AND ${under('to_rel')}`).get(rootId, p, p)) return { kind: 'limpieza', label: T.limpiezaLargo }
  if (db.prepare(`SELECT 1 FROM archive_trashed WHERE root_id = ? AND ${under('trash_rel')}`).get(rootId, p, p) || /_zip-\d+_/.test(folder)) return { kind: 'comprimido', label: T.zipAbierto }
  if (/_separado-\d+_/.test(folder)) return { kind: 'otro', label: T.separado }
  if (/_tapas-deshechas_/.test(folder)) return { kind: 'otro', label: T.tapas } // core/restos.ts
  if (/(^r\d+|_reemplazo-\d+)-deshecho(_|$)/.test(folder)) return { kind: 'deshecho', label: T.deshecho }
  if (/^r\d+$|_reemplazo-\d+_/.test(folder)) return { kind: 'reemplazo', label: T.original }
  if (/^limpieza-\d+$|_limpieza-\d+_/.test(folder)) return { kind: 'limpieza', label: T.limpieza }
  if (/_respaldo-[a-z-]+_/.test(folder)) return { kind: 'respaldo', label: T.respaldos } // core/ops/backup-trash.ts
  if (/^\d+$|_tanda-\d+_/.test(folder)) return { kind: 'temas', label: T.temasMandaste(null) }
  return { kind: 'otro', label: T.otros }
}

/** Cuánto ocupa la papelera: todas las tandas de `_PAILA/papelera` de cada carpeta de música conectada. */
export function trashUsage(db: Db, roots: () => RootLike[]): TrashUsage {
  const out: TrashUsage = { bytes: 0, files: 0, folders: [], offline: 0 }
  const now = Date.now()
  for (const root of roots()) {
    if (!root.available) { out.offline++; continue }
    for (const trash of trashDirs(db, root.id)) {
      const base = path.join(root.path, ...trash.split('/'))
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue
        const files: { rel: string; size: number }[] = []
        walk(path.join(base, e.name), '', files)
        const bytes = files.reduce((s, f) => s + f.size, 0)
        const createdAt = folderDate(db, root.id, root.path, trash, e.name)
        out.folders.push({
          key: trash === TRASH_DIR ? `${root.id}|${e.name}` : `${root.id}|${trash}|${e.name}`, rootId: root.id, rootPath: root.path, trash, folder: e.name, createdAt, ageDays: Math.floor((now - Date.parse(createdAt)) / 86_400_000),
          ...folderKind(db, root.id, trash, e.name), files: files.length, bytes,
        })
        out.bytes += bytes; out.files += files.length
      }
    }
  }
  out.folders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return out
}

/** Desde cuánto se avisa que la papelera de un disco ocupa mucho: 5 GB, o el 5 % del disco si es chico (lo que llegue primero). */
export const trashLimit = (diskBytes: number | null) => Math.min(5e9, diskBytes ? 0.05 * diskBytes : 5e9)

/**
 * El resumen de la papelera (pedido del autor, 24/10: que nadie junte GB sin darse cuenta): cuánto ocupa, cuánto es de
 * respaldos y cuánto de temas, y si en algún disco pasa del tope (`trashLimit`). Solo mira: no toca nada.
 */
export function trashSummary(db: Db, roots: () => RootLike[]): TrashSummary {
  const u = trashUsage(db, roots)
  const sum = (kinds: TrashFolderKind[], rootId?: number) => u.folders.filter((f) => kinds.includes(f.kind) && (rootId == null || f.rootId === rootId)).reduce((s, f) => s + f.bytes, 0)
  const backups = sum(['respaldo']), tracks = sum(['temas', 'reemplazo', 'deshecho'])
  let warn = false, limit = 5e9
  for (const r of roots()) {
    if (!r.available) continue
    const mine = u.folders.filter((f) => f.rootId === r.id).reduce((s, f) => s + f.bytes, 0)
    let disk: number | null = null
    try { const st = fs.statfsSync(r.path); disk = Number(st.blocks) * Number(st.bsize) } catch { /* sin dato: 5 GB */ }
    if (mine > 0) limit = Math.min(limit, trashLimit(disk))
    if (mine > trashLimit(disk)) warn = true
  }
  return { bytes: u.bytes, files: u.files, backups, tracks, other: u.bytes - backups - tracks, warn, limit, offline: u.offline }
}

/** Anota en la base que estos archivos de la papelera ya se borraron (también lo usa la recuperación al abrir). */
export function markPurged(db: Db, rootId: number, rels: string[], at = new Date().toISOString()) {
  const t = db.prepare('UPDATE trash_log SET purged_at = ? WHERE trash_rel = ? AND restored_at IS NULL AND purged_at IS NULL AND file_id IN (SELECT id FROM files WHERE root_id = ?)')
  const r = db.prepare('UPDATE replacements SET purged_at = ? WHERE old_trash_rel = ? AND undone_at IS NULL AND purged_at IS NULL AND file_id IN (SELECT id FROM files WHERE root_id = ?)')
  const m = db.prepare('UPDATE moves_log SET purged_at = ? WHERE to_rel = ? AND undone_at IS NULL AND purged_at IS NULL AND root_id = ?')
  const a = db.prepare('UPDATE archive_trashed SET purged_at = ? WHERE trash_rel = ? AND restored_at IS NULL AND purged_at IS NULL AND root_id = ?')
  transaction(db, () => { for (const rel of rels) { t.run(at, rel, rootId); r.run(at, rel, rootId); m.run(at, rel, rootId); a.run(at, rel, rootId) } })
}

/**
 * Borra DE VERDAD las tandas elegidas (`keys` de `trashUsage`). Se recalcula todo acá: solo se borra lo que sigue estando
 * dentro de `_PAILA/papelera`, archivo por archivo, y nunca algo que sea de un sample pack.
 */
export function purgeTrash(db: Db, roots: () => RootLike[], keys: string[]): PurgeResult {
  const res: PurgeResult = { deleted: 0, bytes: 0, folders: 0, kept: [], failed: [] }
  const wanted = new Set(keys)
  const now = new Date().toISOString()
  const byId = new Map(roots().map((r) => [r.id, r]))
  const journal = new OpJournal(db)
  for (const f of trashUsage(db, roots).folders) {
    if (!wanted.has(f.key)) continue
    const root = byId.get(f.rootId)!
    const base = path.join(root.path, ...f.trash.split('/'))
    const dir = path.join(base, f.folder)
    // seguridad: tiene que ser una carpeta real, directamente dentro de <carpeta de música>/_PAILA/papelera (sin accesos directos en el medio)
    try {
      const realBase = fs.realpathSync(base), realDir = fs.realpathSync(dir)
      if (!/^(?:[^/]+\/)*_PAILA\/papelera$/.test(f.trash) || f.trash.split('/').includes('..') || realBase !== path.join(fs.realpathSync(root.path), ...f.trash.split('/')) || path.dirname(realDir) !== realBase || !inside(realBase, realDir) || fs.lstatSync(dir).isSymbolicLink()) {
        throw new Error(T.noDentro)
      }
    } catch (e) { res.failed.push({ rel: f.folder, error: T.noSeToco((e as Error).message) }); continue }
    // chequeos centrales del motor de operaciones (candado de operaciones, disco conectado)
    try { checkOrThrow(db, { kind: 'borrar', op: 'vaciar', rootId: root.id, fileId: null, src: `${f.trash}/${f.folder}`, dst: null, data: null }, { rootPath: (id) => byId.get(id)?.path ?? null }) }
    catch (e) { res.failed.push({ rel: f.folder, error: T.noSeToco((e as Error).message) }); continue }
    const files: { rel: string; size: number }[] = []
    walk(dir, '', files)
    const gone: string[] = []
    // Diario antes de borrar: si se corta a mitad, al abrir PAILA anota como vaciado lo que ya no esté (core/recovery.ts).
    const jid = journal.begin({ op: 'vaciar', rootId: root.id, src: `${f.trash}/${f.folder}`, data: { rels: files.map((x) => `${f.trash}/${f.folder}/${x.rel}`) } })
    for (const file of files) {
      const trashRel = `${f.trash}/${f.folder}/${file.rel}`
      const inner = f.trash.slice(0, -TRASH_DIR.length) // "Rock/" si es la papelera de una carpeta que se unió
      // Regla del producto: los sample packs nunca se tocan (no deberían estar acá, pero por las dudas).
      const sample = kindFor(inner + file.rel, root.rules as Rule[]) === 'produccion' ||
        !!db.prepare("SELECT 1 FROM trash_log t JOIN files x ON x.id = t.file_id WHERE x.root_id = ? AND t.trash_rel = ? AND x.kind = 'produccion'").get(root.id, trashRel)
      if (sample) { res.kept.push({ rel: trashRel, why: T.samplePack }); continue }
      const abs = path.join(dir, ...file.rel.split('/'))
      try {
        if (!inside(dir, abs) || fs.lstatSync(abs).isSymbolicLink()) throw new Error(T.fuera)
        fs.unlinkSync(abs)
        res.deleted++; res.bytes += file.size; gone.push(trashRel)
      } catch (e) { res.failed.push({ rel: trashRel, error: (e as Error).message }) }
    }
    journal.done(jid, () => markPurged(db, root.id, gone, now))
    pruneEmpty(dir)
    if (!fs.existsSync(dir)) res.folders++
  }
  return res
}

/** Saca las carpetas que quedaron vacías dentro de una tanda (y la tanda misma si quedó vacía). Nunca algo con contenido. */
function pruneEmpty(dir: string): boolean {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  let empty = true
  for (const e of entries) {
    if (e.isDirectory() && !e.isSymbolicLink()) { if (!pruneEmpty(path.join(dir, e.name))) empty = false } else empty = false
  }
  if (empty) { try { fs.rmdirSync(dir) } catch { return false } }
  return empty
}

// ---------- para el Historial ----------

/** Lo que se borró en cada "Vaciar papelera": todos los archivos de una vez llevan la misma fecha (`purgeTrash`). */
export function purgedFiles(db: Db): { at: string; rel: string; what: string }[] {
  // de qué tabla viene cada uno (un dato): el texto se pone acá, en el idioma de ahora
  const what = (k: string) => (k === 't' ? T.temaPapelera : k === 'r' ? T.originalCorto : k === 'm' ? T.limpieza : T.zipAbierto)
  return (db.prepare(
    `SELECT purged_at AS at, orig_rel AS rel, 't' AS k FROM trash_log WHERE purged_at IS NOT NULL
     UNION ALL SELECT purged_at, old_trash_rel, 'r' FROM replacements WHERE purged_at IS NOT NULL
     UNION ALL SELECT purged_at, from_rel, 'm' FROM moves_log WHERE purged_at IS NOT NULL
     UNION ALL SELECT purged_at, rel, 'a' FROM archive_trashed WHERE purged_at IS NOT NULL ORDER BY 1, 2`,
  ).all() as { at: string; rel: string; k: string }[]).map((r) => ({ at: r.at, rel: r.rel, what: what(r.k) }))
}

/** El número de un vaciado en el Historial (con el tipo 'vaciado' lo identifica): su fecha en segundos. */
export const purgeId = (at: string) => Math.floor(Date.parse(at) / 1000)

/**
 * Un renglón del Historial por cada vez que se vació la papelera: lo único que PAILA borra de verdad (antes solo quedaba
 * como nota en cada tanda, "ya no se puede: se vació la papelera"). No se deshace.
 */
export function purgeEntries(db: Db): HistoryEntry[] {
  const by = new Map<string, number>()
  for (const r of purgedFiles(db)) by.set(r.at, (by.get(r.at) ?? 0) + 1)
  return [...by].map(([at, n]) => ({
    kind: 'vaciado' as const, id: purgeId(at), at, files: n,
    summary: T.vacio(n),
    undone: false, canUndo: false, whyNot: T.noSeDeshace, note: null,
  }))
}
