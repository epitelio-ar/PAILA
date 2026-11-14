// Tracklist de sets con la base: elegir el set, guardar su huella entera (set_prints), escucharlo contra la biblioteca
// (core/tracklist.ts), una segunda pasada a otras velocidades donde no reconoce nada, lo que falta por internet (AcoustID y
// el reconocedor opcional), y lo que sale: el texto con minutos, una hoja .cue, el comentario del tag (por Cambios
// pendientes) y cue points para Rekordbox (dj_cues, fuente 'tracklist'). Nunca escribe en un archivo de música.
import fs from 'node:fs'
import { visible, type Db } from './db'
import { decodeFingerprint, encodeFingerprint } from './analysis/chromaprint'
import { setPrint } from './analysis/setprint'
import { libraryPrints } from './soundindex'
import { setReason } from './sets'
import { nameGuess } from './inbox'
import { buildTracklist } from './tracklist-build'
import { recognizeGaps, refiner, scanSet, twins, type Progress, type Recognizers } from './setlists-scan'
import { clearCues, commentFor, cuesSaved, saveCues, tracklistExport } from './setlists-out'
import type { SetHit } from './tracklist'
import type { ListenOptions, SetCandidate, TrackInSet, SetTracklist, TracklistFormat } from '@paila/shared/types'
import { num, textos } from '@paila/shared/idioma'

// Lo que se ve en la pantalla (lo que sale al archivo está en core/setlists-out.ts y no se traduce)
const T = textos({
  enSets: { es: 'Está en Sets y en vivo', en: 'It\'s in "Sets y en vivo"' },
  escuchandoSet: { es: 'Escuchando el set entero', en: 'Listening to the whole set' },
  noSeEscucho: { es: 'No se pudo escuchar el set (¿está vacío o dañado?)', en: "Couldn't listen to the set (is it empty or damaged?)" },
  yaNoEsta: { es: 'Ese tema ya no está en la biblioteca', en: "That track is no longer in the library" },
  sinDisco: { es: 'El disco del set no está conectado', en: "The set's drive isn't connected" },
  buscando: { es: 'Buscando los temas en tu biblioteca', en: 'Looking for the tracks in your library' },
  deLaCarpeta: { es: 'de la carpeta del set', en: "from the set's folder" },
  deLasCarpetas: { es: 'de las carpetas de los temas que reconoció', en: 'from the folders of the tracks it recognized' },
  cancelado: { es: 'Cancelado', en: 'Cancelled' },
  enteros: { es: (donde: string, i: number, n: number) => `Escuchando enteros los temas ${donde} (${i} de ${n})`, en: (donde: string, i: number, n: number) => `Listening to the whole tracks ${donde} (${num(i)} of ${num(n)})` },
  sinTracklist: { es: 'Ese set no tiene tracklist todavía', en: "That set doesn't have a tracklist yet" },
})

export { scanSet, refiner, twins, type Recognizers } from './setlists-scan'

/** Cuántos temas de la carpeta del set se escuchan enteros como mucho. */
const MAX_NEIGHBORS = 400

interface FileRow { id: number; rel: string; size: number; mtime: number; duration: number | null; channels: number | null; kind: string; artist: string | null; title: string | null }

export class SetLists {
  constructor(private db: Db, private pathOf: (id: number) => string | null, private ffmpeg: string) {}

  private file(id: number): FileRow | null {
    return (this.db.prepare('SELECT id, rel_path AS rel, size, mtime, duration, channels, kind, artist, title FROM files WHERE id = ?').get(id) as FileRow | undefined) ?? null
  }

