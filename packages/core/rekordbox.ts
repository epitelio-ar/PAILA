// Rekordbox: exportar la biblioteca y las playlists a rekordbox.xml (el camino oficial: PAILA no toca la base interna de Rekordbox),
// con TrackID fijo, grilla, cue points, estrellas, color y "my tags" (core/djdata.ts); perfiles de compatibilidad con equipos
// de DJ y registro de qué temas ya se exportaron (para avisar antes de moverlos o reemplazarlos).
import path from 'node:path'
import { transaction, visible, type Db } from './db'
import type { Playlists } from './playlists'
import { DjData } from './djdata'
import { CopyOut, backupStamp, checkOut, keepCopy } from './ops/copy'
import type { DeviceProfile, DjCue, PlaylistNode, RekordboxResult } from '@paila/shared/types'
import type { GridSegment } from './analysis/grid'
import { textos } from '@paila/shared/idioma'

// Lo que se ve en la pantalla (lo que va adentro del rekordbox.xml no se traduce)
const T = textos({
  cdjViejas: { es: 'CDJ-2000 / CDJ-2000nexus (las más viejas)', en: 'CDJ-2000 / CDJ-2000nexus (the oldest)' },
  cdjViejasNota: { es: 'No leen FLAC ni ALAC.', en: "They don't play FLAC or ALAC." },
  nxs2Nota: { es: 'Leen FLAC y ALAC, pero conviene probar un tema antes del show.', en: "They play FLAC and ALAC, but it's worth testing a track before the show." },
  cdj3000Nota: { es: 'Aceptan archivos de hasta 96 kHz.', en: 'They take files up to 96 kHz.' },
  soloRb: { es: 'Solo Rekordbox en la compu', en: 'Rekordbox on the computer only' },
  soloRbNota: { es: 'Rekordbox no lee WMA, OGG ni Opus.', en: "Rekordbox doesn't play WMA, OGG or Opus." },
  formatoNadie: { es: (ext: string) => `Formato .${ext}: ni Rekordbox ni las CDJ lo leen`, en: (ext: string) => `.${ext} format: neither Rekordbox nor the CDJs play it` },
  alac: { es: 'ALAC: este equipo no lo lee', en: "ALAC: this gear doesn't play it" },
  formatoEquipo: { es: (ext: string) => `Formato .${ext}: este equipo no lo lee`, en: (ext: string) => `.${ext} format: this gear doesn't play it` },
  khz: { es: (k: number, max: number) => `${k} kHz: este equipo llega hasta ${max} kHz`, en: (k: number, max: number) => `${k} kHz: this gear goes up to ${max} kHz` },
  noLoLee: { es: (ext: string, app: string) => `.${ext}: ${app} no lo lee (convertilo con "A pendrive o carpeta…")`, en: (ext: string, app: string) => `.${ext}: ${app} doesn't play it (convert it with "To a USB stick or folder…")` },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  desaparecido: { es: 'Desaparecido: no se encontró en el último escaneo', en: "Missing: it wasn't found in the last scan" },
})

export interface RekordboxOptions {
  /** 'todo': toda la Música; 'playlists': solo los temas que están en las playlists elegidas. */
  scope: 'todo' | 'playlists'
  playlistIds: number[] // vacío = todas
  dest: string // archivo .xml
  /** Grilla (TEMPO) de los temas que la tienen. Por defecto sí. */
  grid?: boolean
  /** Cues sugeridos por PAILA en los temas sin cues de Rekordbox ni de Serato. Por defecto no. */
  suggestedCues?: boolean
  /** En los temas que se mueven, la grilla variable de PAILA aunque Rekordbox o Serato tengan una fija. Por defecto no. */
  pailaWhenMoving?: boolean
}

/** Formatos que Rekordbox NO lee: no entran al XML (se avisa para convertirlos). */
export const RB_UNSUPPORTED = new Set(['wma', 'ogg', 'oga', 'opus', 'webm', 'ape', 'wv', 'tta', 'mka', 'dsf', 'dff'])
/**
 * El formato de verdad de un archivo: por su extensión, salvo que el escaneo haya leído Opus o Vorbis adentro de algo que se llama
 * ".mp3" (un WebM de YouTube con un ID3 pegado adelante: PAILA lo trata como MP3 para escribirle los tags, pero ningún equipo de
 * DJ lo toca). Esos cuentan como "opus" u "ogg", que es lo que son.
 */
