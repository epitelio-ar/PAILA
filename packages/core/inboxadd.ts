// Bandeja: los temas que llegan y no tenías (un tema que te faltaba, o uno que no se parece a nada de tu biblioteca) se
// ofrecen para pasar a tu Música (decidido el 22/10), con vista previa, Historial y deshacer. Van a la carpeta
// "Recibidos" de tu Música con su nombre (sin pisar nada); después Organizar los acomoda como al resto. Se mueven con el
// motor de operaciones (diario, verificar). Deshacer: vuelven a la Bandeja, a donde estaban. Nunca se borra nada.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import { runMovesAsync } from './ops/run'
import type { Step } from './ops/types'
import { sameFile } from './ops/checks'
import type { HistoryDetailRow, HistoryEntry, InboxAddPlan, InboxAddResult, InboxResult } from '@paila/shared/types'
import { cant, textos } from '@paila/shared/idioma'

/** La carpeta de tu Música donde llegan los temas nuevos de la Bandeja. */
export const RECEIVED_DIR = 'Recibidos'

/** Lo que guarda el diario de cada paso (y, si se corta, la recuperación anota igual el Historial). */
export interface AddData { file: string; dest: string; added: { batch: number; rootId: number; rel: string } }

export interface InboxAddDeps {
  /** Carpeta de música de un disco conectado, o null. */
  rootPath: (rootId: number) => string | null
}

/** Lo que se ve en la pantalla y en el Historial (se arma al mostrarlo: no se guarda). "Recibidos" es una carpeta: no se traduce. */
const T = textos({
  sinMusica: {
    es: 'La carpeta de tu Música no está conectada (o cambió desde la vista previa): no se tocó nada.',
    en: "Your Music folder isn't connected (or it changed since the preview): nothing was touched.",
  },
  yaNoEnBandeja: { es: 'Ya no está en la Bandeja', en: "It's no longer in the Inbox" },
  yaHayEnRecibidos: { es: `Ya hay un archivo con ese nombre en ${RECEIVED_DIR}`, en: `There's already a file with that name in ${RECEIVED_DIR}` },
  yaDeshecho: { es: 'Ya se deshizo', en: 'Already undone' },
  sinDiscoMusica: { es: 'El disco de tu Música no está conectado', en: "The drive with your Music isn't connected" },
  volvieron: {
    es: (n: number) => (n === 1 ? '1 tema ya volvió a la Bandeja' : `${cant(n, 'tema', 'temas')} ya volvieron a la Bandeja`),
    en: (n: number) => (n === 1 ? '1 track already went back to the Inbox' : `${cant(n, 'track', 'tracks')} already went back to the Inbox`),
  },
  resumen: {
    es: (n: number) => `Se ${n === 1 ? 'pasó' : 'pasaron'} ${cant(n, 'tema', 'temas')} de la Bandeja a tu Música (${RECEIVED_DIR})`,
    en: (n: number) => `Moved ${cant(n, 'track', 'tracks')} from the Inbox to your Music (${RECEIVED_DIR})`,
  },
  deBandeja: { es: 'De la Bandeja a tu Música', en: 'From the Inbox to your Music' },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  yaNoEnMusica: { es: 'Ya no está en tu Música (¿lo moviste?)', en: "It's no longer in your Music (did you move it?)" },
  yaHayEnBandeja: { es: 'En la Bandeja ya hay un archivo con ese nombre', en: "There's already a file with that name in the Inbox" },
})

/** Anota en el Historial un tema que pasó de la Bandeja a la Música (lo usa también la recuperación tras un corte). */
export function logAdded(db: Db, d: AddData) {
  db.prepare('INSERT INTO inbox_added (batch, root_id, rel, src, at) VALUES (?, ?, ?, ?, ?)').run(d.added.batch, d.added.rootId, d.added.rel, d.file, new Date().toISOString())
  db.prepare('DELETE FROM inbox_items WHERE path = ?').run(d.file)
}

export class InboxAdd {
  constructor(private db: Db, private deps: InboxAddDeps) {}

