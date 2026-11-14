// "Pasar a otra compu", la ida: "Exportar todo" arma UN archivo (.paila) con la base entera (playlists, historial,
// análisis, huellas, cambios pendientes, vistas, diccionario y configuración), las tapas guardadas y lo que recuerda la
// ventana. Las claves de los servicios NUNCA viajan. La vuelta (traerlo en otra compu) está en core/mudanza-traer.ts.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MudanzaCarpeta, MudanzaConteos, MudanzaResumen } from '@paila/shared/types/mudanza'
import { MIGRATIONS } from './migrations'
import type { Db } from './db'

export const MUDANZA_EXT = 'paila'
/** Versión del formato del archivo (si cambia lo que lleva adentro, sube). */
export const MUDANZA_FORMATO = 1
/** Las claves de los servicios: cifradas con la cuenta de esta compu, en otra no se podrían abrir. Cada uno las vuelve a pegar. */
export const CLAVES = "key LIKE 'claves.%'"
/** Ajustes con una ruta de esta compu (la carpeta de la Bandeja, la de los modelos): al traer, solo quedan si la ruta existe. */
export const AJUSTES_CON_RUTA = ['inbox_dir', 'models_dir', 'backup_dir']

/** Lo que el archivo guarda aparte de la base. */
export interface MudanzaExtras {
  version: string
  /** Lo que recuerda la ventana (columnas, volumen…): las claves "paila…" de su almacenamiento. */
  ventana?: Record<string, string>
  /** El estilo de la ventana (userData/estilo.json). */
  estilo?: string | null
  /** La carpeta de tapas guardadas (core/coverstore.ts). */
  tapas?: string
}

const sistemaDe = (p: NodeJS.Platform) => (p === 'win32' ? 'Windows' : p === 'darwin' ? 'Mac' : 'Linux')
const n = (db: DatabaseSync | Db, sql: string) => Number((db.prepare(sql).get() as { n: number | bigint } | undefined)?.n ?? 0)
const hay = (db: DatabaseSync | Db, tabla: string) => n(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${tabla}'`) > 0

/** Cuánto hay en una base (la de PAILA o un archivo exportado). */
export function contar(db: DatabaseSync | Db): MudanzaConteos {
  const lotes = (t: string, c: string) => (hay(db, t) ? n(db, `SELECT COUNT(DISTINCT ${c}) AS n FROM ${t}`) : 0)
  const vistas = (db.prepare("SELECT value FROM settings WHERE key = 'tabla.vistas'").get() as { value: string } | undefined)?.value
  let nVistas = 0
  try { nVistas = vistas ? (JSON.parse(vistas) as unknown[]).length : 0 } catch { /* vistas ilegibles: 0 */ }
  return {
    temas: n(db, 'SELECT COUNT(*) AS n FROM files WHERE trashed_at IS NULL AND excluded_at IS NULL'),
    analizados: n(db, 'SELECT COUNT(*) AS n FROM analysis WHERE error IS NULL'),
    huellas: n(db, 'SELECT COUNT(*) AS n FROM analysis WHERE audio_md5 IS NOT NULL OR chromaprint IS NOT NULL'),
    playlists: n(db, 'SELECT COUNT(*) AS n FROM playlists'),
    enPlaylists: n(db, 'SELECT COUNT(*) AS n FROM playlist_items'),
    historial: lotes('journal', 'batch_id') + lotes('trash_log', 'batch_id') + lotes('moves_log', 'batch_id') + lotes('replacements', 'id') + lotes('playlist_ops', 'id'),
    pendientes: n(db, 'SELECT COUNT(*) AS n FROM pending_changes'),
    vistas: nVistas,
    diccionario: hay(db, 'artist_dict') ? n(db, 'SELECT COUNT(*) AS n FROM artist_dict') : 0,
  }
}

/** Las carpetas de música de una base, con la ruta que tenían en su compu. */
export function carpetasDe(db: DatabaseSync | Db): Omit<MudanzaCarpeta, 'sugerida'>[] {
  const rows = db.prepare(`SELECT r.id, r.rel_path AS rel, v.label, v.last_mount AS mount,
      (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id AND f.trashed_at IS NULL AND f.excluded_at IS NULL) AS temas
    FROM roots r JOIN volumes v ON v.id = r.volume_id WHERE r.removed_at IS NULL ORDER BY r.id`).all() as { id: number; rel: string; label: string; mount: string; temas: number }[]
  return rows.map((r) => {
    const sep = r.mount.includes('\\') || /^[a-z]:/i.test(r.mount) ? '\\' : '/'
    const rel = r.rel.split(/[\\/]+/).filter(Boolean).join(sep)
    return { rootId: r.id, origen: rel ? r.mount.replace(/[\\/]+$/, '') + sep + rel : r.mount, disco: r.label, temas: Number(r.temas) }
  })
}

/** Todos los archivos de una carpeta, con su ruta relativa ("tapas/…" → "…"), en `/`. */
function archivosDe(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? archivosDe(p, base) : e.isFile() ? [path.relative(base, p).split(path.sep).join('/')] : []
  })
}

