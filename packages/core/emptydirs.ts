// Sacar las carpetas vacías de la Música (Espacio, "Lo que no es música"; punto 1 real del 24/10: después de Organizar quedaron
// 103). Solo carpetas realmente vacías, de la más adentro a la de afuera; nunca la raíz, ni _PAILA, ni nada dentro de un sample
// pack, de los inéditos, los sets o lo excluido. Cada tanda queda en el Historial (kind 'carpetas') y Deshacer las vuelve a crear.
// La lista la arma Space.junk (core/space.ts). Tests: tests/carpetas-vacias.test.ts.
import fs from 'node:fs'
import path from 'node:path'
import { enPaila, type Db } from './db'
import { ahora } from './reloj'
import { kindFor, type Rule } from './collections'
import { isSystemDir } from './files'
import { soloLectura, T as J } from './journal'
import { num, textos } from '@paila/shared/idioma'
import type { HistoryDetailRow, HistoryEntry, HistoryUndoResult } from '@paila/shared/types'

const T = textos({
  sinDisco: { es: 'El disco no está conectado', en: "The disk isn't connected" },
  rutaMala: { es: 'Ruta no válida', en: 'Not a valid path' },
  protegida: { es: 'Está en un sample pack, en los inéditos, en los sets o en lo excluido: no se toca', en: "It's in a sample pack, the unreleased tracks, the sets or something excluded: it isn't touched" },
  yaNoEsta: { es: 'Ya no está', en: "It's not there anymore" },
  noVacia: { es: 'Ya no está vacía: no se toca', en: "It's not empty anymore: it isn't touched" },
  resumen: { es: (n: number) => (n === 1 ? 'Se sacó 1 carpeta vacía' : `Se sacaron ${num(n)} carpetas vacías`), en: (n: number) => (n === 1 ? 'Removed 1 empty folder' : `Removed ${num(n)} empty folders`) },
  sacada: { es: 'Carpeta vacía sacada', en: 'Empty folder removed' },
  yaDeshizo: { es: 'Ya se volvieron a crear', en: 'Already created again' },
})

type Root = { id: number; path: string; available: boolean; rules: { rel: string; kind: string }[] }
const depth = (rel: string) => rel.split('/').length

/**
 * ¿Es una carpeta que PAILA nunca toca, aunque falte su regla? El export de Rekordbox (PIONEER) y un proyecto de Ableton, que
 * espera sus carpetas aunque estén vacías ("Samples/Recorded"). `names`: lo que tiene adentro. Lo usa también Space.junk.
 */
export const untouchable = (name: string, names: string[]) =>
  name.toUpperCase() === 'PIONEER' || names.some((n) => n === 'Ableton Project Info' || /\.als$/i.test(n))

export class EmptyDirs {
  constructor(private db: Db, private roots: () => Root[]) {}

  private root(id: number) { return this.roots().find((r) => r.id === id && r.available) ?? null }

  /**
   * Saca las carpetas elegidas (las de la vista previa de Espacio), de la más adentro a la de afuera. Cada una se vuelve a mirar
   * justo antes: tiene que estar dentro de la Música, fuera de lo protegido y vacía de verdad (ni un archivo oculto).
   */
  remove(items: { rootId: number; rel: string }[]): { batch: number | null; removed: number; failed: { rel: string; error: string }[] } {
    if (soloLectura()) throw new Error(J.soloLectura)
    const res = { batch: null as number | null, removed: 0, failed: [] as { rel: string; error: string }[] }
    const batch = (this.db.prepare('SELECT COALESCE(MAX(batch), 0) + 1 AS n FROM empty_dirs_log').get() as { n: number }).n
    const log = this.db.prepare('INSERT INTO empty_dirs_log (batch, root_id, rel, at) VALUES (?, ?, ?, ?)')
    const at = ahora()
    for (const it of [...items].sort((a, b) => depth(b.rel) - depth(a.rel) || (a.rel < b.rel ? -1 : 1))) {
      try {
        const root = this.root(it.rootId)
        if (!root) throw new Error(T.sinDisco)
        const parts = it.rel.split('/')
        if (!it.rel || parts.some((p) => p === '' || p === '.' || p === '..') || parts.some(isSystemDir)) throw new Error(T.rutaMala)
        const k = kindFor(it.rel, root.rules as Rule[])
        if (k === 'excluir' || k === 'produccion' || k === 'proyectos' || k === 'sets') throw new Error(T.protegida)
        for (let i = 1; i <= parts.length; i++) {
          let names: string[] = []
          try { names = fs.readdirSync(path.join(root.path, ...parts.slice(0, i))) } catch { /* se mira abajo */ }
          if (untouchable(parts[i - 1], names)) throw new Error(T.protegida)
        }
        const abs = path.join(root.path, ...parts)
        let st: fs.Stats
        try { st = fs.statSync(abs) } catch { throw new Error(T.yaNoEsta) }
        if (!st.isDirectory()) throw new Error(T.rutaMala)
        if (fs.readdirSync(abs).length) throw new Error(T.noVacia)
        // el "solo lectura" de Windows (una carpeta que tuvo ícono propio): en un disco exFAT rmdir da EPERM si no se le saca antes
        const readonly = process.platform === 'win32' && !(st.mode & 0o200)
        if (readonly) fs.chmodSync(abs, 0o777)
        try { fs.rmdirSync(abs) } catch (e) { if (readonly) try { fs.chmodSync(abs, 0o555) } catch { /* ya no está */ } throw e } // rmdir solo saca una vacía
        const id = Number(log.run(batch, it.rootId, it.rel, at).lastInsertRowid)
        if (readonly) this.db.prepare('INSERT INTO empty_dirs_readonly (log_id) VALUES (?)').run(id)
        res.removed++
      } catch (e) { res.failed.push({ rel: it.rel, error: (e as Error).message }) }
    }
    if (res.removed) res.batch = batch
    return res
  }

