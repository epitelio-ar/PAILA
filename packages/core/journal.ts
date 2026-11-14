// Diario de operaciones en curso ("escrito antes de actuar"). Cada paso que toca un archivo se anota ANTES de hacerlo
// (qué operación, origen, destino, copia de resguardo) y la anotación se borra recién en la misma transacción que guarda
// el resultado en la base. Si PAILA se corta en el medio (luz, cuelgue, cierre forzado), la fila queda: al abrir,
// core/recovery.ts mira dónde quedó el archivo y lo termina o lo vuelve atrás.
import fs from 'node:fs'
import { inTransaction, transaction, type Db } from './db'
import { textos } from '@paila/shared/idioma'

// Lo que se muestra si se intenta tocar un archivo con la app abierta solo para mirar. Lo que se anota en el diario
// (operación, rutas, datos para deshacer) son datos: no se traducen.
export const T = textos({
  soloLectura: { es: 'PAILA está abierta solo para mirar (PAILA_SOLO_LECTURA): no se toca ningún archivo', en: "PAILA is open just for looking (PAILA_SOLO_LECTURA): no file is touched" },
})

/** Qué se estaba haciendo. Cada una tiene su forma de terminarse o volverse atrás en core/recovery.ts. */
export type JournalOp =
  | 'organizar' | 'deshacer-organizar' | 'limpieza' // moves_log
  | 'papelera' | 'restaurar' // trash_log
  | 'tags' | 'deshacer-tags' // cambios pendientes (tags, tapa, nombre, extensión)
  | 'reemplazo' | 'deshacer-reemplazo' // reemplazos y conversiones
  | 'vaciar' // vaciar la papelera
  | 'bandeja' // un archivo de la Bandeja pasa a usados/ o no-sirvió/
  | 'separar' | 'deshacer-separar' // Separar voz: la acapella y el instrumental a su carpeta, o a la papelera al deshacer (core/stems/separar.ts)
  | 'abrir' | 'deshacer-abrir' // lo sacado de un ZIP o RAR va a su carpeta (o, al deshacer, a la papelera): core/archive/extract.ts
  | 'zip-papelera' | 'zip-restaurar' // un ZIP o RAR que ya estaba abierto afuera va a la papelera (o vuelve): core/archive/papelera.ts
  | 'copia' // algo que PAILA escribe afuera de tu Música (pendrive, celular, archivos de otros programas): core/ops/copy.ts

export interface JournalStart {
  op: JournalOp
  rootId?: number | null
  fileId?: number | null
  /** Rutas relativas a la carpeta de música (así sirven aunque el disco cambie de letra). */
  src?: string | null
  dst?: string | null
  /** Copia de resguardo (ruta completa, en la carpeta de datos de PAILA). */
  backup?: string | null
  /** Lo que hace falta para anotar el resultado en la base si hay que terminarlo al abrir. */
  data?: unknown
}

export interface JournalEntry {
  id: number; op: JournalOp; phase: string; rootId: number | null; fileId: number | null; src: string | null; dst: string | null
  backup: string | null; origSize: number | null; hash: string | null; data: unknown; startedAt: string
}

/**
 * Las anotaciones del diario se guardan con sincronización completa: tienen que estar en el disco antes de tocar el
 * archivo (si no, un corte de luz podría llevarse la anotación y dejar el movimiento). El resto de la base sigue en
 * modo normal (más rápido); al sincronizar el diario también queda en el disco todo lo anterior.
 */
function durable<T>(db: Db, fn: () => T): T {
  if (inTransaction(db)) return fn() // SQLite no deja cambiarlo en medio de una transacción: queda como la de afuera
  db.exec('PRAGMA synchronous = FULL')
  try { return fn() } finally { db.exec('PRAGMA synchronous = NORMAL') }
}

/** PAILA_SOLO_LECTURA=1: la app se abre para mirar (capturas, pruebas con una copia de la base que apunta a la Música de
 * verdad) y no puede tocar ningún archivo. Toda operación sobre archivos pasa por begin(), así que alcanza con frenarla acá
 * (22/10/2026: una captura apretó "Deshacer" y le devolvió a 49 temas reales su volumen viejo). */
