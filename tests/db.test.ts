// La base: filtro único de "tema visible", consultas preparadas que se reusan y filas como objetos comunes (core/db.ts).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { allRows, listed, openDb, visible } from '@paila/core/db'
import { OnlineCache } from '@paila/core/online/http'

const tmpDb = () => openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'paila-db-')), 'paila.db'))

describe('filtro de tema visible', () => {
  it('visible() oculta papelera, desaparecidos y excluidos; listed() muestra los desaparecidos', () => {
    expect(visible()).toBe('trashed_at IS NULL AND missing_at IS NULL AND excluded_at IS NULL')
    expect(visible('f')).toBe('f.trashed_at IS NULL AND f.missing_at IS NULL AND f.excluded_at IS NULL')
    expect(listed('f')).toBe('f.trashed_at IS NULL AND f.excluded_at IS NULL')
  })
})

describe('consultas preparadas', () => {
  it('la misma consulta se prepara una sola vez y sigue andando', () => {
    const db = tmpDb()
    db.exec('CREATE TABLE t (x INTEGER)')
    const a = db.prepare('INSERT INTO t (x) VALUES (?)')
    expect(db.prepare('INSERT INTO t (x) VALUES (?)')).toBe(a)
    for (let i = 0; i < 5; i++) db.prepare('INSERT INTO t (x) VALUES (?)').run(i)
    expect((db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(5)
    db.close()
  })

  it('con muchas consultas distintas suelta las viejas sin romper nada', () => {
    const db = tmpDb()
    const first = db.prepare('SELECT 0 AS v')
    for (let i = 1; i <= 600; i++) expect((db.prepare(`SELECT ${i} AS v`).get() as { v: number }).v).toBe(i)
    const again = db.prepare('SELECT 0 AS v')
    expect(again).not.toBe(first) // se había soltado: se vuelve a preparar
    expect((again.get() as { v: number }).v).toBe(0)
    db.close()
  })
})

describe('filas como objetos comunes (allRows)', () => {
  it('trae lo mismo que .all(), en el mismo orden de campos, y deja la consulta compartida como estaba', () => {
    const db = tmpDb()
    db.exec("CREATE TABLE t (id INTEGER, nombre TEXT, nota REAL, nada TEXT); INSERT INTO t VALUES (1, 'Luna', 4.5, NULL), (2, 'Sol', NULL, 'x')")
    const sql = 'SELECT id, nombre AS n, nota, nada FROM t WHERE id >= ? ORDER BY id'
    const rapido = allRows<Record<string, unknown>>(db, sql, 1)
    const comun = db.prepare(sql).all(1)
    expect(rapido).toEqual(comun.map((r) => ({ ...r })))
    expect(rapido.map((r) => Object.keys(r).join())).toEqual(comun.map((r) => Object.keys(r).join()))
    expect(Array.isArray(db.prepare(sql).get(2))).toBe(false) // la consulta preparada sigue devolviendo objetos
    expect(allRows(db, 'SELECT id FROM t WHERE id > 5')).toEqual([])
    db.close()
  })
})

describe('caché de internet: solo las claves guardadas (OnlineCache.known)', () => {
  it('contesta igual que sin el atajo, también lo que se guarda después', () => {
    const db = tmpDb()
    const guardado = new OnlineCache(db)
    guardado.put('acoustid', 'f:uno', 'ok', [1])
    guardado.put('deezer', 'r:otro', 'error', null)
    const c = new OnlineCache(db)
    expect([...c.known('acoustid')]).toEqual(['f:uno'])
    expect(c.get('acoustid', 'f:uno')).toEqual({ status: 'ok', data: [1] })
    expect(c.get('acoustid', 'f:dos')).toBeNull()
    expect(c.get('deezer', 'r:otro')).toEqual({ status: 'error', data: null }) // una fuente sin `known` pregunta como siempre
    c.put('acoustid', 'f:dos', 'ok', [2])
    expect(c.get('acoustid', 'f:dos')).toEqual({ status: 'ok', data: [2] })
    expect(c.known('acoustid').size).toBe(2)
    db.close()
  })
})
