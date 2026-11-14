// La lista «Faltan o suenan mal» por tema: qué conviene conseguir en mejor calidad (o qué falta), con estados pendiente → pedido →
// llegó → reemplazado / ignorar, y la exportación en .txt y .csv. PAILA no descarga música: la lista la usás vos donde quieras.
import path from 'node:path'
import { visible, type Db } from './db'
import { RB_UNSUPPORTED } from './rekordbox'
import { setReason } from './sets'
import { NombresLimpios } from './wanted-limpios'
import { normalize } from './dupnames'
import { nameGuess } from './inbox'
import { cleanBase, dropOpenParen, loose } from './names'
import { stripJunk } from './tagactions'
import { versionRe } from './versionwords'
import { napiaCsv, sockseekCsv, sockseekTxt } from './listexport'
import { flagList } from './better'
import type { TidyRule, WantedCriteria, WantedExport, WantedFormat, WantedItem, WantedQue, WantedReason, WantedStatus } from '@paila/shared/types'
import { idioma, type Idioma } from '@paila/shared/idioma'
import type { CopiaTuya } from '@paila/shared/napia'
import { Q, T } from './wanted.textos'
import { peorPrimero } from './peor-primero'

const STATUSES: WantedStatus[] = ['pendiente', 'pedido', 'llego', 'reemplazado', 'ignorar']
const ORDER: Record<WantedStatus, number> = { llego: 0, pendiente: 1, pedido: 2, reemplazado: 3, ignorar: 4 }
const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'tta'])
const FAKE_FLAGS = ['fake_lossless', 'maybe_transcoded']
const INFLATED_FLAGS = ['upscaled', 'reencoded']
export const DEFAULT_CRITERIA: WantedCriteria = { bad: true, fair: false, fakes: true, rekordbox: false, mp3like: false }

/** Nombre oficial de un tema (de la Fase C: MusicBrainz, Discogs…), si lo hay. */
export type OfficialName = (fileId: number) => { artist: string; title: string } | null

interface Row {
  id: number; rel: string; ext: string; kind: string; kbps: number | null; duration: number | null
  artist: string | null; title: string | null; album: string | null; grade: string | null; flags: string | null; label: string | null; effKbps: number | null
  clipEvents: number | null; lufs: number | null
}
interface Saved {
  id: number; fileId: number | null; refFileId: number | null; artist: string; title: string; status: WantedStatus; reason: string
  note: string; album: string | null; arrived: string | null; repId: number | null; repUndone: number | null; refRel: string | null; /** la duración que traía la lista (lista traída) */ reqDuration: number | null
  /** de una lista traída, dijiste "No es" a la copia que se parecía: es otra versión (NAPIA no la saltea) */ otraVersion: number
}

// las palabras de versión de Duplicados (core/versionwords.ts): "Salir a asustar - En vivo" es título y versión
const VERSION = versionRe(['mezcla', 'vivo', 'grabacion', 'remaster'], { except: ['club'] })
/**
 * El nombre para buscar el tema, solo para la lista (los tags no se tocan; eso es de "Arreglar nombres"). Arreglos de la
 * corrida del 20/10: el n.º de tema adelante ("04 - SOY CORDOBES"), lo cortado al final ("Touchdown (feat. Ale"), y
 * "Various Artists" o el canal que subió el video en el artista ("Lucas Pereira" / "Rodrigo - Fuego y pasion") cuando el
 * nombre del archivo confirma "Artista - Título".
 */
export function listName(artist: string, title: string, rel: string): { artist: string; title: string } {
  const t = dropOpenParen(title.replace(/^\d{1,3}(?:\s+-|\.)\s+(?=\S)/, ''))
  const parts = t.split(/\s+[-–]\s+/)
  if (parts.length >= 2) {
    const x = parts[0], y = parts.slice(1).join(' - ')
    const file = loose(cleanBase(path.posix.basename(rel, path.posix.extname(rel))).replace(/^\d{1,3}(?:\s+-|\.)?\s+/, ''))
    const various = !artist.trim() || /^(?:various(?: artists)?|varios(?: artistas)?|va|v\.a\.)$/i.test(artist.trim())
    // "Salir a asustar - En vivo" sin el artista en el nombre del archivo es título y versión, no "artista - título"
    const uploader = !VERSION.test(y) && !file.includes(loose(artist)) && file.startsWith(loose(`${x}${y}`))
    if (various || uploader) return { artist: x, title: y }
  }
  return { artist, title: t }
}