  /** Los archivos que parecen un set (los de "Sets y en vivo" y los largos que core/sets.ts reconoce), los más largos primero. */
  candidates(): SetCandidate[] {
    const rows = this.db.prepare(`SELECT f.id, f.rel_path AS rel, f.duration, f.kind, f.artist, f.title, t.made_at AS madeAt, t.entries
      FROM files f LEFT JOIN set_tracklists t ON t.file_id = f.id
      WHERE ${visible('f')} AND f.kind IN ('musica', 'revisar', 'sets') AND f.duration > 15 * 60 ORDER BY f.duration DESC`).all() as
      { id: number; rel: string; duration: number; kind: string; artist: string | null; title: string | null; madeAt: string | null; entries: string | null }[]
    const out: SetCandidate[] = []
    for (const r of rows) {
      const why = r.kind === 'sets' ? T.enSets : setReason(r.rel, r.duration, r)
      if (!why) continue
      let found = 0
      try { found = r.entries ? (JSON.parse(r.entries) as { entries: TrackInSet[] }).entries.filter((e) => e.source && !e.hidden && e.confidence !== 'baja').length : 0 } catch { /* viejo */ }
      out.push({ fileId: r.id, rel: r.rel, minutes: Math.round(r.duration / 60), why, madeAt: r.madeAt, found })
    }
    return out
  }

  /** El último tracklist armado de un set (con los nombres al día), o null. */
  saved(fileId: number): SetTracklist | null {
    const r = this.db.prepare('SELECT made_at AS madeAt, entries FROM set_tracklists WHERE file_id = ?').get(fileId) as { madeAt: string; entries: string } | undefined
    const f = this.file(fileId)
    if (!r || !f) return null
    const p = this.db.prepare('SELECT seconds, length(chromaprint) AS bytes FROM set_prints WHERE file_id = ?').get(fileId) as { seconds: number; bytes: number } | undefined
    const stored = JSON.parse(r.entries) as { entries: TrackInSet[]; took?: SetTracklist['took']; internet?: SetTracklist['internet'] }
    return { fileId, rel: f.rel, seconds: p?.seconds ?? f.duration ?? 0, madeAt: r.madeAt, entries: stored.entries.map((e) => this.named(e)), printKb: Math.round((p?.bytes ?? 0) / 1024), took: stored.took, internet: stored.internet }
  }

  /** Los datos del tema de la biblioteca, como están hoy (si se le corrigió el nombre después, sale el nuevo). */
  private named(e: TrackInSet): TrackInSet {
    if (e.source !== 'biblioteca' || e.fileId == null) return e
    const f = this.file(e.fileId)
    if (!f) return e
    // sin tags: lo que dice el nombre del archivo ("Artista - Título"), o el nombre entero
    const guess = f.artist || f.title ? null : nameGuess(f.rel)
    return { ...e, rel: f.rel, artist: f.artist ?? guess?.artist ?? null, title: guess?.title ?? f.title ?? e.title ?? f.rel.split('/').pop()!.replace(/\.[^.]+$/, '') }
  }

  /** La huella entera del set: la guardada si el archivo no cambió, si no se lee (y se guarda). */
  private async print(f: FileRow, path: string, prog: Progress): Promise<{ fp: Uint32Array; seconds: number }> {
    const r = this.db.prepare('SELECT src_size AS size, src_mtime AS mtime, seconds, chromaprint FROM set_prints WHERE file_id = ?').get(f.id) as
      { size: number; mtime: number; seconds: number; chromaprint: string } | undefined
    // el tamaño y la fecha del archivo como están ahora (los de la base pueden tener otra precisión)
    const st = fs.statSync(path)
    if (r && r.size === st.size && r.mtime === st.mtimeMs) { try { return { fp: decodeFingerprint(r.chromaprint), seconds: r.seconds } } catch { /* se vuelve a leer */ } }
    const got = await setPrint({
      ffmpeg: this.ffmpeg, file: path, channels: f.channels, duration: f.duration,
      onProgress: (x) => prog.onProgress?.({ done: Math.round(x * 100), total: 100, current: T.escuchandoSet }), isCancelled: prog.isCancelled,
    })
    if (!got.fp.length) throw new Error(T.noSeEscucho)
    this.db.prepare(`INSERT INTO set_prints (file_id, src_size, src_mtime, seconds, chromaprint, made_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (file_id) DO UPDATE SET src_size = excluded.src_size, src_mtime = excluded.src_mtime, seconds = excluded.seconds, chromaprint = excluded.chromaprint, made_at = excluded.made_at`)
      .run(f.id, st.size, st.mtimeMs, got.seconds, encodeFingerprint(got.fp), new Date().toISOString())
    return got
  }

