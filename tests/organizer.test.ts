// Tests del organizador de carpetas (core/organizer.ts): limpiar nombres, armar la carpeta destino y mover sin pisar.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { DEFAULT_RULE, Organizer, cleanName, targetFor, type TagRow } from '@paila/core/organizer'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let org: Organizer
const row = (o: Partial<TagRow>): TagRow => ({ id: 1, rootId: 1, rel: 'x.mp3', ext: 'mp3', kind: 'musica', artist: 'La Renga', albumArtist: null, title: 'Hablando de la Libertad', album: 'Despedazado por mil partes', track: '3', year: '1996', genre: 'Rock', ...o })
const tone = (rel: string, meta: Record<string, string>) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-org-'))
  tone('Descargas/uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' })
  tone('Descargas/dos.mp3', { artist: 'La Renga', title: 'Dos', album: 'Disco A', date: '1996', track: '2' })
  fs.writeFileSync(path.join(dir, 'M/Descargas/cover.jpg'), 'img')
  tone('Mezclas/suelto.mp3', { artist: 'Otro', title: 'Suelto' })
  tone('Mezclas/sin tags.mp3', {})
  tone('La Renga/1996 - Disco A/01 - Uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' })
  tone('Samples/loop.mp3', { artist: 'X', title: 'Loop' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  void root
  await lib.scan()
  org = new Organizer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('organizador', () => {
  it('«solo carpetas»: cada tema va a la carpeta de la regla con el nombre de archivo que ya tiene (01/11)', () => {
    const conNombre = org.plan({ rule: DEFAULT_RULE, dest: '' })
    const soloCarpetas = org.plan({ rule: DEFAULT_RULE, dest: '', soloCarpetas: true })
    const uno = conNombre.moves.find((m) => m.from === 'Descargas/uno.mp3')!
    expect(uno.to).toMatch(/^La Renga\/1996 - Disco A\/01 - Uno( \(2\))?\.mp3$/)
    const solo = soloCarpetas.moves.find((m) => m.from === 'Descargas/uno.mp3')!
    expect(solo.to).toBe('La Renga/1996 - Disco A/uno.mp3')
    // el que ya está en su carpeta, con otro nombre, no se mueve: solo carpetas no lo renombra
    expect(soloCarpetas.moves.some((m) => m.from === 'La Renga/1996 - Disco A/01 - Uno.mp3')).toBe(false)
  })
  it('arma la ruta según la regla y maneja lo que falta', () => {
    expect(targetFor(row({}), { rule: DEFAULT_RULE, dest: '' })).toBe('La Renga/1996 - Despedazado por mil partes/03 - Hablando de la Libertad.mp3')
    expect(targetFor(row({ year: null }), { rule: DEFAULT_RULE, dest: '' })).toBe('La Renga/Despedazado por mil partes/03 - Hablando de la Libertad.mp3')
    expect(targetFor(row({ album: null, year: null, track: null }), { rule: DEFAULT_RULE, dest: 'Biblioteca' })).toBe('Biblioteca/La Renga/Hablando de la Libertad.mp3')
    expect(targetFor(row({ albumArtist: 'Various Artists', artist: 'Otro' }), { rule: DEFAULT_RULE, dest: '' })).toBe('Varios Artistas/1996 - Despedazado por mil partes/03 - Hablando de la Libertad.mp3')
    expect(targetFor(row({ title: 'AC/DC: ¿Qué?' }), { rule: DEFAULT_RULE, dest: '' })).toContain('03 - AC_DC_ ¿Qué_.mp3')
    expect(targetFor(row({ title: null }), { rule: DEFAULT_RULE, dest: '' })).toBeNull()
    expect(() => targetFor(row({}), { rule: '%foo%', dest: '' })).toThrow(/Campo desconocido/)
    expect(cleanName('  a:b.  ')).toBe('a_b')
  })

  it('la vista previa no toca archivos, salta sin tags, respeta samples y lleva la tapa con su disco', () => {
    const p = org.plan({ rule: DEFAULT_RULE, dest: '' })
    const tos = p.moves.map((m) => m.to).sort()
    expect(tos).toEqual(['La Renga/1996 - Disco A/01 - Uno (2).mp3', 'La Renga/1996 - Disco A/02 - Dos.mp3', 'Otro/Suelto.mp3'].sort())
    expect(p.conflicts).toBe(1) // "Uno" ya existe en la carpeta ordenada
    // con quién choca, para avisar antes y ofrecer Duplicados (decisión del 22/10)
    expect(p.clashes).toEqual([{ fileId: expect.any(Number), from: 'Descargas/uno.mp3', to: 'La Renga/1996 - Disco A/01 - Uno (2).mp3', with: 'La Renga/1996 - Disco A/01 - Uno.mp3' }])
    expect(p.skipped.map((s) => path.basename(s.rel))).toEqual(['sin tags.mp3'])
    expect(p.moves.some((m) => m.from.startsWith('Samples/'))).toBe(false)
    expect(p.extras).toEqual([{ rootId: p.moves[0].rootId, from: 'Descargas/cover.jpg', to: 'La Renga/1996 - Disco A/cover.jpg' }])
    expect(fs.existsSync(path.join(dir, 'M/Descargas/uno.mp3'))).toBe(true)
  })

  it('aplica, actualiza la base y se deshace por completo', async () => {
    const p = org.plan({ rule: DEFAULT_RULE, dest: '' })
    const r = await org.apply(p)
    expect(r.failed).toEqual([])
    expect(r.moved).toBe(3)
    expect(r.extras).toBe(1)
    expect(fs.existsSync(path.join(dir, 'M/La Renga/1996 - Disco A/02 - Dos.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/La Renga/1996 - Disco A/cover.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Descargas/dos.mp3'))).toBe(false)
    expect(lib.tracks().some((t) => t[2] === 'La Renga/1996 - Disco A/02 - Dos.mp3')).toBe(true)
    expect(org.plan({ rule: DEFAULT_RULE, dest: '' }).moves).toEqual([]) // ya está todo ordenado

    const u = await org.undo(r.batchId!)
    expect(u.failed).toEqual([])
    expect(fs.existsSync(path.join(dir, 'M/Descargas/dos.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Descargas/cover.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Otro'))).toBe(false) // la carpeta nueva que quedó vacía se saca
    expect(fs.existsSync(path.join(dir, 'M/La Renga/1996 - Disco A/01 - Uno.mp3'))).toBe(true) // lo que ya estaba ahí no se toca
    expect(lib.tracks().some((t) => t[2] === 'Descargas/dos.mp3')).toBe(true)
    expect(org.batches()[0].undone).toBe(true)
  })

  it('Cancelar en el medio: lo movido queda (y se deshace), lo demás no se toca, y avisa que se canceló', async () => {
    const p = org.plan({ rule: DEFAULT_RULE, dest: '' })
    let checks = 0
    const r = await org.apply(p, { isCancelled: () => checks++ >= 1 })
    expect(r.cancelled).toBe(true)
    expect(r.moved).toBe(1)
    expect(r.extras).toBe(0) // la tapa viaja con su disco solo si el disco terminó de moverse
    expect(fs.existsSync(path.join(dir, 'M/Descargas/cover.jpg'))).toBe(true)
    expect((await org.undo(r.batchId!)).failed).toEqual([])
    expect(org.plan({ rule: DEFAULT_RULE, dest: '' }).moves.length).toBe(p.moves.length)
  })

  it('cortado justo después de mover los temas y antes de la tapa: el próximo Organizar la lleva con su disco (corrida del 23/10)', async () => {
    const p = org.plan({ rule: DEFAULT_RULE, dest: '' })
    const r = await org.apply({ ...p, extras: [] }) // como un corte: los temas se movieron, la tapa (que va al final) no
    expect(r.moved).toBe(3)
    expect(fs.existsSync(path.join(dir, 'M/Descargas/cover.jpg'))).toBe(true)
    const again = org.plan({ rule: DEFAULT_RULE, dest: '' })
    expect(again.moves).toEqual([])
    expect(again.extras).toEqual([{ rootId: p.moves[0].rootId, from: 'Descargas/cover.jpg', to: 'La Renga/1996 - Disco A/cover.jpg' }])
    const e = await org.apply(again) // solo la tapa: sin temas para mover, igual se aplica
    expect(e.extras).toBe(1)
    expect(fs.existsSync(path.join(dir, 'M/La Renga/1996 - Disco A/cover.jpg'))).toBe(true)
    expect(org.plan({ rule: DEFAULT_RULE, dest: '' }).extras).toEqual([])
    // deshacer las dos tandas (la más nueva primero) deja todo como estaba
    expect((await org.undo(e.batchId!)).failed).toEqual([])
    expect((await org.undo(r.batchId!)).failed).toEqual([])
    expect(fs.existsSync(path.join(dir, 'M/Descargas/cover.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'M/Descargas/dos.mp3'))).toBe(true)
  })
})
