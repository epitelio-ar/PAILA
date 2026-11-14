// Separar voz, lo que toca archivos (MASTERPLAN-4, 4B.6): a dónde van la acapella y el instrumental (una carpeta propia, de
// fábrica «Acapellas e instrumentales (PAILA)» en tu carpeta de música, que cuenta como Producción: nunca se renombra ni se
// reorganiza), cómo se llaman y ponerlos en su lugar por el motor (diario, sin pisar nada, verificado), con su tanda en el
// Historial. Deshacer los manda a la papelera de PAILA. El tema original nunca se toca.
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from '../db'
import { runMovesAsync } from '../ops/run'
import type { Step } from '../ops/types'
import { trashBatch } from '../safefs'
import { soloLectura, T as J } from '../journal'
import { pruneEmpty } from '../archive/extract'
import { clean, readCover, readTags, safeName, writeTags } from '../tagio'
import { T as R } from '../recovery.textos'
import { textos } from '@paila/shared/idioma'
import type { CollectionKind, HistoryDetailRow, HistoryEntry, HistoryUndoResult, RootInfo, StemsDestino, StemsHecho, StemsTema } from '@paila/shared/types'

/** Nombres que PAILA escribe en tu disco: no se traducen. */
export const STEMS_FOLDER = 'Acapellas e instrumentales (PAILA)'
/** Lo separado en 4 partes, de fábrica en su propia carpeta (el autor: "ordenalo como sea mejor", 31/10). */
export const STEMS4_FOLDER = 'Stems (PAILA)'
// en 4 partes, lo que no es voz, batería ni bajo se llama «Instrumental» (el autor, 31/10): va a su propia carpeta, así no se
// confunde con el instrumental de Separar voz (que es todo menos la voz)
const PARTE = { acapella: 'Acapella', instrumental: 'Instrumental', bateria: 'Batería', bajo: 'Bajo', resto: 'Instrumental' } as const
export const STEMS_COMMENT = 'Separado por PAILA con MDX-Net Inst_HQ_3 (UVR, MIT)'
export const STEMS_MODEL_ID = 'mdx-inst-hq3'
export const CUATRO_COMMENT = 'Separado por PAILA con HT-Demucs v4 (Meta, MIT)'
export const CUATRO_MODEL_ID = 'htdemucs'
export const MAX_MODEL_ID = 'htdemucs-ft'
export const MAX_COMMENT = 'Separado por PAILA con HT-Demucs v4 ft, máxima calidad (Meta, MIT)'
export const STEMS_SETTING = 'stems_dir'
/** Carpeta de trabajo, en el mismo disco que el destino (_PAILA: el escaneo no la recorre). */
export const STEMS_STAGING = '_PAILA/separando'

export type StemsPart = keyof typeof PARTE
/** Un tema con lo que hace falta para separarlo y nombrar lo que sale. */
export type StemsFuente = StemsTema & { abs: string; rootId: number; rel: string; artist: string | null; title: string | null }
export interface StemsData { batch: number; sourceId: number; sourceRel: string; part: StemsPart; rootId: number; rel: string; /** de fábrica, el de Separar voz */ model?: string }
export interface StemsUndoData { id: number; rootId: number; rel: string; trashRel: string }

