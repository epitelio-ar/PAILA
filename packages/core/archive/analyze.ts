// Leer y analizar los temas de adentro de un ZIP o un RAR sin abrirlo entero: se saca un tema por vez (o una tanda chica,
// en un rar "sólido") a una carpeta temporal, se leen sus tags, la nota de calidad, el BPM y el tono, y se borra enseguida.
// El disco nunca guarda más que unos pocos temas a la vez.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { probe } from '../probe'
import { extOf } from '../files'
import { isLossless } from '../queue'
import { gradeEnLosDos } from '../analysis/grade'
import { guardarOtroZip, type OtroIdioma } from '../textosidioma'
import type { AnalysisRunner } from '../analysis/pool'
import { extractEntries, type LibRunner } from './read'
import type { Archives } from '../archives'
import type { ArchiveReadResult } from '@paila/shared/types'

export interface ReadDeps {
  ffprobe: string
  ffmpeg: string
  /** Sin esto se leen solo los tags (sin nota, BPM ni tono). */
  analysis: AnalysisRunner | null
  lib?: LibRunner
  /** Carpeta temporal (se crea y se vacía sola). */
  tmpDir: string
}

/** Lo que se saca junto en un rar sólido (cada pasada vuelve a leer desde el principio: tandas grandes, pocas pasadas). */
const SOLID_BATCH = 400 * 1024 * 1024

/**
 * Lee los temas de los comprimidos pedidos que todavía no se leyeron (`again`: también los ya leídos). Los sample packs, los
 * que tienen clave y los rotos se saltean.
 */
export async function readArchives(arch: Archives, ids: number[], deps: ReadDeps, on: { progress?: (done: number, total: number, current: string) => void; cancelled?: () => boolean } = {}, again = false): Promise<ArchiveReadResult> {
  const res: ArchiveReadResult = { archives: 0, read: 0, errors: 0 }
  const todo: { archiveId: number; entries: { id: number; idx: number; name: string; size: number }[] }[] = []
  for (const id of ids) {
    const a = arch.db.prepare("SELECT sample_pack AS sp, status FROM archives WHERE id = ? AND missing_at IS NULL").get(id) as { sp: number; status: string } | undefined
    if (!a || a.sp || a.status !== 'ok') continue
    const es = arch.db.prepare(`SELECT id, idx, name, size FROM archive_entries WHERE archive_id = ? AND audio = 1 AND blocked IS NULL ${again ? '' : 'AND read_at IS NULL'} ORDER BY idx`).all(id) as { id: number; idx: number; name: string; size: number }[]
    if (es.length) todo.push({ archiveId: id, entries: es })
  }
  const total = todo.reduce((s, t) => s + t.entries.length, 0)
  let done = 0
  const ac = new AbortController()
  const dir = path.join(deps.tmpDir, `leer-${crypto.randomBytes(4).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    for (const t of todo) {
      if (on.cancelled?.()) break
      let opened
      try { opened = arch.open(t.archiveId) } catch (e) { res.errors += t.entries.length; done += t.entries.length; mark(arch, t.entries.map((x) => x.id), (e as Error).message); continue }
      res.archives++
      // en un rar sólido van juntos (una pasada por tanda); si no, de a uno
      const batches: (typeof t.entries)[] = []
      for (const e of t.entries) {
        const b = batches[batches.length - 1]
        if (opened.listing.solid && b && b.reduce((s, x) => s + x.size, 0) + e.size <= SOLID_BATCH) b.push(e); else batches.push([e])
      }
      for (const b of batches) {
        if (on.cancelled?.()) break
        on.progress?.(done, total, `${path.posix.basename(opened.row.rel)}: ${path.posix.basename(b[0].name)}`)
        const dests = b.map((e) => ({ e, dest: path.join(dir, `${e.idx}.${extOf(e.name) || 'bin'}`) }))
        let out: { index: number; error: string | null }[]
        try { out = await extractEntries(opened.listing, dests.map((d) => ({ index: d.e.idx, dest: d.dest })), { runner: deps.lib, signal: ac.signal }) } catch (e) {
          out = dests.map((d) => ({ index: d.e.idx, error: (e as Error).message }))
        }
        for (const [k, d] of dests.entries()) {
          if (on.cancelled?.()) break
          on.progress?.(done, total, `${path.posix.basename(opened.row.rel)}: ${path.posix.basename(d.e.name)}`)
          try {
            if (out[k].error) throw new Error(out[k].error!)
            await readOne(arch, d.e.id, d.dest, d.e.name, deps)
            res.read++
          } catch (e) { res.errors++; mark(arch, [d.e.id], (e as Error).message) } finally { fs.rmSync(d.dest, { force: true }) }
          done++
        }
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  on.progress?.(done, total, '')
  return res
}

function mark(arch: Archives, ids: number[], error: string) {
  const st = arch.db.prepare('UPDATE archive_entries SET error = ?, read_at = ? WHERE id = ?')
  for (const id of ids) st.run(error, new Date().toISOString(), id)
}

/** Tags, nota de calidad, BPM y tono de un tema ya sacado a `file`. */
async function readOne(arch: Archives, entryId: number, file: string, name: string, deps: ReadDeps) {
  const m = await probe(deps.ffprobe, file)
  const ext = extOf(name)
  let g: { grade: string; is: string; why: string[]; otro: OtroIdioma } | null = null, bpm: number | null = null, key: string | null = null
  if (deps.analysis) {
    const info = { codec: m.codec, ext, lossless: isLossless(m.codec, ext), kbps: m.kbps, sampleRate: m.sampleRate, bits: m.bits, channels: m.channels }
    const raw = await deps.analysis.full({ ffmpeg: deps.ffmpeg, file, ...info, duration: m.duration, withDj: (m.duration ?? 0) <= 20 * 60, withPrints: false })
    const v = gradeEnLosDos(info, raw)
    // la etiqueta y el porqué también en el otro idioma: al cambiar de idioma se intercambian (core/textosidioma.ts)
    g = { grade: v.grade, is: v.is, why: v.why, otro: v.otro }
    bpm = raw.dj?.bpm != null ? Math.round(raw.dj.bpm * 10) / 10 : null
    key = raw.dj?.camelot ?? raw.dj?.key ?? null
  }
  arch.db.prepare(`UPDATE archive_entries SET codec = ?, sample_rate = ?, bits = ?, channels = ?, kbps = ?, duration = ?, artist = ?, title = ?, album = ?,
    track = ?, year = ?, genre = ?, grade = ?, grade_is = ?, grade_why = ?, bpm = ?, musical_key = ?, read_at = ?, error = NULL WHERE id = ?`)
    .run(m.codec, m.sampleRate, m.bits, m.channels, m.kbps, m.duration, m.albumArtist && !m.artist ? m.albumArtist : m.artist, m.title, m.album, m.track,
      m.year, m.genre, g?.grade ?? null, g?.is ?? null, g ? JSON.stringify(g.why) : null, bpm, key, new Date().toISOString(), entryId)
  guardarOtroZip(arch.db, entryId, g?.otro ?? null) // la etiqueta y el porqué en el otro idioma (core/textosidioma.ts)
}
