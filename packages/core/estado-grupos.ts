// Las cuentas del estado de la colección (core/estado.ts), una por parte: cada una sale de la base tal como está ahora (temas,
// análisis, diario de cambios, movimientos, papelera y caché de internet), sin marcas. Si deshacés algo, la cuenta vuelve sola.
import { allRows, visible, type Db } from './db'
import { setReason } from './sets'
import { isPlaceholder, isSite } from './names'
import { fixMojibake } from './tagactions'
import { albumGroups } from './albums'
import { cleanedRows } from './official-run'
import { REC_SOURCES, recKey } from './official-findings'
import type { Organizer } from './organizer'
import type { DupGroup, FilaEstado, GrupoCuenta, OrganizeOptions } from '@paila/shared/types'

/** Hasta cuántos renglones se mandan para "Ver cuáles" (el número de arriba es el total). */
export const MAX_FILAS = 300
const nombre = (r: { artist: string | null; title: string | null; rel: string }) =>
  r.artist?.trim() && r.title?.trim() ? `${r.artist.trim()} - ${r.title.trim()}` : r.rel.split('/').pop() ?? r.rel
const cuenta = (filas: FilaEstado[], dejados: number, aparte?: number): GrupoCuenta =>
  ({ n: filas.length, filas: filas.slice(0, MAX_FILAS), dejados, ...(aparte != null ? { aparte } : {}) })

interface Tema { id: number; rel: string; artist: string | null; title: string | null; duration: number | null }
const temas = (db: Db) => allRows<Tema>(db,
  `SELECT id, rel_path AS rel, artist, title, duration FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY rel_path`)

/** Un nombre que hay que arreglar: falta el artista o el título, es de relleno ("Unknown Artist", una página) o tiene letras rotas. */
const roto = (v: string | null) => !v?.trim() || isPlaceholder(v) || isSite(v) || v.includes('�') || fixMojibake(v) !== v

/** Nombres rotos o sin artista: los sets largos no cuentan (no tienen "Artista - Título"). */
export function nombres(db: Db, dejar: ReadonlySet<number>): GrupoCuenta {
  const malos = temas(db).filter((r) => !setReason(r.rel, r.duration, r) && (roto(r.artist) || roto(r.title)))
  const filas = malos.filter((r) => !dejar.has(r.id)).map((r) => ({ ids: [r.id], texto: nombre(r), detalle: r.rel }))
  return cuenta(filas, malos.length - filas.length)
}

/**
 * Sin buscar en internet: temas con artista y título que nunca se preguntaron con el nombre que tienen hoy (la clave de la búsqueda
 * es "artista + título" ya limpios, como la arma Completar desde internet). Si cambiás el nombre, el tema vuelve a contar.
 */
export function internet(db: Db, dejar: ReadonlySet<number>): GrupoCuenta {
  const hechas = new Set(allRows<{ query: string }>(db,
    `SELECT query FROM online_cache WHERE status = 'ok' AND source IN (${REC_SOURCES.map(() => '?').join(', ')})`, ...REC_SOURCES).map((r) => r.query))
  const rels = new Map(temas(db).map((t) => [t.id, t]))
  const falta = cleanedRows(db).filter((r) => r.artist?.trim() && r.title?.trim() && !hechas.has(recKey(r.artist!, r.title!)))
  const filas = falta.filter((r) => !dejar.has(r.id)).map((r) => ({ ids: [r.id], texto: `${r.artist} - ${r.title}`, detalle: rels.get(r.id)?.rel }))
  return cuenta(filas, falta.length - filas.length)
}

/**
 * Discos con tapa para poner: los que la revisión de Tapas (core/covers.ts) dejó con una tapa mejor para poner y que todavía no se
 * aplicó (o se deshizo), y los discos que nunca se revisaron (`aparte`). Un disco cuenta como dejado si todos sus temas lo están.
 */
