// Lo común de la prueba de corte (scripts/corte.ts): los argumentos, abrir la copia de la base como la app (y asegurarse de
// que apunta a la copia de la Música, nunca a la original) y el control de que todo quedó coherente.
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { guardWith } from '@paila/core/ops/checks'
import { AUDIO_EXT } from '@paila/core/files'

export const mode = process.argv[2]
export const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
export const datos = arg('--datos'), dbFile = datos && path.join(datos, 'paila.db'), antesFile = datos && path.join(datos, 'antes.json')
export const log = (...a: unknown[]) => console.log(...a)
export const fail = (m: string) => { console.error(m); process.exit(2) }

/**
 * Abre la copia como lo hace la app, y se asegura de que la carpeta de música sea la copia (nunca la Música original). Con
 * --musica-real (vistas previas del punto 1 sobre la Música de verdad) acepta otra carpeta, pero solo con PAILA_SOLO_LECTURA=1,
 * que frena toda operación sobre archivos, y nunca con la base real.
 */
export function open(): { lib: Library; root: string; rootPath: (id: number) => string | null } {
  if (!dbFile || !fs.existsSync(dbFile)) fail('Falta --datos con la copia de la base (paila.db)')
  const real = process.argv.includes('--musica-real')
  if (real && process.env.PAILA_SOLO_LECTURA !== '1') fail('--musica-real solo con PAILA_SOLO_LECTURA=1')
  if (/[\\/]PAILA[\\/]paila\.db$/i.test(path.resolve(dbFile))) fail('Esa parece la base real: usá una copia')
  const lib = new Library(dbFile, findFfprobe())
  guardWith(lib.db, lib.ops)
  const roots = lib.roots()
  if (roots.length !== 1 || !roots[0].available || (!real && !/PAILA-trabajo[\\/]Música-copia$/i.test(roots[0].path))) fail(`La base no apunta a la copia: ${roots.map((r) => r.path).join(', ')}`)
  return { lib, root: roots[0].path, rootPath: (id) => lib.roots().find((r) => r.id === id && r.available)?.path ?? null }
}

export interface Antes { files: { id: number; rel: string; size: number }[]; playlistItems: number; batch: number; /** audios del disco sin fila (carpetas excluidas, sin escanear) */ unknown: string[] }
export const visibles = (lib: Library) => lib.db.prepare("SELECT id, rel_path AS rel, size FROM files WHERE trashed_at IS NULL AND missing_at IS NULL AND excluded_at IS NULL ORDER BY id").all() as unknown as Antes['files']
export const count = (lib: Library, sql: string) => (lib.db.prepare(sql).get() as { n: number }).n
export const count0 = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n

/** Lo que tiene que valer siempre: cada tema una sola vez, la base igual al disco, nada cambió de tamaño. */
export function controlar(lib: Library, root: string, antes: Antes, esperarOriginal: boolean): string[] {
  const bad: string[] = []
  const now = visibles(lib)
  if (now.length !== antes.files.length) bad.push(`temas visibles: ${antes.files.length} → ${now.length}`)
  const nowById = new Map(now.map((f) => [f.id, f]))
  for (const f of antes.files) {
    const n = nowById.get(f.id)
    if (!n) { bad.push(`falta el tema ${f.id} (${f.rel})`); continue }
    const abs = path.join(root, ...n.rel.split('/'))
    let size = -1
    try { size = fs.statSync(abs).size } catch { /* no está */ }
    if (size < 0) bad.push(`la base dice ${n.rel} y ahí no hay archivo`)
    else if (size !== f.size) bad.push(`${n.rel} cambió de tamaño (${f.size} → ${size})`)
    if (esperarOriginal && n.rel !== f.rel) bad.push(`${f.rel} no volvió a su lugar (está en ${n.rel})`)
    if (!esperarOriginal && n.rel !== f.rel && !lib.db.prepare('SELECT 1 FROM moves_log WHERE file_id = ? AND to_rel = ? AND undone_at IS NULL').get(f.id, n.rel)) bad.push(`${n.rel} se movió sin quedar en el registro de movimientos`)
  }
  // archivos de música en el disco que la base no conoce y antes no estaban (se duplicó algo o quedó un movimiento sin anotar)
  const before = new Set(antes.unknown)
  for (const rel of unknownFiles(lib, root)) if (!before.has(rel)) bad.push(`archivo que la base no conoce: ${rel}`)
  const pl = count(lib, 'SELECT COUNT(*) AS n FROM playlist_items')
  if (pl !== antes.playlistItems) bad.push(`lugares en playlists: ${antes.playlistItems} → ${pl}`)
  const open = count(lib, 'SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL')
  if (open) bad.push(`${open} anotaciones del diario sin resolver`)
  return bad
}

export function unknownFiles(lib: Library, root: string): string[] {
  const rows = new Set((lib.db.prepare('SELECT rel_path AS rel FROM files').all() as { rel: string }[]).map((r) => r.rel.toLowerCase()))
  return (fs.readdirSync(root, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'))
    .filter((rel) => !/^_paila\//i.test(rel) && AUDIO_EXT.has(path.extname(rel).slice(1).toLowerCase()) && !rows.has(rel.toLowerCase()))
}
