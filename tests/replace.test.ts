// Tests de Reemplazar un tema (core/replace.ts): cambiar el archivo conservando tags y playlists, y deshacerlo.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Changes } from '@paila/core/changes'
import { coverFromBytes, readCover, readTags } from '@paila/core/tagio'
import { Replacer, describeCandidate } from '@paila/core/replace'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { Trash } from '@paila/core/trash'
import { purgeTrash, trashUsage } from '@paila/core/purge'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
/** ¿Está `rel` dentro de alguna tanda de la papelera? (las carpetas de tanda llevan fecha, hora y un código al azar) */
const inTrash = (root: string, rel: string) => fs.existsSync(path.join(root, '_PAILA/papelera')) && (fs.readdirSync(path.join(root, '_PAILA/papelera'), { recursive: true }) as string[]).some((f) => f.split(path.sep).join('/').endsWith('/' + rel))

let dir: string
let lib: Library
let rep: Replacer
let pl: Playlists
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const run = { full: analyzeFile }

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-rep-'))
  fs.mkdirSync(path.join(dir, 'M/Rock'), { recursive: true }); fs.mkdirSync(path.join(dir, 'Descargas'))
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-b:a', '64k', '-metadata', 'artist=La Renga', '-metadata', 'title=Tema Viejo', path.join(dir, 'M/Rock/Tema.mp3')])
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path.join(dir, 'Descargas/track01.flac')])
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const id = lib.tracks()[0][0] as number
  const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
  ch.stage([id], 'cover', coverFromBytes(PNG)); await ch.apply()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  pl.addTracks(pl.create('Mi lista'), [id])
  rep = new Replacer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null, ffprobe, ffmpeg)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('reemplazo básico', () => {
  it('compara el archivo nuevo con el actual', async () => {
    const c = await describeCandidate(run, ffprobe, ffmpeg, path.join(dir, 'Descargas/track01.flac'))
    expect(c.ext).toBe('flac')
    expect(['A+', 'A', 'B', 'C', 'D', 'F']).toContain(c.grade)
    expect(c.artist).toBeNull() // sin tags: por eso conviene heredar los del tema actual
  })

  it('reemplaza conservando tags, tapa, nombre, carpeta y playlists, y se deshace', async () => {
    const id = lib.tracks()[0][0] as number
    const r = await rep.replace(id, path.join(dir, 'Descargas/track01.flac'), { keepTags: true, keepCover: true, sameName: true })
    expect(r.newRel).toBe('Rock/Tema.flac')
    const now = lib.tracks()[0]
    expect(now[0]).toBe(id) // mismo tema para PAILA
    expect(now[2]).toBe('Rock/Tema.flac')
    expect(now[4]).toBe('flac')
    expect(now[11]).toBe('La Renga') // artista conservado
    const file = path.join(dir, 'M/Rock/Tema.flac')
    expect(readTags(file)).toMatchObject({ artist: 'La Renga', title: 'Tema Viejo' }) // y escrito en el archivo nuevo
    expect(readCover(file)).not.toBeNull()
    expect(pl.trackIds(pl.tree()[0].id)).toEqual([id]) // la playlist lo sigue
    expect(fs.existsSync(path.join(dir, 'M/Rock/Tema.mp3'))).toBe(false)
    expect(inTrash(path.join(dir, 'M'), 'Rock/Tema.mp3')).toBe(true) // el viejo se guarda
    expect(fs.existsSync(path.join(dir, 'Descargas/track01.flac'))).toBe(true) // la descarga queda donde estaba
    expect(lib.db.prepare('SELECT COUNT(*) AS n FROM analysis WHERE file_id = ?').get(id)).toMatchObject({ n: 0 }) // se vuelve a analizar

    rep.undo(r.replacementId)
    expect(fs.existsSync(path.join(dir, 'M/Rock/Tema.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Rock/Tema.flac'))).toBe(false)
    expect(lib.tracks()[0][2]).toBe('Rock/Tema.mp3')
    expect(lib.tracks()[0][4]).toBe('mp3')
    expect(rep.list()[0].undone).toBe(true)
    expect(() => rep.undo(r.replacementId)).toThrow(/ya se deshizo/)
  })

  // uso real del 24/10: al reemplazar por otra versión quedaba la grilla del archivo viejo
  it('la grilla y los cues del archivo viejo se sacan (los de Rekordbox solo si cambia la duración o el formato) y deshacer los devuelve', async () => {
    const id = lib.tracks()[0][0] as number
    const grid = (method: string) => lib.db.prepare("INSERT INTO dj_grid (file_id, method, bpm, segments, src_size, made_at) VALUES (?, ?, 124, '[]', 1, 'x')").run(id, method)
    const cue = (source: string) => lib.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, name) VALUES (?, ?, 'cue', 1, 0.5, 'Intro')").run(id, source)
    grid('beatthis'); grid('rekordbox'); cue('paila'); cue('rekordbox'); cue('tracklist')
    lib.db.prepare("INSERT INTO dj_tempo (file_id, method, lo, hi) VALUES (?, 'beatthis', 120, 128)").run(id)
    const has = () => ({
      grids: (lib.db.prepare('SELECT method FROM dj_grid WHERE file_id = ? ORDER BY method').all(id) as { method: string }[]).map((r) => r.method),
      cues: (lib.db.prepare('SELECT source FROM dj_cues WHERE file_id = ? ORDER BY source').all(id) as { source: string }[]).map((r) => r.source),
      tempo: (lib.db.prepare('SELECT COUNT(*) AS n FROM dj_tempo WHERE file_id = ?').get(id) as { n: number }).n,
    })
    // de MP3 a FLAC (misma duración): lo de PAILA se va; lo de Rekordbox también, porque el MP3 empieza corrido
    const r = await rep.replace(id, path.join(dir, 'Descargas/track01.flac'), { keepTags: true, keepCover: true, sameName: true })
    expect(has()).toEqual({ grids: [], cues: ['tracklist'], tempo: 0 })
    grid('beatthis') // PAILA la volvió a calcular para el FLAC
    rep.undo(r.replacementId)
    expect(has()).toEqual({ grids: ['beatthis', 'rekordbox'], cues: ['paila', 'rekordbox', 'tracklist'], tempo: 1 })
    // FLAC por FLAC de la misma duración: la de Rekordbox sigue valiendo; la de PAILA se recalcula
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path.join(dir, 'Descargas/otro.flac')])
    const r2 = await rep.replace(id, path.join(dir, 'Descargas/track01.flac'), { keepTags: true, keepCover: true, sameName: true })
    grid('beatthis'); grid('rekordbox')
    const r3 = await rep.replace(id, path.join(dir, 'Descargas/otro.flac'), { keepTags: true, keepCover: true, sameName: true })
    expect(has().grids).toEqual(['rekordbox'])
    // una conversión del mismo audio (keepDj) no toca nada
    grid('beatthis')
    const r4 = await rep.replace(id, path.join(dir, 'Descargas/track01.flac'), { keepTags: true, keepCover: true, sameName: true, keepDj: true })
    expect(has().grids).toEqual(['beatthis', 'rekordbox'])
    for (const x of [r4, r3, r2]) rep.undo(x.replacementId)
    expect(has().grids).toEqual(['beatthis', 'rekordbox']) // r3 devolvió la de PAILA que tenía el FLAC anterior
    lib.db.prepare('DELETE FROM dj_grid WHERE file_id = ?').run(id); lib.db.prepare('DELETE FROM dj_cues WHERE file_id = ?').run(id); lib.db.prepare('DELETE FROM dj_tempo WHERE file_id = ?').run(id)
    expect(lib.tracks()[0][2]).toBe('Rock/Tema.mp3')
  })

  it('si el nombre ya existe o es sample pack, no toca nada', async () => {
    const id = lib.tracks()[0][0] as number
    fs.writeFileSync(path.join(dir, 'M/Rock/Tema.flac'), 'x')
    await expect(rep.replace(id, path.join(dir, 'Descargas/track01.flac'), { keepTags: true, keepCover: true, sameName: true })).rejects.toThrow(/Ya existe/)
    expect(fs.existsSync(path.join(dir, 'M/Rock/Tema.mp3'))).toBe(true)
    fs.rmSync(path.join(dir, 'M/Rock/Tema.flac'))
    lib.db.prepare("UPDATE files SET kind = 'produccion' WHERE id = ?").run(id)
    await expect(rep.replace(id, path.join(dir, 'Descargas/track01.flac'), { keepTags: true, keepCover: true, sameName: true })).rejects.toThrow(/sample packs/)
    lib.db.prepare("UPDATE files SET kind = 'musica' WHERE id = ?").run(id)
  })
})

