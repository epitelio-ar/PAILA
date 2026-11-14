// Tests del reconocedor tipo Shazam (core/online/audd.ts), con respuestas simuladas: solo se usa para lo que AcoustID no
// reconoció, lo encontrado va a "para mirar a mano" y una clave mala para solo esa fuente. El fragmento de 15 s, con ffmpeg.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { AudD, audioClip } from '@paila/core/online/audd'
import { OfficialSearch, cleanedRows } from '@paila/core/official-run'
import { officialFindings } from '@paila/core/official-findings'
import { decideByAudd } from '@paila/core/official'
import type { FetchFn, HttpRes } from '@paila/core/online/http'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let db: Db
const res = (status: number, body: unknown): HttpRes => ({ ok: status < 400, status, json: async () => body })
const add = (id: number, artist: string | null, title: string | null, duration = 200) =>
  db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title) VALUES (?, 1, ?, 1, 1, 'musica', 'mp3', ?, ?, ?)").run(id, `pista ${id}.mp3`, duration, artist, title)
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-audd-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('AudD', () => {
  it('manda el fragmento con la clave y lee artista, título, disco y año', async () => {
    let body: FormData | null = null
    const fetchFn: FetchFn = async (_u, init) => { body = init?.body as FormData; return res(200, { status: 'success', result: { artist: 'Soda Stereo', title: 'De Música Ligera', album: 'Canción Animal', release_date: '1990-08-07' } }) }
    const r = await new AudD('CLAVE123', 'x', fetchFn, 0).recognize(new Uint8Array(2000))
    expect(r).toEqual({ artist: 'Soda Stereo', title: 'De Música Ligera', album: 'Canción Animal', year: '1990' })
    expect(body!.get('api_token')).toBe('CLAVE123')
    expect((body!.get('file') as Blob).size).toBe(2000)
  })
  it('sin coincidencia devuelve null; con clave mala avisa', async () => {
    expect(await new AudD('x', 'x', async () => res(200, { status: 'success', result: null }), 0).recognize(new Uint8Array(10))).toBeNull()
    await expect(new AudD('x', 'x', async () => res(200, { status: 'error', error: { error_code: 900, error_message: 'Invalid api_token' } }), 0).test()).rejects.toThrow(/no aceptó la clave/)
  })
  it('lo reconocido va a mirar a mano y no pisa un dato que no coincide', () => {
    const r = { artist: 'Soda Stereo', title: 'De Música Ligera', album: null, year: null }
    expect(decideByAudd({ artist: null, title: null }, r).map((f) => [f.field, f.to, f.conf])).toEqual([['artist', 'Soda Stereo', 'media'], ['title', 'De Música Ligera', 'media']])
    expect(decideByAudd({ artist: 'Otro Artista', title: null }, r)).toEqual([])
  })
  it('solo escucha lo que AcoustID no reconoció, y solo si está prendido (hay clave)', async () => {
    add(1, null, null, 205); add(2, null, null, 180)
    db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, chromaprint) VALUES (1, 1, 1, 1, '', 'HUELLA1'), (2, 1, 1, 1, '', 'HUELLA2')").run()
    const clipped: number[] = []
    const fetchFn: FetchFn = async (url, init) => {
      if (url.includes('acoustid')) return res(200, { status: 'ok', results: String(init?.body).includes('HUELLA1') ? [{ score: 0.97, recordings: [{ title: 'Persiana americana', duration: 205, artists: [{ name: 'Soda Stereo' }] }] }] : [] })
      if (url.includes('audd')) return res(200, { status: 'success', result: { artist: 'Virus', title: 'Wadu Wadu', album: 'Wadu Wadu', release_date: '1981' } })
      return res(200, { artists: [], recordings: [], data: [] })
    }
    const opts = { ua: 'x', fetchFn, gapMs: { musicbrainz: 0, deezer: 0, acoustid: 0, audd: 0 }, clip: async (id: number) => { clipped.push(id); return new Uint8Array(3000) } }
    // apagado: no se pide nada a AudD
    expect(new OfficialSearch(db, { ...opts, keys: () => ({ acoustid: 'A123456' }) }).todo(cleanedRows(db)).audd).toBe(0)
    const s = new OfficialSearch(db, { ...opts, keys: () => ({ acoustid: 'A123456', audd: 'B123456' }) })
    await s.run(cleanedRows(db), () => {}, () => false)
    expect(clipped).toEqual([2])
    const f = officialFindings(db, cleanedRows(db))
    expect(f.get(1)?.[0]).toMatchObject({ to: 'Soda Stereo', sources: ['acoustid'] })
    expect(f.get(2)?.map((x) => [x.field, x.to, x.conf])).toEqual([['artist', 'Virus', 'media'], ['title', 'Wadu Wadu', 'media']])
  })
  it('el fragmento son 15 s del medio, en MP3 chico', async () => {
    const f = path.join(dir, 'tono.wav')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', f])
    const c = await audioClip(ffmpeg, f, 60)
    expect(c).not.toBeNull()
    expect(c!.length).toBeGreaterThan(50_000) // ~15 s a 64 kbps ≈ 120 KB
    expect(c!.length).toBeLessThan(200_000)
    expect(await audioClip(ffmpeg, path.join(dir, 'no-existe.mp3'), 60)).toBeNull()
  }, 90_000)
})