/**
 * La copia que ya tenés, para NAPIA: solo de lo que viene a reemplazarse por calidad (con nota). Lo que se pide solo para que
 * Rekordbox lo lea no: ahí sirve el mismo tema en otro formato, aunque no sea mejor.
 */
const tuyaDe = (i: WantedItem): CopiaTuya | null =>
  i.fileId != null && i.grade && !i.reasons.every((r) => r === 'rekordbox')
    ? { nota: i.grade, kbps: i.effKbps, que: i.quality, marcas: flagList(i.flags), recortes: i.clipEvents ?? null, lufs: i.lufs ?? null, duracion: i.duration, id: i.fileId }
    : null

const mmss = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export class Wanted {
  /** Lo que propondría "Arreglar nombres" (core/wanted-limpios.ts): en la app, en un hilo aparte (`limpios.enHilo`). */
  readonly limpios: NombresLimpios
  constructor(private db: Db, private official: OfficialName | null = null) { this.limpios = new NombresLimpios(db) }

  /** Por qué conviene conseguir este tema (vacío = no entra con estas casillas). */
  private reasons(r: Row, c: WantedCriteria): WantedReason[] {
    const out: WantedReason[] = []
    const flags = (r.flags ?? '').split(',')
    const g = RANK[r.grade ?? ''] ?? -1
    if ((c.bad && g >= 4) || (c.fair && g === 3)) out.push('nota')
    if (c.fakes && flags.some((f) => FAKE_FLAGS.includes(f))) out.push('lossless_falso')
    if (c.fakes && flags.some((f) => INFLATED_FLAGS.includes(f))) out.push('inflado')
    if (c.rekordbox && RB_UNSUPPORTED.has(r.ext.toLowerCase())) out.push('rekordbox')
    if (c.mp3like && flags.includes('cut20_mp3like')) out.push('puede_mp3')
    return out
  }

  private rows(): Row[] {
    return (this.db.prepare(
      `SELECT f.id, f.rel_path AS rel, f.ext, f.kind, f.kbps, f.duration, f.artist, f.title, f.album, a.grade, a.flags, a.is_label AS label, a.eff_kbps AS effKbps, a.clip_events AS clipEvents, a.lufs
       FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar')`,
    ).all() as unknown as Row[]).filter((r) => !setReason(r.rel, r.duration, r)) // los sets y enganchados no se consiguen "en mejor calidad"
  }

  private saved(): Saved[] {
    return this.db.prepare(
      `SELECT w.id, w.file_id AS fileId, w.ref_file_id AS refFileId, w.artist, w.title, w.status, w.reason, w.note, w.album, w.arrived_path AS arrived,
              w.replacement_id AS repId, r.undone_at IS NOT NULL AS repUndone, rf.rel_path AS refRel,
              (SELECT MAX(i.duration) FROM request_items i WHERE i.wanted_id = w.id) AS reqDuration,
              EXISTS (SELECT 1 FROM request_items i WHERE i.wanted_id = w.id AND i.decision = 'no' AND i.file_id IS NOT NULL) AS otraVersion
       FROM wanted w LEFT JOIN replacements r ON r.id = w.replacement_id LEFT JOIN files rf ON rf.id = w.ref_file_id`,
    ).all() as unknown as Saved[]
  }

  /**
   * "Artista - Título" limpios, con las reglas del perfil de nombres (el mismo asistente "Arreglar nombres", sin escribir
   * nada) o el oficial si existe. Lo que no tiene tags sale del nombre del archivo. `rapido`: sin esperar a que el hilo
   * termine de limpiar (NombresLimpios.cambios).
   */
  names(ids: number[], rules?: Iterable<TidyRule>, rapido = false): Map<number, { artist: string; title: string }> {
    const want = new Set(ids)
    const out = new Map<number, { artist: string; title: string }>()
    const base = this.db.prepare(`SELECT id, rel_path AS rel, artist, title FROM files WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})`).all(...ids) as
      { id: number; rel: string; artist: string | null; title: string | null }[]
    // de base (lo que el asistente no mira, como "Para revisar"): los tags sin basura de páginas, o el nombre del archivo
    const tag = (v: string | null) => (v ? stripJunk(v).trim() : '')
    for (const b of base) {
      const g = !tag(b.artist) || !tag(b.title) ? nameGuess(b.rel) : null
      out.set(b.id, { artist: tag(b.artist) || g?.artist || '', title: tag(b.title) || g?.title || path.posix.basename(b.rel, path.posix.extname(b.rel)) })
    }
    if (ids.length) {
      for (const ch of this.limpios.cambios(rules, rapido)) {
        if (!want.has(ch.id) || (ch.field !== 'artist' && ch.field !== 'title')) continue
        const cur = out.get(ch.id)
        if (cur) cur[ch.field] = ch.to
      }
    }
    const rels = new Map(base.map((b) => [b.id, b.rel]))
    for (const [id, n] of out) out.set(id, listName(n.artist, n.title, rels.get(id) ?? ''))
    if (this.official) for (const id of ids) { const o = this.official(id); if (o?.artist && o.title) out.set(id, { artist: o.artist, title: o.title }) }
    return out
  }

  /** La lista: lo que entra por las casillas, más lo que ya tiene un estado guardado (y los temas que faltan). */
  list(c: WantedCriteria = DEFAULT_CRITERIA, rules?: Iterable<TidyRule>, playlistId?: number | null): WantedItem[] {
    return this.dePlaylist(this.build(c, rules, idioma(), true), playlistId)
  }

  /**
   * Solo lo que pide esa playlist (el autor, 24/10: "en la lista de pedir me agrega todos los malos, quiero solo los de mala
   * calidad y que no tengo de esa playlist que cargué"): los temas que están en la playlist (los de mala calidad que ya entraron
   * por las casillas) y lo que le falta, que viene del pedido (lista traída) que armó esa playlist. Sin playlist, todo.
   */
  dePlaylist(items: WantedItem[], playlistId?: number | null): WantedItem[] {
    if (playlistId == null) return items
    const enLista = new Set((this.db.prepare('SELECT file_id AS id FROM playlist_items WHERE playlist_id = ?').all(playlistId) as { id: number }[]).map((r) => r.id))
    const pedidos = new Set((this.db.prepare('SELECT name FROM requests WHERE playlist_id = ? AND undone_at IS NULL').all(playlistId) as { name: string }[]).map((r) => r.name))
    return items.filter((i) => (i.fileId != null && enLista.has(i.fileId)) || i.requests.some((r) => pedidos.has(r)))
  }

  /** La lista con la calidad y lo que conviene conseguir en `lang`. */
  private build(c: WantedCriteria, rules: Iterable<TidyRule> | undefined, lang: Idioma, rapido = false): WantedItem[] {
    const rows = this.rows()
    const byId = new Map(rows.map((r) => [r.id, r]))
    const saved = this.saved()
    const savedByFile = new Map(saved.filter((s) => s.fileId != null).map((s) => [s.fileId!, s]))
    const picked = rows.map((r) => ({ r, why: this.reasons(r, c) })).filter((x) => x.why.length || savedByFile.has(x.r.id))
    const names = this.names(picked.filter((x) => !savedByFile.has(x.r.id)).map((x) => x.r.id), rules, rapido)
    const out: WantedItem[] = []
    const reqs = this.requestNames()
    for (const { r, why } of picked) {
      const s = savedByFile.get(r.id)
      const n = s ? { artist: s.artist, title: s.title } : names.get(r.id)!
      const rs = why.length ? why : ((s?.reason.split(',').filter(Boolean) ?? []) as WantedReason[])
      out.push({
        key: `f${r.id}`, fileId: r.id, rel: r.rel, refRel: null, artist: n.artist, title: n.title, album: r.album, duration: r.duration, ext: r.ext, grade: r.grade, effKbps: r.effKbps, flags: r.flags, clipEvents: r.clipEvents, lufs: r.lufs,
        quality: this.quality(r, lang), want: this.wantText(r, rs, lang), reasons: rs, status: s ? this.effective(s) : 'pendiente', note: s?.note ?? '', arrivedPath: s?.arrived ?? null, requests: s ? reqs.get(s.id) ?? [] : [],
      })
    }
    for (const s of saved) {
      if (s.fileId != null) continue
      out.push({
        key: `w${s.id}`, fileId: null, rel: null, refRel: s.refRel, artist: s.artist, title: s.title, album: s.album, duration: (s.refFileId ? byId.get(s.refFileId)?.duration : null) ?? s.reqDuration,
        ext: null, grade: null, effKbps: null, quality: Q[lang].noLoTenes, want: Q[lang].elTema, reasons: [s.reason === 'falta_disco' ? 'falta_disco' : 'falta'], status: this.effective(s), note: s.note, arrivedPath: s.arrived, requests: reqs.get(s.id) ?? [],
        ...(s.otraVersion ? { otraVersion: true } : {}),
      })
    }
    return out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || peorPrimero(a, b))
  }

  /** Los pedidos (listas traídas de otro lado, core/requests.ts) de cada fila: «80s Mood». */
  private requestNames(): Map<number, string[]> {
    const rows = this.db.prepare(
      `SELECT DISTINCT i.wanted_id AS id, r.name FROM request_items i JOIN requests r ON r.id = i.request_id
       WHERE i.wanted_id IS NOT NULL AND r.undone_at IS NULL ORDER BY r.id`,
    ).all() as { id: number; name: string }[]
    const out = new Map<number, string[]>()
    for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.name])
    return out
  }

  /** Un reemplazo deshecho (desde el Historial) vuelve el tema a "pedido": hay que conseguirlo de nuevo. */
  private effective(s: Saved): WantedStatus {
    return s.status === 'reemplazado' && s.repId != null && s.repUndone ? 'pedido' : s.status
  }

  private quality(r: Row, lang: Idioma): string {
    const fmt = `${r.ext.toUpperCase()}${r.kbps && !LOSSLESS.has(r.ext.toLowerCase()) ? ` ${r.kbps} kbps` : ''}`
    if (!r.grade) return `${fmt} · ${Q[lang].sinAnalizar}`
    return `${fmt} · ${Q[lang].nota} ${r.grade}${r.label && !r.label.startsWith(r.ext.toUpperCase()) ? ` (${r.label})` : ''}`
  }

  private wantText(r: Row, why: WantedReason[], lang: Idioma): string {
    if (why.includes('lossless_falso')) return Q[lang].deVerdad
    if (why.includes('nota') || why.includes('inflado')) return Q[lang].flac
    if (why.includes('puede_mp3')) return Q[lang].puedeMp3
    if (why.includes('rekordbox')) return Q[lang].rekordbox(r.ext.toLowerCase())
    return Q[lang].mejor
  }

  /** Cambia el estado de un tema de la lista (`key` de WantedItem). Si todavía no tenía fila, se guarda con su nombre de hoy. */
  setStatus(key: string, status: WantedStatus, note?: string, rules?: Iterable<TidyRule>) {
    if (!STATUSES.includes(status)) throw new Error(T.estadoDesconocido)
    const now = new Date().toISOString()
    if (key.startsWith('w')) {
      this.db.prepare('UPDATE wanted SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?').run(status, note ?? null, now, Number(key.slice(1)))
      return
    }
    const fileId = Number(key.slice(1))
    if (!Number.isInteger(fileId)) throw new Error(T.temaDesconocido)
    this.ensure([fileId], undefined, rules)
    this.db.prepare('UPDATE wanted SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE file_id = ?').run(status, note ?? null, now, fileId)
  }

  /** Crea la fila de los temas que todavía no la tienen (con el nombre limpio y el motivo de hoy). */
  ensure(fileIds: number[], c: WantedCriteria = { bad: true, fair: true, fakes: true, rekordbox: true, mp3like: true }, rules?: Iterable<TidyRule>) {
    const have = new Set((this.db.prepare('SELECT file_id AS id FROM wanted WHERE file_id IS NOT NULL').all() as { id: number }[]).map((r) => r.id))
    const todo = fileIds.filter((id) => !have.has(id))
    if (!todo.length) return
    const names = this.names(todo, rules)
    const rows = new Map(this.rows().map((r) => [r.id, r]))
    const now = new Date().toISOString()
    const ins = this.db.prepare("INSERT INTO wanted (file_id, artist, title, status, reason, added_at, updated_at) VALUES (?, ?, ?, 'pendiente', ?, ?, ?)")
    for (const id of todo) {
      const n = names.get(id)
      if (!n) continue
      const r = rows.get(id)
      ins.run(id, n.artist, n.title, r ? this.reasons(r, c).join(',') : '', now, now)
    }
  }

  /**
   * Suma un tema que falta (de Duplicados: el mismo audio con dos títulos distintos, "Conjure Drama" que en realidad es
   * "Conjure Balearia"). `refFileId` = el archivo que tiene ese título pero suena como el otro tema. Con `album`: un tema
   * que le falta a ese disco (de Discos completos; motivo "falta_disco").
   */
  addMissing(artist: string, title: string, refFileId: number | null = null, album: string | null = null): string {
    if (!title.trim()) throw new Error(T.faltaTitulo)
    const same = this.findMissing(artist, title)
    if (same) return same
    const now = new Date().toISOString()
    const r = this.db.prepare("INSERT INTO wanted (file_id, ref_file_id, artist, title, status, reason, album, added_at, updated_at) VALUES (NULL, ?, ?, ?, 'pendiente', ?, ?, ?, ?)")
      .run(refFileId, artist.trim(), title.trim(), album ? 'falta_disco' : 'falta', album, now, now)
    return `w${Number(r.lastInsertRowid)}`
  }

  /** La fila de un tema que falta con este nombre (`w<id>`), si ya está en la lista. */
  findMissing(artist: string, title: string): string | null {
    const key = `${normalize(artist)}|${normalize(title)}`
    const same = (this.db.prepare('SELECT id, artist, title FROM wanted WHERE file_id IS NULL').all() as { id: number; artist: string; title: string }[])
      .find((w) => `${normalize(w.artist)}|${normalize(w.title)}` === key)
    return same ? `w${same.id}` : null
  }

  /**
   * La lista para llevarte: .txt (un "Artista - Título" por línea) o .csv (para planilla, separado por ";"). Entra lo
   * pendiente y lo pedido (o solo lo pendiente); lo reemplazado y lo ignorado nunca. Lo exportado queda "pedido".
   * También en los formatos de sockseek (core/listexport.ts): `s:"Artista - Tema"` por línea, o Artist,Title,Album,Length.
   */
  export(format: WantedFormat, c: WantedCriteria = DEFAULT_CRITERIA, opts: { onlyNew?: boolean; rules?: Iterable<TidyRule>; /** solo lo de este pedido (lista traída) */ request?: string; /** solo lo de esta playlist (ver dePlaylist) */ playlistId?: number | null; /** qué parte (ver soloQue) */ que?: WantedQue } = {}): WantedExport {
    // en el idioma de la app: el .csv lo lee una persona (decidido el 23/10); "Traer una lista" lo vuelve a leer en los dos
    const items = this.dePlaylist(this.build(c, opts.rules, idioma()), opts.playlistId).filter((i) => (i.status === 'pendiente' || (!opts.onlyNew && i.status === 'pedido')) && (!opts.request || i.requests.includes(opts.request)) && soloQue(i, opts.que)).sort(peorPrimero)
    const line = (i: WantedItem) => (i.artist ? `${i.artist} - ${i.title}` : i.title)
    // a sockseek y a NAPIA no van los que no se pueden buscar ("AudioTrack 08" sin artista: en la prueba de la persona 1, 31/10)
    const paraBuscar = format === 'napia-csv' || format === 'sockseek-txt' || format === 'sockseek-csv' ? items.filter(sePuedeBuscar) : items
    let text: string
    if (format === 'sockseek-txt') text = sockseekTxt(paraBuscar)
    else if (format === 'sockseek-csv') text = sockseekCsv(paraBuscar)
    else if (format === 'napia-csv') text = napiaCsv(paraBuscar.map((i) => ({ ...i, tuya: tuyaDe(i) })))
    else if (format === 'txt') text = [...new Set(items.map(line))].join('\r\n') + (items.length ? '\r\n' : '')
    else {
      const head = T.csvHead.split(';')
      const rows = items.map((i) => [i.artist, i.title, i.album ?? '', mmss(i.duration), i.quality, i.want, i.status === 'pedido' ? T.pedido : T.nuevo, i.requests.join(', ')])
      text = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n'
    }
    const fresh = paraBuscar.filter((i) => i.status === 'pendiente')
    const fileIds = fresh.filter((i) => i.fileId != null).map((i) => i.fileId!)
    this.ensure(fileIds, c, opts.rules)
    const now = new Date().toISOString()
    const byFile = this.db.prepare("UPDATE wanted SET status = 'pedido', updated_at = ? WHERE file_id = ? AND status = 'pendiente'")
    const byId = this.db.prepare("UPDATE wanted SET status = 'pedido', updated_at = ? WHERE id = ? AND status = 'pendiente'")
    for (const i of fresh) if (i.fileId != null) byFile.run(now, i.fileId); else byId.run(now, Number(i.key.slice(1)))
    return { text, count: paraBuscar.length, marked: fresh.length }
  }

  /** Los temas pedidos (o que ya llegaron): la Bandeja los compara primero. */
  requested(): number[] {
    return (this.db.prepare("SELECT file_id AS id FROM wanted WHERE file_id IS NOT NULL AND status IN ('pedido', 'llego')").all() as { id: number }[]).map((r) => r.id)
  }

  /** Los temas que faltan y siguen buscándose (para reconocerlos por nombre cuando llegan). */
  missing(): { id: number; artist: string; title: string; refRel: string | null; duration: number | null }[] {
    // la duración: la del archivo que suena como el tema, o la que traía una lista traída
    return (this.db.prepare(
      `SELECT w.id, w.artist, w.title, f.rel_path AS refRel, COALESCE(f.duration, (SELECT MAX(i.duration) FROM request_items i WHERE i.wanted_id = w.id)) AS duration
       FROM wanted w LEFT JOIN files f ON f.id = w.ref_file_id WHERE w.file_id IS NULL AND w.status IN ('pendiente', 'pedido', 'llego')`,
    ).all() as { id: number; artist: string; title: string; refRel: string | null; duration: number | null }[])
  }

  /** La Bandeja encontró el archivo de un tema de la lista. */
  arrived(target: { fileId?: number; wantedId?: number }, file: string) {
    const now = new Date().toISOString()
    if (target.fileId != null) {
      this.ensure([target.fileId])
      this.db.prepare("UPDATE wanted SET status = 'llego', arrived_path = ?, updated_at = ? WHERE file_id = ? AND status IN ('pendiente', 'pedido', 'llego')").run(file, now, target.fileId)
    } else if (target.wantedId != null) {
      this.db.prepare("UPDATE wanted SET status = 'llego', arrived_path = ?, updated_at = ? WHERE id = ? AND status IN ('pendiente', 'pedido', 'llego')").run(file, now, target.wantedId)
    }
  }

  /** Se reemplazó: sale de la próxima exportación (si se deshace desde el Historial, vuelve a "pedido"). */
  replaced(fileId: number, replacementId: number, file: string) {
    this.ensure([fileId])
    this.db.prepare("UPDATE wanted SET status = 'reemplazado', replacement_id = ?, arrived_path = ?, updated_at = ? WHERE file_id = ?").run(replacementId, file, new Date().toISOString(), fileId)
  }
}

/** ¿Entra en esa parte de la lista? "calidad": un tema que ya tenés y conviene mejorar; "faltan": uno que no tenés (el autor, 1/11:
 *  quería bajar primero lo que mejora lo que ya tiene, sin los temas que les faltan a los discos). */
export const soloQue = (i: { fileId: number | null }, que: WantedQue = 'todo') => que === 'todo' || (que === 'calidad') === (i.fileId != null)

/** ¿Se puede buscar en Soulseek? Sin artista y con un título de pista genérico ("Track 01", "AudioTrack 08", "Pista 3") o vacío,
 *  no: nadie lo comparte con ese nombre. Primero hay que arreglarle el nombre (Arreglar nombres o Completar desde internet). */
export function sePuedeBuscar(i: { artist: string | null; title: string | null }): boolean {
  const t = (i.title ?? '').trim()
  if ((i.artist ?? '').trim()) return !!t
  return !!t && !/^(audio\s*)?(track|pista|tema|title|t[ií]tulo)?\s*[-_#.]?\s*\d+$/i.test(t)
}