  /** Las tandas, para el Historial. */
  history(): HistoryEntry[] {
    const rows = this.db.prepare(`SELECT batch, MIN(root_id) AS rootId, MIN(at) AS at, COUNT(*) AS n, SUM(restored_at IS NOT NULL) AS restored
      FROM empty_dirs_log WHERE ${enPaila('root_id')} GROUP BY batch ORDER BY batch`).all() as { batch: number; rootId: number; at: string; n: number; restored: number }[]
    return rows.map((b) => {
      const undone = b.restored === b.n
      const whyNot = undone ? T.yaDeshizo : !this.root(b.rootId) ? T.sinDisco : null
      return { kind: 'carpetas' as const, id: b.batch, at: b.at, files: b.n, summary: T.resumen(b.n), undone, canUndo: !whyNot, whyNot, note: null }
    })
  }

  historyDetail(batch: number): HistoryDetailRow[] {
    const rs = this.db.prepare('SELECT rel, restored_at IS NOT NULL AS restored FROM empty_dirs_log WHERE batch = ? ORDER BY rel').all(batch) as { rel: string; restored: number }[]
    return rs.map((r) => ({ name: path.posix.basename(r.rel), folder: path.posix.dirname(r.rel) === '.' ? '' : path.posix.dirname(r.rel), what: T.sacada, before: null, after: null, undone: !!r.restored }))
  }

  /**
   * Deshacer: vuelve a crear las carpetas, de la de afuera a la más adentro. Si ya existe, queda como está. Las que eran de solo
   * lectura vuelven a serlo al final, cuando ya están todas (así ninguna frena a las de adentro).
   */
  async undo(batch: number): Promise<HistoryUndoResult> {
    if (soloLectura()) throw new Error(J.soloLectura)
    const rs = this.db.prepare(`SELECT l.id, l.root_id AS rootId, l.rel, r.log_id IS NOT NULL AS readonly FROM empty_dirs_log l
      LEFT JOIN empty_dirs_readonly r ON r.log_id = l.id WHERE l.batch = ? AND l.restored_at IS NULL AND ${enPaila('l.root_id')}`).all(batch) as { id: number; rootId: number; rel: string; readonly: number }[]
    const out: HistoryUndoResult = { done: 0, failed: [] }
    const mark = this.db.prepare('UPDATE empty_dirs_log SET restored_at = ? WHERE id = ?')
    const lock: string[] = []
    for (const r of rs.sort((a, b) => depth(a.rel) - depth(b.rel))) {
      const root = this.root(r.rootId)
      if (!root) { out.failed.push({ rel: r.rel, error: T.sinDisco }); continue }
      const abs = path.join(root.path, ...r.rel.split('/'))
      try { fs.mkdirSync(abs, { recursive: true }); mark.run(new Date().toISOString(), r.id); out.done++; if (r.readonly) lock.push(abs) } catch (e) { out.failed.push({ rel: r.rel, error: (e as Error).message }) }
    }
    for (const abs of lock.reverse()) try { fs.chmodSync(abs, 0o555) } catch { /* queda sin el atributo: no cambia nada de la música */ }
    return out
  }
}
