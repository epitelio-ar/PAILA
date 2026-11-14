// "Combinan para pasar después" en la ficha del tema (core/setbuilder.ts, `combinan`): tono vecino en la rueda Camelot y
// BPM a ±6 % (con el doble y la mitad), los de mejor nota primero, sin el mismo tema en otra copia.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { combinan } from '@paila/core/setbuilder'

let dir: string, db: Db
let nextId = 1
const add = (title: string, bpm: number, camelot: string, grade: string, extra: { artist?: string; kind?: string } = {}) => {
  const id = nextId++
  db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, artist, title) VALUES (?, 1, ?, 1, 1, ?, 'mp3', ?, ?)").run(id, `${id}.mp3`, extra.kind ?? 'musica', extra.artist ?? 'Alguien', title)
  db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, bpm, camelot) VALUES (?, 1, 1, 1, '', ?, ?, ?)").run(id, grade, bpm, camelot)
  return id
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-combinan-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
})
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('combinan para pasar después', () => {
  it('tono vecino y BPM parecido, mejor nota primero; nada que choque ni el mismo tema', () => {
    const base = add('Seven Nation Army', 120, '12A', 'F', { artist: 'The White Stripes' })
    add('Vecino B', 122.7, '11A', 'B')
    add('Vecino A', 118, '1A', 'A')
    add('Relativo', 121, '12B', 'C')
    add('Mitad', 60.5, '12A', 'B')
    add('Choca de tono', 120, '5A', 'A+')
    add('Diagonal', 120, '11B', 'A')
    add('Muy rápido', 130, '12A', 'A')
    add('Seven Nation Army (copia)', 120, '12A', 'A+', { artist: 'The White Stripes' })
    add('Un sample', 120, '12A', 'A+', { kind: 'produccion' })
    expect(combinan(db, base).map((x) => x.title)).toEqual(['Vecino A', 'Mitad', 'Vecino B', 'Relativo'])
    expect(combinan(db, base, 2)).toHaveLength(2)
  })
})
