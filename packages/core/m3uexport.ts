// Playlists para reproductores de PC (foobar2000, MusicBee, Apple Music/iTunes, VLC…): un .m3u8 por playlist en la
// carpeta elegida, con rutas completas o relativas a esa carpeta. Solo escribe los archivos de las listas, nunca la música.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import type { Playlists } from './playlists'
import { cleanName } from './carry'
import { CopyOut, checkOut } from './ops/copy'
import type { M3uOptions, M3uResult } from '@paila/shared/types'

export interface M3uEntry { path: string; duration: number | null; label: string }

/**
 * El texto del .m3u8 (pura, para los tests). Con `relative`, la ruta queda relativa a la carpeta de la lista; si el tema
 * está en otro disco no hay ruta relativa posible y va completa (se cuenta en `absolute`).
 */
export function m3uText(entries: M3uEntry[], listDir: string, relative: boolean, p: typeof path = path): { text: string; absolute: number } {
  const lines = ['#EXTM3U']
  let absolute = 0
  for (const e of entries) {
    let ref = e.path
    if (relative) {
      const r = p.relative(listDir, e.path)
      if (p.isAbsolute(r)) absolute++; else ref = r
    }
    lines.push(`#EXTINF:${Math.round(e.duration ?? -1)},${e.label}`)
    lines.push(ref)
  }
  return { text: lines.join('\r\n') + '\r\n', absolute }
}

/**
 * Escribe un .m3u8 por playlist (las carpetas de playlists se saltean: sus listas van cada una aparte). Si ya hay una lista con
 * ese nombre, la pone al día. Por el motor (ops/copy.ts): chequeos antes, y cada lista entera o nada, con su renglón en el Historial.
 */
export function exportM3uLists(db: Db, playlists: Playlists, pathOf: (id: number) => string | null, ids: number[], o: M3uOptions): M3uResult {
  const res: M3uResult = { dir: o.dir, files: [], absoluteFallback: 0 }
  checkOut(db, [path.join(o.dir, 'x.m3u8')])
  const copies = new CopyOut(db, 'listas', o.dir)
  fs.mkdirSync(o.dir, { recursive: true })
  const nodes = new Map(playlists.tree().map((n) => [n.id, n]))
  const used = new Set<string>()
  const q = db.prepare('SELECT artist, title, duration, rel_path AS rel FROM files WHERE id = ?')
  for (const id of ids) {
    const node = nodes.get(id)
    if (!node || node.kind === 'folder') continue
    const base = cleanName(node.name) || 'Playlist'
    let name = `${base}.m3u8`
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} (${k}).m3u8`
    used.add(name.toLowerCase())
    const entries: M3uEntry[] = []
    let missing = 0
    for (const fid of playlists.trackIds(id)) {
      const abs = pathOf(fid)
      const f = q.get(fid) as { artist: string | null; title: string | null; duration: number | null; rel: string } | undefined
      if (!abs || !f || !fs.existsSync(abs)) { missing++; continue }
      entries.push({ path: abs, duration: f.duration, label: [f.artist, f.title ?? path.basename(f.rel, path.extname(f.rel))].filter(Boolean).join(' - ') })
    }
    const { text, absolute } = m3uText(entries, o.dir, o.relative)
    copies.write({ dst: path.join(o.dir, name), replace: true }, text)
    res.absoluteFallback += absolute
    res.files.push({ name, tracks: entries.length, missing })
  }
  return res
}