export function tapas(db: Db, dejar: ReadonlySet<number>): GrupoCuenta {
  const veredictos = new Map(allRows<{ query: string; data: string | null; at: string }>(db,
    "SELECT query, data, looked_at AS at FROM online_cache WHERE source = 'tapas' AND query LIKE 'veredicto|%' AND status = 'ok'")
    .map((r) => [r.query.slice('veredicto|'.length), { poner: !!(JSON.parse(r.data ?? 'null') as { poner?: boolean } | null)?.poner, at: r.at }]))
  const puesta = db.prepare(`SELECT 1 FROM journal WHERE file_id = ? AND field IN ('cover', 'folderCover') AND undone_at IS NULL AND applied_at >= ? LIMIT 1`)
  const filas: FilaEstado[] = []
  let dejados = 0, sinRevisar = 0
  for (const g of albumGroups(db, 2)) {
    const v = veredictos.get(g.key)
    const falta = !v || (v.poner && !g.tracks.some((t) => puesta.get(t.id, v.at)))
    if (!falta) continue
    if (g.tracks.every((t) => dejar.has(t.id))) { dejados++; continue }
    if (!v) sinRevisar++
    filas.push({ ids: g.tracks.map((t) => t.id), texto: `${g.artist} - ${g.album}`, detalle: g.dir })
  }
  return cuenta(filas, dejados, sinRevisar)
}

/**
 * Fuera de su carpeta: lo que haría Organizar hoy con la regla elegida (`aparte`: los que solo cambiarían de nombre). Los que dejaste
 * como están ya no los mueve Organizar (core/organizer.ts), así que acá tampoco cuentan.
 */
export function carpetas(db: Db, organizer: Organizer, regla: OrganizeOptions): GrupoCuenta {
  const plan = organizer.plan(regla)
  const carpeta = (rel: string) => rel.replace(/\/[^/]*$/, '').toLowerCase()
  const rels = new Map(temas(db).map((t) => [t.id, t]))
  const filas = plan.moves.filter((m) => m.fileId != null).map((m) => { const t = rels.get(m.fileId!); return { ids: [m.fileId!], texto: t ? nombre(t) : m.from, detalle: `${m.from} → ${m.to}` } })
  const soloNombre = plan.moves.filter((m) => carpeta(m.from) === carpeta(m.to)).length
  const dejados = (db.prepare("SELECT COUNT(*) AS n FROM dejar_como_esta WHERE grupo = 'carpetas'").get() as { n: number }).n
  return cuenta(filas, dejados, soloNombre)
}

/** Lo que suena mal: nota D o F (MP3 muy comprimido, un "FLAC" que no lo es, dañado). Sin veredicto hasta tener datos suficientes. */
export function sonido(db: Db, dejar: ReadonlySet<number>): GrupoCuenta {
  const malos = allRows<Tema & { grade: string }>(db,
    `SELECT f.id, f.rel_path AS rel, f.artist, f.title, f.duration, a.grade FROM files f JOIN analysis a ON a.file_id = f.id
     WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' AND a.grade IN ('D', 'F') ORDER BY a.grade DESC, f.rel_path`)
  const filas = malos.filter((r) => !dejar.has(r.id)).map((r) => ({ ids: [r.id], texto: nombre(r), detalle: r.grade }))
  return cuenta(filas, malos.length - filas.length)
}

/**
 * Repetidos sin resolver, de los grupos de Duplicados: las copias de más de los seguros (el mismo archivo, el mismo audio o el mismo
 * sonido en otra calidad). Los que se parecen solo por el nombre van `aparte` (los decidís vos) y las versiones no cuentan.
 */
export function repetidos(grupos: DupGroup[], dejar: ReadonlySet<number>): GrupoCuenta {
  const filas: FilaEstado[] = []
  let dejados = 0, aparte = 0
  for (const g of grupos) {
    if (g.level === 'version') continue
    if (g.decidir || g.keep == null || g.level === 'probable') { if (!g.items.every((i) => dejar.has(i.id))) aparte++; continue }
    const keep = g.items.find((i) => i.id === g.keep)
    for (const i of g.items) {
      if (i.id === g.keep) continue
      if (dejar.has(i.id)) { dejados++; continue }
      filas.push({ ids: [i.id], texto: i.rel.split('/').pop() ?? i.rel, detalle: keep ? `${i.rel} = ${keep.rel}` : i.rel })
    }
  }
  return cuenta(filas, dejados, aparte)
}
