// NAPIA: lo que sockseek ya bajó de una lista, según su _index.csv (en <destino>/<nombre de la lista>/), y lo que quedó a
// medio bajar (archivos .incomplete). Con ese índice sockseek saltea lo ya bajado la próxima vez; NAPIA solo lo lee.
// Columnas: filepath,artist,album,title,length,tracktype,state,failurereason. state: 0 pendiente (no terminó), 1 bajado,
// 2 no se pudo (failurereason: 9 = nadie lo tiene, 4 = no respondieron…), 3 ya estaba, 4 no se encontró la vez anterior.
import fs from 'node:fs'
import path from 'node:path'
import { csvRows } from '../listparse'
import type { IndexSummary } from '@paila/shared/napia'

export type IndexState = 'pendiente' | 'bajado' | 'noSePudo' | 'yaEstaba' | 'noEncontradoAntes'
export interface IndexRow { path: string | null; artist: string; album: string; title: string; state: IndexState; reason: number }

const STATE: Record<string, IndexState> = { 0: 'pendiente', 1: 'bajado', 2: 'noSePudo', 3: 'yaEstaba', 4: 'noEncontradoAntes' }

export function parseIndex(text: string): IndexRow[] {
  const rows = csvRows(text)
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (n: string) => head.indexOf(n)
  const [fp, ar, al, ti, st, fr] = ['filepath', 'artist', 'album', 'title', 'state', 'failurereason'].map(col)
  if (ti < 0 || st < 0) return []
  return rows.slice(1).map((r) => ({
    path: fp >= 0 && r[fp]?.trim() ? r[fp].trim() : null,
    artist: ar >= 0 ? (r[ar] ?? '').trim() : '', album: al >= 0 ? (r[al] ?? '').trim() : '', title: (r[ti] ?? '').trim(),
    state: STATE[(r[st] ?? '').trim()] ?? 'pendiente', reason: Number(fr >= 0 ? r[fr] : 0) || 0,
  }))
}

/** Archivos .incomplete adentro de la carpeta (sockseek los deja así mientras baja; si se cortó, quedan). */
export function incompleteFiles(dir: string): string[] {
  try { return fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.toLowerCase().endsWith('.incomplete')).map((f) => path.join(dir, f)) } catch { return [] }
}

/** Resumen de lo que ya pasó con una lista en esa carpeta (null si nunca se bajó ahí). */
export const indexSummary = (listDir: string) => resumenIndice(path.join(listDir, '_index.csv'), listDir)

/** Lo mismo con el índice en otro lado (NAPIA lo guarda en sus datos) y los .incomplete en su carpeta de trabajo. */
export function resumenIndice(file: string, workDir: string): IndexSummary | null {
  let rows: IndexRow[]
  try { rows = parseIndex(fs.readFileSync(file, 'utf8')) } catch { return null }
  const n = (s: IndexState[]) => rows.filter((r) => s.includes(r.state)).length
  return { file, bajados: n(['bajado', 'yaEstaba']), noEncontrados: n(['noSePudo', 'noEncontradoAntes']), pendientes: n(['pendiente']), aMedias: incompleteFiles(workDir).length }
}