const T = textos({
  fueraDeMusica: { es: 'Elegí una carpeta adentro de tu Música (así lo separado aparece en PAILA y se puede deshacer)', en: 'Choose a folder inside your Music (so what is separated shows up in PAILA and can be undone)' },
  enPaila: { es: 'Esa carpeta es de PAILA (_PAILA): elegí otra', en: "That folder belongs to PAILA (_PAILA): choose another one" },
  sinMusica: { es: 'Primero agregá tu carpeta de música', en: 'Add your music folder first' },
  sinDisco: { es: 'El disco de la carpeta de destino no está conectado', en: "The destination folder's disk isn't connected" },
  noEsta: { es: 'Ese tema ya no está', en: "That track isn't there anymore" },
  noSalio: { es: 'No salió de la separación', en: "It didn't come out of the separation" },
  mismoNombre: { es: 'Ya hay un archivo con ese nombre', en: 'There is already a file with that name' },
  yaDeshizo: { es: 'Ya se deshizo', en: 'Already undone' },
  discoNo: { es: 'El disco no está conectado', en: "The disk isn't connected" },
  resumen: { es: (t: string) => `Se separó «${t}» en acapella e instrumental (el original quedó igual)`, en: (t: string) => `«${t}» was separated into acapella and instrumental (the original stayed the same)` },
  resumen4: { es: (t: string) => `Se separó «${t}» en voz, batería, bajo e instrumental (el original quedó igual)`, en: (t: string) => `«${t}» was separated into vocals, drums, bass and instrumental (the original stayed the same)` },
  separado: { es: 'Separado de', en: 'Separated from' },
  yaPuesto: { es: (n: string) => `"${n}" ya se había guardado al separar: se terminó de anotar.`, en: (n: string) => `"${n}" had already been saved when separating: PAILA finished noting it down.` },
  noPuesto: { es: (n: string) => `"${n}" no se llegó a guardar: podés volver a separar el tema.`, en: (n: string) => `"${n}" was never saved: you can separate the track again.` },
  cambiaste: { es: 'Lo cambiaste después de separarlo: queda en tu Música', en: 'You changed it after separating it: it stays in your Music' },
  movido: { es: 'Ya no está donde se guardó (¿lo moviste?)', en: "It's no longer where it was saved (did you move it?)" },
  enPapelera: { es: 'Ya hay algo en la papelera con ese nombre', en: 'There is already something in the trash with that name' },
})