export function formatoReal(ext: string, codec: string | null): string {
  const e = ext.toLowerCase()
  if (codec === 'opus' && e !== 'ogg' && e !== 'oga') return 'opus'
  if (codec === 'vorbis' && e !== 'ogg' && e !== 'oga') return 'ogg'
  return e
}
const KIND: Record<string, string> = { mp3: 'MP3 File', wav: 'WAV File', aif: 'AIFF File', aiff: 'AIFF File', m4a: 'M4A File', aac: 'M4A File', alac: 'M4A File', flac: 'FLAC File' }

/** Orientativo: cada modelo y versión de firmware varía. Hay que confirmarlo en el manual del equipo. */
export const DEVICES: DeviceProfile[] = [
  { id: 'cdj-viejas', get label() { return T.cdjViejas }, formats: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif'], maxSampleRate: 48000, get note() { return T.cdjViejasNota } },
  { id: 'cdj-nxs2', label: 'CDJ-2000NXS2 / XDJ-1000MK2 / XDJ-RX2 / XDJ-RX3', formats: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif', 'flac'], maxSampleRate: 48000, get note() { return T.nxs2Nota } },
  { id: 'cdj-3000', label: 'CDJ-3000 / Opus Quad / XDJ-XZ', formats: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif', 'flac'], maxSampleRate: 96000, get note() { return T.cdj3000Nota } },
  { id: 'rekordbox', get label() { return T.soloRb }, formats: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif', 'flac'], maxSampleRate: 96000, get note() { return T.soloRbNota } },
]

/** `maxKhz`: solo cuando el problema es la frecuencia de muestreo (hasta cuánto llega el equipo); la pantalla los agrupa con eso. */
export interface CompatIssue { fileId: number; rel: string; reason: string; maxKhz?: number }

/** Qué va en la grilla y los cues de un exporte. */
export interface MarkOptions { grid?: boolean; suggestedCues?: boolean; pailaWhenMoving?: boolean }
/** La grilla y los cues de un tema, en segundos del tiempo de Rekordbox. */
export interface DjMarks { grid: { bpm: number; segments: GridSegment[] } | null; cues: DjCue[] }
/** Lo elegido para un exporte: las playlists (y carpetas) que van, sus temas (solo los que entran) y cada tema con su ruta. */
export interface Picked { nodes: PlaylistNode[]; playlistTracks: Map<number, number[]>; tracks: (TrackRow & { abs: string })[]; skipped: RekordboxResult['skipped'] }

const xmlEsc = (s: string | number | null | undefined) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

/** file://localhost/C:/Musica/Tema%20uno.mp3 */
export function toLocation(abs: string): string {
  const p = abs.replace(/\\/g, '/')
  const enc = p.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg).replace(/%2F/g, '/').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))).join('/')
  return `file://localhost/${enc.replace(/^\//, '')}`
}

export interface TrackRow { id: number; rel: string; ext: string; codec: string | null; size: number; duration: number | null; sr: number | null; bits: number | null; kbps: number | null; artist: string | null; albumArtist: string | null; title: string | null; album: string | null; track: string | null; year: string | null; genre: string | null; bpm: number | null; musicKey: string | null; probedAt: string | null }

export class Rekordbox {
  readonly dj: DjData

  constructor(readonly db: Db, private pathOf: (id: number) => string | null, private playlists: Playlists) {
    this.dj = new DjData(db, pathOf)
  }

  /**
   * La grilla y los cues de un tema, en el tiempo de Rekordbox (que es también el de Serato): lo de Rekordbox y Serato ya
   * viene así; lo de PAILA se corre (`rbShift`). Sin los sugeridos, salvo que se pidan. Lo usan los cuatro exportes.
   */
  marks(id: number, o: MarkOptions): DjMarks {
    const shift = this.dj.rbShift(id)
    const g = o.grid === false ? null : this.dj.grid(id, o.pailaWhenMoving)
    const gs = g?.rbTime ? 0 : shift
    const grid = g ? { bpm: g.bpm, segments: g.segments.map((s) => ({ ...s, start: s.start + gs })) } : null
    const cues = this.dj.cues(id).filter((c) => c.source !== 'paila' || o.suggestedCues).map((c) => {
      const cs = c.source === 'paila' || c.source === 'tracklist' ? shift : 0
      return { ...c, start: Math.max(0, c.start + cs), endAt: c.endAt == null ? null : c.endAt + cs }
    })
    return { grid, cues }
  }

