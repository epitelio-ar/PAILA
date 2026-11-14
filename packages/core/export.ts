// Playlist → pendrive o carpeta: copia los archivos en el orden de la playlist, con nombres numerados y un .m3u8,
// para tocar en CDJ o computadoras sin Rekordbox. Convierte lo que las CDJ no leen. Copia, nunca mueve ni toca la biblioteca.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { lowPriority } from './lowpriority'
import { precheck } from './ops/checks'
import { CopyOut, copyStep } from './ops/copy'
import { type Db } from './db'
import type { ExportProgress, ExportResult } from '@paila/shared/types'
import { num, textos } from '@paila/shared/idioma'

// Lo que se ve en la pantalla. Los nombres que se escriben en el pendrive ("Playlist", "tema 3", playlist.m3u8) no se traducen.
const gbEn = (b: number) => num(b / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const T = textos({
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  yaNoEsta: { es: 'El archivo ya no está', en: 'The file is no longer there' },
  flac: { es: 'Las CDJ más viejas no leen FLAC', en: "The oldest CDJs don't play FLAC" },
  alac: { es: 'ALAC no lo leen las CDJ', en: "CDJs don't play ALAC" },
  otro: { es: (ext: string) => `Las CDJ no leen .${ext}`, en: (ext: string) => `CDJs don't play .${ext}` },
  sinConvertir: { es: (name: string, ext: string) => `${name}: formato .${ext}, puede que tu equipo no lo lea (la conversión está apagada)`, en: (name: string, ext: string) => `${name}: .${ext} format, your gear may not play it (converting is turned off)` },
  fat32: { es: 'Pesa más de 4 GB: un pendrive FAT32 no lo admite', en: "It's over 4 GB: a FAT32 USB stick can't hold it" },
  sinLugar: {
    es: (falta: number, hay: number) => `No alcanza el lugar: hacen falta ${(falta / 1e9).toFixed(2)} GB y hay ${(hay / 1e9).toFixed(2)} GB libres`,
    en: (falta: number, hay: number) => `There isn't enough space: ${gbEn(falta)} GB are needed and there are ${gbEn(hay)} GB free`,
  },
  distinto: { es: 'Ya hay un archivo con ese nombre y es distinto', en: "There's already a different file with that name" },
})

export type ExportAction = 'copy' | 'convert'
export interface ExportOptions {
  dest: string
  /** Mi equipo lee FLAC: se copian sin convertir. Si no, el FLAC pasa a AIFF. */
  keepFlac: boolean
  /** Cuando algo no lo lee la CDJ y es con pérdida (WMA, OGG, Opus…): a MP3 320. Lo sin pérdida raro (APE, WV) pasa a AIFF. */
  convert: boolean
  numbered: boolean
  /** Meter todo en una subcarpeta con el nombre de la playlist. */
  subfolder: boolean
  /** Pendrive FAT32: nombres cortos y sin caracteres raros, y avisa de archivos de más de 4 GB. */
  fat32: boolean
}
export interface ExportItem { fileId: number; src: string; rel: string; action: ExportAction; targetExt: string; outName: string; estBytes: number; why: string | null }
export interface ExportPlan {
  items: ExportItem[]
  skipped: { fileId: number; rel: string; reason: string }[]
  warnings: string[]
  totalBytes: number
  freeBytes: number | null
  copyCount: number
  convertCount: number
  folder: string
}

/** Lo que leen las CDJ (y casi cualquier equipo). */
const SAFE = new Set(['mp3', 'wav', 'aif', 'aiff', 'm4a', 'aac'])
const FAT32_MAX = 4_294_967_295
export const DEFAULT_EXPORT: Omit<ExportOptions, 'dest'> = { keepFlac: false, convert: true, numbered: true, subfolder: true, fat32: true }

const clean = (s: string, fat32: boolean) => {
  let o = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s{2,}/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '')
  if (fat32) o = o.normalize('NFC')
  return o
}

export class Exporter {
  constructor(private db: Db, private pathOf: (id: number) => string | null, private ffmpeg: string) {}

