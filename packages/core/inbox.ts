// Bandeja: archivos nuevos (de la carpeta de descargas o arrastrados a la ventana) que PAILA empareja con temas de tu
// biblioteca: primero por cómo suenan (huella acústica, con los temas pedidos primero), después por tags o por el nombre
// con la duración, y si no, quedan para mirar a mano. Solo mira: reemplazar es otro paso (Replace, core/inboxflow.ts).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from './db'
import { analyzePrints } from './analysis/analyze'
import { normalize } from './duplicates'
import { matchByPrint } from './printmatch'
import { sameLength } from './soundmatch'
import { fingerprintOf } from './soundindex'
import { AUDIO_EXT } from './files'
import { probe, type ProbeResult } from './probe'
import { parsePattern } from './tagactions'
import { cleanBase, dropOpenParen, prepName } from './names'
import { sameSong } from './listmatch'
import type { InboxItem, InboxMatch, InboxMatchKind } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

/** Las notas que se ven al lado de cada archivo de la Bandeja (solo se muestran: no se escriben en ningún lado). */
const T = textos({
  noZip: { es: (m: string) => `No se pudo abrir el ZIP: ${m}`, en: (m: string) => `Couldn't open the ZIP: ${m}` },
  noLeer: { es: (m: string) => `No se pudo leer: ${m}`, en: (m: string) => `Couldn't read it: ${m}` },
  faltaba: { es: (a: string, t: string) => `Es «${a} - ${t}», un tema que te faltaba`, en: (a: string, t: string) => `It's «${a} - ${t}», a track you were missing` },
  otraVersion: {
    es: (n: string, s: number | null) => `Suena como otra versión de "${n}" (comparten ${s} s): no se reemplaza solo`,
    en: (n: string, s: number | null) => `It sounds like another version of "${n}" (they share ${s} s): it isn't replaced on its own`,
  },
  noSuenaIgual: {
    es: (n: string) => `Se llama como "${n}" pero no suena igual: escuchalos antes de hacer nada`,
    en: (n: string) => `It has the same name as "${n}" but doesn't sound the same: listen to them before you do anything`,
  },
  sePareceUnPoco: {
    es: (n: string) => `Se parece un poco a "${n}": escuchalo para saber si es el mismo tema`,
    en: (n: string) => `It sounds a bit like "${n}": listen to it to find out if it's the same track`,
  },
})

/** El tar de Windows (bsdtar) abre ZIP; si hay otro tar en el PATH (por ejemplo el de Git) no sirve. */
export const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'tta'])
const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
/** Cuántos archivos se comparan por sonido en cada vistazo (~0,3–1 s la primera vez cada uno; después queda guardado). */
const MAX_BY_SOUND = 500
/** Subcarpetas de la Bandeja donde PAILA deja lo usado y lo que no sirvió: no se vuelven a revisar. */
export const INBOX_DONE_DIRS = ['usados', 'no-sirvió']
/** Donde NAPIA aparta las copias truchas de cada lista (<lista>/descartados, core/sockseek/carpetas.ts): no se miran, en ningún nivel. */
export const INBOX_SKIP_DIRS = ['descartados']

/**
 * "Artista - Título" sacado del nombre del archivo, o null. Sin n.º de tema, prefijos de DJ ni basura de páginas de
 * descarga, y sin lo que quedó cortado al final ("Tekna [www.slider." de un pendrive con nombres cortos → "Tekna").
 */
export function nameGuess(file: string): { artist: string; title: string } | null {
  const b = path.basename(file), ext = path.extname(b)
  const rel = prepName(cleanBase(b.slice(0, b.length - ext.length)) + ext)
  // "Laura Branigan - Self Control - 05 - Spanish Eddie": el disco y el número van antes del título (uso real del 24/10: el disco le ganaba al tema)
  for (const p of ['%n% - %artista% - %titulo%', '%n%. %artista% - %titulo%', '%artista% - %album% - %n% - %titulo%', '%artista% - %titulo%']) {
    try {
      const r = parsePattern(rel, p)
      if (r?.track && !/^\d{1,3}$/.test(r.track)) continue // "Tema - 2004 - Remaster" no es un número de tema
      if (r?.artist && r.title && !/^\d{1,3}$/.test(r.artist.trim())) return { artist: r.artist.replace(/^\d{1,3}\s*[-.)_]\s*/, '').trim(), title: dropOpenParen(r.title.trim()) }
    } catch { /* sigue */ }
  }
  return null
}