  /** Lo que va adentro de un TRACK: la grilla (TEMPO) y los cues (POSITION_MARK). */
  private trackBody(id: number, o: RekordboxOptions): { lines: string[]; bpm: number | null } {
    const lines: string[] = []
    const { grid: g, cues } = this.marks(id, o)
    if (g) for (const s of g.segments) lines.push(`      <TEMPO Inizio="${s.start.toFixed(3)}" Bpm="${s.bpm.toFixed(2)}" Metro="4/4" Battito="${s.beat}"/>`)
    for (const c of cues) {
      const loop = c.kind === 'loop' && c.endAt != null
      const rgb = c.kind !== 'memory' && c.color ? ` Red="${parseInt(c.color.slice(1, 3), 16)}" Green="${parseInt(c.color.slice(3, 5), 16)}" Blue="${parseInt(c.color.slice(5, 7), 16)}"` : ''
      lines.push(`      <POSITION_MARK Name="${xmlEsc(c.name)}" Type="${loop ? 4 : 0}" Start="${c.start.toFixed(3)}"${loop ? ` End="${c.endAt!.toFixed(3)}"` : ''} Num="${c.kind === 'memory' ? -1 : c.num}"${rgb}/>`)
    }
    return { lines, bpm: g?.bpm ?? null }
  }