  /**
   * Escuchar un set: qué temas de la biblioteca suenan y desde qué minuto. Lo corregido a mano en el tracklist anterior
   * (temas quitados o escritos) se conserva si el tramo sigue ahí.
   */
  async listen(fileId: number, opts: ListenOptions & Progress & { recognizers?: Recognizers } = {}): Promise<SetTracklist> {
    const f = this.file(fileId)
    if (!f) throw new Error(T.yaNoEsta)
    const path = this.pathOf(fileId)
    if (!path || !fs.existsSync(path)) throw new Error(T.sinDisco)
    const t0 = Date.now()
    const { fp, seconds } = await this.print(f, path, opts)
    const t1 = Date.now()
    const step = (current: string, done: number) => opts.onProgress?.({ done, total: 100, current })
    step(T.buscando, 0)
    const lib = await libraryPrints(this.db)
    // los sets no se buscan dentro de otro set (el mismo set en otro formato encontraría su propio principio)
    const info = this.db.prepare('SELECT rel_path AS rel, duration, kind, artist, title FROM files WHERE id = ?')
    const notSet = new Map<number, boolean>()
    const exclude = (id: number) => {
      if (id === fileId) return true
      if (!notSet.has(id)) { const r = info.get(id) as { rel: string; duration: number | null; kind: string; artist: string | null; title: string | null } | undefined; notSet.set(id, !!r && r.kind !== 'sets' && !setReason(r.rel, r.duration, r)) }
      return !notSet.get(id)
    }
    const read = (from: number, secs: number, speed: number) => setPrint({ ffmpeg: this.ffmpeg, file: path, channels: f.channels, duration: null, from, seconds: secs, speed }).then((x) => x.fp)
    let long = await this.wholePrints(this.neighbors(fileId), opts, T.deLaCarpeta)
    // una primera pasada rápida: en qué carpetas están los temas que ya reconoce; esas carpetas se escuchan enteras (corrida
    // del 22/10: un set de 77 min guardado lejos de la carpeta de sus temas pasó de 12 a ~22 temas reconocidos)
    let hits = await scanSet(lib, fp, seconds, read, { exclude, long, onStep: step, isCancelled: opts.isCancelled })
    const more = this.foldersOf(hits, fileId, new Set(long.map((l) => l.fileId)))
    if (more.length) {
      long = long.concat(await this.wholePrints(more, opts, T.deLasCarpetas))
      hits = await scanSet(lib, fp, seconds, read, { exclude, long, speeds: opts.speeds, onStep: step, isCancelled: opts.isCancelled })
    } else if (opts.speeds) hits = await scanSet(lib, fp, seconds, read, { exclude, long, speeds: true, onStep: step, isCancelled: opts.isCancelled })
    if (opts.isCancelled?.()) throw new Error(T.cancelado)
    const durations = this.db.prepare('SELECT duration FROM files WHERE id = ?')
    const prefer = this.db.prepare(`SELECT f.kind, f.ext, f.kbps, (f.artist IS NOT NULL AND f.title IS NOT NULL) AS tagged FROM files f WHERE f.id = ?`)
    const rank = (id: number) => { const r = prefer.get(id) as { kind: string; ext: string; kbps: number | null; tagged: number }; return [r.kind === 'musica' ? 0 : 1, r.tagged ? 0 : 1, -(r.kbps ?? 0)] }
    const built = buildTracklist(hits, seconds, (id) => (durations.get(id) as { duration: number | null } | undefined)?.duration ?? null, (a, b) => {
      const x = rank(a), y = rank(b)
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
      return 0
    }, refiner(lib, fp, long), twins(lib, long, (id) => this.named({ source: 'biblioteca', fileId: id } as TrackInSet).title))
    let entries: TrackInSet[] = built.map((e) => this.named({
      start: Math.round(e.start), until: Math.round(e.heardUntil), source: e.fileId == null ? null : 'biblioteca', fileId: e.fileId, alsoIds: e.alsoIds,
      artist: null, title: null, confidence: e.confidence, rate: e.rate, windows: e.windows,
    }))
    const t2 = Date.now()
    // lo que no está en la biblioteca: AcoustID (la huella del tramo) y el reconocedor (un fragmento), si se pidió
    let internet: SetTracklist['internet']
    if (opts.internet) internet = await recognizeGaps(entries, fp, path, this.ffmpeg, opts.recognizers ?? { acoustid: null, audd: null }, opts).then((r) => { entries = r.entries; return r.info })
    entries = this.keepEdits(fileId, entries)
    const took = { read: Math.round((t1 - t0) / 100) / 10, search: Math.round((t2 - t1) / 100) / 10, internet: Math.round((Date.now() - t2) / 100) / 10 }
    this.store(fileId, entries, took, internet)
    return this.saved(fileId)!
  }

