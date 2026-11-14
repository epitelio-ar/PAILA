// "Mejorar esta playlist": para cada tema de una playlist busca en la biblioteca una versión mejor del mismo tema
// (mismo artista y título, duración parecida, mejor nota o sin pérdida) y la cambia en la lista. No toca archivos.
import { transaction, visible, type Db } from './db'
import { normalize, pickKeeper } from './duplicates'
import type { DupItem, ImproveProposal } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

/** Por qué la otra versión es mejor (solo se muestra). */
const T = textos({
  nota: { es: (b: string | null, a: string | null) => `Nota ${b} en vez de ${a ?? 'sin nota'}`, en: (b: string | null, a: string | null) => `Grade ${b} instead of ${a ?? 'no grade'}` },
  sinPerdida: { es: 'Sin pérdida en vez de con pérdida', en: 'Lossless instead of lossy' },
  kbps: { es: (b: number | null, a: number | null) => `${b} kbps en vez de ${a ?? '?'}`, en: (b: number | null, a: number | null) => `${b} kbps instead of ${a ?? '?'}` },
  borrada: { es: '(playlist borrada)', en: '(deleted playlist)' },
})

export interface ImproveBatch { batchId: number; playlistId: number; playlistName: string; createdAt: string; swaps: number; undone: boolean }

const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'tta'])

interface Row { id: number; rel: string; ext: string; size: number; kbps: number | null; duration: number | null; kind: string; artist: string | null; title: string | null; grade: string | null }
const toItem = (r: Row): DupItem => ({ id: r.id, rel: r.rel, ext: r.ext, size: r.size, kbps: r.kbps, duration: r.duration, grade: r.grade, kind: r.kind, tagged: !!(r.artist && r.title), artist: r.artist, title: r.title, playlists: [] })

function isBetter(cur: Row, cand: Row): string | null {
  const gc = RANK[cur.grade ?? ''] ?? 6, gb = RANK[cand.grade ?? ''] ?? 6
  if (gb < gc) return T.nota(cand.grade, cur.grade)
  if (gb === gc && gb < 6 && LOSSLESS.has(cand.ext) && !LOSSLESS.has(cur.ext)) return T.sinPerdida
  if (gb === gc && gb < 6 && !LOSSLESS.has(cand.ext) && !LOSSLESS.has(cur.ext) && (cand.kbps ?? 0) >= (cur.kbps ?? 0) * 1.5) return T.kbps(cand.kbps, cur.kbps)
  return null
}

export class Improver {
  constructor(private db: Db) {}

  /** Qué temas de la lista tienen una versión mejor en la biblioteca. */
  propose(playlistId: number, trackIds: number[]): ImproveProposal[] {
    const sel = `SELECT f.id, f.rel_path AS rel, f.ext, f.size, f.kbps, f.duration, f.kind, f.artist, f.title, a.grade
                 FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar')`
    const all = this.db.prepare(sel).all() as unknown as Row[]
    const byKey = new Map<string, Row[]>()
    for (const r of all) {
      if (!r.artist || !r.title) continue
      const k = `${normalize(r.artist)}|${normalize(r.title)}`
      byKey.set(k, [...(byKey.get(k) ?? []), r])
    }
    const byId = new Map(all.map((r) => [r.id, r]))
    const inList = new Set(trackIds)
    const out: ImproveProposal[] = []
    for (const id of trackIds) {
      const cur = byId.get(id)
      if (!cur || !cur.artist || !cur.title) continue
      const same = (byKey.get(`${normalize(cur.artist)}|${normalize(cur.title)}`) ?? [])
        .filter((c) => c.id !== id && Math.abs((c.duration ?? 0) - (cur.duration ?? 0)) <= 3 && isBetter(cur, c))
      if (!same.length) continue
      const bestId = pickKeeper(same.map(toItem))
      const better = byId.get(bestId)!
      if (inList.has(better.id)) continue // esa versión ya está en la misma lista
      out.push({ playlistId, currentId: id, betterId: better.id, current: toItem(cur), better: toItem(better), reason: isBetter(cur, better)! })
    }
    return out
  }

  /** Cambia las versiones en la playlist (mantiene la posición) y lo anota para deshacer. */
  apply(proposals: { playlistId: number; currentId: number; betterId: number }[]): { batchId: number | null; swaps: number } {
    if (!proposals.length) return { batchId: null, swaps: 0 }
    const batchId = (this.db.prepare('SELECT COALESCE(MAX(batch_id), 0) + 1 AS n FROM improve_log').get() as { n: number }).n
    let swaps = 0
    transaction(this.db, () => {
      for (const p of proposals) {
        const row = this.db.prepare('SELECT position FROM playlist_items WHERE playlist_id = ? AND file_id = ?').get(p.playlistId, p.currentId) as { position: number } | undefined
        if (!row) continue
        if (this.db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND file_id = ?').get(p.playlistId, p.betterId)) continue
        this.db.prepare('UPDATE playlist_items SET file_id = ? WHERE playlist_id = ? AND file_id = ?').run(p.betterId, p.playlistId, p.currentId)
        this.db.prepare('INSERT INTO improve_log (batch_id, playlist_id, old_file, new_file, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(batchId, p.playlistId, p.currentId, p.betterId, row.position, new Date().toISOString())
        swaps++
      }
    })
    return { batchId: swaps ? batchId : null, swaps }
  }

  batches(): ImproveBatch[] {
    return (this.db.prepare(
      `SELECT l.batch_id AS batchId, l.playlist_id AS playlistId, p.name AS playlistName, MIN(l.created_at) AS createdAt, COUNT(*) AS swaps, MIN(l.undone_at IS NOT NULL) AS undone
       FROM improve_log l LEFT JOIN playlists p ON p.id = l.playlist_id GROUP BY l.batch_id, l.playlist_id ORDER BY l.batch_id DESC`,
    ).all() as { batchId: number; playlistId: number; playlistName: string | null; createdAt: string; swaps: number; undone: number }[]).map((b) => ({ ...b, playlistName: b.playlistName ?? T.borrada, undone: !!b.undone }))
  }

  undo(batchId: number): number {
    const rows = this.db.prepare('SELECT id, playlist_id AS playlistId, old_file AS oldFile, new_file AS newFile FROM improve_log WHERE batch_id = ? AND undone_at IS NULL').all(batchId) as
      { id: number; playlistId: number; oldFile: number; newFile: number }[]
    let n = 0
    transaction(this.db, () => {
      for (const r of rows) {
        const there = this.db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND file_id = ?').get(r.playlistId, r.newFile)
        if (there && !this.db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND file_id = ?').get(r.playlistId, r.oldFile)) {
          this.db.prepare('UPDATE playlist_items SET file_id = ? WHERE playlist_id = ? AND file_id = ?').run(r.oldFile, r.playlistId, r.newFile)
          n++
        }
        this.db.prepare('UPDATE improve_log SET undone_at = ? WHERE id = ?').run(new Date().toISOString(), r.id)
      }
    })
    return n
  }
}
