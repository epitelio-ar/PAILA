// Bandeja vigilada: revisa cada archivo nuevo (emparejar + verificar la calidad), guarda el resultado, arma la simulación
// de "Reemplazar todos" y la aplica con el Reemplazo de siempre. Lo usado va a <Bandeja>/usados/ y lo que no sirvió a
// <Bandeja>/no-sirvió/ con el motivo: nunca se borra nada.
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from './db'
import { probe } from './probe'
import { INBOX_DONE_DIRS, type Inbox } from './inbox'
import { AUDIO_EXT } from './files'
import { breather, runMovesAsync } from './ops/run'
import type { CandidateInfo, Replacer } from './replace'
import type { InboxAdd } from './inboxadd'
import type { Wanted } from './wanted'
import type { DupItem, InboxAddPlan, InboxAddResult, InboxApplyResult, InboxCheck, InboxMotivo, InboxPlan, InboxResult } from '@paila/shared/types'
import { pickKeeper } from './dupkeeper'
import { beatsOnQuality, duraDistinto, flagList, gapsOverClean, saturaMas, type Copy } from './better'
import { enCadaIdioma, enEsteIdioma, idioma } from '@paila/shared/idioma'
import { P, T } from './inboxflow.textos'

const FAKE = ['fake_lossless', 'maybe_transcoded', 'upscaled']
/** Tolerancias de la verificación (plan aprobado el 20/10). La duración y los recortes, en core/better.ts (los comparte NAPIA). */
const MASTER_DB = 2
/**
 * Un FLAC hecho de un MP3 saturado engaña al detector de agudos (la saturación agrega "ruido" arriba, no música). Pero
 * sabemos dónde corta el tuyo: uno hecho a partir de un archivo así conserva un escalón justo ahí y suma poco sonido
 * arriba. Corrida del 20/10: los falsos, escalón de 16 y 57 dB y suman 28 y 19 dB; los buenos pasan lisos (escalón de 0 a
 * 12 dB) y suman de 35 a 96 dB (35: "Cómo le Digo", donde el tuyo es un MP3 de 96 disfrazado y muy saturado).
 */
