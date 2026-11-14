// Un tema en la papelera no ocupa más su lugar de antes (migración v54, core/trash.ts, organizer.ts liberarLugar) y, si la base no
// acepta lo que se movió, el archivo vuelve a su lugar (core/ops/run.ts). Pasó el 01/11 en la música del autor: NAPIA trajo
// mejores copias, las viejas fueron a la papelera, y Organizar movió 11 copias nuevas al lugar de las viejas pero la base las
// rechazó (UNIQUE root_id, rel_path): quedaron movidas en el disco y anotadas en el lugar de antes.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'
import { logMove } from '@paila/core/organizer'
import { runMovesAsync } from '@paila/core/ops/run'
import { MIGRATIONS } from '@paila/core/migrations'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, trash: Trash
const M = () => path.join(dir, 'M')
const tone = (rel: string, freq: number) => {
  const out = path.join(M(), ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=2`, out])
}
const fila = (id: number) => lib.db.prepare('SELECT rel_path AS rel, trashed_at AS t FROM files WHERE id = ?').get(id) as { rel: string; t: string | null }
const idDe = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const raiz = () => lib.roots()[0].id
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-papelera-lugar-'))
  tone('Biblioteca/Callejeros/Rehén.mp3', 440) // la copia vieja
  tone('Bajado/Callejeros - Rehén.mp3', 660) // la mejor, que trajo NAPIA
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  trash = new Trash(lib.db, rootPath, new Playlists(lib.db, (i) => lib.trackPath(i)))
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('la papelera no ocupa el lugar de antes', () => {
  it('al mandarlo a la papelera, el tema queda anotado donde está de verdad', async () => {
    const vieja = idDe('Biblioteca/Callejeros/Rehén.mp3')
    await trash.trash([vieja], 'Duplicados')
    expect(fila(vieja).t).not.toBeNull()
    expect(fila(vieja).rel).toMatch(/^_PAILA\/papelera\/.+\/Biblioteca\/Callejeros\/Rehén\.mp3$/)
    expect(fs.existsSync(path.join(M(), ...fila(vieja).rel.split('/')))).toBe(true)
  })

  it('Organizar pone la copia nueva en ese lugar y la base lo acepta (antes: UNIQUE constraint failed)', async () => {
    const nueva = idDe('Bajado/Callejeros - Rehén.mp3')
    const r = await runMovesAsync(lib.db, [{ kind: 'mover', op: 'organizar', rootId: raiz(), fileId: nueva, src: 'Bajado/Callejeros - Rehén.mp3', dst: 'Biblioteca/Callejeros/Rehén.mp3', data: { batchId: 99, rootId: raiz(), fileId: nueva, from: 'Bajado/Callejeros - Rehén.mp3', to: 'Biblioteca/Callejeros/Rehén.mp3' } }],
      { rootPath, annotate: (s) => logMove(lib.db, s.data) })
    expect(r.failed).toEqual([])
    expect(fila(nueva).rel).toBe('Biblioteca/Callejeros/Rehén.mp3')
    expect(fs.existsSync(path.join(M(), 'Biblioteca/Callejeros/Rehén.mp3'))).toBe(true)
  })

  it('restaurar la vieja con su lugar ocupado no pisa nada: falla y sigue en la papelera', async () => {
    const batch = (lib.db.prepare('SELECT MAX(batch_id) AS b FROM trash_log').get() as { b: number }).b
    const r = await trash.restore(batch)
    expect(r.moved).toBe(0)
    expect(r.failed.length).toBe(1)
    const vieja = (lib.db.prepare('SELECT file_id AS id FROM trash_log WHERE batch_id = ?').get(batch) as { id: number }).id
    expect(fila(vieja).t).not.toBeNull()
  })

  it('restaurar con el lugar libre la devuelve a su lugar de antes, también en la base', async () => {
    tone('Sueltos/Pompeya.mp3', 330)
    await lib.scan()
    const id = idDe('Sueltos/Pompeya.mp3')
    const t = await trash.trash([id], 'Duplicados')
    expect(fila(id).rel).toMatch(/^_PAILA\/papelera\//)
    const r = await trash.restore(t.batchId!)
    expect(r.moved).toBe(1)
    expect(fila(id)).toEqual({ rel: 'Sueltos/Pompeya.mp3', t: null })
  })

  it('la migración v54 pasa lo que ya estaba en la papelera a su lugar de verdad', () => {
    const v54 = MIGRATIONS.find((m) => m.includes('UPDATE files SET rel_path = (SELECT t.trash_rel FROM trash_log t'))!
    const id = idDe('Biblioteca/Callejeros/Rehén.mp3')
    // como estaba antes: un tema en la papelera anotado en un lugar libre de antes
    lib.db.prepare("INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at) VALUES (77, ?, 'Viejo/x.mp3', '_PAILA/papelera/t77/Viejo/x.mp3', 'Duplicados', '2026-11-01')").run(id)
    lib.db.prepare("UPDATE files SET trashed_at = '2026-11-01', rel_path = 'Viejo/x.mp3' WHERE id = ?").run(id)
    lib.db.exec(v54)
    expect(fila(id).rel).toBe('_PAILA/papelera/t77/Viejo/x.mp3')
    lib.db.exec(v54) // se puede volver a correr
    expect(fila(id).rel).toBe('_PAILA/papelera/t77/Viejo/x.mp3')
  })
})

describe('si la base no acepta lo movido, el archivo vuelve a su lugar', () => {
  it('disco y base no quedan distintos', async () => {
    tone('Prueba/a.mp3', 550)
    await lib.scan()
    const id = idDe('Prueba/a.mp3')
    const r = await runMovesAsync(lib.db, [{ kind: 'mover', op: 'organizar', rootId: raiz(), fileId: id, src: 'Prueba/a.mp3', dst: 'Prueba/b.mp3', data: null }],
      { rootPath, annotate: () => { throw Object.assign(new Error('UNIQUE constraint failed: files.root_id, files.rel_path'), { code: 'ERR_SQLITE_ERROR' }) } })
    expect(r.failed.length).toBe(1)
    expect(r.failed[0].error).toMatch(/lo dejó donde estaba|left it where it was/)
    expect(fs.existsSync(path.join(M(), 'Prueba/a.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(M(), 'Prueba/b.mp3'))).toBe(false)
    expect(lib.db.prepare('SELECT COUNT(*) AS n FROM op_journal WHERE result IS NULL').get()).toEqual({ n: 0 })
  })
})
