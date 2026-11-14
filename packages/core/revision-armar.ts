// Ordenar se arma solo (MASTERPLAN-5, 2.2 y etapa 3): PAILA suma a la lista lo que puede proponer sin preguntar, sin que la persona
// apriete "Buscar": los repetidos comprobados (el mismo archivo, el mismo audio o el mismo sonido; nunca "probable por nombre",
// riesgo 1), los nombres que arreglan las reglas elegidas y cada tema a su carpeta, calculado sobre cómo van a quedar los nombres.
// Lo dudoso no se suma: lo muestra core/revision.ts como "Para decidir vos". Lo destildado sigue destildado
// (core/revision-apagados.ts). Acá también se contestan las cartas de lo dudoso. Nada de esto toca archivos: escribe Aplicar.
import path from 'node:path'
import { visible, type Db } from './db'
import { isCatalog, isPlaceholder } from './names'
import type { Changes } from './changes'
import type { Organizer } from './organizer'
import { tidy, toProposals } from './tidy'
import { repetidosAlDia } from './repetidos-guardados'
import { proponerMover, proponerPapelera, propuestas, sacarPropuestas } from './propuestas'
import { dejarComoEsta, guardarRegla, hayRegla, reglaElegida } from './estado-dejar'
import { limpiarApagados } from './revision-apagados'
import { internetElegido, repartirOficiales, sumarSinTildar } from './revision-internet'
import type { TidyRule } from '@paila/shared/tidy-profiles'
import type { Proposal } from './tagactions'
import type { EleccionRevision, ModoCarpetas, OrganizeOptions, OrganizePlan } from '@paila/shared/types'

export interface ArmarDeps {
  db: Db; changes: Changes; organizer: Organizer
  /** Dónde está cada tema (algunos pasos de los nombres leen el archivo). */
  pathOf: (id: number) => string | null
  /** Las reglas de nombres elegidas (core/tidy-reglas.ts). */
  reglas: TidyRule[]
}

const MODO = 'ordenar.carpetas'
const MOTIVO = 'Duplicados' // idioma-ok: el motivo de la tanda en la papelera (el mismo que usa la pantalla Duplicados)

type GrupoAlDia = NonNullable<ReturnType<typeof repetidosAlDia>>['grupos'][number]
/** Una carta "¿Son el mismo?" sin contestar: un grupo dudoso (o sin la copia que se queda) que todavía no está en la lista. */
export const parPendiente = (g: GrupoAlDia) => g.level !== 'version' && g.propuesto == null && (!!g.decidir || g.keep == null)
/**
 * Las copias de esas cartas: no se mueven ni arman disco hasta contestar (si no, la copia se mudaba al lado del original). Solo la
 * COPIA: el que se queda (`keep`) cuenta normal para su disco; si no, el disco quedaba de un tema y la vista previa sacaba al otro
 * tema del disco ("Gimme More", aplicar sobre Música-copia, 13/11). Sin `keep` no se sabe cuál es la copia: quietos los dos.
 */
export const quietosPorPares = (db: Db) => new Set((repetidosAlDia(db)?.grupos ?? []).filter(parPendiente).flatMap((g) => g.items.filter((i) => g.keep == null || i.id !== g.keep).map((i) => i.id)))
/** La cuenta de las carpetas de Ordenar: sobre cómo van a quedar los nombres, sin mover lo que espera una carta par. */
export const planOrdenar = (d: Pick<ArmarDeps, 'db' | 'organizer'>) => d.organizer.plan(reglaElegida(d.db), true, quietosPorPares(d.db))
/**
 * Los temas que pueden servir de ejemplo de una forma (la pregunta de las carpetas): los que se mueven con esa regla, sobre cómo
 * van a quedar los nombres, sin los que chocan con otro ("OUKE (2).mp3") ni los de una carta "¿Son el mismo?" sin contestar
 * (salía "CA7RIEL & Paco Amoroso / 2019 - OUKE / OUKE (2).mp3" con la base real, 13/11). Los elige la pantalla (ordenarRegla.ts).
 */
export function movesDeEjemplo(d: Pick<ArmarDeps, 'db' | 'organizer'>, o: OrganizeOptions) {
  const plan = d.organizer.plan(o, true, quietosPorPares(d.db))
  // los dos de cada choque: el que quedaría "(2)" y el que se queda con el lugar (o ya está ahí)
  // y los dos de una carta "¿Son el mismo?" sin contestar (también el que se queda: un ejemplo no tiene que tener un repetido)
  const enPares = new Set((repetidosAlDia(d.db)?.grupos ?? []).filter(parPendiente).flatMap((g) => g.items.map((i) => i.id)))
  const chocan = new Set([...(plan.clashes ?? []).map((c) => c.fileId), ...enPares])
  const lugares = new Set((plan.clashes ?? []).flatMap((c) => [c.with, c.to.replace(/ \(\d+\)(\.[^./]+)$/, '$1')]).map((r) => r.toLowerCase()))
  return plan.moves.filter((m) => !chocan.has(m.fileId) && !lugares.has(m.to.toLowerCase()) && !lugares.has(m.from.toLowerCase())).map((m) => ({ fileId: m.fileId, from: m.from, to: m.to }))
}