  /** La carpeta de música que tiene más temas de Música (ahí va "Recibidos"). */
  private musicRoot(): { rootId: number; path: string } | null {
    const rows = this.db.prepare("SELECT root_id AS rootId, COUNT(*) AS n FROM files WHERE kind = 'musica' AND trashed_at IS NULL GROUP BY root_id ORDER BY n DESC").all() as { rootId: number; n: number }[]
    const all = rows.length ? rows : (this.db.prepare('SELECT id AS rootId FROM roots ORDER BY id').all() as { rootId: number }[])
    for (const r of all) { const p = this.deps.rootPath(r.rootId); if (p) return { rootId: r.rootId, path: p } }
    return null
  }

  private inAnyRoot(file: string): boolean {
    const roots = (this.db.prepare('SELECT id FROM roots').all() as { id: number }[]).map((r) => this.deps.rootPath(r.id)).filter((p): p is string => !!p)
    return roots.some((r) => path.resolve(file).toLowerCase().startsWith(path.resolve(r).toLowerCase() + path.sep))
  }

  /** La vista previa: qué temas de la Bandeja no tenías y adónde irían. Nada se toca. */
  plan(results: InboxResult[]): InboxAddPlan {
    const root = this.musicRoot()
    const items: InboxAddPlan['items'] = []
    const taken = new Set<string>()
    for (const r of results) {
      if (r.decision !== 'falta' && r.decision !== 'sin-pareja') continue
      if (!fs.existsSync(r.path) || this.inAnyRoot(r.path)) continue // ya está en tu Música (la Bandeja adentro de la biblioteca)
      let rel = `${RECEIVED_DIR}/${r.name}`
      if (root) {
        const ext = path.extname(r.name), stem = r.name.slice(0, r.name.length - ext.length)
        for (let i = 2; taken.has(rel.toLowerCase()) || fs.existsSync(path.join(root.path, ...rel.split('/'))); i++) rel = `${RECEIVED_DIR}/${stem} (${i})${ext}`
      }
      taken.add(rel.toLowerCase())
      items.push({ path: r.path, name: r.name, rel, decision: r.decision, artist: r.missing?.artist ?? r.artist, title: r.missing?.title ?? r.title, why: r.why })
    }
    return { root: root?.path ?? null, folder: root ? path.join(root.path, RECEIVED_DIR) : null, items }
  }

  /**
   * Pasa a la Música lo elegido de la vista previa (llamar con el candado tomado). Cada archivo se mueve sin pisar nada y
   * se verifica; todo va en una tanda del Historial. Lo que cambió desde la vista previa se saltea con el motivo. Mueve
   * cediendo el control (cientos de temas no congelan la ventana).
   */
  async apply(plan: InboxAddPlan, chosen: string[], on: { progress?: (done: number, total: number, current: string) => void; cancelled?: () => boolean } = {}): Promise<InboxAddResult> {
    const root = this.musicRoot()
    if (!root || !plan.root || !sameFile(root.path, plan.root)) throw new Error(T.sinMusica)
    const pick = new Set(chosen)
    const batch = Date.now()
    const steps = plan.items.filter((x) => pick.has(x.path)).map((x) => {
      const dest = path.join(root.path, ...x.rel.split('/'))
      let bytes = 0
      try { bytes = fs.statSync(x.path).size } catch { /* lo ve el motor */ }
      const data: AddData = { file: x.path, dest, added: { batch, rootId: root.rootId, rel: x.rel } }
      return { kind: 'sacar' as const, op: 'bandeja' as const, rootId: null, fileId: null, src: x.path, dst: dest, data, bytes,
        missing: T.yaNoEnBandeja, taken: T.yaHayEnRecibidos }
    })
    fs.mkdirSync(path.join(root.path, RECEIVED_DIR), { recursive: true })
    const r = await runMovesAsync<AddData>(this.db, steps, { rootPath: this.deps.rootPath, annotate: (s) => logAdded(this.db, s.data) },
      { onStep: (done, total, s) => on.progress?.(done, total, path.basename(s.src)), isCancelled: on.cancelled })
    return { added: r.done.length, failed: r.failed.map((f) => ({ name: path.basename(f.step.src), error: f.error })), batch, folder: path.join(root.path, RECEIVED_DIR) }
  }

