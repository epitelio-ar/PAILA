// "Llevar la música" al celular: copia una playlist (o los temas elegidos) a una carpeta, convirtiendo a AAC o MP3 lo que
// ocupa mucho o el celular no lee, con tags y tapa. Lo que ya es chico y compatible se copia tal cual (reconvertirlo solo
// lo empeora). Los originales nunca se tocan: se lee de la biblioteca y se escribe solo en el destino. Reanudable.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Db } from './db'
import { probe } from './probe'
import { checkSameAudio, hashBefore, readCover, writeTags, type TagField } from './tagio'
import { FOLDER_NAMES, findFile } from './foldercover'
import { imageInfo } from './coverstore'
import crypto from 'node:crypto'
import { lowPriority } from './lowpriority'
import { precheck } from './ops/checks'
import { CopyOut, copyStep } from './ops/copy'
import type { PhoneOptions, PhonePlan, PhoneItem, PhoneResult, PhoneQuality, PhoneFormat, PhoneTarget } from '@paila/shared/types'
import { T } from './carry.textos'

/** kbps de cada calidad (un techo: lo que ya pesa menos no se agranda). AAC rinde más por kbps: a 256 ya no se distingue del original. */
export const PHONE_KBPS: Record<PhoneFormat, Record<Exclude<PhoneQuality, 'original'>, number>> = {
  aac: { chica: 128, normal: 192, alta: 256 },
  mp3: { chica: 128, normal: 192, alta: 320 },
}
export const DEFAULT_PHONE: Omit<PhoneOptions, 'dest'> = { format: 'aac', quality: 'normal', layout: 'lista', numbered: true }

const LOSSLESS = new Set(['flac', 'wav', 'aif', 'aiff', 'ape', 'wv', 'tta', 'dsf', 'dff'])
/** Lo que muchos celulares no reproducen (sin una app aparte): con "Original" se copia igual, pero se avisa. */
const PHONE_UNFRIENDLY = new Set(['wma', 'asf', 'aif', 'aiff', 'ape', 'wv', 'tta', 'dsf', 'dff'])
/** Margen para no reconvertir un MP3 de 200 kbps a 192: casi no ahorra y suena peor. */
const SLACK = 1.15

/** Lo que Windows y los celulares no aceptan en un nombre; también los puntos y espacios del final. */
export const cleanName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s{2,}/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').normalize('NFC')
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s)

interface Row { rel: string; ext: string; codec: string | null; size: number; duration: number | null; kbps: number | null; artist: string | null; albumArtist: string | null; title: string | null; album: string | null; track: string | null; year: string | null; genre: string | null }

/**
 * Qué hacer con un tema: copiarlo tal cual o convertirlo, y por qué (pura, para los tests). La calidad elegida es un
 * techo: solo se achica lo que pesa más; lo que ya está en menor calidad se copia como está (o, si el celular no lo lee,
 * se convierte sin pasarse de los kbps que ya tenía). Nunca se agranda un tema: no suena mejor y ocupa más.
 */
export function decide(f: Pick<Row, 'ext' | 'codec' | 'size' | 'duration' | 'kbps'>, format: PhoneFormat, quality: PhoneQuality): { action: 'copy' | 'convert'; kbps: number | null; why: string; unfriendly?: boolean } {
  const ext = f.ext.toLowerCase()
  const src = f.kbps ?? (f.duration ? Math.round((f.size * 8) / f.duration / 1000) : null)
  if (quality === 'original') {
    if (PHONE_UNFRIENDLY.has(ext)) return { action: 'copy', kbps: src, why: T.originalOjo(ext), unfriendly: true }
    return { action: 'copy', kbps: src, why: T.original }
  }
  const target = PHONE_KBPS[format][quality]
  const lossless = LOSSLESS.has(ext) || f.codec === 'alac'
  const aac = (ext === 'm4a' || ext === 'aac' || ext === 'mp4') && f.codec === 'aac'
  if (lossless) return { action: 'convert', kbps: target, why: T.sinPerdida(ext === 'm4a' ? 'ALAC' : ext.toUpperCase(), target) }
  if (ext === 'mp3' || aac) {
    if (src == null || src <= target * SLACK) return { action: 'copy', kbps: src, why: T.yaEs(aac ? 'AAC' : 'MP3', src) }
    return { action: 'convert', kbps: target, why: T.seAchica(aac ? 'AAC' : 'MP3', src, target, Math.round((1 - target / src) * 100)) }
  }
  // OGG, Opus, WMA…: muchos celulares no los leen. Si ya venían finitos, se quedan finitos: nunca se agranda.
  const kbps = src ? Math.min(target, Math.max(64, Math.floor(src / 16) * 16)) : target
  return { action: 'convert', kbps, why: T.noLeen(ext, format === 'aac' ? 'AAC' : 'MP3', kbps) }
}