/** Cómo quiere las carpetas. Quien ya ordenó con una regla no tiene que contestar de nuevo. */
export function modoCarpetas(db: Db): ModoCarpetas {
  const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(MODO) as { value: string } | undefined)?.value
  return v === 'regla' || v === 'no-tocar' ? v : hayRegla(db) ? 'regla' : null
}
const guardarModo = (db: Db, m: Exclude<ModoCarpetas, null>) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(MODO, m)

/**
 * Todo lo que PAILA puede sumar sola, de una. La app lo hace en partes (ipc/ordenar.ts): los nombres se calculan en un hilo
 * aparte (core/tidyworker.ts) para no trabar la ventana. Devuelve la cuenta de las carpetas, para leer la lista sin repetirla.
 */
export function armarRevision(d: ArmarDeps) {
  armarRepetidos(d.db)
  sumarNombres(d, proponerNombres(d))
  return cerrarArmado(d)
}
export interface NombresArmados { p: Proposal[]; dudosos: Proposal[] }
/** Los nombres, con las reglas elegidas. Lo dudoso ("para mirar a mano") no se suma, salvo los nombres oficiales (abajo). */
export function proponerNombres(d: Pick<ArmarDeps, 'db' | 'pathOf' | 'reglas'>): NombresArmados {
  const r = tidy(d.db, undefined, d.pathOf, d.reglas)
  // los oficiales de confianza media que solo cambian acentos y signos van con lo seguro (el autor, 13/11)
  const o = repartirOficiales(r.review)
  return { p: [...toProposals(r.changes), ...o.seguros], dudosos: o.dudosos }
}
/** Lo seguro, tildado; con el OK de internet, los nombres oficiales dudosos también, pero sin tildar (core/revision-internet.ts). */
export function sumarNombres(d: Pick<ArmarDeps, 'db' | 'changes'>, n: NombresArmados) {
  if (n.p.length) d.changes.stageMany(n.p)
  if (n.dudosos.length && internetElegido(d.db) === 'si') sumarSinTildar(d.db, d.changes, n.dudosos)
}
/** Lo último: cada tema a su carpeta (sobre cómo quedan los nombres) y lo destildado que ya no está en ninguna lista sale. */
export function cerrarArmado(d: Pick<ArmarDeps, 'db' | 'organizer'>) {
  const plan = armarCarpetas(d)
  limpiarApagados(d.db)
  return plan
}

/** Los grupos comprobados que todavía no están en la lista, con la copia que elige PAILA. Lo "probable" queda para decidir. */
export function armarRepetidos(db: Db) {
  for (const g of repetidosAlDia(db)?.grupos ?? []) {
    if ((g.level !== 'exact' && g.level !== 'quality') || g.decidir || g.propuesto != null || g.keep == null) continue
    proponerPapelera(db, g.items.map((i) => ({ id: i.id, kept: g.keep })), MOTIVO, g.items.map((i) => i.id))
  }
}

/**
 * Cada tema a su carpeta, sobre cómo van a quedar los nombres (lo destildado no cuenta). Se vuelve a calcular cada vez que cambia
 * algo de la lista. Dos que irían al mismo lugar no se suman (riesgo 3), salvo que la persona haya elegido "los dos, con (2)".
 */
export function armarCarpetas(d: Pick<ArmarDeps, 'db' | 'organizer'>): OrganizePlan | null {
  const { db } = d
  const aceptados = new Map(propuestas(db, 'mover').filter((p) => p.dato.choque).map((p) => [p.fileId, p.dato.choque!]))
  sacarPropuestas(db, { tipo: 'mover' })
  if (modoCarpetas(db) !== 'regla') return null
  const plan = planOrdenar(d)
  const choca = new Map((plan.clashes ?? []).map((c) => [c.fileId, c.with]))
  proponerMover(db, plan.moves.filter((m) => !choca.has(m.fileId) || aceptados.has(m.fileId))
    .map((m) => (choca.has(m.fileId) ? { ...m, choque: choca.get(m.fileId) } : m)))
  return plan
}

/** La regla elegida (o null = "No tocar mis carpetas"). Se pregunta una vez; después se cambia desde Ordenar. */
export function elegirCarpetas(d: Pick<ArmarDeps, 'db' | 'organizer'>, o: OrganizeOptions | null) {
  if (o) { guardarRegla(d.db, o); guardarModo(d.db, 'regla') } else guardarModo(d.db, 'no-tocar')
  return armarCarpetas(d)
}

