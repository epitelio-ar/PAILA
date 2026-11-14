// Vistas guardadas de la tabla (MASTERPLAN-3, 4): los filtros, el orden y las columnas con un nombre, para volver a ellos desde la
// barra lateral. Viven en la base (`settings`, clave `tabla.vistas`), así viajan con el respaldo; no tocan ningún archivo.
import type { Db } from './db'
import type { SavedView } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  sinNombre: { es: 'La vista necesita un nombre', en: 'The view needs a name' },
  muchas: { es: (n: number) => `Ya hay ${n} vistas guardadas: borrá alguna antes de guardar otra`, en: (n: number) => `There are already ${n} saved views: delete one before you save another` },
  yaHay: { es: (n: string) => `Ya hay una vista que se llama «${n}»`, en: (n: string) => `There's already a view called «${n}»` },
})

export const VIEWS_SETTING = 'tabla.vistas'
/** Hasta cuántas vistas (la barra lateral es para las de todos los días). */
export const MAX_VIEWS = 40

export class Views {
  constructor(private db: Db) {}

  list(): SavedView[] {
    try {
      const v = (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(VIEWS_SETTING) as { value: string } | undefined)?.value
      const all = v ? (JSON.parse(v) as SavedView[]) : []
      return Array.isArray(all) ? all.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string') : []
    } catch { return [] }
  }

  private write(all: SavedView[]) {
    if (!all.length) this.db.prepare('DELETE FROM settings WHERE key = ?').run(VIEWS_SETTING)
    else this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(VIEWS_SETTING, JSON.stringify(all))
  }

  /** Guarda una vista. Con el nombre de una que ya está, la reemplaza (queda en su lugar). Devuelve todas. */
  save(v: Omit<SavedView, 'id'>): SavedView[] {
    const name = v.name.trim().slice(0, 60)
    if (!name) throw new Error(T.sinNombre)
    const all = this.list()
    const i = all.findIndex((x) => x.name.toLowerCase() === name.toLowerCase())
    const view: SavedView = { id: i >= 0 ? all[i].id : `v${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, name, kind: v.kind, problem: v.problem, query: v.query.trim(), sort: v.sort, columns: v.columns?.length ? v.columns : null }
    if (i >= 0) all[i] = view
    else {
      if (all.length >= MAX_VIEWS) throw new Error(T.muchas(MAX_VIEWS))
      all.push(view)
    }
    this.write(all)
    return all
  }

  rename(id: string, name: string): SavedView[] {
    const n = name.trim().slice(0, 60)
    if (!n) throw new Error(T.sinNombre)
    const all = this.list()
    if (all.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error(T.yaHay(n))
    this.write(all.map((x) => (x.id === id ? { ...x, name: n } : x)))
    return this.list()
  }

  remove(id: string): SavedView[] {
    this.write(this.list().filter((x) => x.id !== id))
    return this.list()
  }
}
