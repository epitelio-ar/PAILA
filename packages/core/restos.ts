// Deshacer sin restos (MASTERPLAN-5, 3.4 y etapa 4). Lo que creó cada tanda queda anotado (tabla `creados`): las carpetas nuevas
// que hizo Organizar. Al deshacer, las que PAILA creó y quedaron vacías se sacan, de la más adentro a la de afuera, y nunca otras
// (una carpeta tuya que ya estaba vacía antes queda). El cover.jpg que puso PAILA donde no había ninguno no se borra al deshacer:
// va a la papelera de PAILA (`tapaAPapelera`), como todo lo demás. Y al volver algo de la papelera, la carpeta de su tanda que quedó
// vacía se saca (`podarPapelera`). Tests: tests/deshacer-cadena.test.ts.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import { isSystemDir } from './files'
import { moveNoClobber, trashBatch } from './safefs'
import { EmptyDirs } from './emptydirs'

const TRASH = ['_PAILA', 'papelera']
const abs = (root: string, rel: string) => path.join(root, ...rel.split('/'))
const hacia = (rel: string) => { const out: string[] = []; for (let d = path.posix.dirname(rel); d && d !== '.'; d = path.posix.dirname(d)) out.push(d); return out }

/** Las carpetas que faltan hoy para poner cada archivo en su lugar (`rels` relativos a la raíz): las que la tanda va a crear. */
export function faltan(root: string, rels: string[]): string[] {
  const out = new Set<string>()
  for (const rel of rels) for (const d of hacia(rel)) {
    if (out.has(d)) continue
    if (d.split('/').some(isSystemDir)) continue // lo de _PAILA (la papelera) no es tu música
    if (!fs.existsSync(abs(root, d))) out.add(d)
  }
  return [...out]
}

/** Lo mismo, por disco, para los movimientos de una tanda (los discos que no están conectados no se miran). */
export function faltanPorDisco(rootDe: (rootId: number) => string | null, items: { rootId: number; to: string }[]): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const rid of new Set(items.map((m) => m.rootId))) {
    const root = rootDe(rid)
    if (root) out.set(rid, faltan(root, items.filter((m) => m.rootId === rid).map((m) => m.to)))
  }
  return out
}

/** Anota las carpetas que la tanda creó de verdad (las que faltaban y ahora están), más la marca de que esta tanda se anota. */
export function anotarCreadas(db: Db, tipo: string, batch: number, rootDe: (rootId: number) => string | null, faltaban: Map<number, string[]>) {
  const ins = db.prepare('INSERT OR IGNORE INTO creados (tipo, batch, root_id, rel, at) VALUES (?, ?, ?, ?, ?)')
  const at = new Date().toISOString()
  for (const [rootId, rels] of faltaban) {
    const root = rootDe(rootId)
    ins.run(tipo, batch, rootId, '', at)
    if (root) for (const rel of rels) if (fs.existsSync(abs(root, rel))) ins.run(tipo, batch, rootId, rel, at)
  }
}

/** ¿La tanda anotó lo que creó? (las de antes de la etapa 4, no: para esas se usa la limpieza de siempre). */
export const seAnoto = (db: Db, tipo: string, batch: number) => !!db.prepare("SELECT 1 FROM creados WHERE tipo = ? AND batch = ? AND rel = ''").get(tipo, batch)

/**
 * Después de deshacer: saca las carpetas que creó PAILA en tandas ya deshechas (enteras o en parte) y quedaron vacías, de la más
 * adentro a la de afuera. Solo vacías de verdad (ni un archivo oculto). Devuelve cuántas sacó.
 */
export function sacarCreadas(db: Db, rootDe: (rootId: number) => string | null): number {
  const rs = db.prepare(`SELECT c.tipo, c.batch, c.root_id AS rootId, c.rel FROM creados c WHERE c.rel != '' AND c.sacada_at IS NULL
    AND c.tipo = 'organizar' AND EXISTS (SELECT 1 FROM moves_log m WHERE m.batch_id = c.batch AND m.undone_at IS NOT NULL)`).all() as { tipo: string; batch: number; rootId: number; rel: string }[]
  const marca = db.prepare('UPDATE creados SET sacada_at = ? WHERE tipo = ? AND batch = ? AND root_id = ? AND rel = ?')
  let n = 0
  for (const r of rs.sort((a, b) => b.rel.split('/').length - a.rel.split('/').length || (a.rel < b.rel ? 1 : -1))) {
    const root = rootDe(r.rootId)
    if (!root) continue
    const p = abs(root, r.rel)
    try {
      if (!fs.existsSync(p)) { marca.run(new Date().toISOString(), r.tipo, r.batch, r.rootId, r.rel); continue }
      if (fs.readdirSync(p).length) continue // tiene algo (de otra tanda, o tuyo): queda
      fs.rmdirSync(p) // rmdir solo saca una vacía
      marca.run(new Date().toISOString(), r.tipo, r.batch, r.rootId, r.rel)
      n++
    } catch { /* queda: no cambia nada de la música */ }
  }
  return n
}

/**
 * Al deshacer un movimiento de Organizar: saca hacia arriba las carpetas que quedaron vacías. Si la tanda anotó lo que creó, solo
 * esas; si es una tanda vieja, como siempre (mientras estén vacías).
 */