/**
 * Arma el archivo con todo en `out`. La base se copia entera (VACUUM INTO: sirve con la app andando) y, en la copia, se
 * sacan las claves, lo que quedó a medias (el diario de operaciones: en la otra compu no se tiene que terminar nada) y lo
 * revisado de la Bandeja (rutas de esta compu). Después se compacta, así lo borrado no queda escondido en el archivo.
 */
export function exportarTodo(db: Db, out: string, extras: MudanzaExtras): { archivo: string; tamano: number; clavesQuitadas: string[] } {
  const tmp = `${out}.armando`
  fs.rmSync(tmp, { force: true })
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
  const copia = new DatabaseSync(tmp)
  let clavesQuitadas: string[] = []
  try {
    copia.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;')
    clavesQuitadas = (copia.prepare(`SELECT key FROM settings WHERE ${CLAVES} AND key NOT LIKE 'claves.prueba.%'`).all() as { key: string }[]).map((r) => r.key.slice('claves.'.length))
    copia.exec('BEGIN')
    copia.exec(`DELETE FROM settings WHERE ${CLAVES}`)
    copia.exec('DELETE FROM op_journal WHERE recovered_at IS NULL')
    copia.exec('DELETE FROM inbox_items')
    copia.exec('CREATE TABLE mudanza (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE mudanza_tapas (rel TEXT PRIMARY KEY, data BLOB NOT NULL);')
    const meta = copia.prepare('INSERT INTO mudanza (key, value) VALUES (?, ?)')
    meta.run('formato', String(MUDANZA_FORMATO))
    meta.run('fecha', new Date().toISOString())
    meta.run('version', extras.version)
    meta.run('sistema', sistemaDe(process.platform))
    meta.run('claves', JSON.stringify(clavesQuitadas))
    meta.run('ventana', JSON.stringify(extras.ventana ?? {}))
    if (extras.estilo) meta.run('estilo', extras.estilo)
    const tapa = copia.prepare('INSERT INTO mudanza_tapas (rel, data) VALUES (?, ?)')
    if (extras.tapas) for (const rel of archivosDe(extras.tapas)) tapa.run(rel, fs.readFileSync(path.join(extras.tapas, ...rel.split('/'))))
    copia.exec('COMMIT')
    copia.exec('VACUUM')
  } catch (e) {
    copia.close(); fs.rmSync(tmp, { force: true })
    throw e
  }
  copia.close()
  fs.renameSync(tmp, out)
  return { archivo: out, tamano: fs.statSync(out).size, clavesQuitadas }
}

/** Abre un archivo exportado solo para leerlo. Error en castellano si no es de PAILA o es de una PAILA más nueva. */
export function abrirMudanza(file: string): DatabaseSync {
  let db: DatabaseSync
  try { db = new DatabaseSync(file, { readOnly: true }) } catch { throw new Error('No se pudo abrir ese archivo. ¿Es el que armó "Exportar todo"?') }
  try {
    if (!hay(db, 'mudanza') || !hay(db, 'files')) throw new Error('Ese archivo no es de "Exportar todo" de PAILA.')
    const formato = Number((db.prepare("SELECT value FROM mudanza WHERE key = 'formato'").get() as { value: string } | undefined)?.value ?? 0)
    const migr = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (formato > MUDANZA_FORMATO || migr > MIGRATIONS.length) throw new Error('Ese archivo lo armó una PAILA más nueva que esta. Actualizá PAILA en esta compu y probá de nuevo.')
  } catch (e) { db.close(); throw e }
  return db
}

/** Qué tiene un archivo exportado: de cuándo es, sus carpetas de música y cuánto trae. */
export function leerMudanza(file: string, existe: (p: string) => boolean = fs.existsSync): MudanzaResumen {
  const db = abrirMudanza(file)
  try {
    const meta = new Map((db.prepare('SELECT key, value FROM mudanza').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]))
    let claves: string[] = []
    try { claves = JSON.parse(meta.get('claves') ?? '[]') as string[] } catch { /* sin datos: ninguna */ }
    return {
      archivo: file,
      fecha: meta.get('fecha') ?? '',
      version: meta.get('version') ?? '',
      sistema: meta.get('sistema') ?? '',
      carpetas: carpetasDe(db).map((c) => ({ ...c, sugerida: existe(c.origen) ? c.origen : null })),
      conteos: contar(db),
      clavesQuitadas: claves,
    }
  } finally { db.close() }
}