  /**
   * Los temas de la carpeta del set (y de la de arriba, si no es la raíz): muchas veces el DJ guarda ahí lo que tocó. Si
   * son demasiados (más de 400: la carpeta de arriba es media biblioteca) se queda con los de la misma carpeta.
   */
  neighbors(fileId: number): number[] {
    const f = this.file(fileId)
    if (!f) return []
    const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : ''
    const up = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    for (const prefix of [up, dir]) {
      if (!prefix) continue
      const ids = this.folderTracks(fileId, prefix)
      if (ids.length <= MAX_NEIGHBORS) return ids
    }
    return []
  }

  /** Los temas (no sets) de una carpeta y sus subcarpetas, en el disco del set. */
  private folderTracks(setId: number, prefix: string): number[] {
    return (this.db.prepare(`SELECT f.id, f.rel_path AS rel, f.duration, f.artist, f.title FROM files f WHERE ${visible('f')} AND f.root_id = (SELECT root_id FROM files WHERE id = ?)
      AND f.kind IN ('musica', 'revisar') AND f.id <> ? AND f.duration BETWEEN 30 AND 15 * 60 AND f.rel_path LIKE ? ESCAPE '!'`).all(setId, setId, `${prefix.replace(/[!%_]/g, (c) => `!${c}`)}/%`) as
      { id: number; rel: string; duration: number; artist: string | null; title: string | null }[]).filter((r) => !setReason(r.rel, r.duration, r)).map((r) => r.id)
  }

  /**
   * Las carpetas donde están dos o más de los temas que ya se reconocen (con dos ventanas o más): ahí suele estar el resto
   * del set. Sus temas (sin los que ya están en `already`), hasta 400 en total, las carpetas con más temas reconocidos primero.
   */
  private foldersOf(hits: SetHit[], setId: number, already: Set<number>): number[] {
    const count = new Map<number, number>()
    for (const h of hits) count.set(h.fileId, (count.get(h.fileId) ?? 0) + 1)
    const dirs = new Map<string, Set<number>>()
    for (const [id, n] of count) {
      if (n < 2) continue
      const rel = this.file(id)?.rel
      if (!rel?.includes('/')) continue
      const dir = rel.slice(0, rel.lastIndexOf('/'))
      if (!dirs.has(dir)) dirs.set(dir, new Set())
      dirs.get(dir)!.add(id)
    }
    const out: number[] = []
    for (const [dir] of [...dirs].filter(([, ids]) => ids.size >= 2).sort((a, b) => b[1].size - a[1].size)) {
      const ids = this.folderTracks(setId, dir).filter((id) => !already.has(id) && !out.includes(id))
      if (out.length + ids.length > MAX_NEIGHBORS) continue
      out.push(...ids)
    }
    return out
  }

