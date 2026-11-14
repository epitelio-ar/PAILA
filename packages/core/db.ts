// Base de datos de PAILA (SQLite integrado en Node, sin módulos nativos).
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Db = DatabaseSync

const col = (alias: string | undefined, c: string) => (alias ? `${alias}.${c}` : c)

/**
 * Condición SQL de "tema visible": no está en la papelera, no desapareció del disco y no está en una carpeta sacada o
 * excluida. `visible('f')` = con el alias de la tabla. Todo estado nuevo que oculte temas se agrega acá, una sola vez.
 */
export const visible = (alias?: string) =>
  `${col(alias, 'trashed_at')} IS NULL AND ${col(alias, 'missing_at')} IS NULL AND ${col(alias, 'excluded_at')} IS NULL`

/**
 * ¿Sigue en PAILA? Lo de una carpeta que sacaste de PAILA (`roots.removed_at`) ya no se toca: deshacer lo deja como está y el
 * Historial lo dice (core/history-files.ts). `enPaila('m.root_id')` para una carpeta; `temaEnPaila('t.file_id')` para un tema.
 */
export const enPaila = (rootCol: string) => `NOT EXISTS (SELECT 1 FROM roots q WHERE q.id = ${rootCol} AND q.removed_at IS NOT NULL)`
export const temaEnPaila = (fileCol: string) => `NOT EXISTS (SELECT 1 FROM files fq JOIN roots q ON q.id = fq.root_id WHERE fq.id = ${fileCol} AND q.removed_at IS NOT NULL)`

/**
 * Como `visible`, pero con los desaparecidos: la tabla los muestra marcados, las playlists los conservan y el escaneo los
 * reconecta si vuelven a aparecer.
 */
export const listed = (alias?: string) => `${col(alias, 'trashed_at')} IS NULL AND ${col(alias, 'excluded_at')} IS NULL`

/** Cuántas consultas preparadas distintas se guardan por base (las que se usan menos se sueltan primero). */
const PREPARED_CACHE = 500

/**
 * Las consultas preparadas se reusan: preparar cuesta más que correr una consulta chica, y muchas se corren una vez por tema
 * (dentro de bucles). Ninguna se usa con `iterate()` ni con opciones propias, así que compartirlas es seguro.
 */
function reusePrepared(db: DatabaseSync) {
  const prepare = db.prepare.bind(db)
  const cache = new Map<string, StatementSync>()
  db.prepare = ((sql: string) => {
    let st = cache.get(sql)
    if (st) { cache.delete(sql); cache.set(sql, st); return st }
    st = prepare(sql)
    cache.set(sql, st)
    if (cache.size > PREPARED_CACHE) cache.delete(cache.keys().next().value!)
    return st
  }) as DatabaseSync['prepare']
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  reusePrepared(db)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
  return db
}

const depth = new WeakMap<Db, number>()

/** ¿Hay una transacción abierta (de transaction())? */
export const inTransaction = (db: Db) => (depth.get(db) ?? 0) > 0

/** Corre `fn` en una transacción. Si ya hay una abierta (una dentro de otra), se suma a esa: todo o nada. */
export function transaction<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0
  if (d > 0) {
    depth.set(db, d + 1)
    try { return fn() } finally { depth.set(db, d) }
  }
  db.exec('BEGIN')
  depth.set(db, 1)
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  } finally { depth.set(db, 0) }
}

/**
 * Como `db.prepare(sql).all(...params)`, pero cada fila es un objeto común. Los de node:sqlite no tienen forma fija para el
 * motor de JavaScript: con 100.000 temas, copiarlos (`{ ...r }`) es ~30 veces más lento y leerles un campo, ~15 veces
 * (medido el 23/10). Para las consultas grandes que después se recorren mucho (Arreglar nombres, Duplicados). Mismos campos,
 * en el mismo orden; leerlas así cuesta lo mismo que de la otra forma.
 */
export function allRows<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  const st = db.prepare(sql)
  // la consulta preparada se comparte (reusePrepared): se vuelve a dejar como estaba
  st.setReturnArrays(true)
  let rows: unknown[][]
  try { rows = st.all(...params) as unknown as unknown[][] } finally { st.setReturnArrays(false) }
  const names = st.columns().map((c) => c.name)
  return rows.map((a) => {
    const o: Record<string, unknown> = {}
    for (let i = 0; i < names.length; i++) o[names[i]] = a[i]
    return o as T
  })
}
