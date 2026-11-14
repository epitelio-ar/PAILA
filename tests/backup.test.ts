// Tests de los respaldos de la base (core/backup.ts): se crean, se listan y se hacen una vez por día.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb } from '@paila/core/db'
import { backupDaily, backupNow, list } from '@paila/core/backup'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-backup-'))
const db = openDb(path.join(dir, 'paila.db'))
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('respaldos de la base', () => {
  it('copia la base entera y se puede abrir', () => {
    db.prepare("INSERT INTO playlists (name, kind, position, created_at) VALUES ('Fiesta', 'list', 0, '2026-10-20')").run()
    const b = backupNow(db, path.join(dir, 'respaldos'), 'antes-de-organizar')
    const copy = new DatabaseSync(b.file)
    expect((copy.prepare('SELECT name FROM playlists').get() as { name: string }).name).toBe('Fiesta')
    copy.close()
  })
  it('uno por día: el segundo del mismo día no se repite', () => {
    expect(backupDaily(db, path.join(dir, 'respaldos'))).not.toBeNull()
    expect(backupDaily(db, path.join(dir, 'respaldos'))).toBeNull()
  })
  it('deja solo los últimos de cada tipo', async () => {
    const r = path.join(dir, 'pocos')
    for (let i = 0; i < 4; i++) { backupNow(db, r, 'prueba', 2); await new Promise((x) => setTimeout(x, 1100)) }
    expect(list(r).filter((b) => b.name.endsWith('_prueba.db'))).toHaveLength(2)
  }, 90_000)
})
