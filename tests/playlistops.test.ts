// Tests de fusionar playlists y limpiar una playlist (core/playlistops.ts), y de "Saltear lo que ya tenés en PAILA" de NAPIA
// (core/sockseek/yatenes.ts + los repetidos de la lista por sameSong).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { PlaylistOps } from '@paila/core/playlistops'
import { History, type HistoryDeps } from '@paila/core/history'
import { listRows } from '@paila/core/sockseek/args'
import { readPailaLibrary, saltearTenes } from '@paila/core/sockseek/yatenes'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, pl: Playlists, ops: PlaylistOps
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const tone = (rel: string, extra: string[], meta: Record<string, string>, secs = 2) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}
const names = (ids: number[]) => ids.map((i) => (lib.tracks().find((r) => r[0] === i)![2] as string).split('/').pop())

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-plops-'))
  const dd = { artist: 'Duran Duran', title: 'Save a Prayer' }
  tone('a.mp3', ['-b:a', '64k'], dd)
  tone('a.flac', [], dd)
  tone('b.mp3', [], { artist: 'Toto', title: 'Africa' })
  tone('b-live.mp3', [], { artist: 'Toto', title: 'Africa (Live)' })
  tone('c.mp3', [], { artist: 'Erasure', title: 'Ship of Fools' })
  tone('d.mp3', [], { artist: 'Emilia', title: 'Cuatro Babys' })
  tone('d-feat.mp3', [], { artist: 'Emilia', title: 'Cuatro Babys (feat. Duki)' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  ops = new PlaylistOps(lib.db, pl)
}, 120_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('fusionar playlists', () => {
  it('arma una nueva sin repetidos: el mismo archivo una vez y el mismo tema en otra calidad, la mejor', () => {
    const p1 = pl.create('Uno'), p2 = pl.create('Dos')
    pl.addTracks(p1, [id('a.mp3'), id('b.mp3'), id('b-live.mp3')])
    pl.addTracks(p2, [id('a.flac'), id('c.mp3'), id('b.mp3')])
    const prev = ops.previewMerge([p1, p2])
    expect(prev).toMatchObject({ total: 6, unique: 4, sameFile: 1, otherQuality: 1 })
    expect(prev.examples[0].keep.ext).toBe('flac')
    const r = ops.merge([p1, p2], 'Todo', false)
    // el FLAC ocupa el lugar de la primera aparición del tema; "Africa (Live)" es otra versión: se queda
    expect(names(pl.trackIds(r.id))).toEqual(['a.flac', 'b.mp3', 'b-live.mp3', 'c.mp3'])
    expect(pl.tree().filter((n) => ['Uno', 'Dos'].includes(n.name))).toHaveLength(2) // las originales siguen
    // "feat." y variantes cuentan como el mismo tema
    const p3 = pl.create('Tres')
    pl.addTracks(p3, [id('d.mp3'), id('d-feat.mp3')])
    expect(ops.previewMerge([p1, p3]).otherQuality).toBe(1)
  })

  it('con "sacar las originales" las saca, y deshacer devuelve todo como estaba', () => {
    const p1 = pl.create('Rock'), p2 = pl.create('Pop')
    pl.addTracks(p1, [id('c.mp3'), id('b.mp3')])
    pl.addTracks(p2, [id('d.mp3')])
    const before = pl.tree().length
    const r = ops.merge([p1, p2], 'Mezcla', true)
    expect(pl.tree().some((n) => n.id === p1 || n.id === p2)).toBe(false)
    expect(pl.trackIds(r.id)).toHaveLength(3)
    // aparece en el Historial y se deshace desde ahí
    const hist = new History(lib.db, { listas: ops, improver: { batches: () => [] }, rootPath: () => null } as unknown as HistoryDeps)
    const e = hist.list().find((x) => x.kind === 'listas' && x.id === r.batchId)!
    expect(e.summary).toContain('Mezcla')
    expect(e.canUndo).toBe(true)
    expect(hist.detail('listas', r.batchId).total).toBe(0)
    return hist.undo('listas', r.batchId).then(() => {
      expect(pl.tree().some((n) => n.id === r.id)).toBe(false)
      expect(pl.trackIds(p1).sort()).toEqual([id('c.mp3'), id('b.mp3')].sort())
      expect(pl.trackIds(p2)).toEqual([id('d.mp3')])
      expect(pl.tree()).toHaveLength(before - 2 + 2)
      expect(hist.list().find((x) => x.kind === 'listas' && x.id === r.batchId)!.undone).toBe(true)
    })
  })

  it('pide al menos dos playlists distintas', () => {
    const p = pl.create('Sola')
    expect(() => ops.merge([p, p], 'X', false)).toThrow(/al menos dos/)
  })
})

describe('limpiar una playlist', () => {
  it('muestra qué saca, deja la mejor, respeta el orden y se deshace', () => {
    const l = pl.create('Sucia')
    pl.addTracks(l, [id('a.mp3'), id('c.mp3'), id('a.flac'), id('b.mp3')])
    const prev = ops.previewClean(l)
    expect(prev.groups).toHaveLength(1)
    expect(prev.groups[0].keep.ext).toBe('flac')
    expect(prev.groups[0].drop.map((d) => d.ext)).toEqual(['mp3'])
    expect(prev.missing).toEqual([])
    // solo se saca lo que la vista previa propuso
    expect(ops.clean(l, [id('c.mp3')])).toEqual({ batchId: null, removed: 0 })
    const r = ops.clean(l, prev.groups[0].drop.map((d) => d.id))
    expect(r.removed).toBe(1)
    expect(names(pl.trackIds(l))).toEqual(['c.mp3', 'a.flac', 'b.mp3'])
    expect(ops.undo(r.batchId!)).toBe(1)
    expect(names(pl.trackIds(l))).toEqual(['a.mp3', 'c.mp3', 'a.flac', 'b.mp3'])
    expect(ops.undo(r.batchId!)).toBe(0) // ya está deshecho
  })

  it('los desaparecidos hace más de 30 días se ofrecen aparte (no cuentan los recientes)', () => {
    const l = pl.create('Viejos')
    pl.addTracks(l, [id('c.mp3'), id('d.mp3'), id('b.mp3')])
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString(), recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
    lib.db.prepare('UPDATE files SET missing_at = ? WHERE id = ?').run(old, id('c.mp3'))
    lib.db.prepare('UPDATE files SET missing_at = ? WHERE id = ?').run(recent, id('d.mp3'))
    try {
      const prev = ops.previewClean(l)
      expect(prev.missing.map((m) => m.id)).toEqual([id('c.mp3')])
      const r = ops.clean(l, [id('c.mp3')])
      expect(names(pl.trackIds(l))).toEqual(['d.mp3', 'b.mp3'])
      ops.undo(r.batchId!)
      expect(names(pl.trackIds(l))).toEqual(['c.mp3', 'd.mp3', 'b.mp3'])
    } finally { lib.db.prepare('UPDATE files SET missing_at = NULL').run() }
  })
})

describe('NAPIA: saltear lo que ya tenés en PAILA', () => {
  const t = (artist: string, title: string, duration: number | null = 2) => ({ artist, title, album: null, duration })

  it('lee la base de PAILA en solo lectura y separa lo que ya está de lo que falta', () => {
    const dbFile = path.join(dir, 'paila.db')
    const sizeBefore = fs.statSync(dbFile).mtimeMs
    const libTracks = readPailaLibrary([path.join(dir, 'no-existe.db'), dbFile])!
    expect(libTracks.length).toBeGreaterThanOrEqual(7)
    const r = saltearTenes([t('Toto', 'Africa'), t('Duran Duran', 'Save a Prayer - 2009 Remaster'), t('Queen', 'Radio Ga Ga'), t('Toto', 'Africa (Remix)')], libTracks)
    expect(r.tenes.map((x) => x.title)).toEqual(['Africa', 'Save a Prayer - 2009 Remaster'])
    expect(r.faltan.map((x) => x.title)).toEqual(['Radio Ga Ga', 'Africa (Remix)']) // otra versión: se baja
    expect(fs.statSync(dbFile).mtimeMs).toBe(sizeBefore)
  })

  it('si la base de PAILA no está, no saltea nada', () => {
    expect(readPailaLibrary([path.join(dir, 'nada.db')])).toBeNull()
    const tracks = [t('Toto', 'Africa')]
    expect(saltearTenes(tracks, null)).toEqual({ faltan: tracks, tenes: [], mejorar: [] })
  })

  it('los repetidos dentro de la lista cuentan aunque cambie "feat." o el remaster', () => {
    const rows = listRows([t('Emilia', 'Cuatro Babys'), t('Emilia', 'Cuatro Babys (feat. Duki)'), t('Emilia', 'Cuatro Babys - 2020 Remaster'), t('Toto', 'Africa'), t('toto', 'africa'), t('Toto', 'Africa (Live)')], { sacarRemaster: true, primeros: null })
    expect(rows.map((r) => r.title)).toEqual(['Cuatro Babys', 'Africa', 'Africa (Live)'])
  })
})