  plan(playlistName: string, trackIds: number[], o: ExportOptions): ExportPlan {
    const folder = o.subfolder ? path.join(o.dest, clean(playlistName, o.fat32) || 'Playlist') : o.dest
    const plan: ExportPlan = { items: [], skipped: [], warnings: [], totalBytes: 0, freeBytes: null, copyCount: 0, convertCount: 0, folder }
    const q = this.db.prepare('SELECT rel_path AS rel, ext, codec, size, duration, sample_rate AS sr, channels, artist, title FROM files WHERE id = ?')
    const width = String(trackIds.length).length < 3 ? 3 : String(trackIds.length).length
    const used = new Set<string>()
    let n = 0
    for (const id of trackIds) {
      const f = q.get(id) as { rel: string; ext: string; codec: string | null; size: number; duration: number | null; sr: number | null; channels: number | null; artist: string | null; title: string | null } | undefined
      const src = this.pathOf(id)
      if (!f || !src) { plan.skipped.push({ fileId: id, rel: f?.rel ?? String(id), reason: T.sinDisco }); continue }
      if (!fs.existsSync(src)) { plan.skipped.push({ fileId: id, rel: f.rel, reason: T.yaNoEsta }); continue }
      n++
      const ext = f.ext.toLowerCase()
      const alac = f.codec === 'alac'
      let action: ExportAction = 'copy', targetExt = ext, why: string | null = null
      const readable = (SAFE.has(ext) && !alac) || (ext === 'flac' && o.keepFlac)
      if (!readable && o.convert) {
        action = 'convert'
        const lossless = ['flac', 'ape', 'wv', 'tta', 'wav'].includes(ext) || alac
        targetExt = lossless ? 'aiff' : 'mp3'
        why = ext === 'flac' ? T.flac : alac ? T.alac : T.otro(ext)
      } else if (!readable) plan.warnings.push(T.sinConvertir(path.basename(f.rel), ext))
      const label = [f.artist, f.title ?? path.basename(f.rel, path.extname(f.rel))].filter(Boolean).join(' - ')
      let base = clean(label, o.fat32) || `tema ${n}`
      const prefix = o.numbered ? `${String(n).padStart(width, '0')} - ` : ''
      const max = o.fat32 ? 100 : 180
      if (prefix.length + base.length + targetExt.length + 1 > max) base = base.slice(0, max - prefix.length - targetExt.length - 1).trim()
      let outName = `${prefix}${base}.${targetExt}`
      for (let k = 2; used.has(outName.toLowerCase()); k++) outName = `${prefix}${base} (${k}).${targetExt}`
      used.add(outName.toLowerCase())
      const dur = f.duration ?? 0
      const estBytes = action === 'copy' ? f.size : targetExt === 'mp3' ? Math.round(dur * 40_000) : Math.round(dur * (f.sr ?? 44100) * (f.channels ?? 2) * 2)
      if (o.fat32 && estBytes > FAT32_MAX) { plan.skipped.push({ fileId: id, rel: f.rel, reason: T.fat32 }); n--; used.delete(outName.toLowerCase()); continue }
      plan.items.push({ fileId: id, src, rel: f.rel, action, targetExt, outName, estBytes, why })
      plan.totalBytes += estBytes
      if (action === 'copy') plan.copyCount++; else plan.convertCount++
    }
    try {
      const probeDir = fs.existsSync(o.dest) ? o.dest : path.dirname(o.dest)
      const s = fs.statfsSync(probeDir)
      plan.freeBytes = Number(s.bavail) * Number(s.bsize)
      if (plan.totalBytes > plan.freeBytes) plan.warnings.unshift(T.sinLugar(plan.totalBytes, plan.freeBytes))
    } catch { /* no se pudo medir el espacio */ }
    return plan
  }

