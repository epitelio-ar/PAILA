// Un solo Aplicar (MASTERPLAN-5, 3.3 y etapa 2): todo lo que toca archivos sale de una sola lista (los cambios de tags y tapas de
// Cambios pendientes, y lo que va a la papelera o se mueve: core/propuestas.ts) y se aplica en el orden que no se puede errar:
// papelera → nombres y tags → mover → tapas → reemplazos. Los repetidos se van antes de arreglarles el nombre, se mueve con los nombres ya escritos
// (el lugar se vuelve a calcular y tiene que ser el que se vio), la tapa va a la carpeta nueva, y la copia mejor que llegó a la Bandeja (Sonido,
// core/sonido-reemplazos.ts) va al final: hereda todo eso. Cada Aplicar anota una tanda con
// sus partes (tabla `tandas`); cada parte sigue en el Historial con su deshacer. Lo que no se puede aplicar vuelve a la revisión con
// el motivo: un archivo que cambió desde que se miró (riesgo 2) o un lugar que choca con otro sin un "(2)" aceptado (riesgo 3).
import path from 'node:path'
import { visible, type Db } from './db'
import { ahora } from './reloj'
import type { Changes } from './changes'
import type { Trash } from './trash'
import type { Organizer } from './organizer'
import type { ResultadoReemplazos } from './sonido-reemplazos'
import { reglaElegida } from './estado-dejar'
import { quietosPorPares } from './revision-armar'
import { marcarFallada, propuestas, sacarPropuestas, type Propuesta } from './propuestas'
import { apagados, claveCambio, claveProp } from './revision-apagados'
import type { ApplyResult, PendingChange } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  sinCopia: { es: 'La copia que se queda ya no está (o también va a la papelera): no se manda, para no perder las dos', en: "The copy that stays isn't there anymore (or it's going to the trash too): it isn't sent, so you don't lose both" },
  otroLugar: { es: 'Con los nombres de ahora va a otro lugar que el que viste: revisalo de nuevo en Organizar', en: 'With the names it has now it goes somewhere else than what you saw: check it again in Organize' },
  yaNoVa: { es: 'Con los nombres de ahora ya no se mueve: revisalo de nuevo en Organizar', en: "With the names it has now it doesn't move anymore: check it again in Organize" },
  seQueda: { es: (rel: string) => `A la papelera (se queda ${rel})`, en: (rel: string) => `To the trash (${rel} stays)` },
  aPapelera: { es: 'A la papelera', en: 'To the trash' },
  mejorCopia: { es: (f: string) => `Por una copia mejor: ${f}`, en: (f: string) => `With a better copy: ${f}` },
  sinBandeja: { es: 'No hay carpeta de Bandeja', en: "There's no Inbox folder" },
})

type Avance = { done: number; total: number; current: string; errors: number }
/** `reemplazar`: los reemplazos de Sonido (core/sonido-reemplazos.ts, aplicarReemplazos); sin él, no se aplican y quedan con el motivo. */
export interface AplicarDeps { db: Db; changes: Changes; trash: Trash; organizer: Organizer; reemplazar?: (props: Propuesta[], avance: (p: Avance) => void, isCancelled?: () => boolean) => Promise<ResultadoReemplazos> }
export type Parte = 'papelera' | 'tags' | 'mover' | 'tapas' | 'reemplazos'
export interface ResultadoAplicar extends ApplyResult { tanda: number | null; partes: Record<Parte, number> }

const TAPAS = new Set(['cover', 'folderCover'])
/** En la lista única, lo de la papelera y lo que se mueve va con número negativo (el de la propuesta): no se confunde con un cambio. */
export const idDe = (p: Propuesta) => -p.id

/** ¿Lo destildaste en Ordenar? Sigue en su lista, pero no va en la barra de arriba ni en Aplicar (core/revision-apagados.ts). */
const apagadoDe = (off: Set<string>) => ({
  prop: (p: Propuesta) => off.has(claveProp(p.fileId, p.tipo)),
  cambio: (c: PendingChange) => off.has(claveCambio(c.fileId, c.field)),
})

/** Todo lo que está para aplicar, en una sola lista (la barra de arriba): cambios de tags y tapas, papelera y mover. */
export function paraAplicar(db: Db, changes: Changes): PendingChange[] {
  const rel = db.prepare('SELECT rel_path AS r FROM files WHERE id = ?')
  const off = apagadoDe(apagados(db))
  const props = propuestas(db).filter((p) => !off.prop(p)).map((p): PendingChange => ({
    id: idDe(p), fileId: p.fileId, rel: p.rel, field: p.tipo, before: p.rel,
    after: p.tipo === 'mover' ? p.despues : p.tipo === 'reemplazo' ? T.mejorCopia(p.dato.frase ?? path.basename(p.dato.archivo ?? '')) : p.dato.kept != null ? T.seQueda(path.posix.basename((rel.get(p.dato.kept) as { r: string } | undefined)?.r ?? '')) : T.aPapelera,
    ...(p.error ? { error: p.error } : {}),
  }))
  return [...props, ...changes.list().filter((c) => !off.cambio(c))]
}

