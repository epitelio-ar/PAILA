// Tests de Completar desde internet (core/musicbrainz.ts): elegir el release correcto y reintentar si falla.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { MusicBrainz, pickRelease } from '@paila/core/musicbrainz'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
const calls: string[] = []
const rec = (title: string, artist: string, score: number, releases: object[], extra: object = {}) => ({ id: `mbid-${title}`, title, score, length: 3000, 'first-release-date': '1996-05-01', 'artist-credit': [{ name: artist, artist: { name: artist } }], releases, tags: [{ name: 'rock', count: 5 }, { name: 'seen live', count: 9 }], ...extra })
const REL = [
  { id: 'r-live', title: 'En vivo', date: '2002-01-01', status: 'Official', 'release-group': { 'primary-type': 'Album', 'secondary-types': ['Live'] } },
  { id: 'r-album', title: 'Despedazado por mil partes', date: '1996-05-01', status: 'Official', 'release-group': { 'primary-type': 'Album' } },
  { id: 'r-boot', title: 'Bootleg', date: '1990-01-01', status: 'Bootleg', 'release-group': { 'primary-type': 'Album' } },
]
const fake = async (url: string) => {
  calls.push(url)
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) })
  if (url.includes('coverartarchive')) return url.includes('r-album') ? { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array(5000).buffer } : { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }
  if (url.includes('Hablando')) return ok({ recordings: [rec('Hablando de la libertad', 'La Renga', 100, REL)] })
  if (url.includes('Inexistente')) return ok({ recordings: [rec('Otra cosa', 'Nadie', 100, REL)] })
  if (url.includes('Duracion')) return ok({ recordings: [rec('Duracion', 'La Renga', 100, REL, { length: 300000 })] })
  return ok({ recordings: [] })
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mb-'))
  fs.mkdirSync(path.join(dir, 'M'))
  const t = (n: string, meta: Record<string, string>) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), path.join(dir, 'M', n)])
  t('a.mp3', { artist: 'La Renga', title: 'Hablando de la Libertad' })
  t('b.mp3', { artist: 'Nadie', title: 'Inexistente' })
  t('c.mp3', { artist: 'La Renga', title: 'Duracion' })
  t('d.mp3', { artist: 'Completo', title: 'Todo', album: 'A', date: '2000', genre: 'Rock' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('MusicBrainz', () => {
  it('elige un release normal (oficial, álbum, no en vivo ni bootleg)', () => {
    expect(pickRelease(REL as never)?.id).toBe('r-album')
    expect(pickRelease([])).toBeNull()
  })

  it('busca por lotes, usa la caché y solo propone completar lo vacío', async () => {
    const mb = new MusicBrainz(lib.db, 'PAILA-test/0.1', fake as never, 0)
    expect(mb.candidates().map((c) => c.title).sort()).toEqual(['Duracion', 'Hablando de la Libertad', 'Inexistente']) // d.mp3 ya está completo
    const seen: number[] = []
    const r = await mb.run((p) => seen.push(p.done), () => false)
    expect(r).toMatchObject({ looked: 3, found: 1, errors: 0 })
    expect(calls.some((u) => u.includes('User-Agent'))).toBe(false)
    const props = mb.proposals()
    expect(props).toHaveLength(1)
    expect(props[0]).toMatchObject({ rel: 'a.mp3', album: 'Despedazado por mil partes', year: '1996', genre: 'Rock', releaseId: 'r-album', confidence: 'alta' }) // "seen live" no cuenta como género
    expect(props[0].fills.map((f) => f.field).sort()).toEqual(['album', 'genre', 'year'])
    const before = calls.length
    await mb.run(() => {}, () => false)
    expect(calls.length).toBe(before) // todo en caché: no vuelve a preguntar
  })

  it('lo que ya está propuesto (en Cambios pendientes) no se vuelve a ofrecer', () => {
    const mb = new MusicBrainz(lib.db, 'x', fake as never, 0)
    const p = mb.proposals().find((x) => x.rel === 'a.mp3')!
    expect(p.fills.map((f) => f.field)).toContain('album')
    lib.db.prepare("INSERT INTO pending_changes (file_id, field, before, after, created_at) VALUES (?, 'album', NULL, 'Despedazado por mil partes', ?)").run(p.fileId, new Date().toISOString())
    expect(mb.proposals().find((x) => x.rel === 'a.mp3')!.fills.map((f) => f.field)).not.toContain('album')
    lib.db.prepare("DELETE FROM pending_changes WHERE file_id = ?").run(p.fileId)
  })

  it('si cambiás el nombre de un tema, se vuelve a preguntar con el nombre nuevo (y lo del nombre viejo no se propone)', async () => {
    const mb = new MusicBrainz(lib.db, 'x', fake as never, 0)
    await mb.run(() => {}, () => false)
    const id = (lib.db.prepare("SELECT id FROM files WHERE rel_path = 'b.mp3'").get() as { id: number }).id
    expect(mb.cached(id)?.status).toBe('sin_resultado')
    // "Inexistente" de "Nadie" no se encontró; con el nombre bien escrito, sí
    lib.db.prepare("UPDATE files SET artist = 'La Renga', title = 'Hablando de la libertad' WHERE id = ?").run(id)
    const c = mb.candidates().find((x) => x.id === id)!
    expect(mb.cached(id, c)).toBeNull()
    const antes = calls.length
    const r = await mb.run(() => {}, () => false)
    expect(r.looked).toBe(1)
    expect(calls.length).toBe(antes + 1)
    expect(mb.cached(id, c)?.status).toBe('ok')
    expect(mb.proposals().some((p) => p.fileId === id)).toBe(true)
    // y lo encontrado para un nombre no se propone si después el nombre cambia
    lib.db.prepare("UPDATE files SET title = 'Otro tema' WHERE id = ?").run(id)
    expect(mb.proposals().some((p) => p.fileId === id)).toBe(false)
    lib.db.prepare("UPDATE files SET artist = 'Nadie', title = 'Inexistente' WHERE id = ?").run(id)
  })

  it('descarta resultados de otro artista o de otra duración, y baja cuando no hay internet', async () => {
    const mb = new MusicBrainz(lib.db, 'x', fake as never, 0)
    expect(await mb.lookup('Nadie', 'Inexistente', 3)).toBeNull() // el resultado es de otro tema
    expect(await mb.lookup('La Renga', 'Duracion', 3)).toBeNull() // dura 300 s contra 3 s
    const down = new MusicBrainz(lib.db, 'x', (async () => { throw new Error('sin internet') }) as never, 0)
    await expect(down.lookup('a', 'b', null)).rejects.toThrow('sin internet')
  })

  it('baja la tapa y la ignora si no hay', async () => {
    const mb = new MusicBrainz(lib.db, 'x', fake as never, 0)
    expect((await mb.cover('r-album'))?.length).toBe(5000)
    expect(await mb.cover('r-nada')).toBeNull()
  })

  it('se corta si falla muchas veces seguidas y se puede cancelar', async () => {
    lib.db.prepare('DELETE FROM mb_lookup').run()
    const down = new MusicBrainz(lib.db, 'x', (async () => ({ ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })) as never, 0)
    const r = await down.run(() => {}, () => false) // solo 3 candidatos: no llega a 5 errores, los anota
    expect(r.errors).toBe(3)
    expect(down.cached(down.candidates()[0].id)?.status).toBe('error')
    const c = await new MusicBrainz(lib.db, 'x', fake as never, 0).run(() => {}, () => true, { retryFailed: true })
    expect(c.looked).toBe(0)
  })
})

describe('releases sospechosos y reintentos', () => {
  it('marca como sospechoso un release en vivo o recopilación y prefiere el de estudio', () => {
    const rs = [
      { id: 'live', title: 'Estadio Club Atlético Huracán (14 de Mayo, 1994)', date: '1994-05-14', status: 'Official', 'release-group': { 'primary-type': 'Album' } },
      { id: 'estudio', title: 'Oktubre', date: '1986-01-01', status: 'Official', 'release-group': { 'primary-type': 'Album' } },
    ]
    expect(pickRelease(rs as never)?.id).toBe('estudio')
    expect(pickRelease([rs[0]] as never)?.id).toBe('live')
  })
  it('reintenta cuando MusicBrainz responde 503', async () => {
    let n = 0
    const flaky = async () => (++n < 3 ? { ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, status: 200, json: async () => ({ recordings: [] }), arrayBuffer: async () => new ArrayBuffer(0) })
    const mb = new MusicBrainz(lib.db, 'x', flaky as never, 0)
    expect(await mb.lookup('a', 'b', null)).toBeNull()
    expect(n).toBe(3)
  })
  it('un release en vivo queda como sospechoso en el resultado', async () => {
    const f = async () => ({ ok: true, status: 200, json: async () => ({ recordings: [rec('Hablando de la libertad', 'La Renga', 100, [{ id: 'l', title: 'En vivo en Obras', date: '2002-01-01', status: 'Official', 'release-group': { 'primary-type': 'Album' } }])] }), arrayBuffer: async () => new ArrayBuffer(0) })
    const r = await new MusicBrainz(lib.db, 'x', f as never, 0).lookup('La Renga', 'Hablando de la Libertad', 3)
    expect(r).toMatchObject({ album: 'En vivo en Obras', suspicious: true })
  })
})