  /**
   * Copia y convierte por el motor (ops/copy.ts): antes del primer tema, los chequeos de toda la tanda (que el pendrive siga
   * conectado y le alcance el lugar); después, cada tema por una copia temporal que recién al final toma su nombre, con su
   * renglón en el diario y en el Historial. Reanuda sin rehacer lo que ya está y nunca pisa algo distinto.
   */
  async run(plan: ExportPlan, onProgress: (p: ExportProgress) => void = () => {}, isCancelled: () => boolean = () => false): Promise<ExportResult> {
    const res: ExportResult = { copied: 0, converted: 0, skippedExisting: 0, failed: [], folder: plan.folder, m3u: null, cancelled: false }
    const outOf = (it: ExportItem) => path.join(plan.folder, it.outName)
    const steps = plan.items.map((it) => copyStep({ rootId: null, fileId: it.fileId, src: it.src, dst: outOf(it), bytes: fs.existsSync(outOf(it)) ? 0 : it.estBytes }))
    const c = precheck(this.db, steps, { rootPath: () => null })
    if (c.fatal) throw new Error(c.fatal)
    const skip = new Map(c.failed.map((f) => [f.step.dst, f.error]))
    const batch = new CopyOut(this.db, 'pendrive', plan.folder)
    fs.mkdirSync(plan.folder, { recursive: true })
    const done: string[] = []
    let i = 0
    for (const it of plan.items) {
      if (isCancelled()) { res.cancelled = true; break }
      onProgress({ done: i, total: plan.items.length, current: it.outName, errors: res.failed.length })
      const out = outOf(it)
      try {
        const why = skip.get(out)
        if (why) throw new Error(why)
        // Reanudar: si ya está del tamaño esperado (copia) o existe (conversión), se saltea. Nunca se pisa algo distinto.
        if (fs.existsSync(out)) {
          const ok = it.action === 'copy' ? fs.statSync(out).size === fs.statSync(it.src).size : fs.statSync(out).size > 0
          if (ok) { res.skippedExisting++; done.push(it.outName); i++; continue }
          throw new Error(T.distinto)
        }
        if (it.action === 'copy') {
          await batch.file({ fileId: it.fileId, src: it.src, dst: out }, (tmp) => fs.copyFileSync(it.src, tmp), fs.statSync(it.src).size)
          res.copied++
        } else {
          await batch.file({ fileId: it.fileId, src: it.src, dst: out }, (tmp) => this.convert(it.src, tmp, it.targetExt, this.tagsOf(it.fileId)))
          res.converted++
        }
        done.push(it.outName)
      } catch (e) {
        res.failed.push({ name: it.outName, error: (e as Error).message })
      }
      i++
    }
    onProgress({ done: i, total: plan.items.length, current: '', errors: res.failed.length })
    if (done.length) {
      // la lista de esta copia (la de una vez anterior en la misma carpeta se reemplaza: también era de PAILA)
      const m3u = path.join(plan.folder, 'playlist.m3u8')
      batch.write({ dst: m3u, replace: true }, ['#EXTM3U', ...done].join('\r\n') + '\r\n')
      res.m3u = m3u
    }
    return res
  }

  /** Los tags de la biblioteca (PAILA los conoce aunque el original sea Ogg/WMA, donde ffmpeg no siempre los pasa solo). */
  private tagsOf(fileId: number): string[] {
    const r = this.db.prepare('SELECT artist, album_artist AS albumArtist, title, album, track, year, genre FROM files WHERE id = ?').get(fileId) as Record<string, string | null> | undefined
    if (!r) return []
    const map: Record<string, string> = { artist: 'artist', albumArtist: 'album_artist', title: 'title', album: 'album', track: 'track', year: 'date', genre: 'genre' }
    return Object.entries(map).filter(([k]) => r[k]).flatMap(([k, ff]) => ['-metadata', `${ff}=${r[k]}`])
  }

  private convert(src: string, out: string, ext: string, tags: string[]): Promise<void> {
    const args = ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-i', src, '-map', '0:a:0', '-map', '0:v?', '-map_metadata', '0', ...tags, '-c:v', 'copy', '-disposition:v', 'attached_pic']
    if (ext === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3', '-f', 'mp3')
    else args.push('-c:a', 'pcm_s16be', '-write_id3v2', '1', '-f', 'aiff')
    args.push(out)
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      lowPriority(p.pid)
      let err = ''
      p.stderr.on('data', (d) => { err += d })
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg terminó con código ${code}`))))
    })
  }
}