/** Anota en el Historial un archivo que ya quedó en su lugar (lo usa también la recuperación tras un corte). */
export function logStem(db: Db, d: StemsData, abs: string) {
  let st: fs.Stats | null = null
  try { st = fs.statSync(abs) } catch { /* lo anota igual */ }
  db.prepare('INSERT INTO stems_made (batch, source_id, source_rel, part, root_id, rel, size, mtime, model, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.batch, d.sourceId, d.sourceRel, d.part, d.rootId, d.rel, st?.size ?? 0, st ? Math.round(st.mtimeMs) : 0, d.model ?? STEMS_MODEL_ID, new Date().toISOString())
}

/** Anota que un archivo separado ya volvió a la papelera de PAILA (deshacer). */
export function logUnstem(db: Db, d: StemsUndoData) {
  const now = new Date().toISOString()
  db.prepare('UPDATE stems_made SET undone_at = ?, trash_rel = ? WHERE id = ?').run(now, d.trashRel, d.id)
  db.prepare('UPDATE files SET missing_at = COALESCE(missing_at, ?) WHERE root_id = ? AND rel_path = ?').run(now, d.rootId, d.rel)
}

/** Tras un corte: si el archivo ya llegó, se anota; si quedó en la carpeta de trabajo, era de PAILA y se saca (el tema se puede volver a separar). */
export function recoverStems(db: Db, e: { op: string; src: string; dst: string; data: unknown }, exists: (p: string) => boolean):
  { result: 'completado' | 'no-hecho' | 'revisar'; message: string; annotate?: () => void; after?: () => void } {
  const name = path.basename(e.dst)
  if (e.op === 'separar') {
    if (exists(e.dst)) return { result: 'completado', message: T.yaPuesto(name), annotate: () => logStem(db, e.data as StemsData, e.dst), after: () => { if (exists(e.src)) fs.rmSync(e.src, { force: true }) } }
    if (exists(e.src)) return { result: 'no-hecho', message: T.noPuesto(name), after: () => fs.rmSync(e.src, { force: true }) }
    return { result: 'no-hecho', message: T.noPuesto(name) }
  }
  if (exists(e.dst)) return { result: 'completado', message: R.yaEnPapelera(name), annotate: () => logUnstem(db, e.data as StemsUndoData) }
  if (exists(e.src)) return { result: 'no-hecho', message: R.noMandado(name) }
  return { result: 'revisar', message: R.niMusicaNiPapelera(name) }
}

const slash = (p: string) => p.split(path.sep).join('/')
const sinAcentos = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
/** Lo que ve la pantalla de un tema (sin rutas). */
export const publico = (t: StemsFuente): StemsTema => ({ id: t.id, name: t.name, duration: t.duration, grade: t.grade, bpm: t.bpm, musicKey: t.musicKey })
/**
 * Las notas de calidad desde las que se avisa "conseguí uno mejor" antes de separar. Medido el 24/10 con 3 temas de un disco
 * contra sus partes oficiales (docs/pruebas/2026-10-24-4B6-stems-etapa2.md, parte 2): un MP3 de 320 (B) o de 192 (C) separa
 * igual que el FLAC; un MP3 o un AAC de 128 (D) pierde ~0,3 dB en la voz y ~0,8 dB en el instrumental, igual que un 128
 * inflado a 320 (F); un MP3 de 96 (F), 1 y 1,3 dB. En C no se avisa: un MP3 de 192 sería una falsa alarma.
 */
export const STEMS_WARN = ['D', 'F'] as const
/** ¿Conviene conseguir una versión mejor antes de separar este tema? (sin nota todavía, no se avisa). */
export const bajaCalidad = (grade: string | null | undefined) => !!grade && (STEMS_WARN as readonly string[]).includes(grade)
const under = (dir: string, p: string) => { const a = path.resolve(dir).toLowerCase(), b = path.resolve(p).toLowerCase(); return b === a || b.startsWith(a + path.sep) }

export interface StemsDeps {
  db: Db
  rootPath: (rootId: number) => string | null
  roots: () => RootInfo[]
  /** Que la carpeta cuente como Producción (Library.setRule). */
  setRule: (rootId: number, rel: string, kind: CollectionKind) => void
}

export class StemsSeparate {
  constructor(private d: StemsDeps) {}
  private get db() { return this.d.db }

  /**
   * A dónde va lo separado: la elegida o, de fábrica, «Acapellas e instrumentales (PAILA)» en la primera carpeta de música
   * (en 4 partes, «Stems (PAILA)»; si elegiste una carpeta, van las dos ahí). De fábrica va en la carpeta de música del tema
   * (`rootId`) si está conectada, o en la primera conectada: antes iba siempre en la primera, y con ese disco desenchufado
   * no se podía separar un tema de otra carpeta (el autor, 31/10).
   */
  destination(cuatro = false, rootId?: number): StemsDestino {
    const raw = (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(STEMS_SETTING) as { value: string } | undefined)?.value
    let chosen: { rootId: number; rel: string } | null = null
    try { chosen = raw ? JSON.parse(raw) : null } catch { /* de fábrica */ }
    const roots = this.d.roots()
    const root = chosen ? roots.find((r) => r.id === chosen!.rootId) : roots.find((r) => r.id === rootId && r.available) ?? roots.find((r) => r.available) ?? roots[0]
    if (!root) return { rootId: null, rel: null, abs: null, chosen: false, available: false, error: T.sinMusica }
    const rel = chosen?.rel ?? (cuatro ? STEMS4_FOLDER : STEMS_FOLDER)
    return { rootId: root.id, rel, abs: path.join(root.path, ...rel.split('/')), chosen: !!chosen, available: root.available, error: root.available ? null : T.sinDisco }
  }

  /** Elige otra carpeta (tiene que estar adentro de una carpeta de música). null = de fábrica. */
  choose(abs: string | null): StemsDestino {
    if (abs == null) { this.db.prepare('DELETE FROM settings WHERE key = ?').run(STEMS_SETTING); return this.destination() }
    const root = this.d.roots().filter((r) => r.available && under(r.path, abs)).sort((a, b) => b.path.length - a.path.length)[0]
    if (!root) throw new Error(T.fueraDeMusica)
    const rel = slash(path.relative(root.path, abs))
    if (rel.split('/')[0].toLowerCase() === '_paila') throw new Error(T.enPaila)
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(STEMS_SETTING, JSON.stringify({ rootId: root.id, rel }))
    return this.destination()
  }

  /** Un tema, como lo muestra la sección (con su nota de calidad, su BPM y su tono). */
  tema(fileId: number): StemsFuente | null {
    const r = this.db.prepare(`SELECT f.id, f.root_id AS rootId, f.rel_path AS rel, f.artist, f.title, f.duration, a.grade, a.bpm, a.music_key AS musicKey
      FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id = ? AND ${visible('f')}`).get(fileId) as Omit<StemsFuente, 'name' | 'abs'> | undefined
    if (!r) return null
    const root = this.d.rootPath(r.rootId)
    if (!root) return null
    const name = r.artist && r.title ? `${r.artist} - ${r.title}` : path.posix.basename(r.rel).replace(/\.[^.]+$/, '')
    return { ...r, name, abs: path.join(root, ...r.rel.split('/')) }
  }

  /** El nombre de cada archivo («Artista - Título (Acapella) 95 BPM Am.flac»: el BPM y el tono se leen del nombre en Producción), sin pisar nada. */
  names(t: StemsTema, dest: StemsDestino, partes: readonly StemsPart[] = ['acapella', 'instrumental']): Partial<Record<StemsPart, string>> {
    const extra = `${t.bpm ? ` ${Math.round(t.bpm)} BPM` : ''}${t.musicKey ? ` ${t.musicKey}` : ''}`
    const base = safeName(t.name).slice(0, 150)
    const out: Partial<Record<StemsPart, string>> = {}
    for (const p of partes) {
      const stem = `${base} (${PARTE[p]})${extra}`
      let rel = `${dest.rel}/${stem}.flac`
      for (let i = 2; fs.existsSync(path.join(dest.abs!, path.posix.basename(rel))); i++) rel = `${dest.rel}/${stem} (${i}).flac`
      out[p] = rel
    }
    return out
  }

  /** Una carpeta de trabajo nueva para un tema (en el disco del destino). */
  staging(dest: StemsDestino): string {
    const root = this.d.rootPath(dest.rootId!)
    if (!root) throw new Error(T.sinDisco)
    const dir = path.join(root, ...STEMS_STAGING.split('/'), trashBatch('tema'))
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Pone en su lugar lo que salió de separar `fileId` (rutas en la carpeta de trabajo). Llamar con el candado tomado: le pone
   * los tags del original («(Acapella)» en el título), lo mueve sin pisar nada y anota la tanda. La carpeta pasa a Producción.
   */
  async place(fileId: number, staged: Partial<Record<StemsPart, string>>, modo: 'voz' | 'cuatro' | 'max' = 'voz'): Promise<{ batch: number; done: number; failed: { name: string; error: string }[]; rels: string[] }> {
    if (soloLectura()) throw new Error(J.soloLectura)
    const t = this.tema(fileId)
    if (!t) throw new Error(T.noEsta)
    const cuatro = modo !== 'voz'
    const dest = this.destination(cuatro, t.rootId)
    if (!dest.available || dest.rootId == null) throw new Error(dest.error ?? T.sinDisco)
    const root = this.d.rootPath(dest.rootId)!
    const partes = Object.keys(staged) as StemsPart[]
    const names = this.names(t, dest, partes)
    const batch = Date.now()
    const tags = readTags(t.abs), cover = readCover(t.abs)
    const steps: Step<StemsData>[] = []
    for (const p of partes) {
      const src = staged[p]!, rel = names[p]!
      if (fs.existsSync(src)) {
        const title = clean(t.title) ?? tags.title ?? t.name
        writeTags(src, { ...tags, artist: clean(t.artist) ?? tags.artist, title: `${title} (${PARTE[p]})`, cover, comment: modo === 'max' ? MAX_COMMENT : cuatro ? CUATRO_COMMENT : STEMS_COMMENT })
      }
      steps.push({ kind: 'sacar', op: 'separar', rootId: null, fileId: null, src, dst: path.join(root, ...rel.split('/')),
        data: { batch, sourceId: fileId, sourceRel: t.rel, part: p, rootId: dest.rootId, rel, model: modo === 'max' ? MAX_MODEL_ID : cuatro ? CUATRO_MODEL_ID : STEMS_MODEL_ID }, missing: T.noSalio, taken: T.mismoNombre })
    }
    fs.mkdirSync(dest.abs!, { recursive: true })
    const rule = this.d.roots().find((r) => r.id === dest.rootId)?.rules.find((x) => x.rel.toLowerCase() === dest.rel!.toLowerCase())
    if (rule?.kind !== 'produccion') this.d.setRule(dest.rootId, dest.rel!, 'produccion')
    const r = await runMovesAsync<StemsData>(this.db, steps, { rootPath: this.d.rootPath, annotate: (s) => logStem(this.db, s.data, s.dst!) })
    return { batch, done: r.done.length, failed: r.failed.map((f) => ({ name: path.posix.basename(f.step.data.rel), error: f.error })), rels: r.done.map((s) => s.data.rel) }
  }

  /** Lo ya separado, lo último primero (para escuchar, abrir la carpeta y deshacer desde la sección). */
  made(limit = 200): StemsHecho[] {
    const rs = this.db.prepare(`SELECT batch, MIN(source_rel) AS sourceRel, MIN(at) AS at, root_id AS rootId, GROUP_CONCAT(part || '|' || rel, '\n') AS parts,
      SUM(undone_at IS NOT NULL) AS undone, COUNT(*) AS n FROM stems_made GROUP BY batch ORDER BY batch DESC LIMIT ?`).all(limit) as { batch: number; sourceRel: string; at: string; rootId: number; parts: string; undone: number; n: number }[]
    return rs.filter((b) => b.undone < b.n).map((b) => {
      const root = this.d.rootPath(b.rootId)
      const parts = Object.fromEntries(b.parts.split('\n').map((x) => x.split('|') as [StemsPart, string]))
      const abs = (p: StemsPart) => (root && parts[p] ? path.join(root, ...parts[p].split('/')) : null)
      const orden = (Object.keys(PARTE) as StemsPart[]).filter((p) => parts[p])
      return { batch: b.batch, at: b.at, source: path.posix.basename(b.sourceRel), partes: Object.fromEntries(orden.map((p) => [p, abs(p)])), available: !!root }
    })
  }

  /** Las tandas, para el Historial (kind 'separar'). */
  history(): HistoryEntry[] {
    const rows = this.db.prepare(`SELECT batch, root_id AS rootId, MIN(source_rel) AS src, MIN(at) AS at, COUNT(*) AS n, SUM(undone_at IS NOT NULL) AS undone, MAX(model) AS model
      FROM stems_made GROUP BY batch ORDER BY batch`).all() as { batch: number; rootId: number; src: string; at: string; n: number; undone: number; model: string | null }[]
    return rows.map((b) => {
      const undone = b.undone === b.n
      const whyNot = undone ? T.yaDeshizo : !this.d.rootPath(b.rootId) ? T.discoNo : null
      return { kind: 'separar' as const, id: b.batch, at: b.at, files: b.n, undone, canUndo: !whyNot, whyNot, summary: (b.model?.startsWith(CUATRO_MODEL_ID) ? T.resumen4 : T.resumen)(path.posix.basename(b.src).replace(/\.[^.]+$/, '')), note: null }
    })
  }

  historyDetail(batch: number): HistoryDetailRow[] {
    const rs = this.db.prepare('SELECT rel, source_rel AS src, undone_at IS NOT NULL AS undone FROM stems_made WHERE batch = ? ORDER BY part').all(batch) as { rel: string; src: string; undone: number }[]
    return rs.map((r) => ({ name: path.posix.basename(r.rel), folder: path.posix.dirname(r.rel), what: T.separado, before: path.posix.basename(r.src), after: path.posix.basename(r.rel), undone: !!r.undone }))
  }

  /** Deshacer: lo separado (si sigue como quedó) va a la papelera de PAILA. Lo que cambiaste después, queda donde está. */
  async undo(batch: number): Promise<HistoryUndoResult> {
    const rs = this.db.prepare('SELECT id, root_id AS rootId, rel, size, mtime FROM stems_made WHERE batch = ? AND undone_at IS NULL').all(batch) as { id: number; rootId: number; rel: string; size: number; mtime: number }[]
    const out: HistoryUndoResult = { done: 0, failed: [] }
    const folder = trashBatch(`separado-${batch}`)
    const steps: Step<StemsUndoData>[] = []
    for (const r of rs) {
      const root = this.d.rootPath(r.rootId)
      if (!root) { out.failed.push({ rel: r.rel, error: T.discoNo }); continue }
      const abs = path.join(root, ...r.rel.split('/'))
      let st: fs.Stats | null = null
      try { st = fs.statSync(abs) } catch { /* ya no está */ }
      if (st && (st.size !== r.size || Math.abs(st.mtimeMs - r.mtime) > 2000)) { out.failed.push({ rel: r.rel, error: T.cambiaste }); continue }
      const trashRel = `_PAILA/papelera/${folder}/${r.rel}`
      steps.push({ kind: 'sacar', op: 'deshacer-separar', rootId: null, fileId: null, src: abs, dst: path.join(root, ...trashRel.split('/')),
        data: { id: r.id, rootId: r.rootId, rel: r.rel, trashRel }, missing: T.movido, taken: T.enPapelera })
    }
    const r = await runMovesAsync<StemsUndoData>(this.db, steps, { rootPath: this.d.rootPath, annotate: (s) => logUnstem(this.db, s.data) })
    out.done = r.done.length
    out.failed.push(...r.failed.map((f) => ({ rel: f.step.data.rel, error: f.error })))
    return out
  }

  private indice: { at: number; rows: { id: number; key: string }[] } | null = null
  /** Temas que coinciden con todas las palabras (artista, título o ruta; sin acentos ni mayúsculas). No busca en Producción. */
  buscar(q: string, limit = 40): StemsTema[] {
    const words = sinAcentos(q).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    if (!this.indice || Date.now() - this.indice.at > 30_000) {
      const rs = this.db.prepare(`SELECT id, coalesce(artist, '') || ' ' || coalesce(title, '') || ' ' || rel_path AS k FROM files f
        WHERE ${visible('f')} AND kind <> 'produccion' AND kind <> 'excluir'`).all() as { id: number; k: string }[]
      this.indice = { at: Date.now(), rows: rs.map((r) => ({ id: r.id, key: sinAcentos(r.k) })) }
    }
    const out: StemsTema[] = []
    for (const r of this.indice.rows) {
      if (!words.every((w) => r.key.includes(w))) continue
      const t = this.tema(r.id)
      if (t) out.push(publico(t))
      if (out.length >= limit) break
    }
    return out
  }

  /** "Buscar uno mejor": quedan esperando en la sección (la lista «Faltan o suenan mal» la arma quien llama). */
  esperar(ids: number[]) {
    const ins = this.db.prepare('INSERT INTO stems_wait (file_id, grade, at) VALUES (?, ?, ?) ON CONFLICT (file_id) DO NOTHING')
    for (const id of ids) ins.run(id, this.tema(id)?.grade ?? null, new Date().toISOString())
  }
  dejarDeEsperar(id: number) { this.db.prepare('DELETE FROM stems_wait WHERE file_id = ?').run(id) }
  esperando(): (StemsTema & { desde: string })[] {
    const rs = this.db.prepare('SELECT file_id AS id, at FROM stems_wait ORDER BY at').all() as { id: number; at: string }[]
    return rs.flatMap((r) => { const t = this.tema(r.id); return t ? [{ ...publico(t), desde: r.at }] : [] })
  }

  /** Al empezar una cola: los restos de una separación cortada (copias de PAILA, sin nada pendiente en el diario). */
  limpiarTrabajo() {
    const open = (this.db.prepare("SELECT COUNT(*) AS n FROM op_journal WHERE op = 'separar' AND recovered_at IS NULL").get() as { n: number }).n
    if (open) return
    for (const r of this.d.roots()) if (r.available) fs.rmSync(path.join(r.path, ...STEMS_STAGING.split('/')), { recursive: true, force: true })
  }

  /** Saca la carpeta de trabajo de un tema (siempre al terminar, haya salido bien o no). */
  dropStaging(dir: string) {
    fs.rmSync(dir, { recursive: true, force: true })
    const root = this.d.roots().find((r) => under(r.path, dir))
    if (root) pruneEmpty(path.join(root.path, '_PAILA'), path.dirname(dir))
  }
}
