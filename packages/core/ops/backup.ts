// Respaldo liviano por paso (motor único; masterplan 3, punto 1.1; rediseñado con el autor el 24/10, porque las copias
// enteras ocupaban 40 GB en una tanda de tags): antes de cambiar lo de ADENTRO de un archivo de tu Música (tags, tapas, volumen
// parejo, comentario, marcas de Serato), PAILA guarda solo lo que cambia: los pedazos de antes (ops/delta.ts), con la huella
// del archivo entero de antes y de después. Alcanza para dejarlo byte a byte como estaba al deshacer. El cover.jpg de la
// carpeta se copia entero (es chico). Cada pedazo se guarda y se verifica justo antes de que el archivo nuevo reemplace al
// original (core/changes-write.ts): nunca hay un archivo cambiado sin su respaldo.
// La vista previa dice cuánto va a ocupar (leyendo los encabezados, sin decodificar) y dónde va. Si pasa del 10 % del lugar
// libre, avisa; si no entra, no arranca; y si en el medio crece más de lo previsto, la tanda se frena (lo hecho queda bien).
// Lo que no se respalda acá: mover o renombrar (no cambia los bytes; se deshace desde el Historial) y reemplazar, convertir o
// recortar silencios (el original va a la papelera de PAILA).
// Dónde: de fábrica, al lado de la música de cada disco, en _PAILA/respaldos/<operación>-<fecha>/ (cada archivo con su ruta
// de adentro de la carpeta de música); o en la carpeta que elija la persona (ajuste `backup_dir`). Nunca se borran solos: a mano
// van a la papelera de PAILA (ops/backup-trash.ts). Los respaldos completos que hacía la 0.5.3 siguen en la lista y sirven para
// deshacer (core/changes-undo.ts).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { copyDurable } from '../journal'
import { backupStamp } from './copy'
import { fileSha1, type DeltaHeader } from './delta'
import { metaBytes } from './metasize'
import { num, textos } from '@paila/shared/idioma'
import type { BackupPlan } from '@paila/shared/types'

/** El ajuste con la carpeta elegida para los respaldos (si no está, al lado de la música). */
export const BACKUP_SETTING = 'backup_dir'
/**
 * El archivo de cada tanda y disco donde se va guardando "lo de antes" de cada tema, uno detrás del otro (ops/delta.ts). Uno solo
 * y no uno por tema: en un disco exFAT (los externos grandes) cada archivo chico ocupa al menos 512 KB.
 */
export const CHANGES_FILE = 'cambios.paila'
/** Si el respaldo ocuparía más que esta parte del lugar libre, la vista previa avisa. */
const WARN_SHARE = 0.1
/** Lugar que se deja libre siempre, aparte de lo que hace falta. */
const MARGIN = 50e6

// Lo que se muestra (la vista previa, el Historial, los avisos). Nada lo compara.
const T = textos({
  sinLugar: {
    es: (need: string, free: string, where: string) => `Falta lugar: hacen falta ${need} en ${where} (el respaldo y la copia de trabajo de cada tema) y quedan ${free} libres. No se tocó nada`,
    en: (need: string, free: string, where: string) => `Not enough space: ${need} needed in ${where} (the backup and each track's working copy) and ${free} free. Nothing was touched`,
  },
  mucho: {
    es: (b: string, free: string, where: string) => `Ojo: el respaldo ocuparía unos ${b}, más del 10 % de lo que queda libre en ${where} (${free}).`,
    en: (b: string, free: string, where: string) => `Heads up: the backup would take about ${b}, more than 10% of the free space left in ${where} (${free}).`,
  },
  frenado: {
    es: (b: string) => `Se frenó la tanda: el respaldo ya ocupa ${b}, más de lo previsto, y PAILA no llena el disco sin avisar. Lo aplicado quedó bien y se deshace desde el Historial; lo demás sigue en Cambios pendientes`,
    en: (b: string) => `The batch was stopped: the backup already takes ${b}, more than expected, and PAILA doesn't fill the disk without warning. What was applied is fine and can be undone from History; the rest stays in Pending changes`,
  },
  copiaMal: {
    es: (n: string) => `La copia de respaldo de "${n}" no quedó igual al original: no se tocó nada`,
    en: (n: string) => `The backup copy of "${n}" didn't come out the same as the original: nothing was touched`,
  },
  sinDisco: { es: 'El disco no está conectado', en: "The disk isn't connected" },
})

