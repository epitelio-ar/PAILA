// Una carpeta que sacaste de PAILA no es un disco desenchufado (pasó con "Temas De Un Amigo", 13/11): el Historial lo dice con su
// nombre, lo de esa carpeta queda como está y el resto de la tanda se deshace (core/history-files.ts, enPaila/temaEnPaila de core/db.ts).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Organizer } from '@paila/core/organizer'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Playlists } from '@paila/core/playlists'
import { Replacer } from '@paila/core/replace'
import { Improver } from '@paila/core/improve'
import { History } from '@paila/core/history'
import { readTags } from '@paila/core/tagio'
import { guardarRegla } from '@paila/core/estado-dejar'
import { proponerMover } from '@paila/core/propuestas'
import { aplicarTodo } from '@paila/core/aplicar'
import type { HistoryEntry } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const REGLA = { rule: '%artista%/%album%/%titulo%', dest: 'Biblioteca' } // idioma-ok: la regla de la prueba

let dir: string, lib: Library, hist: History, changes: Changes, organizer: Organizer
const deps = () => ({ db: lib.db, changes, trash: new Trash(lib.db, rootPath, new Playlists(lib.db, (i) => lib.trackPath(i))), organizer })
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
const id = (nombre: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${nombre}`) as { id: number }).id
const rel = (fileId: number) => (lib.db.prepare('SELECT rel_path AS r FROM files WHERE id = ?').get(fileId) as { r: string }).r
const entrada = (t: number) => hist.list().find((e) => e.kind === 'aplicar' && e.id === t) as HistoryEntry
const tema = (abs: string, meta: Record<string, string>, freq: number) => {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), abs])
}
const aplicar = async () => { const r = await aplicarTodo(deps()); expect(r.failed).toEqual([]); return r.tanda! }

describe('una carpeta que sacaste de PAILA, en el Historial', () => {
  let soloAmigo: number, tags: number, mover: number, uno: number, dos: number, tres: number
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-quitada-'))
    const M = path.join(dir, 'Música'), R = path.join(dir, 'Temas De Un Amigo')
    tema(path.join(M, 'Descargas', 'uno.mp3'), { artist: 'La Renga', title: 'Uno', album: 'Disco' }, 300)
    tema(path.join(M, 'Descargas', 'dos.mp3'), { artist: 'La Renga', title: 'Dos', album: 'Disco' }, 500)
    tema(path.join(R, 'sueltos', 'tres.mp3'), { artist: 'Un Amigo', title: 'Tres', album: 'Demos' }, 700)
    lib = new Library(path.join(dir, 'paila.db'), ffprobe)
    await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
    await lib.addRoot(R, [{ rel: '', kind: 'musica' }])
    await lib.scan()
    guardarRegla(lib.db, REGLA)
    changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    organizer = new Organizer(lib.db, rootPath)
    hist = new History(lib.db, { changes, trash: deps().trash, organizer, replacer: new Replacer(lib.db, rootPath, ffprobe, ffmpeg), improver: new Improver(lib.db), rootPath })
    uno = id('uno.mp3'); dos = id('dos.mp3'); tres = id('tres.mp3')
    changes.stage([tres], 'comment', 'demo'); soloAmigo = await aplicar()
    changes.stage([uno, dos, tres], 'genre', 'Rock'); tags = await aplicar()
    proponerMover(lib.db, organizer.plan(REGLA, true).moves); mover = await aplicar()
    expect(rel(tres)).toBe('Biblioteca/Un Amigo/Tres.mp3')
    lib.removeRoot(lib.roots().find((r) => r.path === R)!.id)
  }, 60_000)
  afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('no dice "el disco no está conectado": dice que es una carpeta que sacaste, con su nombre', () => {
    const l = hist.list()
    expect(l.some((e) => /disco/i.test(e.whyNot ?? ''))).toBe(false)
    expect(entrada(soloAmigo)).toMatchObject({ canUndo: false, whyNot: 'Estos temas son de una carpeta que sacaste de PAILA («Temas De Un Amigo»): ya no se tocan' })
    const m = entrada(mover)
    expect(m.canUndo).toBe(true)
    expect(m.note).toBe('Uno de estos temas es de una carpeta que sacaste de PAILA («Temas De Un Amigo»): ese queda como está')
    // la tanda de tags tiene en su cadena al mover (los mismos temas), y nada la frena
    expect(entrada(tags)).toMatchObject({ canUndo: true })
    expect(entrada(tags).cadena!.map((c) => c.id)).toEqual([mover])
  })

  it('deshacer devuelve lo de Música y deja como está lo de la carpeta quitada (sin fallas)', async () => {
    const r = await hist.undo('aplicar', tags, { cadena: true })
    expect(r.failed).toEqual([])
    expect(rel(uno)).toBe('Descargas/uno.mp3')
    expect(readTags(lib.trackPath(uno)!).genre).toBeNull()
    // lo del Amigo quedó como estaba después de aplicar: movido y con el género
    const tresAbs = path.join(dir, 'Temas De Un Amigo', 'Biblioteca', 'Un Amigo', 'Tres.mp3')
    expect(fs.existsSync(tresAbs)).toBe(true)
    expect(readTags(tresAbs).genre).toBe('Rock')
    const m = entrada(mover), t = entrada(tags)
    expect([m.undone, t.undone]).toEqual([true, true])
    expect(t.note).toMatch(/carpeta que sacaste de PAILA/)
  }, 60_000)
})