export class PhoneCopier {
  constructor(private db: Db, private pathOf: (id: number) => string | null, private ffmpeg: string, private ffprobe: string,
    /** Las carpetas de la biblioteca conectadas hoy: el destino nunca puede caer adentro. */
    private rootPaths: () => string[],
    /** Al celular por cable: acá se convierte primero (una carpeta por celular y destino, así se puede retomar). */
    private stagingRoot = path.join(os.tmpdir(), 'PAILA-celular')) {}

  /** La carpeta temporal donde se prepara lo que va a un celular. */
  staging(t: PhoneTarget): string {
    return path.join(this.stagingRoot, crypto.createHash('md5').update(`${t.id}|${t.storage}|${t.folder}`).digest('hex').slice(0, 12))
  }

  plan(name: string, trackIds: number[], o: PhoneOptions): PhonePlan {
    const listName = cleanName(name) || 'Playlist'
    const dest = o.device ? this.staging(o.device) : o.dest
    const folder = path.join(dest, listName)
    const plan: PhonePlan = { name: listName, folder, items: [], skipped: [], warnings: [], totalBytes: 0, srcBytes: 0, freeBytes: null, copyCount: 0, convertCount: 0 }
    const q = this.db.prepare(`SELECT rel_path AS rel, ext, codec, size, duration, kbps, artist, album_artist AS albumArtist, title, album, track, year, genre
      FROM files WHERE id = ? AND trashed_at IS NULL`)
    const width = Math.max(3, String(trackIds.length).length)
    const used = new Set<string>()
    const seen = new Set<number>()
    let n = 0, unfriendly = 0
    for (const id of trackIds) {
      if (seen.has(id)) continue // el mismo tema dos veces en la lista: una sola copia (el .m3u8 lo repite igual)
      seen.add(id)
      const f = q.get(id) as Row | undefined
      const src = this.pathOf(id)
      if (!f) { plan.skipped.push({ fileId: id, rel: String(id), reason: T.yaNoEnBiblioteca }); continue }
      if (!src) { plan.skipped.push({ fileId: id, rel: f.rel, reason: T.sinDisco }); continue }
      if (!fs.existsSync(src)) { plan.skipped.push({ fileId: id, rel: f.rel, reason: T.yaNoEsta }); continue }
      n++
      const d = decide(f, o.format, o.quality)
      if (d.unfriendly) unfriendly++
      const ext = d.action === 'copy' ? f.ext.toLowerCase() : o.format === 'aac' ? 'm4a' : 'mp3'
      const fileBase = path.basename(f.rel, path.extname(f.rel))
      let dir: string, base: string
      if (o.layout === 'discos') {
        const artist = cut(cleanName(f.albumArtist || f.artist || '') || 'Artista desconocido', 60)
        const album = f.album ? cut(cleanName(f.album), 80) : ''
        const tn = parseInt(f.track ?? '', 10)
        dir = album ? `${artist}/${album}` : artist
        base = album ? `${tn > 0 ? `${String(tn).padStart(2, '0')} - ` : ''}${cleanName(f.title || fileBase)}`
          : cleanName([f.artist, f.title || fileBase].filter(Boolean).join(' - '))
      } else {
        dir = ''
        base = `${o.numbered ? `${String(n).padStart(width, '0')} - ` : ''}${cleanName([f.artist, f.title || fileBase].filter(Boolean).join(' - '))}`
      }
      base = cut(base || `tema ${n}`, 120)
      let outRel = dir ? `${dir}/${base}.${ext}` : `${base}.${ext}`
      for (let k = 2; used.has(outRel.toLowerCase()); k++) outRel = dir ? `${dir}/${base} (${k}).${ext}` : `${base} (${k}).${ext}`
      used.add(outRel.toLowerCase())
      const estBytes = d.action === 'copy' ? f.size : Math.round(((f.duration ?? 0) * d.kbps! * 1000) / 8) + 60_000
      const item: PhoneItem = { fileId: id, rel: f.rel, action: d.action, outRel, kbps: d.kbps, estBytes, srcBytes: f.size, why: d.why }
      plan.items.push(item)
      plan.totalBytes += estBytes; plan.srcBytes += f.size
      if (d.action === 'copy') plan.copyCount++; else plan.convertCount++
    }
    if (unfriendly) plan.warnings.push(T.formatosRaros(unfriendly))
    try {
      const probeDir = [dest, path.dirname(dest), this.stagingRoot, path.dirname(this.stagingRoot)].slice(0, o.device ? 4 : 2).find((p) => fs.existsSync(p))
      if (probeDir) {
        const s = fs.statfsSync(probeDir)
        plan.freeBytes = Number(s.bavail) * Number(s.bsize)
        if (plan.totalBytes > plan.freeBytes) plan.warnings.unshift(o.device ? T.sinLugarCompu(plan.totalBytes, plan.freeBytes) : T.sinLugar(plan.totalBytes, plan.freeBytes))
      }
    } catch { /* no se pudo medir el espacio */ }
    if (o.device) plan.deviceFolder = [o.device.name, o.device.storage, ...folderParts(o.device.folder), listName].join(' › ')
    else if (this.inside(o.dest)) { plan.insideLibrary = true; plan.warnings.unshift(T.dentroAviso) }
    return plan
  }

