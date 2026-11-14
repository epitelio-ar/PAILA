// PAILA_SOLO_LECTURA=1 (capturas y pruebas con una copia de la base que apunta a la Música de verdad): ninguna operación
// sobre archivos arranca, y la recuperación al abrir no toca el disco.
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { OpJournal, soloLectura } from '@paila/core/journal'

describe('modo solo mirar', () => {
  afterEach(() => { delete process.env.PAILA_SOLO_LECTURA })
  it('frena cualquier operación sobre archivos antes de empezar', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE op_journal (id INTEGER PRIMARY KEY, op TEXT, phase TEXT, root_id INTEGER, file_id INTEGER, src_rel TEXT, dst_rel TEXT, backup TEXT, orig_size INTEGER, hash TEXT, data TEXT, started_at TEXT, recovered_at TEXT, result TEXT, message TEXT, seen_at TEXT)')
    const j = new OpJournal(db as never)
    expect(soloLectura()).toBe(false)
    expect(j.begin({ op: 'tags', src: 'a.mp3' })).toBeGreaterThan(0)
    process.env.PAILA_SOLO_LECTURA = '1'
    expect(soloLectura()).toBe(true)
    expect(() => j.begin({ op: 'tags', src: 'b.mp3' })).toThrow(/solo para mirar/)
  })
})