const WALL_DB = 8
const MIN_GAIN_DB = 40
const NYQUIST = 22050
export const USED_DIR = INBOX_DONE_DIRS[0]
export const REJECT_DIR = INBOX_DONE_DIRS[1]
export const REASONS_FILE = 'motivos.txt'
/** La tanda del Historial de lo que el modo automático reemplazó ese día (se deshace junta). */
export const autoBatch = (d = new Date()) => `${AUTO_BATCH}${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const AUTO_BATCH = 'bandeja-auto-'

/** Lo que se sabe del tema de la biblioteca para compararlo. */
export interface OldSide { grade: string | null; duration: number | null; clipEvents: number | null; lufs: number | null; cutoff?: number | null; spectrum?: number[] | null
  /** Las marcas del análisis del tema de la biblioteca ("gaps": tiene huecos). */
  flags?: string | null
  /** Su calidad real en kbps (1411 = CD). */
  effKbps?: number | null }

/** Un archivo que llegó, como copia de Duplicados (`id`: su lugar en la lista), para elegir entre dos para el mismo tema. */
const candidateItem = (id: number, r: InboxResult): DupItem => ({
  id, rel: r.name, ext: r.ext, size: r.size, kbps: r.kbps, duration: r.duration, grade: r.check?.newGrade ?? null, kind: 'musica',
  tagged: !!(r.artist && r.title), artist: r.artist, title: r.title, playlists: [], ...r.sound,
})

/** dB promedio de un espectro de 128 puntos (0–22 kHz) entre dos frecuencias. */
function band(sp: number[], from: number, to: number): number {
  const w = NYQUIST / sp.length
  const xs = sp.slice(Math.max(0, Math.floor(from / w)), Math.min(sp.length, Math.ceil(to / w)))
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN
}

/**
 * ¿El archivo nuevo es mejor de verdad? Mejor nota, o la misma con más calidad real y entero (core/better.ts, la misma vara
 * que NAPIA); un FLAC falso no pasa; duración ±2 s, no dañado y sin más recortes de volumen que el original. Si el volumen
 * cambia 2 dB o más es otro master: pasa con aviso.
 */
export function verify(old: OldSide, c: CandidateInfo): InboxCheck {
  const problems: string[] = [], problemsEs: string[] = [], warnings: string[] = []
  // cada motivo, en el idioma de la pantalla y en castellano (para no-sirvió/motivos.txt)
  const no = (p: { es: string; en: string }) => { problems.push(p[idioma()]); problemsEs.push(p.es) }
  // "mejor" con la misma vara que NAPIA cuando baja algo para reemplazar el tuyo (core/better.ts)
  const nueva: Copy = { grade: c.grade, effKbps: c.effKbps ?? null, flags: c.flags }, tuya: Copy = { grade: old.grade, effKbps: old.effKbps ?? null, flags: flagList(old.flags) }
  if (c.flags.includes('damaged')) no(P.danado())
  // con huecos, aunque sean pocos, no reemplaza a uno limpio (el autor, 24/10: entre una con huecos y una limpia, la limpia)
  else if (gapsOverClean(nueva, tuya)) no(P.conHuecos())
  if (c.flags.some((f) => FAKE.includes(f))) no(P.noEsLoQueDice(c.label))
  if (!old.grade) no(P.noAnalizado())
  else if (!beatsOnQuality(nueva, tuya)) {
    no(c.grade === old.grade ? P.mismaNota(c.grade, c.effKbps ?? null, old.effKbps ?? null) : P.noEsMejor(c.grade, c.label, old.grade))
  }
  if (old.duration != null && c.duration != null && duraDistinto(c.duration, old.duration)) {
    no(P.duraDistinto(Math.round(old.duration), Math.round(c.duration)))
  }
  // ¿suma agudos donde el tuyo corta? (solo si el tuyo tiene una pared, el nuevo dice llegar más arriba y no se delató solo)
  const cut = old.cutoff ?? NYQUIST
  if (old.spectrum?.length && c.spectrum?.length && cut < NYQUIST - 1500 && (c.cutoff ?? 0) > cut + 500 && !c.flags.some((f) => FAKE.includes(f))) {
    const above = band(c.spectrum, cut + 300, cut + 1500)
    const wall = band(c.spectrum, cut - 1500, cut - 300) - above, gain = above - band(old.spectrum, cut + 300, cut + 1500)
    if (wall >= WALL_DB && gain < MIN_GAIN_DB) no(P.hechoDelTuyo(cut))
  }
  if (saturaMas(c, old)) no(P.masFuerte(c.clipEvents ?? 0, old.clipEvents ?? 0))
  if (old.lufs != null && c.lufs != null && Math.abs(old.lufs - c.lufs) >= MASTER_DB) {
    warnings.push(T.otroMaster(Math.abs(old.lufs - c.lufs)))
  }
  return { ok: problems.length === 0, newGrade: c.grade, newLabel: c.label, oldGrade: old.grade, problems, problemsEs, notAnalyzed: !old.grade, warnings }
}

export interface FlowDeps {
  ffprobe: string
  /** Analiza la calidad de un archivo de afuera (describeCandidate con un worker). */
  describe: (file: string) => Promise<CandidateInfo>
  /** Cuáles de estos temas ya se exportaron a Rekordbox (para avisar en la simulación). */
  inRekordbox: (ids: number[]) => number[]
}

export class InboxFlow {
  constructor(private db: Db, private inbox: Inbox, private wanted: Wanted, private replacer: Replacer, private deps: FlowDeps) {}

  private libStamp(fileId: number): string | null {
    const r = this.db.prepare(`SELECT size, mtime FROM files WHERE id = ? AND ${visible()}`).get(fileId) as { size: number; mtime: number } | undefined
    return r ? `${r.size}|${r.mtime}` : null
  }

  /** El resultado guardado si el archivo y el tema emparejado no cambiaron; si no, null. */
  cached(file: string): InboxResult | null {
    let st: fs.Stats
    try { st = fs.statSync(file) } catch { return null }
    const r = this.db.prepare('SELECT size, mtime, result FROM inbox_items WHERE path = ?').get(file) as { size: number; mtime: number; result: string } | undefined
    if (!r || r.size !== st.size || r.mtime !== Math.round(st.mtimeMs)) return null
    const res = JSON.parse(r.result) as InboxResult
    if (res.match && this.libStamp(res.match.fileId) !== res.libStamp) return null
    // el motivo en el idioma de hoy (P3: si se cambió el idioma, sin volver a revisar). Solo las palabras: si lo guardado no
    // tiene la misma cantidad de problemas y avisos que la traducción, manda lo guardado (decide si se reemplaza solo)
    const t = res.idiomas?.[idioma()], c = res.check
    if (t) {
      res.why = t.why
      if (c && c.problems.length === t.problems.length && c.warnings.length === t.warnings.length) { c.problems = t.problems; c.warnings = t.warnings }
    }
    return res
  }

  /** Revisa un archivo: emparejar, verificar y decidir. Lo guarda (mientras no cambie, no se vuelve a analizar). */
  async evaluate(file: string, opts: { force?: boolean } = {}): Promise<InboxResult> {
    if (!opts.force) { const c = this.cached(file); if (c) return c }
    const st = fs.statSync(file)
    const base = { path: file, name: path.basename(file), ext: path.extname(file).slice(1).toLowerCase(), size: st.size, checkedAt: new Date().toISOString() }
    let res: InboxResult
    // lo que hace falta para volver a armar el motivo en el otro idioma
    let comparado: { old: OldSide; cand: CandidateInfo } | null = null, nota: string | null = null, error: string | null = null
    try {
      const m = await probe(this.deps.ffprobe, file)
      const id = await this.inbox.identify(file, m)
      nota = id.note
      res = { ...base, kbps: m.kbps ?? null, duration: m.duration ?? null, codec: m.codec ?? null, artist: id.artist, title: id.title, match: null, missing: id.missing, check: null, decision: 'sin-pareja', why: id.note ?? T.sinPareja, libStamp: null }
      if (id.missing) {
        res.decision = 'falta'
        res.why = T.faltaba(id.missing.artist, id.missing.title, id.missing.refRel ? path.posix.basename(id.missing.refRel) : null)
        this.wanted.arrived({ wantedId: id.missing.wantedId }, file)
      } else if (id.match) {
        const wantedRow = this.db.prepare('SELECT id FROM wanted WHERE file_id = ?').get(id.match.fileId) as { id: number } | undefined
        res.match = { ...id.match, wantedId: wantedRow?.id ?? null }
        res.libStamp = this.libStamp(id.match.fileId)
        if (id.match.kind === 'mismo' || id.match.kind === 'probable') {
          const o = this.db.prepare('SELECT f.duration, a.grade, a.clip_events AS clipEvents, a.lufs, a.cutoff, a.spectrum, a.flags, a.eff_kbps AS effKbps FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id = ?').get(id.match.fileId) as unknown as OldSide & { spectrum: string | null }
          const old: OldSide = { ...o, spectrum: o.spectrum ? JSON.parse(o.spectrum) as number[] : null }
          const cand = await this.deps.describe(file)
          res.check = verify(old, cand)
          comparado = { old, cand }
          res.sound = { clipEvents: cand.clipEvents, lufs: cand.lufs, cutoff: cand.cutoff, encoder: cand.encoder ?? null, sampleRate: cand.sampleRate, gaps: cand.flags.includes('gaps') }
        }
        res.decision = id.match.kind !== 'mismo' ? 'mirar' : res.check?.ok ? 'reemplazar' : onlyNotAnalyzed(res.check) ? 'mirar' : 'no-sirve'
        res.why = this.why(res, id.note)
        if (res.decision === 'reemplazar') this.wanted.arrived({ fileId: id.match.fileId }, file)
      }
    } catch (e) {
      error = (e as Error).message
      res = { ...base, kbps: null, duration: null, codec: null, artist: null, title: null, match: null, missing: null, check: null, decision: 'error', why: T.noLeer((e as Error).message), libStamp: null }
    }
    const r = res
    r.idiomas = enCadaIdioma(() => this.motivo(r, comparado, nota, error))
    this.db.prepare('INSERT INTO inbox_items (path, size, mtime, result, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, result = excluded.result, checked_at = excluded.checked_at')
      .run(file, st.size, Math.round(st.mtimeMs), JSON.stringify(res), res.checkedAt)
    return res
  }

  /** El motivo de `r` en el idioma de ahora (enCadaIdioma lo arma en los dos): lo mismo que se calculó al revisar. */
  private motivo(r: InboxResult, v: { old: OldSide; cand: CandidateInfo } | null, note: string | null, error: string | null): InboxMotivo {
    const check = v ? verify(v.old, v.cand) : null
    const n = note && enEsteIdioma(note)
    const m = r.missing
    const why = error != null ? T.noLeer(error)
      : m ? T.faltaba(m.artist, m.title, m.refRel ? path.posix.basename(m.refRel) : null)
        : r.match ? this.why({ ...r, check }, n)
          : n ?? T.sinPareja
    return { why, problems: check?.problems ?? [], warnings: check?.warnings ?? [] }
  }

  private why(r: InboxResult, note: string | null): string {
    const name = path.posix.basename(r.match!.rel)
    const c = r.check
    switch (r.decision) {
      case 'reemplazar': return T.reemplazar(name, c!.oldGrade, c!.newGrade, c!.warnings.join(' '))
      case 'no-sirve': return T.noSirve(name, c!.problems.join(' '))
      default:
        if (r.match!.kind === 'probable') return T.probable(r.match!.by === 'tags', name, c && !c.ok ? c.problems.join(' ') : '')
        if (r.match!.kind === 'mismo') return T.mismo(name, c!.problems.join(' '))
        return note ?? T.seParece(name)
    }
  }

  /** Lo revisado de una carpeta (lo que sigue ahí y no cambió). */
  results(folder: string): InboxResult[] {
    // los temas de un ZIP de la Bandeja se abren en la carpeta de trabajo
    const prefixes = [path.resolve(folder) + path.sep, path.resolve(this.inbox.workDir) + path.sep]
    const rows = (this.db.prepare('SELECT path FROM inbox_items').all() as { path: string }[]).filter((r) => prefixes.some((p) => r.path.startsWith(p)))
    const out: InboxResult[] = []
    for (const r of rows) { const c = this.cached(r.path); if (c) out.push(c) }
    const order: Record<InboxResult['decision'], number> = { reemplazar: 0, falta: 1, mirar: 2, 'no-sirve': 3, 'sin-pareja': 4, error: 5 }
    return out.sort((a, b) => order[a.decision] - order[b.decision] || a.name.localeCompare(b.name))
  }

  /** La simulación de "Reemplazar todos": nada se toca hasta confirmar. */
  plan(folder: string): InboxPlan {
    const all = this.results(folder)
    const ok = all.filter((r) => r.decision === 'reemplazar' && r.match)
    const replace = ok.map((r) => {
      const m = r.match!
      const newRel = m.rel.replace(/\.[^./]+$/, '') + '.' + r.ext
      return { path: r.path, name: r.name, fileId: m.fileId, rel: m.rel, newRel, oldGrade: r.check?.oldGrade ?? null, newGrade: r.check?.newGrade ?? '', inRekordbox: false, warnings: r.check?.warnings ?? [] }
    })
    // dos archivos para el mismo tema: va el mejor con la regla de Duplicados (la nota, el formato, el que satura menos, el bitrate,
    // LAME antes que ffmpeg…; repaso de criterios del 24/10: antes, a igual nota, el primero por nombre); el otro queda para mirar
    const byTrack = new Map<number, number[]>()
    replace.forEach((p, i) => byTrack.set(p.fileId, [...(byTrack.get(p.fileId) ?? []), i]))
    const chosen = [...byTrack.values()].map((idx) => replace[idx.length === 1 ? idx[0] : pickKeeper(idx.map((i) => candidateItem(i, ok[i])))])
    const rb = new Set(this.deps.inRekordbox(chosen.map((p) => p.fileId)))
    for (const p of chosen) p.inRekordbox = rb.has(p.fileId)
    const reject = all.filter((r) => r.decision === 'no-sirve').map((r) => ({ path: r.path, name: r.name, reason: r.check?.problems.join(' ') || r.why }))
    return { replace: chosen, reject, rekordbox: rb.size }
  }

  /**
   * "Modo automático" (apagado de fábrica): lo que se puede reemplazar solo, sin preguntar, apenas llega. Solo con confianza:
   * el mismo audio según la huella acústica (no por el nombre ni los tags), mejor de verdad según la verificación y sin
   * avisos (otro master, con otro volumen, queda para que lo mires vos); nunca un tema que ya está en Rekordbox, y si llegaron
   * dos para el mismo tema, solo el mejor. null: queda para "Reemplazar todos" (o para mirar).
   */
  autoItem(folder: string, file: string): InboxPlan['replace'][number] | null {
    const r = this.cached(file)
    if (!r || r.decision !== 'reemplazar' || !r.match || r.match.kind !== 'mismo' || r.match.by !== 'sonido' || !r.check?.ok || r.check.warnings.length) return null
    const item = this.plan(folder).replace.find((p) => p.path === file)
    return item && !item.inRekordbox ? item : null
  }

  /**
   * Aplica la simulación (llamar con el candado tomado y el análisis en pausa). Cada reemplazo usa el Reemplazo de siempre
   * (papelera, tags, tapa, nombre, playlists, Historial y deshacer), todos en una misma tanda del Historial. `batch`: otra
   * tanda (el modo automático junta lo del día: `bandeja-auto-<día>`).
   */
  async apply(folder: string, plan: InboxPlan, on: { progress?: (done: number, total: number, current: string) => void; cancelled?: () => boolean } = {}, batchName?: string): Promise<InboxApplyResult> {
    const out: InboxApplyResult = { replaced: 0, rejected: 0, failed: [] }
    const batch = batchName ?? `bandeja-${Date.now()}`
    const total = plan.replace.length + plan.reject.length
    const breathe = breather() // de a un archivo por vuelta: cada ~30 ms la app respira (si no, cientos congelan la ventana)
    let done = 0
    for (const p of plan.replace) {
      await breathe()
      if (on.cancelled?.()) break
      on.progress?.(done++, total, p.name)
      const fresh = this.cached(p.path)
      if (!fresh || fresh.decision !== 'reemplazar' || fresh.match?.fileId !== p.fileId) { out.failed.push({ name: p.name, error: T.cambio }); continue }
      try {
        const r = await this.replacer.replace(p.fileId, p.path, { keepTags: true, keepCover: true, sameName: true, batch })
        const used = await this.moveDone(folder, p.path, USED_DIR)
        this.wanted.replaced(p.fileId, r.replacementId, used)
        out.replaced++
      } catch (e) { out.failed.push({ name: p.name, error: (e as Error).message }) }
    }
    for (const r of plan.reject) {
      await breathe()
      if (on.cancelled?.()) break
      on.progress?.(done++, total, r.name)
      if (!fs.existsSync(r.path)) continue
      // el motivo va a motivos.txt en castellano (lo que PAILA escribe en tus carpetas no cambia de idioma)
      const es = this.cached(r.path)?.check?.problemsEs
      try { await this.moveDone(folder, r.path, REJECT_DIR, es?.length ? es.join(' ') : r.reason); out.rejected++ } catch (e) { out.failed.push({ name: r.name, error: (e as Error).message }) }
    }
    await this.retireZips(folder)
    return out
  }

  /**
   * "Pasar a tu Música" (core/inboxadd.ts; llamar con el candado tomado) y después, como en apply, los ZIP de la Bandeja que
   * quedaron sin temas pasan a `usados/`: antes quedaban ahí aunque ya no tuvieran nada (22/10).
   */
  async addToMusic(folder: string, add: InboxAdd, plan: InboxAddPlan, chosen: string[], on?: Parameters<InboxAdd['apply']>[2]): Promise<InboxAddResult> {
    const r = await add.apply(plan, chosen, on)
    if (r.added) await this.retireZips(folder)
    return r
  }

  /**
   * Un ZIP de la Bandeja cuyos temas ya se usaron todos (o no sirvieron) pasa a `usados/`, así no queda en la Bandeja
   * como si faltara algo. Su copia abierta en la carpeta de trabajo de PAILA (lo que quedó: tapas, textos) se saca.
   */
  async retireZips(folder: string) {
    const zips: string[] = []
    const visit = (dir: string, depth: number) => {
      let names: string[]
      try { names = fs.readdirSync(dir) } catch { return }
      for (const n of names) {
        const p = path.join(dir, n)
        if (depth === 0 && INBOX_DONE_DIRS.includes(n.toLowerCase())) continue
        if (n.toLowerCase().endsWith('.zip')) zips.push(p)
        else if (depth < 3) { try { if (fs.statSync(p).isDirectory()) visit(p, depth + 1) } catch { /* se fue */ } }
      }
    }
    visit(folder, 0)
    for (const zip of zips) {
      const dir = this.inbox.zipDir(zip)
      if (!fs.existsSync(dir)) continue // nunca se abrió: no se sabe qué tiene
      const left = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => AUDIO_EXT.has(path.extname(f).slice(1).toLowerCase()))
      if (left.length) continue // quedan temas por mirar
      await this.moveDone(folder, zip, USED_DIR)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Mueve un archivo de la Bandeja a `usados/` o `no-sirvió/` sin pisar nada (si ya hay uno con ese nombre, le agrega un
   * número). Lo que no sirvió deja el motivo en `no-sirvió/motivos.txt`. Devuelve dónde quedó.
   */
  async moveDone(folder: string, file: string, sub: string, reason?: string): Promise<string> {
    const dir = path.join(folder, sub)
    fs.mkdirSync(dir, { recursive: true })
    const ext = path.extname(file), stem = path.basename(file, ext)
    let dest = path.join(dir, stem + ext)
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${stem} (${i})${ext}`)
    // con el motor de operaciones: diario antes de mover (un corte en el medio lo resuelve la recuperación al abrir) y,
    // entre discos (un ZIP abierto en la carpeta de trabajo), copia verificada antes de sacar el original
    const r = await runMovesAsync(this.db, [{ kind: 'sacar', op: 'bandeja', rootId: null, fileId: null, src: file, dst: dest, data: { file, dest } }], {
      rootPath: () => null,
      annotate: () => { this.db.prepare('DELETE FROM inbox_items WHERE path = ?').run(file) },
    })
    if (r.failed.length) throw new Error(r.failed[0].error)
    if (reason) fs.appendFileSync(path.join(dir, REASONS_FILE), `${new Date().toLocaleString('es-AR')} · ${path.basename(dest)} · ${reason}\r\n`)
    return dest
  }
}

/** El único problema es que el tema de la biblioteca no estaba analizado: no se puede decidir, se mira a mano (no va a `no-sirvió/`). */
const onlyNotAnalyzed = (c: InboxCheck | null) => !!c && c.problems.length === 1 && !!c.notAnalyzed
