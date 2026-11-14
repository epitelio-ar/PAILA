// Deshacer encadenado (MASTERPLAN-5, 3.4 y riesgos 6 y 7). Tres cosas sobre la lista del Historial (core/history.ts):
// 1. `agrupar`: las partes de cada Aplicar (tabla `tandas`: papelera → tags → mover → tapas → reemplazos) se juntan en una sola entrada 'aplicar',
//    que se deshace de una.
// 2. `huellas`: qué tocó cada tanda que todavía no se deshizo (los temas, los lugares y las carpetas), de sus registros.
// 3. `encadenar`: a cada tanda le pone su cadena, lo que vino después y la toca (directo o a través de otra de la cadena). Deshacerla
//    deshace antes la cadena, de la más nueva a la más vieja. Si algo de la cadena no se puede deshacer, esta tampoco: nada a medias.
// Qué cuenta como "tocar": el mismo tema movido o mandado a la papelera; el mismo tema y el mismo campo de tags (dos tandas de tags que
// cambian campos distintos no se tocan: cada una vuelve sola); un tema renombrado o con tags nuevos que otra tanda movió; el mismo
// lugar (lo que dejó uno y ocupó otro, el cover.jpg); y la carpeta de la que Organizar sacó temas que después Espacio sacó por vacía.
import path from 'node:path'
import { enPaila, temaEnPaila, type Db } from './db'
import type { HistoryEntry, HistoryKind, HistoryPunto, HistoryRef } from '@paila/shared/types'
import { C } from './history-cadena.textos'
import { H } from './history-text'
import { repGroups } from './history-replace'

export const clave = (r: HistoryRef) => `${r.kind}:${r.id}`
/** Organizar y la limpieza de Espacio salen del mismo registro (moves_log). */
const registro = (r: HistoryRef) => `${r.kind === 'limpieza' ? 'organizar' : r.kind}:${r.id}`
/** Los temas que una tanda de Organizar movió y que después cambiaron de lugar o de nombre (los anota history-files.ts). */
export const movidosDespues = new WeakMap<HistoryEntry, number[]>()

// carpetas: las que el mover dejó vacías y se sacaron; reemplazos: las copias mejores de Sonido (core/sonido-reemplazos.ts), al final
const ORDEN = ['papelera', 'tags', 'mover', 'carpetas', 'tapas', 'reemplazos'] as const
const KIND: Record<(typeof ORDEN)[number], HistoryKind> = { papelera: 'papelera', tags: 'tags', mover: 'organizar', carpetas: 'carpetas', tapas: 'tags', reemplazos: 'reemplazo' }

/** Cada Aplicar con sus partes, en el orden en que se aplicaron. */
export function tandasAplicar(db: Db): { id: number; at: string; partes: (HistoryRef & { parte: (typeof ORDEN)[number]; n: number })[] }[] {
  const rows = db.prepare('SELECT id, at, partes FROM tandas ORDER BY id').all() as { id: number; at: string; partes: string }[]
  return rows.map((r) => {
    const p = JSON.parse(r.partes) as Partial<Record<(typeof ORDEN)[number], { tanda: number; n: number }>>
    return { id: r.id, at: r.at, partes: ORDEN.filter((k) => p[k]).map((k) => ({ parte: k, kind: KIND[k], id: p[k]!.tanda, n: p[k]!.n })) }
  })
}

