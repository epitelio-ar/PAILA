// Las propuestas guardadas (MASTERPLAN-5, 3.2 y etapa 2): lo que PAILA propone mandar a la papelera o mover queda en la base (tabla
// `propuestas`), no en la pantalla, con la versión del archivo que se miró (tamaño y fecha). Salís y volvés, y sigue ahí. Al aplicar
// (core/aplicar.ts), si el archivo cambió desde entonces, esa propuesta no se aplica y vuelve a la revisión con el motivo (riesgo 2).
// También guarda lo que encontró una búsqueda larga (los grupos de repetidos, las tapas) en `resultados`, para mostrarlo de nuevo.
import fs from 'node:fs'
import type { Db } from './db'
import type { PlannedMove } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

export const T = textos({
  cambio: {
    es: 'El archivo cambió desde que PAILA lo miró (lo editaste o lo reemplazaste): no se tocó. Volvé a mirarlo',
    en: 'The file changed since PAILA looked at it (you edited or replaced it): it was left alone. Look at it again',
  },
  noEsta: { es: 'El archivo ya no está donde PAILA lo vio', en: "The file isn't where PAILA saw it anymore" },
})

/** 'papelera' = va a la papelera de PAILA (un repetido); 'mover' = cambia de carpeta o de nombre (Organizar); 'reemplazo' = una copia
 * mejor que llegó a la Bandeja toma su lugar (Sonido, MASTERPLAN-5 etapa 5: core/sonido-reemplazos.ts). */
export type TipoPropuesta = 'papelera' | 'mover' | 'reemplazo'
/** Lo que lleva cada una: en la papelera, la copia que se queda; al mover, la carpeta de música y el "(2)" aceptado a propósito. */
/** Al reemplazar: el archivo que llegó (en la Bandeja) y cómo es, en palabras. */
export interface DatoPropuesta { kept?: number | null; motivo?: string; rootId?: number; choque?: string; archivo?: string; frase?: string }
export interface Propuesta {
  id: number; tipo: TipoPropuesta; fileId: number
  /** Dónde está hoy el tema. */
  rel: string
  /** Dónde estaba al proponerlo, y adónde va (al mover). */
  antes: string; despues: string | null
  dato: DatoPropuesta; size: number | null; mtime: number | null
  /** Por qué no se pudo aplicar la última vez (vuelve a la revisión: "Aplicar todo" ya no la incluye). */
  error: string | null
}

const ahora = () => new Date().toISOString()

function guardar(db: Db, tipo: TipoPropuesta, fileId: number, despues: string | null, dato: DatoPropuesta) {
  // el "antes" y la versión salen de cómo está el tema en la base (lo que PAILA miró), no de lo que diga la pantalla
  db.prepare(`INSERT INTO propuestas (tipo, file_id, antes, despues, dato, size, mtime, error, creada)
    SELECT ?, id, rel_path, ?, ?, size, mtime, NULL, ? FROM files WHERE id = ? AND trashed_at IS NULL
    ON CONFLICT (file_id, tipo) DO UPDATE SET antes = excluded.antes, despues = excluded.despues, dato = excluded.dato,
      size = excluded.size, mtime = excluded.mtime, error = NULL, creada = excluded.creada`).run(tipo, despues, JSON.stringify(dato), ahora(), fileId)
}