/** Un tema que está en la base, a la vista, por dónde está hoy (para "choca con…"). */
export function idPorLugar(db: Db, rel: string): number | null {
  // sin distinguir mayúsculas, como Windows: "Es la que va.mp3" ocupa el lugar de "Es La Que Va.mp3" (13/11)
  return (db.prepare(`SELECT id FROM files WHERE rel_path = ? COLLATE NOCASE AND ${visible()} LIMIT 1`).get(rel) as { id: number } | undefined)?.id ?? null
}

/** Contesta una carta de "Para decidir vos". `clave` dice cuál: "par|ids", "choque|tema", "quien|tema". */
export function decidir(d: Pick<ArmarDeps, 'db' | 'changes' | 'organizer'>, clave: string, e: EleccionRevision, recalcular = true) {
  const { db } = d
  const [tipo, resto] = [clave.slice(0, clave.indexOf('|')), clave.slice(clave.indexOf('|') + 1)]
  if (tipo === 'par') {
    const ids = resto.split(',').map(Number)
    const g = repetidosAlDia(db)?.grupos.find((x) => x.items.length === ids.length && x.items.every((i) => ids.includes(i.id)))
    if (e === 'distintos') dejarComoEsta(db, 'repetidos', ids)
    else {
      const keep = typeof e === 'object' && 'quedaId' in e ? e.quedaId : g?.keep ?? null
      if (keep == null || !ids.includes(keep)) throw new Error('No se sabe cuál se queda')
      proponerPapelera(db, ids.map((id) => ({ id, kept: keep })), MOTIVO, ids)
    }
  } else if (tipo === 'choque') {
    const id = Number(resto)
    if (e === 'version') proponerMover(db, [{ ...movDe(d, id), choque: 'version' }])
    else if (e === 'dejar') dejarComoEsta(db, 'carpetas', [id])
    else if (typeof e === 'object' && 'quedaId' in e) {
      const otro = conQuien(d, id)
      if (otro == null) throw new Error('No se encontró con cuál choca')
      const sale = e.quedaId === id ? otro : id
      proponerPapelera(db, [{ id: sale, kept: e.quedaId }], MOTIVO)
    }
  } else if (tipo === 'quien') {
    const id = Number(resto)
    if (e === 'dejar') dejarComoEsta(db, 'nombres', [id])
    else if (typeof e === 'object' && 'artista' in e) {
      if (!e.artista.trim() || !e.titulo.trim()) throw new Error('Hacen falta el artista y el título')
      d.changes.stageMany([{ id, field: 'artist', value: e.artista.trim() }, { id, field: 'title', value: e.titulo.trim() }], 'mano')
    }
  }
  // varias de una ("Quedarme con el mejor en los 25"): las carpetas se recalculan una vez, al final
  return recalcular ? armarCarpetas(d) : null
}

function movDe(d: Pick<ArmarDeps, 'db' | 'organizer'>, id: number) {
  const plan = planOrdenar(d)
  const m = plan.moves.find((x) => x.fileId === id)
  if (!m) throw new Error('Este tema ya no se mueve')
  return m
}
function conQuien(d: Pick<ArmarDeps, 'db' | 'organizer'>, id: number): number | null {
  const c = planOrdenar(d).clashes?.find((x) => x.fileId === id)
  return c ? idPorLugar(d.db, c.with) : null
}

/** "01 - Artista - Título" → { Artista, Título }: lo que dice el nombre del archivo, para sugerirlo en un tema sin artista. */
export function delNombre(rel: string): { artista: string; titulo: string } | null {
  // tres espacios o más marcan un " - " que Windows no dejó ("3 Nathy Peluso   Vivir Así…"); "100 BPM - " adelante no es el artista
  const base = path.posix.basename(rel, path.posix.extname(rel)).replace(/\s{3,}/g, ' - ').replace(/^\d{2,3}\s*bpm\s*-\s*/i, '')
    .replace(/^\d{1,3}\s*[-.)_]\s*/, '').replace(/^\d{1,3}\s+(?=.+ - )/, '').replace(/_/g, ' ')
    // "Unknown Artist - …" o el código de catálogo del sello adelante ("AL046 - KASST - Hope Im Alone"): no son el artista (13/11)
    .replace(/^(.+?)\s+-\s+/, (todo, primero: string) => (isPlaceholder(primero) || isCatalog(primero) ? '' : todo))
  const m = base.match(/^(.+?)\s+-\s+(.+)$/)
  return m ? { artista: m[1].trim(), titulo: m[2].replace(/\s*\[[^\]]*\]\s*$/, '').trim() } : null
}