/** Junta las partes de cada Aplicar en una entrada. Devuelve la lista nueva y las partes de cada Aplicar (por clave). */
export function agrupar(db: Db, all: HistoryEntry[]): { lista: HistoryEntry[]; partes: Map<string, HistoryEntry[]> } {
  const por = new Map(all.map((e) => [clave(e), e]))
  const partes = new Map<string, HistoryEntry[]>(), usadas = new Set<string>()
  const lista: HistoryEntry[] = []
  for (const t of tandasAplicar(db)) {
    const es = t.partes.map((p) => por.get(clave(p))).filter((e): e is HistoryEntry => !!e && !usadas.has(clave(e)))
    if (!es.length) continue
    for (const e of es) usadas.add(clave(e))
    const n = (k: (typeof ORDEN)[number]) => t.partes.filter((p) => p.parte === k).reduce((a, p) => a + p.n, 0)
    const textos = [n('papelera') && C.pPapelera(n('papelera')), n('tags') && C.pTags(n('tags')), n('mover') && C.pMover(n('mover')), n('tapas') && C.pTapas(n('tapas')), n('reemplazos') && C.pReemplazos(n('reemplazos')), n('carpetas') && C.pCarpetas(n('carpetas'))].filter((x): x is string => !!x)
    const g: HistoryEntry = { kind: 'aplicar', id: t.id, at: t.at, files: es.reduce((a, e) => a + e.files, 0), summary: C.aplicaste(t.partes.filter((p) => p.parte !== 'carpetas').reduce((a, p) => a + p.n, 0), textos), undone: false, canUndo: true, whyNot: null, note: null, partes: es.map((e) => ({ kind: e.kind, id: e.id })) }
    const bks = es.flatMap((e) => e.backups ?? [])
    if (bks.length) g.backups = bks
    partes.set(clave(g), es)
    lista.push(g)
  }
  for (const e of all) if (!usadas.has(clave(e))) lista.push(e)
  return { lista, partes }
}

/** Lo que tocó una tanda: lo que deja a la vista (`emite`) y lo que la toca si otra lo deja (`busca`). */
interface Huella { emite: Set<string>; busca: Set<string>; temas: Set<number> }

/**
 * Las huellas, recalculadas solo si cambió algo en los registros (se pide la lista seguido: la barra de arriba muestra lo último).
 * `memo`: dónde guardarlas entre una vez y otra (una por Historial).
 */
export function huellasAlDia(db: Db, memo: { firma?: string; hs?: Map<string, Huella> }): Map<string, Huella> {
  const firma = (db.prepare(`SELECT (SELECT COUNT(*) || '.' || IFNULL(MAX(id), 0) FROM journal WHERE undone_at IS NULL) || '|' ||
    (SELECT COUNT(*) || '.' || IFNULL(MAX(id), 0) FROM trash_log WHERE restored_at IS NULL AND purged_at IS NULL) || '|' ||
    (SELECT COUNT(*) || '.' || IFNULL(MAX(id), 0) FROM moves_log WHERE undone_at IS NULL AND purged_at IS NULL) || '|' ||
    (SELECT COUNT(*) || '.' || IFNULL(MAX(id), 0) FROM empty_dirs_log WHERE restored_at IS NULL) || '|' ||
    (SELECT COUNT(*) || '.' || IFNULL(MAX(id), 0) FROM replacements WHERE undone_at IS NULL AND purged_at IS NULL) || '|' ||
    (SELECT COUNT(*) FROM roots WHERE removed_at IS NOT NULL) AS f`).get() as { f: string }).f
  if (memo.firma !== firma || !memo.hs) { memo.hs = huellas(db); memo.firma = firma }
  return memo.hs
}

/**
 * Qué tocó cada tanda que todavía no se deshizo del todo, por registro (tags, papelera, organizar, carpetas). Solo lectura. Lo de una carpeta
 * que sacaste de PAILA no cuenta: deshacer lo deja como está.
 */