/** Descartar de la lista única (todo, o esos números): no toca ningún archivo. */
export function descartar(db: Db, changes: Changes, ids?: number[]) {
  if (!ids) { changes.discard(); sacarPropuestas(db); return }
  changes.discard(ids.filter((i) => i > 0))
  sacarPropuestas(db, { ids: ids.filter((i) => i < 0).map((i) => -i) })
}
/** "Sacarlos": lo que no se pudo aplicar, de las dos partes. */
export function descartarFallados(db: Db, changes: Changes) { changes.discardFailed(); sacarPropuestas(db, { fallidas: true }) }

/** Aplica todo (o solo `ids` de la lista única: para "Probar de nuevo") en orden: papelera → tags → mover → tapas. */
export async function aplicarTodo(d: AplicarDeps, opts: { ids?: number[]; onProgress?: (p: Avance) => void; isCancelled?: () => boolean } = {}): Promise<ResultadoAplicar> {
  const { db, changes } = d
  const elegida = (id: number, error?: string | null) => (opts.ids ? opts.ids.includes(id) : !error)
  const off = apagadoDe(apagados(db)) // lo destildado en Ordenar no se aplica, ni pidiéndolo por número
  const props = propuestas(db).filter((p) => !off.prop(p) && elegida(idDe(p), p.error))
  const cambios = changes.list().filter((c) => !off.cambio(c) && elegida(c.id, c.error))
  const res: ResultadoAplicar = { batchId: null, tanda: null, applied: 0, failed: [], partes: { papelera: 0, tags: 0, mover: 0, tapas: 0, reemplazos: 0 } }
  const total = props.length + cambios.length
  let hechos = 0
  const avance = (p: Avance) => opts.onProgress?.({ ...p, done: hechos + p.done, total })
  const lotes: Partial<Record<Parte | 'carpetas', number>> = {} // carpetas: las que el mover dejó vacías y se sacaron (core/restos.ts)
  const falla = (p: Propuesta, error: string) => { marcarFallada(db, p.id, error); res.failed.push({ fileId: p.fileId, rel: p.rel, error }) }

  // 1. papelera: solo si la copia que se queda sigue (y no se va también)
  const pap = props.filter((p) => p.tipo === 'papelera')
  const seVan = new Set(pap.map((p) => p.fileId))
  const sigue = db.prepare(`SELECT 1 FROM files WHERE id = ? AND ${visible()}`)
  const mandar: Propuesta[] = []
  for (const p of pap) if (p.dato.kept == null || (!seVan.has(p.dato.kept) && sigue.get(p.dato.kept))) mandar.push(p); else falla(p, T.sinCopia)
  for (const motivo of new Set(mandar.map((p) => p.dato.motivo ?? ''))) {
    const ps = mandar.filter((p) => (p.dato.motivo ?? '') === motivo)
    avance({ done: 0, total, current: motivo, errors: res.failed.length })
    const r = await d.trash.trash(ps.map((p) => p.fileId), motivo, new Map(ps.filter((p) => p.dato.kept != null).map((p) => [p.fileId, p.dato.kept!])), new Map(ps.map((p) => [p.fileId, p])))
    for (const f of r.failed) { const p = ps.find((x) => x.fileId === f.fileId); if (p) falla(p, f.error) }
    res.partes.papelera += r.moved; if (r.batchId) lotes.papelera = r.batchId
  }
  hechos += pap.length

  // 2. nombres y tags (sin las tapas: van al final, en la carpeta nueva)
  const tags = cambios.filter((c) => !TAPAS.has(c.field)).map((c) => c.id)
  if (tags.length && !opts.isCancelled?.()) {
    const r = await changes.apply(tags, { onProgress: avance, isCancelled: opts.isCancelled })
    res.partes.tags = r.applied; res.failed.push(...r.failed); if (r.batchId) lotes.tags = r.batchId
  }
  hechos += tags.length

  // 3. mover: el lugar se vuelve a calcular con los nombres ya escritos, y tiene que ser el que se vio. Se leen de nuevo: lo que PAILA
  // acaba de escribir les puso la versión nueva del archivo (core/propuestas.ts, reestampar)
  const elegidos = new Set(props.filter((p) => p.tipo === 'mover').map((p) => p.id))
  const movs = propuestas(db, 'mover').filter((p) => elegidos.has(p.id))
  if (movs.length && !opts.isCancelled?.()) await mover(d, movs, res, lotes, avance, opts.isCancelled, falla)
  hechos += movs.length

  // 4. tapas, con cada tema ya en su lugar (el cover.jpg va a la carpeta nueva)
  const tapas = cambios.filter((c) => TAPAS.has(c.field)).map((c) => c.id)
  if (tapas.length && !opts.isCancelled?.()) {
    const r = await changes.apply(tapas, { onProgress: avance, isCancelled: opts.isCancelled })
    res.partes.tapas = r.applied; res.failed.push(...r.failed); if (r.batchId) lotes.tapas = r.batchId
  }
  hechos += tapas.length

  // 5. reemplazos (Sonido): la copia mejor toma el lugar del tema ya con sus nombres, tags, carpeta y tapa
  const reps = props.filter((p) => p.tipo === 'reemplazo')
  if (reps.length && !opts.isCancelled?.()) {
    if (!d.reemplazar) for (const p of reps) falla(p, T.sinBandeja)
    else {
      const r = await d.reemplazar(reps, avance, opts.isCancelled)
      for (const f of r.failed) falla(f.p, f.error)
      res.partes.reemplazos = r.hechos; if (r.tanda) lotes.reemplazos = r.tanda
    }
  }

  res.applied = Object.values(res.partes).reduce((a, b) => a + b, 0)
  if (res.applied) {
    const n = (k: string) => k === 'carpetas' ? (db.prepare('SELECT COUNT(*) AS n FROM empty_dirs_log WHERE batch = ?').get(lotes.carpetas!) as { n: number }).n : res.partes[k as Parte]
    const partes = Object.fromEntries(Object.entries(lotes).map(([k, v]) => [k, { tanda: v, n: n(k) }]))
    res.tanda = res.batchId = Number(db.prepare('INSERT INTO tandas (at, partes) VALUES (?, ?)').run(ahora(), JSON.stringify(partes)).lastInsertRowid)
  }
  return res
}