function enTransaccion(db: Db, f: () => void) {
  db.exec('BEGIN')
  try { f(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
}

/**
 * Suma repetidos a lo que vas a aplicar: cada uno con la copia que se queda (sus playlists pasan a ella). Si después elegís otra copia
 * del mismo grupo, se vuelve a llamar con lo nuevo: `grupo` saca primero lo anterior de esos temas.
 */
export function proponerPapelera(db: Db, items: { id: number; kept: number | null }[], motivo: string, grupo: number[] = []): number {
  enTransaccion(db, () => {
    const sacar = db.prepare("DELETE FROM propuestas WHERE tipo = 'papelera' AND file_id = ?")
    for (const id of grupo) sacar.run(id)
    for (const it of items) if (it.id !== it.kept) guardar(db, 'papelera', it.id, null, { kept: it.kept, motivo })
  })
  return items.length
}

/** Suma lo que mueve Organizar. Los que chocan con otro solo entran si la persona aceptó el "(2)" (`choque`): nunca en silencio. */
export function proponerMover(db: Db, moves: (PlannedMove & { choque?: string })[]): number {
  enTransaccion(db, () => { for (const m of moves) guardar(db, 'mover', m.fileId, m.to, { rootId: m.rootId, ...(m.choque ? { choque: m.choque } : {}) }) })
  return moves.length
}

/**
 * Las copias mejores que llegaron a la Bandeja (Sonido): `items` es todo lo que hoy se puede reemplazar. Las nuevas se suman, las que ya
 * estaban con el mismo archivo quedan como están (con su motivo, si fallaron) y las que ya no están en `items` salen. Devuelve cuántas hay.
 */
export function proponerReemplazos(db: Db, items: { fileId: number; archivo: string; despues: string; frase: string }[]): number {
  const hoy = new Map(propuestas(db, 'reemplazo').map((p) => [p.fileId, p]))
  const nuevos = new Set(items.map((i) => i.fileId))
  enTransaccion(db, () => {
    for (const p of hoy.values()) if (!nuevos.has(p.fileId)) db.prepare('DELETE FROM propuestas WHERE id = ?').run(p.id)
    for (const i of items) if (hoy.get(i.fileId)?.dato.archivo !== i.archivo) guardar(db, 'reemplazo', i.fileId, i.despues, { archivo: i.archivo, frase: i.frase })
  })
  return items.length
}

/** Lo que está para aplicar (de un tipo, o todo), con dónde está hoy cada tema. */
export function propuestas(db: Db, tipo?: TipoPropuesta): Propuesta[] {
  return (db.prepare(`SELECT p.id, p.tipo, p.file_id AS fileId, f.rel_path AS rel, p.antes, p.despues, p.dato, p.size, p.mtime, p.error
    FROM propuestas p JOIN files f ON f.id = p.file_id ${tipo ? 'WHERE p.tipo = ?' : ''} ORDER BY p.tipo, f.rel_path`)
    .all(...(tipo ? [tipo] : [])) as unknown as (Omit<Propuesta, 'dato'> & { dato: string | null })[])
    .map((p) => ({ ...p, dato: p.dato ? (JSON.parse(p.dato) as DatoPropuesta) : {} }))
}

/** Saca propuestas (por número, de esos temas, de un tipo, o todas): no toca ningún archivo. */
export function sacarPropuestas(db: Db, que: { ids?: number[]; fileIds?: number[]; tipo?: TipoPropuesta; fallidas?: boolean } = {}) {
  enTransaccion(db, () => {
    if (que.ids) { const st = db.prepare('DELETE FROM propuestas WHERE id = ?'); for (const id of que.ids) st.run(id) }
    else if (que.fileIds) {
      const st = db.prepare(`DELETE FROM propuestas WHERE file_id = ?${que.tipo ? ' AND tipo = ?' : ''}`)
      for (const id of que.fileIds) st.run(...(que.tipo ? [id, que.tipo] : [id]))
    } else if (que.fallidas) db.exec('DELETE FROM propuestas WHERE error IS NOT NULL')
    else if (que.tipo) db.prepare('DELETE FROM propuestas WHERE tipo = ?').run(que.tipo)
    else db.exec('DELETE FROM propuestas')
  })
}

/** Una propuesta que no se pudo aplicar: queda, aparte y con el motivo, para revisarla o sacarla. */
export function marcarFallada(db: Db, id: number, error: string) {
  db.prepare('UPDATE propuestas SET error = ? WHERE id = ?').run(error, id)
}

/**
 * ¿El archivo sigue siendo el que se miró? null si sí (o si no hay versión anotada); si no, el motivo. Con 2 s de margen en la fecha,
 * como el motor de operaciones (core/ops/checks.ts): algunos discos la guardan redondeada.
 */
export function cambioDesde(file: string | null, base: { size: number | null; mtime: number | null } | undefined): string | null {
  if (!base || base.size == null) return null
  let st: fs.Stats
  try { st = fs.statSync(file ?? '') } catch { return T.noEsta }
  return st.size !== base.size || (base.mtime != null && Math.abs(st.mtimeMs - base.mtime) > 2000) ? T.cambio : null
}

/**
 * Lo que PAILA misma acaba de escribir en un archivo (tags, tapa, un recorte) no es "un cambio de afuera": las demás propuestas de ese
 * tema pasan a la versión nueva. Lo llama core/changes-file.ts después de anotar el tamaño y la fecha nuevos.
 */
export function reestampar(db: Db, fileId: number) {
  db.prepare('UPDATE pending_base SET size = (SELECT size FROM files WHERE id = ?), mtime = (SELECT mtime FROM files WHERE id = ?) WHERE file_id = ?').run(fileId, fileId, fileId)
  db.prepare('UPDATE propuestas SET size = (SELECT size FROM files WHERE id = ?), mtime = (SELECT mtime FROM files WHERE id = ?) WHERE file_id = ?').run(fileId, fileId, fileId)
}

/** Lo que encontró una búsqueda larga (los repetidos, las tapas), para mostrarlo de nuevo sin buscar otra vez. */
export function guardarResultado(db: Db, clave: string, datos: unknown) {
  db.prepare('INSERT INTO resultados (clave, datos, at) VALUES (?, ?, ?) ON CONFLICT (clave) DO UPDATE SET datos = excluded.datos, at = excluded.at')
    .run(clave, JSON.stringify(datos), ahora())
}
export function leerResultado<T>(db: Db, clave: string): { datos: T; at: string } | null {
  const r = db.prepare('SELECT datos, at FROM resultados WHERE clave = ?').get(clave) as { datos: string; at: string } | undefined
  try { return r ? { datos: JSON.parse(r.datos) as T, at: r.at } : null } catch { return null }
}