export function huellas(db: Db): Map<string, Huella> {
  const out = new Map<string, Huella>()
  const de = (k: string) => { let h = out.get(k); if (!h) out.set(k, h = { emite: new Set(), busca: new Set(), temas: new Set() }); return h }
  const ambos = (h: Huella, k: string) => { h.emite.add(k); h.busca.add(k) }
  const lugar = (root: number | null, rel: string) => `p:${root}|${rel.toLowerCase()}`
  const dir = (rel: string) => path.posix.dirname(rel)
  const tags = db.prepare(`SELECT j.batch_id AS b, j.file_id AS f, j.rel_path AS rel, j.field, fi.root_id AS r FROM journal j LEFT JOIN files fi ON fi.id = j.file_id
    WHERE j.undone_at IS NULL AND ${temaEnPaila('j.file_id')}`).all() as { b: number; f: number; rel: string; field: string; r: number | null }[]
  for (const x of tags) {
    const h = de(`tags:${x.b}`)
    ambos(h, `c:${x.f}|${x.field}`); h.emite.add(`jf:${x.f}`); h.busca.add(`mf:${x.f}`); h.temas.add(x.f)
    if (x.field === 'folderCover') ambos(h, lugar(x.r, `${dir(x.rel)}/cover.jpg`))
  }
  const pap = db.prepare(`SELECT t.batch_id AS b, t.file_id AS f, t.orig_rel AS rel, fi.root_id AS r FROM trash_log t JOIN files fi ON fi.id = t.file_id
    WHERE t.restored_at IS NULL AND t.purged_at IS NULL AND ${enPaila('fi.root_id')}`).all() as { b: number; f: number; rel: string; r: number }[]
  for (const x of pap) { const h = de(`papelera:${x.b}`); ambos(h, `f:${x.f}`); h.emite.add(`mf:${x.f}`); h.busca.add(`jf:${x.f}`); h.temas.add(x.f); ambos(h, lugar(x.r, x.rel)) }
  const movs = db.prepare(`SELECT batch_id AS b, root_id AS r, file_id AS f, from_rel AS fromRel, to_rel AS toRel FROM moves_log WHERE undone_at IS NULL AND purged_at IS NULL AND ${enPaila('root_id')}`)
    .all() as { b: number; r: number; f: number | null; fromRel: string; toRel: string }[]
  for (const x of movs) {
    const h = de(`organizar:${x.b}`)
    if (x.f != null) { ambos(h, `f:${x.f}`); h.emite.add(`mf:${x.f}`); h.busca.add(`jf:${x.f}`); h.temas.add(x.f) }
    ambos(h, lugar(x.r, x.fromRel)); ambos(h, lugar(x.r, x.toRel))
    h.emite.add(`dm:${x.r}|${dir(x.fromRel).toLowerCase()}`); h.busca.add(`dc:${x.r}|${dir(x.fromRel).toLowerCase()}`)
  }
  const vacias = db.prepare(`SELECT batch AS b, root_id AS r, rel FROM empty_dirs_log WHERE restored_at IS NULL AND ${enPaila('root_id')}`).all() as { b: number; r: number; rel: string }[]
  for (const x of vacias) { const h = de(`carpetas:${x.b}`); h.emite.add(`dc:${x.r}|${x.rel.toLowerCase()}`); h.busca.add(`dm:${x.r}|${x.rel.toLowerCase()}`) }
  // un reemplazo cambia el archivo entero del tema: lo toca todo lo de antes de ese tema (tags, mover) y todo lo de después
  for (const g of repGroups(db)) for (const x of g) {
    if (x.undone || x.purgedAt || g[0].cls !== 'reemplazo') continue // las conversiones y los recortes, como antes
    const h = de(`reemplazo:${g[0].id}`)
    for (const k of [`f:${x.fileId}`, `mf:${x.fileId}`, `jf:${x.fileId}`]) ambos(h, k)
    h.temas.add(x.fileId)
  }
  return out
}

/**
 * Pone la cadena a cada tanda de `lista` (del más nuevo al más viejo) y ajusta si se puede deshacer: lo que se volvió a tocar en
 * una tanda de la cadena ya no frena (se deshace antes); lo que la cadena no puede deshacer, frena a esta también.
 */