  /** ¿El destino cae dentro de una carpeta de la biblioteca? */
  private inside(dest: string): boolean {
    const d = path.resolve(dest).toLowerCase() + path.sep
    return this.rootPaths().some((r) => d.startsWith(path.resolve(r).toLowerCase() + path.sep))
  }

  /**
   * Copia y convierte. `concurrency` se vuelve a mirar en cada tema (la intensidad elegida puede cambiar en el medio) y
   * mientras `paused()` sea verdadero espera (Tranqui a batería). Nunca pisa un archivo distinto que ya esté.
   */
  async run(plan: PhonePlan, opts: {
    onProgress?: (p: { done: number; total: number; current: string; errors: number }) => void
    isCancelled?: () => boolean
    concurrency?: () => number
    paused?: () => boolean
    /** La tanda del Historial (al celular por cable, una sin anotar: lo que llega al celular se anota después). */
    copies?: CopyOut
  } = {}): Promise<PhoneResult> {
    const onProgress = opts.onProgress ?? (() => {}), isCancelled = opts.isCancelled ?? (() => false)
    const res: PhoneResult = { copied: 0, converted: 0, skippedExisting: 0, failed: [], notes: [], folder: plan.folder, m3u: null, cancelled: false }
    if (this.inside(plan.folder)) throw new Error(T.dentro)
    // los chequeos de toda la tanda (el motor, ops/checks.ts): que el destino siga conectado y le alcance el lugar
    const outOf = (it: PhoneItem) => path.join(plan.folder, ...it.outRel.split('/'))
    const c = precheck(this.db, plan.items.map((it) => copyStep({ rootId: null, fileId: it.fileId, src: null, dst: outOf(it), bytes: fs.existsSync(outOf(it)) ? 0 : it.estBytes })), { rootPath: () => null })
    if (c.fatal) throw new Error(c.fatal)
    const copies = opts.copies ?? new CopyOut(this.db, 'celular', plan.folder)
    fs.mkdirSync(plan.folder, { recursive: true })
    const ok = new Set<number>()
    let next = 0, finished = 0, active = 0
    const report = (current: string) => onProgress({ done: finished, total: plan.items.length, current, errors: res.failed.length })
    // por el motor (ops/copy.ts): diario, una copia temporal con la extensión real (la librería de tags la necesita) que recién
    // al final toma su nombre, y su renglón en el Historial
    const one = async (it: PhoneItem) => {
      const out = outOf(it)
      try {
        if (fs.existsSync(out)) {
          if (!this.alreadyThere(out, it)) throw new Error(T.noSePisa)
          res.skippedExisting++; ok.add(it.fileId); return
        }
        const src = this.pathOf(it.fileId)
        if (!src || !fs.existsSync(src)) throw new Error(T.sinDiscoOArchivo)
        await copies.file({ fileId: it.fileId, src, dst: out }, async (tmp) => {
          if (it.action === 'copy') {
            fs.copyFileSync(src, tmp)
            if (fs.statSync(tmp).size !== fs.statSync(src).size) throw new Error(T.incompleta)
            const note = await this.folderCoverOnCopy(src, tmp)
            if (note) res.notes.push({ name: it.outRel, note })
          } else {
            const note = await this.convert(src, tmp, it)
            if (note) res.notes.push({ name: it.outRel, note })
          }
        })
        if (it.action === 'copy') res.copied++; else res.converted++
        ok.add(it.fileId)
      } catch (e) {
        res.failed.push({ name: it.outRel, error: (e as Error).message })
      }
    }
    await new Promise<void>((resolve) => {
      const pump = () => {
        if (isCancelled()) res.cancelled = true
        if (res.cancelled || next >= plan.items.length) { if (active === 0) resolve(); return }
        if (opts.paused?.()) { if (active === 0) setTimeout(pump, 1000); return }
        const limit = Math.max(1, Math.min(4, opts.concurrency?.() ?? 1))
        while (active < limit && next < plan.items.length && !opts.paused?.()) {
          const it = plan.items[next++]
          active++
          report(it.outRel)
          void one(it).finally(() => { active--; finished++; report(''); pump() })
        }
      }
      pump()
    })
    report('')
    // la playlist con lo que quedó, en el orden original, con rutas relativas y / (la leen Android, iPhone y la PC)
    const done = plan.items.filter((it) => ok.has(it.fileId))
    if (done.length) {
      const durs = this.db.prepare('SELECT duration, artist, title FROM files WHERE id = ?')
      const lines = ['#EXTM3U']
      for (const it of done) {
        const r = durs.get(it.fileId) as { duration: number | null; artist: string | null; title: string | null }
        lines.push(`#EXTINF:${Math.round(r.duration ?? -1)},${[r.artist, r.title].filter(Boolean).join(' - ') || path.basename(it.outRel)}`)
        lines.push(it.outRel)
      }
      res.m3u = path.join(plan.folder, `${plan.name}.m3u8`)
      // la de una vez anterior en la misma carpeta se reemplaza: también era de PAILA
      copies.write({ dst: res.m3u, replace: true }, lines.join('\r\n') + '\r\n')
    }
    return res
  }