// A8: deshacer mira cómo está el tema AHORA (pudo moverse, renombrarse, ir a la papelera, desaparecer o reemplazarse de nuevo).
describe('deshacer un reemplazo después de otros cambios', () => {
  let d: string
  let l: Library
  let r: Replacer
  let t: Trash
  const cand = () => path.join(d, 'Descargas/nuevo.flac')
  const rootOf = (rid: number) => l.roots().find((x) => x.id === rid)?.path ?? null
  const relOf = (id: number) => (l.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id) as { rel: string }).rel
  /** Mueve el archivo de un tema como lo haría el Organizador o "Arreglar nombres" (disco + base). */
  const moveTrack = (id: number, to: string) => {
    const dest = path.join(d, 'M', ...to.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(path.join(d, 'M', ...relOf(id).split('/')), dest)
    l.db.prepare('UPDATE files SET rel_path = ? WHERE id = ?').run(to, id)
  }
  const mk = (rel: string) => {
    const out = path.join(d, 'M', ...rel.split('/'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-b:a', '96k', out])
  }
  const idOf = (rel: string) => (l.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
  const opts = { keepTags: true, keepCover: false, sameName: true }

  beforeAll(async () => {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-rep2-'))
    fs.mkdirSync(path.join(d, 'Descargas'))
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', cand()])
    for (const n of ['Movido', 'Tirado', 'Perdido', 'Doble', 'Vaciado']) mk(`Sueltos/${n}.mp3`)
    l = new Library(path.join(d, 'paila.db'), ffprobe)
    await l.addRoot(path.join(d, 'M'), [{ rel: '', kind: 'musica' }])
    await l.scan()
    r = new Replacer(l.db, rootOf, ffprobe, ffmpeg)
    t = new Trash(l.db, rootOf, new Playlists(l.db, (i) => l.trackPath(i)))
  })
  afterAll(() => { l.close(); fs.rmSync(d, { recursive: true, force: true }) })

  it('si el tema se movió y renombró después, el original vuelve a ese lugar nuevo (no al viejo) y la base queda al día', async () => {
    const id = idOf('Sueltos/Movido.mp3')
    const rep = await r.replace(id, cand(), opts)
    moveTrack(id, 'Artistas/Fulano/Fulano - Movido.flac') // el Organizador y Arreglar nombres
    expect(r.undo(rep.replacementId)).toEqual({ rel: 'Artistas/Fulano/Fulano - Movido.mp3', followed: true })
    expect(fs.existsSync(path.join(d, 'M/Artistas/Fulano/Fulano - Movido.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(d, 'M/Artistas/Fulano/Fulano - Movido.flac'))).toBe(false)
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Movido.mp3'))).toBe(false) // no reaparece en el lugar viejo
    expect(inTrash(path.join(d, 'M'), 'Artistas/Fulano/Fulano - Movido.flac')).toBe(true) // el de hoy, a la papelera
    expect(relOf(id)).toBe('Artistas/Fulano/Fulano - Movido.mp3')
    expect(l.db.prepare('SELECT ext FROM files WHERE id = ?').get(id)).toMatchObject({ ext: 'mp3' })
    await l.scan() // la base y el disco coinciden: el escaneo no encuentra nada raro
    expect(l.db.prepare('SELECT COUNT(*) AS n FROM files WHERE missing_at IS NOT NULL').get()).toMatchObject({ n: 0 })
    expect(l.db.prepare("SELECT id FROM files WHERE rel_path LIKE 'Artistas/%'").all()).toEqual([{ id }])
  })

  it('si el tema está en la papelera, explica y no toca nada; restaurado, se deshace bien', async () => {
    const id = idOf('Sueltos/Tirado.mp3')
    const rep = await r.replace(id, cand(), opts)
    const tr = await t.trash([id], 'prueba')
    expect(() => r.undo(rep.replacementId)).toThrow(/está en la papelera. Restauralo primero/)
    expect(inTrash(path.join(d, 'M'), 'Sueltos/Tirado.flac')).toBe(true) // sigue donde estaba
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Tirado.mp3'))).toBe(false)
    expect((await t.restore(tr.batchId!)).failed).toEqual([])
    expect(r.undo(rep.replacementId)).toEqual({ rel: 'Sueltos/Tirado.mp3', followed: false })
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Tirado.mp3'))).toBe(true)
  })

  it('si el tema está desaparecido o su archivo no está, explica y no toca nada', async () => {
    const id = idOf('Sueltos/Perdido.mp3')
    const rep = await r.replace(id, cand(), opts)
    l.db.prepare('UPDATE files SET missing_at = ? WHERE id = ?').run('2026-10-01T12:00:00.000Z', id)
    expect(() => r.undo(rep.replacementId)).toThrow(/desaparecido desde el 01\/10\/2026/)
    l.db.prepare('UPDATE files SET missing_at = NULL WHERE id = ?').run(id)
    fs.renameSync(path.join(d, 'M/Sueltos/Perdido.flac'), path.join(d, 'afuera.flac')) // alguien lo movió fuera de PAILA
    expect(() => r.undo(rep.replacementId)).toThrow(/ya no está en Sueltos\/Perdido.flac/)
    expect(inTrash(path.join(d, 'M'), 'Sueltos/Perdido.mp3')).toBe(true) // el original sigue a salvo
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Perdido.mp3'))).toBe(false)
    expect(r.list().find((x) => x.id === rep.replacementId)!.undone).toBe(false)
    fs.renameSync(path.join(d, 'afuera.flac'), path.join(d, 'M/Sueltos/Perdido.flac'))
    expect(r.undo(rep.replacementId).rel).toBe('Sueltos/Perdido.mp3')
  })

  it('si se volvió a reemplazar, pide deshacer primero el más nuevo', async () => {
    const id = idOf('Sueltos/Doble.mp3')
    const a = await r.replace(id, cand(), opts)
    const mp3 = path.join(d, 'Descargas/otro.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-b:a', '320k', mp3])
    const b = await r.replace(id, mp3, opts)
    expect(() => r.undo(a.replacementId)).toThrow(/se volvió a reemplazar después/)
    expect(relOf(id)).toBe('Sueltos/Doble.mp3') // nada cambió (es el MP3 320 del segundo reemplazo)
    expect(r.undo(b.replacementId).rel).toBe('Sueltos/Doble.flac')
    expect(r.undo(a.replacementId).rel).toBe('Sueltos/Doble.mp3')
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Doble.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Doble.flac'))).toBe(false)
    expect(l.db.prepare('SELECT kbps FROM files WHERE id = ?').get(id)).toMatchObject({ kbps: 96 }) // volvió el primero de todos
  })

  it('si se vació la papelera con el original adentro, dice desde cuándo ya no se puede', async () => {
    const id = idOf('Sueltos/Vaciado.mp3')
    const rep = await r.replace(id, cand(), opts)
    const f = trashUsage(l.db, () => l.roots()).folders.find((x) => fs.existsSync(path.join(d, 'M/_PAILA/papelera', x.folder, 'Sueltos/Vaciado.mp3')))!
    expect(f.kind).toBe('reemplazo')
    expect(purgeTrash(l.db, () => l.roots(), [f.key]).deleted).toBe(1)
    expect(r.list().find((x) => x.id === rep.replacementId)!.purgedAt).toEqual(expect.any(String))
    expect(() => r.undo(rep.replacementId)).toThrow(/Ya no se puede: se vació la papelera el \d\d\/\d\d\/\d{4}/)
    expect(fs.existsSync(path.join(d, 'M/Sueltos/Vaciado.flac'))).toBe(true) // el tema de hoy no se toca
  })
})