  private rows(ids?: number[]): TrackRow[] {
    const all = this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, f.ext, f.codec, f.size, f.duration, f.sample_rate AS sr, f.bits, f.kbps, f.artist, f.album_artist AS albumArtist, f.title, f.album, f.track, f.year, f.genre,
              a.bpm, a.music_key AS musicKey, f.probed_at AS probedAt
       FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar', 'proyectos', 'sets')`,
    ).all() as unknown as TrackRow[]
    if (!ids) return all
    const want = new Set(ids)
    return all.filter((r) => want.has(r.id))
  }

  /** Lo que un equipo no va a poder tocar, tema por tema. Solo Música. */
  compatibility(deviceId: string): { device: DeviceProfile; ok: number; issues: CompatIssue[] } {
    const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[1]
    const issues: CompatIssue[] = []
    let ok = 0
    for (const r of this.db.prepare(`SELECT f.id, f.rel_path AS rel, f.ext, f.codec, f.sample_rate AS sr FROM files f WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica'`).all() as unknown as { id: number; rel: string; ext: string; codec: string | null; sr: number | null }[]) {
      const ext = formatoReal(r.ext, r.codec)
      const alac = r.codec === 'alac'
      let reason: string | null = null
      let maxKhz: number | undefined
      if (RB_UNSUPPORTED.has(ext)) reason = T.formatoNadie(ext)
      else if (alac && !device.formats.includes('flac')) reason = T.alac
      else if (!device.formats.includes(ext)) reason = T.formatoEquipo(ext)
      else if ((r.sr ?? 0) > device.maxSampleRate) { maxKhz = device.maxSampleRate / 1000; reason = T.khz(Math.round((r.sr ?? 0) / 1000), maxKhz) }
      if (reason) issues.push({ fileId: r.id, rel: r.rel, reason, ...(maxKhz != null ? { maxKhz } : {}) }); else ok++
    }
    return { device, ok, issues }
  }

  /**
   * Qué temas y playlists van a un exporte: las playlists elegidas (y las carpetas que las tienen), sus temas y, con 'todo',
   * toda la Música. Los que el programa no lee (`unsupported`), los desaparecidos y los de un disco desconectado no entran.
   */
  pick(o: { scope: 'todo' | 'playlists'; playlistIds: number[] }, unsupported: Set<string>, app: string): Picked {
    const tree = this.playlists.tree()
    const wanted = new Set(o.playlistIds)
    const choose = (n: { id: number }) => !o.playlistIds.length || wanted.has(n.id)
    // una carpeta se exporta si se eligió ella o alguna de sus hijas
    const included = new Set<number>()
    const hasChosen = (id: number): boolean => tree.filter((c) => c.parentId === id).some((c) => (c.kind === 'folder' ? hasChosen(c.id) : choose(c)))
    for (const n of tree) if (n.kind === 'folder' ? (choose(n) || hasChosen(n.id)) : choose(n)) included.add(n.id)

    const playlistTracks = new Map<number, number[]>()
    for (const n of tree) if (n.kind !== 'folder' && included.has(n.id)) playlistTracks.set(n.id, this.playlists.trackIds(n.id))
    const inPlaylists = new Set([...playlistTracks.values()].flat())

    const skipped: RekordboxResult['skipped'] = []
    const usable = (r: TrackRow) => {
      const fmt = formatoReal(r.ext, r.codec)
      if (unsupported.has(fmt)) { skipped.push({ rel: r.rel, reason: T.noLoLee(fmt, app) }); return false }
      if (!this.pathOf(r.id)) { skipped.push({ rel: r.rel, reason: T.sinDisco }); return false }
      return true
    }
    for (const r of this.db.prepare('SELECT id, rel_path AS rel FROM files WHERE missing_at IS NOT NULL AND trashed_at IS NULL').all() as { id: number; rel: string }[]) {
      if (inPlaylists.has(r.id)) skipped.push({ rel: r.rel, reason: T.desaparecido })
    }
    const candidates = o.scope === 'todo' ? this.rows().filter((r) => this.kindMusica(r.id) || inPlaylists.has(r.id)) : this.rows([...inPlaylists])
    const tracks = candidates.filter(usable).map((r) => ({ ...r, abs: this.pathOf(r.id)! }))
    // sin los temas que no entraron, para que cada programa no tenga que volver a filtrarlos
    const ok = new Set(tracks.map((t) => t.id))
    for (const [k, ids] of playlistTracks) playlistTracks.set(k, ids.filter((id) => ok.has(id)))
    return { nodes: tree.filter((n) => included.has(n.id)), playlistTracks, tracks, skipped }
  }

  export(o: RekordboxOptions): RekordboxResult {
    const { nodes: tree, playlistTracks, tracks, skipped } = this.pick(o, RB_UNSUPPORTED, 'Rekordbox')
    const included = new Set(tree.map((n) => n.id))
    // el mismo TrackID en cada exportación (el de Rekordbox si vino de su XML). Rekordbox igual reconoce el tema por su ubicación: si se movió, lo importa como nuevo (punto 1 real, 24/10)
    const rbId = new Map(tracks.map((r) => [r.id, this.dj.trackId(r.id)]))

    let grids = 0, cues = 0
    const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">', '  <PRODUCT Name="rekordbox" Version="6.0.0" Company="Pioneer DJ"/>', `  <COLLECTION Entries="${tracks.length}">`]
    for (const r of tracks) {
      const abs = r.abs
      const kind = r.codec === 'alac' ? 'M4A File' : KIND[r.ext.toLowerCase()] ?? `${r.ext.toUpperCase()} File`
      const added = (r.probedAt ?? new Date().toISOString()).slice(0, 10)
      const body = this.trackBody(r.id, o)
      const meta = this.dj.meta(r.id)
      // el comentario vuelve con sus "my tags" al final, como los escribe Rekordbox
      const comments = [meta?.comments ?? '', meta?.myTags.length ? `/* ${meta.myTags.join(' / ')} */` : ''].filter(Boolean).join(' ')
      const colour = meta?.colour ? ` Colour="0x${meta.colour.slice(1)}"` : ''
      const head = `    <TRACK TrackID="${rbId.get(r.id)}" Name="${xmlEsc(r.title ?? path.basename(r.rel, path.extname(r.rel)))}" Artist="${xmlEsc(r.artist)}" Composer="" Album="${xmlEsc(r.album)}" Grouping="" Genre="${xmlEsc(r.genre)}" Kind="${kind}" Size="${r.size}" TotalTime="${Math.round(r.duration ?? 0)}" DiscNumber="0" TrackNumber="${xmlEsc(r.track && Number(r.track) ? Number(r.track) : 0)}" Year="${xmlEsc(r.year && /^\d{4}/.test(r.year) ? r.year.slice(0, 4) : 0)}" AverageBpm="${(body.bpm ?? r.bpm ?? 0).toFixed(2)}" DateAdded="${added}" BitRate="${r.kbps ?? 0}" SampleRate="${r.sr ?? 0}" Comments="${xmlEsc(comments)}" PlayCount="${meta?.playCount ?? 0}" Rating="${(meta?.stars ?? 0) * 51}" Location="${xmlEsc(toLocation(abs))}" Remixer="" Tonality="${xmlEsc(r.musicKey)}" Label="" Mix=""${colour}`
      if (!body.lines.length) out.push(head + '/>')
      else {
        out.push(head + '>', ...body.lines, '    </TRACK>')
        if (body.lines.some((l) => l.includes('<TEMPO'))) grids++
        if (body.lines.some((l) => l.includes('<POSITION_MARK'))) cues++
      }
    }
    out.push('  </COLLECTION>', '  <PLAYLISTS>')
    const node = (parent: number | null, depth: number): string[] => {
      const kids = tree.filter((c) => c.parentId === parent && included.has(c.id))
      const pad = '  '.repeat(depth)
      return kids.flatMap((c) => {
        if (c.kind === 'folder') return [`${pad}<NODE Name="${xmlEsc(c.name)}" Type="0" Count="${tree.filter((x) => x.parentId === c.id && included.has(x.id)).length}">`, ...node(c.id, depth + 1), `${pad}</NODE>`]
        const keys = (playlistTracks.get(c.id) ?? []).filter((id) => rbId.has(id))
        return [`${pad}<NODE Name="${xmlEsc(c.name)}" Type="1" KeyType="0" Entries="${keys.length}">`, ...keys.map((id) => `${pad}  <TRACK Key="${rbId.get(id)}"/>`), `${pad}</NODE>`]
      })
    }
    out.push(`    <NODE Type="0" Name="ROOT" Count="${tree.filter((c) => c.parentId == null && included.has(c.id)).length}">`, ...node(null, 3), '    </NODE>', '  </PLAYLISTS>', '</DJ_PLAYLISTS>')
    // por el motor (ops/copy.ts): si ya había un archivo ahí (lo elegiste pisar), primero una copia en PAILA-respaldos; después
    // se escribe entero al lado y recién ahí toma su nombre, con su renglón en el Historial
    checkOut(this.db, [o.dest])
    const backup = keepCopy(o.dest, path.join(path.dirname(o.dest), 'PAILA-respaldos', backupStamp()))
    new CopyOut(this.db, 'rekordbox', o.dest).write({ dst: o.dest, replace: true, backup }, out.join('\n') + '\n')

    // Se anota qué temas viajaron a Rekordbox, para avisar si después se mueven o reemplazan.
    const now = new Date().toISOString()
    transaction(this.db, () => {
      const up = this.db.prepare('INSERT INTO rb_exports (file_id, exported_at) VALUES (?, ?) ON CONFLICT (file_id) DO UPDATE SET exported_at = excluded.exported_at')
      for (const r of tracks) up.run(r.id, now)
    })
    return { file: o.dest, tracks: tracks.length, playlists: [...playlistTracks.keys()].length, skipped, grids, cues }
  }

  private kindMusica(id: number): boolean {
    return (this.db.prepare('SELECT kind FROM files WHERE id = ?').get(id) as { kind: string } | undefined)?.kind === 'musica'
  }

  /** Temas que ya se exportaron alguna vez a Rekordbox (por id). */
  exportedIds(ids?: number[]): Set<number> {
    const all = (this.db.prepare('SELECT file_id AS id FROM rb_exports').all() as { id: number }[]).map((r) => r.id)
    if (!ids) return new Set(all)
    const want = new Set(ids)
    return new Set(all.filter((i) => want.has(i)))
  }

  /** Ordena una playlist común para que cada tema combine con el siguiente: tono (rueda Camelot) y BPM. Devuelve el orden nuevo. */
  harmonicOrder(trackIds: number[]): number[] {
    const q = this.db.prepare('SELECT a.bpm, a.camelot FROM analysis a WHERE a.file_id = ?')
    type T = { id: number; bpm: number | null; num: number | null; letter: string | null }
    const ts: T[] = trackIds.map((id) => {
      const r = q.get(id) as { bpm: number | null; camelot: string | null } | undefined
      const m = r?.camelot?.match(/^(\d{1,2})([AB])$/)
      return { id, bpm: r?.bpm ?? null, num: m ? Number(m[1]) : null, letter: m ? m[2] : null }
    })
    const known = ts.filter((t) => t.num != null && t.bpm != null)
    const unknown = ts.filter((t) => t.num == null || t.bpm == null)
    if (known.length < 2) return trackIds
    const dist = (a: T, b: T) => {
      const dn = Math.min(Math.abs(a.num! - b.num!), 12 - Math.abs(a.num! - b.num!))
      return dn + (a.letter === b.letter ? 0 : 1) * (dn === 0 ? 1 : 2) + Math.abs(a.bpm! - b.bpm!) / 4
    }
    // arranca por el de BPM más bajo y siempre sigue con el más cercano (tono y BPM)
    const left = [...known].sort((a, b) => a.bpm! - b.bpm!)
    const order = [left.shift()!]
    while (left.length) {
      const last = order[order.length - 1]
      let bi = 0
      for (let i = 1; i < left.length; i++) if (dist(last, left[i]) < dist(last, left[bi])) bi = i
      order.push(left.splice(bi, 1)[0])
    }
    return [...order, ...unknown].map((t) => t.id)
  }
}