const size = (n: number) => n >= 1e9 ? `${num(n / 1e9, { maximumFractionDigits: 1 })} GB` : `${num(Math.max(n > 0 ? 1 : 0, Math.round(n / 1e6)))} MB`

/** Un archivo que se va a cambiar. `whole`: se copia entero (el cover.jpg de la carpeta). */
export interface BackupItem { rootId: number; rel: string; whole?: boolean }
export interface BackupDeps { rootPath: (rootId: number) => string | null }

/** La carpeta elegida para los respaldos, o null (al lado de la música). */
export function chosenBackupDir(db: Db): string | null {
  const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(BACKUP_SETTING) as { value: string } | undefined)?.value
  return v && v.trim() ? v : null
}
export function setBackupDir(db: Db, dir: string | null) {
  if (dir) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(BACKUP_SETTING, dir)
  else db.prepare('DELETE FROM settings WHERE key = ?').run(BACKUP_SETTING)
}

/** Dónde va el respaldo de una tanda en un disco: `<base>/<operación>-<fecha>` (con la carpeta elegida, una por disco adentro). */
function dirFor(db: Db, root: string, rootId: number, name: string, roots: number) {
  const chosen = chosenBackupDir(db)
  if (!chosen) return path.join(root, '_PAILA', 'respaldos', name)
  const tanda = path.join(chosen, name)
  return roots > 1 ? path.join(tanda, `${path.basename(root) || 'disco'}-${rootId}`) : tanda
}

/** Lo que queda libre en el disco de una carpeta (o null si no se sabe). */
function freeAt(dir: string): number | null {
  let probe = dir
  while (!fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) return null; probe = up }
  try { const st = fs.statfsSync(probe); return Number(st.bavail) * Number(st.bsize) } catch { return null }
}
const volume = (p: string) => path.parse(path.resolve(p)).root.toLowerCase()

/** Lo que se calcula por disco: cuánto va a ocupar el respaldo, el archivo más grande (la copia de trabajo) y el lugar libre. */
interface Group { rootId: number; root: string; dir: string; files: number; bytes: number; biggest: number; free: number | null; rootFree: number | null }