export const soloLectura = () => process.env.PAILA_SOLO_LECTURA === '1'

export class OpJournal {
  constructor(private db: Db) {}

  /** Anota lo que se va a hacer. Devuelve el número de la anotación. */
  begin(e: JournalStart): number {
    if (soloLectura()) throw new Error(T.soloLectura)
    return durable(this.db, () => Number(this.db.prepare(
      'INSERT INTO op_journal (op, root_id, file_id, src_rel, dst_rel, backup, data, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(e.op, e.rootId ?? null, e.fileId ?? null, e.src ?? null, e.dst ?? null, e.backup ?? null, e.data === undefined ? null : JSON.stringify(e.data), new Date().toISOString()).lastInsertRowid))
  }

  /**
   * Avanza la fase ("resguardo" = la copia de resguardo de la 0.5.3 ya está completa y en el disco; "respaldo" = lo de antes ya está
   * guardado en el cambios.paila de la tanda, en la posición `pos`, que se suma a los datos: recién ahí se reemplaza el archivo).
   */
  phase(id: number, phase: string, extra: { origSize?: number; pos?: number } = {}) {
    durable(this.db, () => this.db.prepare("UPDATE op_journal SET phase = ?, orig_size = COALESCE(?, orig_size), data = CASE WHEN ? IS NULL THEN data ELSE json_set(COALESCE(data, '{}'), '$.pos', ?) END WHERE id = ?")
      .run(phase, extra.origSize ?? null, extra.pos ?? null, extra.pos ?? null, id))
  }

  /** Guarda la huella del sonido del original (sirve para verificar la copia de resguardo si hay que restaurarla). */
  hash(id: number, hash: string) {
    this.db.prepare('UPDATE op_journal SET hash = ? WHERE id = ?').run(hash, id)
  }

  /** Terminó bien: guarda el resultado (`annotate`) y borra la anotación, todo junto (o nada). */
  done(id: number, annotate: () => void = () => {}) {
    durable(this.db, () => transaction(this.db, () => {
      annotate()
      this.db.prepare('DELETE FROM op_journal WHERE id = ?').run(id)
    }))
  }

  /** No se hizo (falló antes de tocar nada, o ya se volvió atrás): se borra la anotación. */
  drop(id: number) {
    durable(this.db, () => this.db.prepare('DELETE FROM op_journal WHERE id = ?').run(id))
  }

  /** Lo que quedó a medias de una vez anterior (sin resolver todavía). */
  open(): JournalEntry[] {
    return (this.db.prepare(
      `SELECT id, op, phase, root_id AS rootId, file_id AS fileId, src_rel AS src, dst_rel AS dst, backup, orig_size AS origSize, hash, data, started_at AS startedAt
       FROM op_journal WHERE recovered_at IS NULL ORDER BY id`,
    ).all() as unknown as (JournalEntry & { data: string | null })[]).map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }))
  }

  /**
   * Anota qué hizo la recuperación con una operación a medias (queda para contárselo a la persona). `annotate` = lo que
   * faltaba guardar en la base: va en la misma transacción, así un segundo corte no lo anota dos veces.
   */
  resolve(id: number, result: RecoveryResult, message: string, annotate: () => void = () => {}) {
    durable(this.db, () => transaction(this.db, () => {
      annotate()
      this.db.prepare('UPDATE op_journal SET recovered_at = ?, result = ?, message = ? WHERE id = ?').run(new Date().toISOString(), result, message, id)
    }))
  }
}

/**
 * completado = el archivo ya estaba en su lugar nuevo: se terminó de anotar en la base.
 * no-hecho = no se había llegado a tocar: queda como estaba.
 * vuelto-atras = había quedado a medias: se volvió a como estaba antes.
 * revisar = no se pudo resolver solo (se explica qué mirar).
 */
export type RecoveryResult = 'completado' | 'no-hecho' | 'vuelto-atras' | 'revisar'

/** Copia `from` a `to` y se asegura de que la copia quede escrita en el disco (no solo en la memoria de Windows). */
export function copyDurable(from: string, to: string) {
  fs.copyFileSync(from, to)
  const fd = fs.openSync(to, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