export function podar(db: Db, batch: number, rootId: number, root: string, relDir: string) {
  const creadas = seAnoto(db, 'organizar', batch)
    ? new Set((db.prepare("SELECT rel FROM creados WHERE tipo = 'organizar' AND batch = ? AND root_id = ? AND rel != ''").all(batch, rootId) as { rel: string }[]).map((r) => r.rel))
    : null
  for (let cur = relDir; cur && cur !== '.'; cur = path.posix.dirname(cur)) {
    if (creadas && !creadas.has(cur)) return
    const p = abs(root, cur)
    try { if (fs.readdirSync(p).length) return; fs.rmdirSync(p) } catch { return }
    if (creadas) db.prepare("UPDATE creados SET sacada_at = ? WHERE tipo = 'organizar' AND batch = ? AND root_id = ? AND rel = ?").run(new Date().toISOString(), batch, rootId, cur)
  }
}

/**
 * Después de mover (decisión del autor del 13/11): las carpetas de donde salieron los temas y quedaron vacías por esta tanda se sacan,
 * de la más adentro a la de afuera, con Carpetas vacías (core/emptydirs.ts): quedan anotadas como su tanda en el Historial y deshacer las
 * vuelve a poner. Nunca la raíz, ni _PAILA, ni sample packs, inéditos, sets, lo excluido, PIONEER o un proyecto de Ableton (eso lo frena
 * emptydirs). `desde`: de dónde salió cada cosa que se movió. Devuelve el número de esa tanda de carpetas, o null si no sacó ninguna.
 */
export function vaciarOrigen(db: Db, rootDe: (rootId: number) => string | null, desde: { rootId: number; from: string }[]): number | null {
  const items: { rootId: number; rel: string }[] = [], vistos = new Set<string>()
  for (const m of desde) for (const d of hacia(m.from)) {
    const k = `${m.rootId}|${d}`
    if (vistos.has(k)) continue
    vistos.add(k)
    const root = rootDe(m.rootId)
    if (root && fs.existsSync(abs(root, d))) items.push({ rootId: m.rootId, rel: d })
  }
  if (!items.length) return null
  // solo las que quedaron vacías (una de afuera, cuando se fueron las de adentro): emptydirs las mira de nuevo una por una
  const vacia = (root: string, rel: string): boolean => {
    try { return fs.readdirSync(abs(root, rel)).every((n) => fs.statSync(abs(root, `${rel}/${n}`)).isDirectory() && vacia(root, `${rel}/${n}`)) } catch { return false }
  }
  const elegidas = items.filter((it) => vacia(rootDe(it.rootId)!, it.rel))
  if (!elegidas.length) return null
  const reglas = db.prepare('SELECT rel_prefix AS rel, kind FROM rules WHERE root_id = ?')
  const raices = () => [...new Set(elegidas.map((x) => x.rootId))].map((id) => ({ id, path: rootDe(id) ?? '', available: !!rootDe(id), rules: reglas.all(id) as { rel: string; kind: string }[] }))
  try { return new EmptyDirs(db, raices).remove(elegidas).batch } catch { return null } // solo lectura: no se saca nada
}

/**
 * Al volver algo de la papelera: saca hacia arriba las carpetas de la tanda que quedaron vacías ("_PAILA/papelera/<tanda>/Rock/…"),
 * hasta la carpeta de la tanda incluida, y nunca la papelera misma ni nada fuera de ella. `relDir`: de donde salió el archivo.
 */
export function podarPapelera(root: string, relDir: string) {
  const i = `/${relDir}/`.indexOf('/_PAILA/papelera/')
  if (i < 0) return
  const tope = `${relDir.slice(0, i)}_PAILA/papelera` // con "Rock/" adelante si la carpeta se unió con otra
  for (let cur = relDir; cur.length > tope.length && cur.startsWith(`${tope}/`); cur = path.posix.dirname(cur)) {
    const p = abs(root, cur)
    try { if (fs.readdirSync(p).length) return; fs.rmdirSync(p) } catch { return }
  }
}

/**
 * Para deshacer una tapa que puso PAILA donde no había: en vez de borrar el cover.jpg, lo manda a la papelera de PAILA, a una
 * carpeta de la tanda ("…_tapas-deshechas_…") con la ruta de su disco. Una carpeta por deshacer (se pide la primera vez).
 */
export function tapaAPapelera(db: Db) {
  let carpeta: string | null = null
  return (fileId: number, trackPath: string) => (cover: string) => {
    const rel = (db.prepare('SELECT rel_path AS r FROM files WHERE id = ?').get(fileId) as { r: string } | undefined)?.r
    const parts = rel?.split('/') ?? []
    const root = parts.length ? path.resolve(trackPath, ...parts.map(() => '..')) : null
    if (!root || !rel) { fs.rmSync(cover); return } // sin saber su disco no hay papelera: queda guardada en "tapas" de PAILA
    carpeta ??= trashBatch('tapas-deshechas')
    const relCover = path.relative(root, cover).split(path.sep)
    moveNoClobber(cover, path.join(root, ...TRASH, carpeta, ...relCover))
  }
}