/** Lo que la Bandeja necesita saber de la lista «Faltan o suenan mal» (core/wanted.ts). */
export interface WantedInfo {
  requested(): number[]
  missing(): { id: number; artist: string; title: string; refRel: string | null; duration?: number | null }[]
}

export type Match = InboxMatch & { kind: InboxMatchKind; sharedSeconds: number | null }
export interface Identified {
  artist: string | null; title: string | null
  match: Match | null
  /** Es un tema que te faltaba (de la lista): no reemplaza a nada. */
  missing: { wantedId: number; artist: string; title: string; refRel: string | null } | null
  note: string | null
}
type LibRow = { id: number; rel: string; ext: string; kbps: number | null; duration: number | null; grade: string | null }

export class Inbox {
  /** ffmpeg: para sacar la huella acústica (sin él, no se intenta). wanted: los pedidos van primero y los que faltan se reconocen. */
  constructor(private db: Db, private ffprobe: string, readonly workDir: string, private ffmpeg: string | null = null, private wanted: WantedInfo | null = null) {}

  /** Huellas ya calculadas (ruta|tamaño|fecha), para no volver a decodificar cada vez que se abre la Bandeja. */
  private printCache = new Map<string, string | null>()

  // ---------- qué archivos mirar ----------

  /** Carpetas → sus audios (hasta 3 niveles, sin `usados/` ni `no-sirvió/`), ZIP → se abren en una carpeta de trabajo, archivos → tal cual. */
  async expand(paths: string[]): Promise<string[]> {
    const out: string[] = []
    const visit = async (p: string, depth: number) => {
      if (out.length >= 800) return
      let st: fs.Stats
      try { st = fs.statSync(p) } catch { return }
      if (st.isDirectory()) {
        const name = path.basename(p).toLowerCase()
        if (depth > 3 || name === '_paila' || INBOX_SKIP_DIRS.includes(name) || (depth === 1 && INBOX_DONE_DIRS.includes(name))) return
        for (const n of fs.readdirSync(p)) if (!n.startsWith('.')) await visit(path.join(p, n), depth + 1)
      } else if (path.extname(p).toLowerCase() === '.zip') {
        const dest = this.zipDir(p, st.size)
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true })
          await new Promise<void>((resolve, reject) => execFile(TAR, ['-xf', p, '-C', dest], { windowsHide: true }, (e) => (e ? reject(new Error(T.noZip(e.message))) : resolve())))
        }
        await visit(dest, depth + 1)
      } else if (AUDIO_EXT.has(path.extname(p).slice(1).toLowerCase()) && !path.basename(p).startsWith('._')) out.push(p)
    }
    for (const p of paths) await visit(p, 0)
    return out
  }

  /** Dónde se abre un ZIP de la Bandeja (en la carpeta de trabajo; el nombre lleva el tamaño por si llega otro igual). */
  zipDir(zip: string, size = fs.statSync(zip).size): string {
    return path.join(this.workDir, `${path.basename(zip, path.extname(zip))}-${size}`)
  }

  ignored(file: string): boolean {
    const st = fs.statSync(file)
    const r = this.db.prepare('SELECT size, mtime FROM inbox_ignored WHERE path = ?').get(file) as { size: number; mtime: number } | undefined
    return !!r && r.size === st.size && r.mtime === Math.round(st.mtimeMs)
  }

  ignore(file: string) {
    const st = fs.statSync(file)
    this.db.prepare('INSERT INTO inbox_ignored (path, size, mtime) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime').run(file, st.size, Math.round(st.mtimeMs))
  }

  // ---------- emparejar ----------

  /** El vistazo rápido (sin analizar la calidad): para lo arrastrado a la ventana. */
  async inspect(paths: string[], opts: { includeIgnored?: boolean } = {}): Promise<InboxItem[]> {
    const files = (await this.expand(paths)).filter((f) => opts.includeIgnored || !this.ignored(f))
    const out: InboxItem[] = []
    let sounded = 0
    for (const file of files) {
      const ext = path.extname(file).slice(1).toLowerCase()
      let m: ProbeResult | null = null
      let note: string | null = null
      try { m = await probe(this.ffprobe, file) } catch (e) { note = T.noLeer((e as Error).message) }
      const id = m ? await this.identify(file, m, { bySound: sounded++ < MAX_BY_SOUND }) : null
      // lo que no es el mismo audio ni "probable" no se ofrece para reemplazar desde acá: queda la nota
      const match = id?.match && (id.match.kind === 'mismo' || id.match.kind === 'probable') ? id.match : null
      const item: InboxItem = {
        path: file, name: path.basename(file), ext, size: fs.statSync(file).size, kbps: m?.kbps ?? null, sampleRate: m?.sampleRate ?? null, duration: m?.duration ?? null, codec: m?.codec ?? null,
        artist: id?.artist ?? null, title: id?.title ?? null, match, looksBetter: null,
        note: note ?? id?.note ?? (id?.missing ? T.faltaba(id.missing.artist, id.missing.title) : null),
      }
      if (match) item.looksBetter = this.better(item, match)
      out.push(item)
    }
    // lo que encontró pareja primero, y dentro de eso lo que parece mejora
    return out.sort((a, b) => Number(!!b.match) - Number(!!a.match) || Number(b.looksBetter === true) - Number(a.looksBetter === true) || a.name.localeCompare(b.name))
  }

  /**
   * Con qué tema de la biblioteca se corresponde un archivo nuevo.
   * - Nivel 1, la huella (matchByPrint), comparando primero los temas pedidos y los que se llaman igual: `mismo`, `version` o `dudoso`.
   * - Nivel 2, tags o nombre del archivo + duración ±3 s (o 2 %): `probable`, solo si no se puede comparar el sonido (si se puede y
   *   no suena igual, es `dudoso`: se llama igual pero es otra cosa, como un archivo mal nombrado).
   * - Un tema que falta en tu biblioteca (de la lista) se reconoce por el nombre y no se empareja con nada.
   */
  async identify(file: string, m: ProbeResult, opts: { bySound?: boolean } = {}): Promise<Identified> {
    let artist = m.artist ?? null, title = m.title ?? null
    let by: 'tags' | 'nombre' = 'tags'
    if (!artist || !title) {
      const guess = nameGuess(file)
      if (guess) { artist = artist ?? guess.artist; title = title ?? guess.title; by = 'nombre' }
    }
    // un tema que falta se reconoce por los tags o por el nombre del archivo (los tags pueden venir de otra cosa)
    const fromName = nameGuess(file)
    const keys = new Set([artist && title ? `${normalize(artist)}|${normalize(title)}` : '', fromName ? `${normalize(fromName.artist)}|${normalize(fromName.title)}` : ''].filter(Boolean))
    // también sin el "- 2018 Remaster" de una lista de Spotify y con la duración que traía la lista (core/listmatch.ts)
    const names = [artist && title ? { artist, title } : null, fromName].filter((n): n is { artist: string; title: string } => !!n)
    const miss = keys.size ? this.wanted?.missing().find((w) => keys.has(`${normalize(w.artist)}|${normalize(w.title)}`)
      || names.some((n) => sameSong({ ...n, duration: m.duration ?? null }, w))) : undefined
    if (miss) return { artist, title, match: null, missing: { wantedId: miss.id, artist: miss.artist, title: miss.title, refRel: miss.refRel }, note: null }
    const named = artist && title ? this.find(artist, title, m.duration ?? null) : null
    const cp = opts.bySound !== false ? await this.printOf(file, m.channels ?? null) : null
    const asMatch = (r: LibRow, kind: InboxMatchKind, how: 'tags' | 'nombre' | 'sonido', shared: number | null): Match =>
      ({ fileId: r.id, rel: r.rel, ext: r.ext, kbps: r.kbps, grade: r.grade, duration: r.duration, by: how, kind, sharedSeconds: shared })
    if (cp) {
      const requested = new Set(this.wanted?.requested() ?? [])
      const found = (await matchByPrint(this.db, cp, { duration: m.duration ?? null, prefer: [...requested, ...(named ? [named.id] : [])] }))
        .map((c) => ({ c, r: this.row(c.fileId) })).filter((x): x is { c: typeof x.c; r: LibRow } => !!x.r)
      const same = found.filter((x) => x.c.kind === 'mismo')
      if (same.length) {
        // de varias copias: la pedida, y si no la de peor nota (la que más necesita la mejora)
        const pick = same.sort((a, b) => Number(requested.has(b.r.id)) - Number(requested.has(a.r.id)) || (RANK[b.r.grade ?? ''] ?? 6) - (RANK[a.r.grade ?? ''] ?? 6))[0]
        return { artist, title, match: asMatch(pick.r, 'mismo', 'sonido', pick.c.sharedSeconds), missing: null, note: null }
      }
      const v = found.find((x) => x.c.kind === 'version')
      if (v) return { artist, title, match: asMatch(v.r, 'version', 'sonido', v.c.sharedSeconds), missing: null, note: T.otraVersion(path.posix.basename(v.r.rel), v.c.sharedSeconds) }
      if (named && fingerprintOf(this.db, named.id)) {
        return { artist, title, match: asMatch(named, 'dudoso', by, null), missing: null, note: T.noSuenaIgual(path.posix.basename(named.rel)) }
      }
      const d = found.find((x) => x.c.kind === 'dudoso')
      if (d && !named) return { artist, title, match: asMatch(d.r, 'dudoso', 'sonido', d.c.sharedSeconds), missing: null, note: T.sePareceUnPoco(path.posix.basename(d.r.rel)) }
    }
    if (named) return { artist, title, match: asMatch(named, 'probable', by, null), missing: null, note: null }
    return { artist, title, match: null, missing: null, note: null }
  }

  private row(id: number): LibRow | undefined {
    return this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, f.ext, f.kbps, f.duration, a.grade FROM files f LEFT JOIN analysis a ON a.file_id = f.id
       WHERE f.id = ? AND ${visible('f')} AND f.kind IN ('musica', 'revisar')`,
    ).get(id) as LibRow | undefined
  }

  private find(artist: string, title: string, duration: number | null): LibRow | null {
    const rows = this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, f.ext, f.kbps, f.duration, f.artist, f.title, a.grade
       FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar')`,
    ).all() as unknown as (LibRow & { artist: string | null; title: string | null })[]
    const key = `${normalize(artist)}|${normalize(title)}`
    const hits = rows.filter((r) => r.artist && r.title && `${normalize(r.artist)}|${normalize(r.title)}` === key && (duration == null || r.duration == null || sameLength(r.duration, duration))) // ±3 s o 2 %, como Duplicados
    if (!hits.length) return null
    // si hay varias copias, la que más necesita la mejora (peor nota)
    return hits.sort((a, b) => (RANK[b.grade ?? ''] ?? 6) - (RANK[a.grade ?? ''] ?? 6))[0]
  }

  /** La huella acústica de un archivo de afuera (la pasada liviana, ~0,3 s; guardada mientras no cambie), o null. */
  private async printOf(file: string, channels: number | null): Promise<string | null> {
    if (!this.ffmpeg) return null
    const st = fs.statSync(file)
    const key = `${file}|${st.size}|${st.mtimeMs}`
    let cp = this.printCache.get(key)
    if (cp === undefined) {
      try { cp = (await analyzePrints({ ffmpeg: this.ffmpeg, file, channels })).chromaprint } catch { cp = null }
      this.printCache.set(key, cp)
    }
    return cp
  }

  private better(item: InboxItem, m: InboxMatch): boolean {
    const g = RANK[m.grade ?? ''] ?? 6
    if (LOSSLESS.has(item.ext) && !LOSSLESS.has(m.ext)) return true
    if (!LOSSLESS.has(item.ext) && !LOSSLESS.has(m.ext) && (item.kbps ?? 0) >= (m.kbps ?? 0) * 1.4) return true
    if (g >= 4 && LOSSLESS.has(item.ext)) return true
    return false
  }
}