export function encadenar(lista: HistoryEntry[], partes: Map<string, HistoryEntry[]>, hs: Map<string, Huella>) {
  const asc = [...lista].reverse()
  const huella = asc.map((e) => {
    const hs2 = (partes.get(clave(e)) ?? [e]).filter((p) => !p.undone).map((p) => hs.get(registro(p))).filter((h): h is Huella => !!h)
    if (hs2.length <= 1) return hs2[0] ?? null
    return { emite: new Set(hs2.flatMap((h) => [...h.emite])), busca: new Set(hs2.flatMap((h) => [...h.busca])), temas: new Set(hs2.flatMap((h) => [...h.temas])) }
  })
  // índice: quién deja a la vista cada cosa (de la más vieja a la más nueva)
  const indice = new Map<string, number[]>()
  huella.forEach((h, i) => { if (h) for (const k of h.emite) { const l = indice.get(k); if (l) l.push(i); else indice.set(k, [i]) } })
  // quién la toca directo (una sola pasada por tanda), y la cadena entera de la más nueva a la más vieja: la de cada una es lo que la
  // toca directo más la cadena de eso (se arma una vez, no una vez por tanda)
  const directas = huella.map((h, i) => {
    const out = new Set<number>()
    if (h) for (const k of h.busca) for (const j of indice.get(k) ?? []) if (j > i) out.add(j)
    return out
  })
  const alcance: Set<number>[] = new Array(asc.length)
  for (let i = asc.length - 1; i >= 0; i--) {
    const r = new Set<number>()
    for (const j of directas[i]) { r.add(j); for (const x of alcance[j]) r.add(x) }
    alcance[i] = r
  }
  const cadenas = asc.map((e, i) => (huella[i] && !e.undone ? [...alcance[i]].sort((a, b) => b - a) : [])) // de la más nueva a la más vieja

  // lo de Organizar que cambió después por una tanda de la cadena vuelve antes: no es "a medias"
  asc.forEach((e, i) => {
    const conMovidos = (partes.get(clave(e)) ?? [e]).filter((p) => movidosDespues.get(p)?.length)
    if (!conMovidos.length || !cadenas[i].length) return
    const enCadena = (f: number) => cadenas[i].some((j) => huella[j]!.temas.has(f))
    for (const p of conMovidos) {
      const mov = movidosDespues.get(p)!
      if (!mov.every(enCadena)) continue
      if (p.whyNot === H.todosCambiaron) { p.whyNot = null; p.canUndo = true }
      if (p.note === H.algunosCambiaron(mov.length)) p.note = null
    }
  })
  // cada Aplicar, de sus partes
  for (const e of asc) {
    const ps = partes.get(clave(e))
    if (!ps) continue
    const vivas = ps.filter((p) => !p.undone)
    e.undone = !vivas.length
    const traba = vivas.find((p) => !p.canUndo)
    e.whyNot = e.undone ? H.yaDeshizo : traba?.whyNot ?? null
    e.canUndo = !e.undone && !traba
    // deshecho entero: solo lo que quedó como está (una carpeta que sacaste de PAILA); si no, el aviso de cada parte viva
    const notas = [...new Set((e.undone ? ps : vivas).map((p) => p.note).filter((x): x is string => !!x && (!e.undone || x !== H.parteDeshecha)))]
    e.note = !e.undone && vivas.length < ps.length ? H.parteDeshecha : notas.length ? notas.join(' · ') : null
  }
  // la cadena, y lo que la frena
  const propio = asc.map((e) => ({ canUndo: e.canUndo, whyNot: e.whyNot }))
  asc.forEach((e, i) => {
    if (!cadenas[i].length) return
    e.cadena = cadenas[i].map((j) => ({ kind: asc[j].kind, id: asc[j].id, summary: asc[j].summary, at: asc[j].at, files: asc[j].files }))
    const traba = cadenas[i].find((j) => !propio[j].canUndo)
    if (e.canUndo && traba != null) { e.canUndo = false; e.whyNot = C.cadenaNoSe(asc[traba].summary, propio[traba].whyNot) }
  })
}

/** Lo que toca archivos (lo que deshace "Volver a como estaba"): las playlists y las listas traídas quedan como están. */
const TOCA = new Set<HistoryKind>(['aplicar', 'tags', 'papelera', 'organizar', 'limpieza', 'reemplazo', 'conversion', 'recorte', 'bandeja', 'comprimido', 'comprimido-papelera', 'separar', 'carpetas'])

/** "Volver a como estaba": un punto por cada Aplicar sin deshacer, con todo lo que deshace (de lo más nuevo a lo más viejo). */
export function puntos(lista: HistoryEntry[]): HistoryPunto[] {
  const out: HistoryPunto[] = []
  lista.forEach((e, i) => {
    if (e.kind !== 'aplicar' || e.undone) return
    const es = lista.slice(0, i + 1).filter((x) => !x.undone && TOCA.has(x.kind))
    const traba = es.find((x) => !x.canUndo) // la más nueva que frena: lo que traba a las de su cadena es ella misma
    out.push({
      tanda: e.id, at: e.at, summary: e.summary,
      entradas: es.map((x) => ({ kind: x.kind, id: x.id, summary: x.summary, at: x.at, files: x.files })),
      canUndo: !traba, whyNot: traba ? C.puntoNoSe(traba.summary, traba.whyNot) : null,
    })
  })
  return out
}