  /** Los tags que conoce PAILA (los que ve el usuario): mandan sobre los del archivo. */
  private known(fileId: number): Partial<Record<TagField, string | null>> {
    const r = this.db.prepare('SELECT artist, album_artist AS albumArtist, title, album, track, year, genre FROM files WHERE id = ?').get(fileId) as Record<TagField, string | null> | undefined
    if (!r) return {}
    // "B1" o "A2" (la cara del vinilo) no es un número de pista: escribirlo lo borraría; se deja el que pasa ffmpeg
    const numeric = (k: string, v: string) => (k !== 'track' && k !== 'year') || /^\d/.test(v.trim())
    return Object.fromEntries(Object.entries(r).filter(([k, v]) => v != null && String(v).trim() !== '' && numeric(k, String(v)))) as Partial<Record<TagField, string | null>>
  }

  /** La tapa: la embebida en el original o, si no tiene, la de la carpeta (cover.jpg, folder.jpg…). */
  private cover(src: string): string | null {
    try { const c = readCover(src); if (c) return c } catch { /* formato sin tags legibles (WMA, WAV raro): se prueba la carpeta */ }
    for (const name of FOLDER_NAMES) {
      const f = findFile(path.dirname(src), name)
      if (!f) continue
      const bytes = fs.readFileSync(f)
      const info = imageInfo(bytes)
      if (info) return JSON.stringify({ mime: info.mime, data: bytes.toString('base64') })
    }
    return null
  }