  /** La huella entera de unos temas: la guardada si el archivo no cambió; si no, se escuchan (y se guardan). */
  private async wholePrints(ids: number[], prog: Progress, where: string): Promise<{ fileId: number; fp: Uint32Array; duration: number | null }[]> {
    const out: { fileId: number; fp: Uint32Array; duration: number | null }[] = []
    const saved = this.db.prepare('SELECT src_size AS size, src_mtime AS mtime, chromaprint FROM long_prints WHERE file_id = ?')
    const put = this.db.prepare(`INSERT INTO long_prints (file_id, src_size, src_mtime, chromaprint, made_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (file_id) DO UPDATE SET src_size = excluded.src_size, src_mtime = excluded.src_mtime, chromaprint = excluded.chromaprint, made_at = excluded.made_at`)
    let i = 0
    for (const id of ids) {
      if (prog.isCancelled?.()) break
      i++
      const f = this.file(id)
      if (!f) continue
      const p = this.pathOf(id)
      if (!p || !fs.existsSync(p)) continue
      const now = fs.statSync(p)
      const r = saved.get(id) as { size: number; mtime: number; chromaprint: string } | undefined
      if (r && r.size === now.size && r.mtime === now.mtimeMs) { try { out.push({ fileId: id, fp: decodeFingerprint(r.chromaprint), duration: f.duration }); continue } catch { /* se vuelve a leer */ } }
      prog.onProgress?.({ done: Math.round((i * 100) / ids.length), total: 100, current: T.enteros(where, i, ids.length) })
      try {
        const st = fs.statSync(p)
        const got = await setPrint({ ffmpeg: this.ffmpeg, file: p, channels: f.channels, duration: f.duration, isCancelled: prog.isCancelled })
        if (!got.fp.length) continue
        put.run(id, st.size, st.mtimeMs, encodeFingerprint(got.fp), new Date().toISOString())
        out.push({ fileId: id, fp: got.fp, duration: f.duration })
      } catch { /* un tema que no se puede leer no frena el resto */ }
    }
    return out
  }

  /** Lo corregido a mano antes (temas quitados, tramos escritos) sigue si hay un tramo que empieza ahí (±20 s). */
  private keepEdits(fileId: number, entries: TrackInSet[]): TrackInSet[] {
    const before = this.saved(fileId)?.entries ?? []
    const edits = before.filter((e) => e.hidden || e.confirmed || e.source === 'mano')
    if (!edits.length) return entries
    const out = entries.map((e) => {
      const m = edits.find((x) => Math.abs(x.start - e.start) <= 20 && (x.source === 'mano' ? e.source !== 'biblioteca' || e.confidence === 'baja' : x.fileId === e.fileId && x.artist === e.artist && x.title === e.title))
      return m ? (m.source === 'mano' ? { ...m, until: e.until } : { ...e, hidden: m.hidden, confirmed: m.confirmed }) : e
    })
    for (const m of edits.filter((x) => x.source === 'mano')) if (!out.includes(m) && !out.some((e) => e.source === 'mano' && e.start === m.start)) out.push(m)
    return out.sort((a, b) => a.start - b.start)
  }

  private store(fileId: number, entries: TrackInSet[], took?: SetTracklist['took'], internet?: SetTracklist['internet']) {
    const plain = entries.map(({ rel: _r, ...e }) => e)
    this.db.prepare(`INSERT INTO set_tracklists (file_id, made_at, entries) VALUES (?, ?, ?)
      ON CONFLICT (file_id) DO UPDATE SET made_at = excluded.made_at, entries = excluded.entries`).run(fileId, new Date().toISOString(), JSON.stringify({ entries: plain, took, internet }))
  }

  /** Guarda lo corregido a mano: quitar un tema ("no es este"), escribir uno, mover cuándo entra. */
  edit(fileId: number, entries: TrackInSet[]): SetTracklist {
    const cur = this.saved(fileId)
    if (!cur) throw new Error(T.sinTracklist)
    const clean = entries.map((e) => ({ ...e, start: Math.max(0, Math.round(e.start)), artist: e.artist?.trim() || null, title: e.title?.trim() || null }))
      .sort((a, b) => a.start - b.start)
    this.store(fileId, clean, cur.took, cur.internet)
    return this.saved(fileId)!
  }

  private must(fileId: number): SetTracklist {
    const t = this.saved(fileId)
    if (!t) throw new Error(T.sinTracklist)
    return t
  }

  /** El tracklist como texto (con minutos), hoja .cue o planilla CSV. */
  export(fileId: number, format: TracklistFormat): string { return tracklistExport(this.must(fileId), format) }
  /** El comentario para el tag del set (core/setlists-out.ts). */
  commentFor(fileId: number, current: string | null): string | null { const t = this.saved(fileId); return t ? commentFor(t, current) : null }
  saveCues(fileId: number): number { return saveCues(this.db, this.must(fileId)) }
  clearCues(fileId: number): number { return clearCues(this.db, fileId) }
  cuesSaved(fileId: number): number { return cuesSaved(this.db, fileId) }
}