/** Cuánto ocuparía: los metadatos de cada archivo (con muchos, una muestra pareja) y los cover.jpg enteros. */
function estimate(db: Db, items: BackupItem[], deps: BackupDeps, name: string): { groups: Group[]; fatal: string | null } {
  const byRoot = new Map<number, Group & { metas: number[]; sampled: number; seen: number }>()
  const seen = new Set<string>()
  const rootIds = new Set(items.map((i) => i.rootId))
  const all = items.filter((it) => { const k = `${it.rootId}|${it.rel.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true })
  const step = Math.max(1, Math.ceil(all.filter((i) => !i.whole).length / 1500))
  for (const it of all) {
    let g = byRoot.get(it.rootId)
    if (!g) {
      const root = deps.rootPath(it.rootId)
      if (!root) return { groups: [], fatal: T.sinDisco }
      const dir = dirFor(db, root, it.rootId, name, rootIds.size)
      g = { rootId: it.rootId, root, dir, files: 0, bytes: 0, biggest: 0, free: freeAt(dir), rootFree: freeAt(root), metas: [], sampled: 0, seen: 0 }
      byRoot.set(it.rootId, g)
    }
    const abs = path.join(g.root, ...it.rel.split('/'))
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { continue } // no está: esa parte de la tanda va a fallar sola, sin tocar nada
    g.files++
    if (it.whole) { g.bytes += st.size; continue }
    g.biggest = Math.max(g.biggest, st.size)
    if (g.seen++ % step === 0) { g.metas.push(metaBytes(abs)); g.sampled++ }
  }
  for (const g of byRoot.values()) {
    // ~300 bytes de anotación por archivo, más los metadatos de antes (de la muestra, para todos)
    const n = g.seen
    if (n) g.bytes += Math.round((g.metas.reduce((s, x) => s + x, 0) / Math.max(1, g.sampled)) * n + 300 * n)
  }
  return { groups: [...byRoot.values()].filter((g) => g.files), fatal: null }
}

/** Qué no deja empezar (falta lugar) y qué conviene avisar (más del 10 % de lo libre). `parallel`: temas que se escriben a la vez. */
function judge(g: Group, parallel: number): { problem: string | null; warning: string | null } {
  const same = volume(g.dir) === volume(g.root)
  const work = parallel * g.biggest + (same ? g.bytes : 0) + MARGIN
  if (g.rootFree != null && work > g.rootFree) return { problem: T.sinLugar(size(work), size(g.rootFree), g.root), warning: null }
  if (!same && g.free != null && g.bytes + MARGIN > g.free) return { problem: T.sinLugar(size(g.bytes + MARGIN), size(g.free), path.dirname(g.dir)), warning: null }
  const free = same ? g.rootFree : g.free
  return { problem: null, warning: free != null && g.bytes > WARN_SHARE * free ? T.mucho(size(g.bytes), size(free), path.dirname(g.dir)) : null }
}

/** La vista previa: cuántos archivos, cuánto va a ocupar el respaldo y dónde va. No toca nada. */
export function planBackup(db: Db, items: BackupItem[], deps: BackupDeps, op = 'tags', parallel = 4): BackupPlan {
  const { groups, fatal } = estimate(db, items, deps, `${op}-${backupStamp()}`)
  let problem = fatal, warning: string | null = null
  for (const g of groups) {
    const j = judge(g, parallel)
    problem ??= j.problem
    warning ??= j.warning
  }
  return { files: groups.reduce((s, g) => s + g.files, 0), bytes: groups.reduce((s, g) => s + g.bytes, 0), dirs: groups.map((g) => path.dirname(g.dir)), problem, warning: problem ? null : warning }
}

/** Lo que guardó el respaldo de un archivo (se anota junto con el cambio). */
export interface SavedFile { path: string; pos: number | null; bytes: number; kind: 'cambio' | 'entero' | 'copia'; old: { size: number; sha1: string }; new: { size: number; sha1: string } | null }
export const savedOf = (p: string, pos: number, bytes: number, h: DeltaHeader): SavedFile => ({ path: p, pos, bytes, kind: h.entero ? 'entero' : 'cambio', old: h.old, new: h.new })

/**
 * El respaldo de una tanda: se arma a medida que se escribe cada archivo (un pedazo por archivo, justo antes de reemplazarlo).
 * `start` hace la vista previa de nuevo: si falta lugar, tira el error y no arranca nada. Cada disco tiene su carpeta y su fila
 * en `backups` (se crean con el primer archivo); cada archivo, su fila en `backup_files`.
 */
export class StepBackup {
  private rows = new Map<number, { id: number; dir: string; limit: number; used: number }>()
  private name: string
  private constructor(private db: Db, private op: string, private ref: number | null, private deps: BackupDeps, private groups: Map<number, Group>, private parallel: number) {
    this.name = `${op}-${backupStamp()}`
  }

  static start(db: Db, op: string, ref: number | null, items: BackupItem[], deps: BackupDeps, parallel = 4): StepBackup {
    const { groups, fatal } = estimate(db, items, deps, `${op}-${backupStamp()}`)
    if (fatal) throw new Error(fatal)
    for (const g of groups) { const j = judge(g, parallel); if (j.problem) throw new Error(j.problem) }
    return new StepBackup(db, op, ref, deps, new Map(groups.map((g) => [g.rootId, g])), parallel)
  }

  private row(rootId: number) {
    let r = this.rows.get(rootId)
    if (r) return r
    const root = this.deps.rootPath(rootId)
    if (!root) throw new Error(T.sinDisco)
    const roots = new Set([...this.groups.keys(), rootId]).size
    let dir = dirFor(this.db, root, rootId, this.name, roots)
    // dos tandas en el mismo segundo (aplicar y volver a aplicar) no comparten carpeta
    for (let k = 2; fs.existsSync(dir); k++) dir = dirFor(this.db, root, rootId, `${this.name}-${k}`, roots)
    fs.mkdirSync(dir, { recursive: true })
    const id = Number(this.db.prepare('INSERT INTO backups (op, ref, root_id, dir, files, bytes, created_at, complete) VALUES (?, ?, ?, ?, 0, 0, ?, 0)')
      .run(this.op, this.ref, rootId, dir, new Date().toISOString()).lastInsertRowid)
    this.db.prepare("INSERT INTO backup_state (backup_id, kind) VALUES (?, 'liviano')").run(id)
    // hasta dónde puede crecer sin avisar: el 10 % de lo libre, o el doble de lo previsto si eso se avisó y se aceptó; y nunca
    // tanto que no entre la copia de trabajo de los temas que se escriben a la vez
    const g = this.groups.get(rootId)
    const free = freeAt(dir), est = g?.bytes ?? 0
    const work = this.parallel * (g?.biggest ?? 0) + MARGIN
    const limit = free == null ? Infinity : Math.min(Math.max(WARN_SHARE * free, 2 * est + 20e6), Math.max(0, free - work))
    r = { id, dir, limit, used: 0 }
    this.rows.set(rootId, r)
    return r
  }

  /** El archivo donde va lo de antes de los temas de este disco (crea la carpeta la primera vez). Frena si el respaldo pasó lo previsto. */
  target(rootId: number): string {
    const r = this.row(rootId)
    if (r.used > r.limit) throw new BackupFull(T.frenado(size(r.used)))
    return path.join(r.dir, CHANGES_FILE)
  }

  /** Lo anota (va dentro de la transacción que guarda el cambio en la base): el pedazo ya está en el disco y verificado. */
  record(rootId: number, fileId: number | null, rel: string, s: SavedFile) {
    const r = this.row(rootId)
    const at = path.relative(r.dir, s.path).split(path.sep).join('/')
    this.db.prepare('INSERT INTO backup_files (backup_id, file_id, rel, path, pos, kind, old_size, old_sha1, new_size, new_sha1, bytes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, fileId, rel, at, s.pos, s.kind, s.old.size, s.old.sha1, s.new?.size ?? null, s.new?.sha1 ?? null, s.bytes, new Date().toISOString())
    this.db.prepare('UPDATE backups SET files = files + 1, bytes = bytes + ? WHERE id = ?').run(s.bytes, r.id)
    r.used += s.bytes
  }

  /**
   * Copia entera y verificada (el cover.jpg de la carpeta, que es chico), anotada en el momento. Una sola vez por tanda: dos temas
   * de la misma carpeta (con varios discos) cambian el mismo cover.jpg, y lo que vale es cómo estaba antes del primero (la segunda
   * copia pisaba la primera con el cover ya cambiado: corrida del respaldo liviano, 24/10).
   */
  saveWhole(rootId: number, rel: string, fileId: number | null): Promise<void> {
    const key = `${rootId}|${rel.toLowerCase()}`
    let p = this.whole.get(key)
    if (!p) { p = this.copyWhole(rootId, rel, fileId); this.whole.set(key, p) }
    return p
  }
  private whole = new Map<string, Promise<void>>()
  private async copyWhole(rootId: number, rel: string, fileId: number | null) {
    const root = this.deps.rootPath(rootId)
    if (!root) throw new Error(T.sinDisco)
    const abs = path.join(root, ...rel.split('/'))
    if (!fs.existsSync(abs)) return
    const r = this.row(rootId)
    const to = path.join(r.dir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(to), { recursive: true })
    copyDurable(abs, to)
    const [a, b] = await Promise.all([fileSha1(abs), fileSha1(to)])
    if (a !== b) { fs.rmSync(to, { force: true }); throw new Error(T.copiaMal(path.basename(rel))) }
    const n = fs.statSync(to).size
    this.record(rootId, fileId, rel, { path: to, pos: null, bytes: n, kind: 'copia', old: { size: n, sha1: a }, new: null })
  }

  /** Terminó la tanda (o se canceló): el respaldo queda completo. Si no llegó a guardar nada (falló todo), no queda en la lista. */
  finish() {
    for (const r of this.rows.values()) {
      const n = (this.db.prepare('SELECT COUNT(*) AS n FROM backup_files WHERE backup_id = ?').get(r.id) as { n: number }).n
      const empty = n === 0 && (fs.readdirSync(r.dir, { recursive: true }) as string[]).every((f) => fs.statSync(path.join(r.dir, f)).isDirectory())
      if (empty) {
        fs.rmSync(r.dir, { recursive: true, force: true })
        this.db.prepare('DELETE FROM backups WHERE id = ?').run(r.id)
        this.db.prepare('DELETE FROM backup_state WHERE backup_id = ?').run(r.id)
      }
      else this.db.prepare('UPDATE backups SET complete = 1 WHERE id = ?').run(r.id)
    }
  }
  get ids() { return [...this.rows.values()].map((r) => r.id) }
}

/** El respaldo pasó lo previsto: la tanda se frena (se reconoce por el tipo). */
export class BackupFull extends Error {}

// la lista de respaldos, mandarlos a la papelera y recuperarlos: ops/backup-trash.ts
export { backupsOf, linkBackup, listBackups, restoreBackup, trashBackups, trashedBackups } from './backup-trash'

/** Un nombre de archivo de trabajo único (la copia temporal de un tema mientras se escribe). */
export const workName = (fileId: number, ext: string) => `${fileId}-${crypto.randomBytes(4).toString('hex')}${ext}`