/** Un "(2)" aceptado que ya no hace falta (el otro se fue a la papelera): mejor sin él. */
const sinNumero = (rel: string) => rel.replace(/ \(\d+\)(\.[^./]+)$/, '$1')

async function mover(d: AplicarDeps, movs: Propuesta[], res: ResultadoAplicar, lotes: Partial<Record<Parte | 'carpetas', number>>, avance: (p: Avance) => void,
  isCancelled: (() => boolean) | undefined, falla: (p: Propuesta, error: string) => void) {
  // con los mismos quietos que la vista previa de Ordenar (core/revision-armar.ts): si no, calculaban distinto ("Gimme More", 13/11)
  const plan = d.organizer.plan(reglaElegida(d.db), false, quietosPorPares(d.db))
  const por = new Map(plan.moves.map((m) => [m.fileId, m]))
  const ok: typeof plan.moves = [], de = new Map<string, Propuesta>()
  for (const p of movs) {
    const m = por.get(p.fileId)
    if (!m) { if (p.rel === p.despues) sacarPropuestas(d.db, { ids: [p.id] }); else falla(p, T.yaNoVa); continue }
    if (m.to !== p.despues && !(p.dato.choque && m.to === sinNumero(p.despues ?? ''))) { falla(p, T.otroLugar); continue }
    ok.push(m); de.set(m.from, p)
  }
  // lo que acompaña a cada disco (tapas, .cue) viaja solo con los temas que se mueven
  const dirs = new Set(ok.map((m) => `${m.rootId}|${path.posix.dirname(m.from)}`))
  const extras = plan.extras.filter((x) => dirs.has(`${x.rootId}|${path.posix.dirname(x.from)}`))
  const r = await d.organizer.apply({ ...plan, moves: ok, extras }, { onProgress: avance, isCancelled, versiones: new Map(ok.map((m) => [m.fileId, de.get(m.from)!])), vaciar: true })
  for (const f of r.failed) { const p = de.get(f.rel); if (p) falla(p, f.error) }
  // lo que ya llegó a su lugar sale de la lista (también si se canceló en el medio)
  const ahora = d.db.prepare('SELECT rel_path AS r FROM files WHERE id = ?')
  sacarPropuestas(d.db, { ids: ok.filter((m) => (ahora.get(m.fileId) as { r: string } | undefined)?.r === m.to).map((m) => de.get(m.from)!.id) })
  res.partes.mover = r.moved; if (r.batchId) lotes.mover = r.batchId
  if (r.carpetas) lotes.carpetas = r.carpetas
}