  private async convert(src: string, tmp: string, it: PhoneItem) {
    const sr = await probe(this.ffprobe, src)
    const args = ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-i', src, '-map', '0:a:0', '-vn', '-map_metadata', '0']
    // 44,1 o 48 kHz y estéreo: lo que reproduce cualquier celular (más no se oye en un archivo con pérdida)
    if (sr.sampleRate && sr.sampleRate !== 44100 && sr.sampleRate !== 48000) args.push('-ar', sr.sampleRate % 48000 === 0 ? '48000' : '44100')
    if ((sr.channels ?? 2) > 2) args.push('-ac', '2')
    if (tmp.endsWith('.m4a')) args.push('-c:a', 'aac', '-b:a', `${it.kbps}k`, '-movflags', '+faststart', '-f', 'mp4')
    else args.push('-c:a', 'libmp3lame', '-b:a', `${it.kbps}k`, '-id3v2_version', '3', '-f', 'mp3')
    await ffmpegRun(this.ffmpeg, [...args, tmp])
    // tags y tapa con la librería de tags (ffmpeg no siempre los pasa entre formatos distintos)
    const change: Partial<Record<TagField | 'cover', string | null>> = this.known(it.fileId)
    const c = this.cover(src)
    if (c) change.cover = c
    if (Object.keys(change).length) {
      try { writeTags(tmp, change) } catch (e) { throw new Error(T.sinTags((e as Error).message)) }
    }
    // dura lo mismo (el AAC agrega unos milisegundos de arranque)
    const after = await probe(this.ffprobe, tmp)
    if (sr.duration != null && after.duration != null && Math.abs(sr.duration - after.duration) <= 1) return null
    // Si no: puede que el original ya esté cortado (dice durar más de lo que se puede escuchar). Se mide escuchándolo entero.
    const real = await decodedSeconds(this.ffmpeg, src)
    if (real != null && after.duration != null && Math.abs(real - after.duration) <= 1) {
      return T.cortado(mmss(real), mmss(sr.duration ?? 0))
    }
    throw new Error(T.noDura(sr.duration?.toFixed(1) ?? '?', after.duration?.toFixed(1) ?? '?'))
  }

  /** Lo que ya está en el destino es lo que se iba a dejar (para retomar sin rehacer). Una copia puede tener la tapa agregada. */
  private alreadyThere(out: string, it: PhoneItem): boolean {
    const size = fs.statSync(out).size
    if (it.action === 'convert') return size > 0
    if (size === it.srcBytes) return true
    if (size < it.srcBytes || size - it.srcBytes > 16e6) return false
    try { return !!readCover(out) } catch { return false }
  }

  /**
   * Un tema que se copia tal cual pero no tiene tapa adentro, y sí hay una imagen en su carpeta (cover.jpg, folder.jpg…):
   * se le pone en la copia (el celular no mira la carpeta). Se verifica que el sonido quede idéntico; si algo falla, queda
   * la copia sin tapa, que es igual al original. El original no se toca.
   */
  private async folderCoverOnCopy(src: string, tmp: string): Promise<string | null> {
    if (/\.(wma|asf|wmv)$/i.test(src)) return null
    try { if (readCover(src)) return null } catch { return null }
    const c = this.cover(src)
    if (!c) return null
    try {
      const before = await hashBefore(this.ffmpeg, tmp)
      writeTags(tmp, { cover: c })
      await checkSameAudio(this.ffmpeg, tmp, before, { es: 'ponerle la tapa a la copia', en: 'adding the cover to the copy' })
      return T.tapaCarpeta
    } catch {
      fs.copyFileSync(src, tmp)
      return null
    }
  }
}

/** "Music/Viajes" → ["Music", "Viajes"], con nombres que el celular acepta. */
export const folderParts = (folder: string) => folder.split(/[\\/]+/).map(cleanName).filter(Boolean)

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Cuánto se puede escuchar de verdad: decodifica el archivo entero y lee hasta dónde llegó. */
function decodedSeconds(bin: string, file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(bin, ['-nostdin', '-hide_banner', '-threads', '1', '-i', file, '-map', '0:a:0', '-f', 'null', '-'], { windowsHide: true })
    lowPriority(p.pid)
    let err = ''
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000) })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const m = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop()
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null)
    })
  })
}

function ffmpegRun(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    lowPriority(p.pid)
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).pop() || `ffmpeg terminó con código ${code}`))))
  })
}