  /** Las tandas, para el Historial (kind 'bandeja'). */
  history(): HistoryEntry[] {
    const rows = this.db.prepare('SELECT batch, root_id AS rootId, MIN(at) AS at, COUNT(*) AS n, SUM(undone_at IS NOT NULL) AS undone FROM inbox_added GROUP BY batch, root_id ORDER BY batch')
      .all() as { batch: number; rootId: number; at: string; n: number; undone: number }[]
    return rows.map((b) => {
      const undone = b.undone === b.n
      const whyNot = undone ? T.yaDeshecho : !this.deps.rootPath(b.rootId) ? T.sinDiscoMusica : null
      const note = !undone && b.undone > 0 ? T.volvieron(b.undone) : null
      return { kind: 'bandeja' as const, id: b.batch, at: b.at, files: b.n, summary: T.resumen(b.n), undone, canUndo: !whyNot, whyNot, note }
    })
  }

  historyDetail(batch: number): HistoryDetailRow[] {
    const rs = this.db.prepare('SELECT rel, src, undone_at IS NOT NULL AS undone FROM inbox_added WHERE batch = ? ORDER BY rel').all(batch) as { rel: string; src: string; undone: number }[]
    return rs.map((r) => ({ name: path.posix.basename(r.rel), folder: path.posix.dirname(r.rel), what: T.deBandeja, before: path.dirname(r.src), after: path.posix.dirname(r.rel), undone: !!r.undone }))
  }

  /**
   * Deshacer una tanda: cada tema vuelve a la Bandeja, a donde estaba (sin pisar nada). Si mientras tanto PAILA ya lo
   * escaneó, el tema sale de la biblioteca como "ya no está" (el escaneo lo marca solo). Devuelve cuántos volvieron.
   * Toda la tanda va junta al motor, que cede el control mientras mueve.
   */
  async undo(batch: number): Promise<{ done: number; failed: { rel: string; error: string }[] }> {
    const rs = this.db.prepare('SELECT id, root_id AS rootId, rel, src FROM inbox_added WHERE batch = ? AND undone_at IS NULL').all(batch) as { id: number; rootId: number; rel: string; src: string }[]
    const out = { done: 0, failed: [] as { rel: string; error: string }[] }
    type Back = { file: string; dest: string; id: number; rootId: number; rel: string }
    const steps: Step<Back>[] = []
    for (const a of rs) {
      const root = this.deps.rootPath(a.rootId)
      if (!root) { out.failed.push({ rel: a.rel, error: T.sinDisco }); continue }
      const from = path.join(root, ...a.rel.split('/'))
      fs.mkdirSync(path.dirname(a.src), { recursive: true })
      steps.push({ kind: 'sacar', op: 'bandeja', rootId: null, fileId: null, src: from, dst: a.src, data: { file: from, dest: a.src, id: a.id, rootId: a.rootId, rel: a.rel },
        missing: T.yaNoEnMusica, taken: T.yaHayEnBandeja })
    }
    const r = await runMovesAsync(this.db, steps, {
      rootPath: this.deps.rootPath,
      annotate: (s) => {
        const now = new Date().toISOString()
        this.db.prepare('UPDATE inbox_added SET undone_at = ? WHERE id = ?').run(now, s.data.id)
        // si ya se había escaneado, sale de la biblioteca como "ya no está" (lo mismo que haría el escaneo)
        this.db.prepare('UPDATE files SET missing_at = COALESCE(missing_at, ?) WHERE root_id = ? AND rel_path = ?').run(now, s.data.rootId, s.data.rel)
      },
    })
    out.done = r.done.length
    out.failed.push(...r.failed.map((f) => ({ rel: f.step.data.rel, error: f.error })))
    return out
  }
}
