// Tests de la Lista de deseos y la Bandeja (core/wishlist.ts, core/inbox.ts), y que en inglés lo que se escribe en archivos no cambia.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Inbox, TAR } from '@paila/core/inbox'
import { Wishlist } from '@paila/core/wishlist'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { Wanted } from '@paila/core/wanted'
import { verify } from '@paila/core/inboxflow'
import type { CandidateInfo } from '@paila/core/replace'
import { ponerIdioma } from '@paila/shared/idioma'
import { parseCsv } from '@paila/core/listparse'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string
let lib: Library
let wl: Wishlist
let inbox: Inbox
const tone = (rel: string, extra: string[], meta: Record<string, string>, base = 'M') => {
  const out = path.join(dir, base, ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
  return out
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-wi-'))
  tone('Disco A/uno.mp3', ['-b:a', '64k'], { artist: 'La Renga', title: 'Uno', album: 'Disco A' })
  tone('Disco A/dos.mp3', ['-b:a', '64k'], { artist: 'La Renga', title: 'Dos', album: 'Disco A' })
  tone('Bien/tres.flac', [], { artist: 'Otro', title: 'Tres', album: 'Disco B' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze({ full: analyzeFile }, ffmpeg, 2)
  wl = new Wishlist(lib.db)
  inbox = new Inbox(lib.db, ffprobe, path.join(dir, 'work'))
}, 120_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('lista de deseos', () => {
  it('agrupa por álbum los temas de mala nota y guarda estados', () => {
    const l = wl.list('D')
    const a = l.find((g) => g.album === 'Disco A')!
    expect(a).toMatchObject({ artist: 'La Renga', tracks: 2, status: 'pendiente', fixed: false })
    expect(l.some((g) => g.album === 'Disco B')).toBe(false) // el FLAC está bien
    wl.setStatus(a.key, 'buscando', 'en Bandcamp')
    expect(wl.list('D').find((g) => g.album === 'Disco A')).toMatchObject({ status: 'buscando', note: 'en Bandcamp' })
    expect(() => wl.setStatus(a.key, 'otra' as never)).toThrow()
  })
  it('arma las direcciones de búsqueda solo para los sitios de la lista', () => {
    expect(wl.searchUrl('bandcamp', 'La Renga', 'Disco A')).toBe('https://bandcamp.com/search?q=La%20Renga%20Disco%20A')
    expect(() => wl.searchUrl('malo.com', 'a', 'b')).toThrow(/Sitio desconocido/)
  })
})

describe('bandeja', () => {
  it('empareja archivos nuevos con temas de la biblioteca, por tags o por nombre, y detecta la mejora', async () => {
    const dl = path.join(dir, 'Descargas')
    tone('Uno.flac', [], { artist: 'La Renga', title: 'Uno' }, 'Descargas') // tags
    tone('La Renga - Dos.flac', [], {}, 'Descargas') // sin tags: por el nombre
    tone('Nada que ver.flac', [], { artist: 'Nadie', title: 'Nada' }, 'Descargas')
    fs.writeFileSync(path.join(dl, 'notas.txt'), 'x')
    const items = await inbox.inspect([dl])
    expect(items).toHaveLength(3)
    const uno = items.find((i) => i.name === 'Uno.flac')!
    expect(uno.match).toMatchObject({ rel: 'Disco A/uno.mp3', by: 'tags' })
    expect(uno.looksBetter).toBe(true)
    const dos = items.find((i) => i.name === 'La Renga - Dos.flac')!
    expect(dos.match).toMatchObject({ rel: 'Disco A/dos.mp3', by: 'nombre' })
    expect(items.find((i) => i.name === 'Nada que ver.flac')!.match).toBeNull()
    expect(items[2].match).toBeNull() // los emparejados van primero
  })
  it('ignorar un archivo lo saca de la lista hasta que cambie', async () => {
    const dl = path.join(dir, 'Descargas')
    const f = path.join(dl, 'Nada que ver.flac')
    inbox.ignore(f)
    expect((await inbox.inspect([dl])).map((i) => i.name)).not.toContain('Nada que ver.flac')
    expect((await inbox.inspect([dl], { includeIgnored: true })).map((i) => i.name)).toContain('Nada que ver.flac')
  })
  it('abre carpetas anidadas y ZIP', async () => {
    const z = path.join(dir, 'pack')
    tone('Album/01 - Otro - Tres.flac', [], { artist: 'Otro', title: 'Tres' }, 'pack')
    execFileSync(TAR, ['-a', '-cf', path.join(dir, 'pack.zip'), '-C', z, 'Album'])
    const items = await inbox.inspect([path.join(dir, 'pack.zip')])
    expect(items).toHaveLength(1)
    expect(items[0].match).toMatchObject({ rel: 'Bien/tres.flac' })
    expect((await inbox.expand([z])).length).toBe(1)
  })
})

describe('en inglés', () => {
  afterEach(() => ponerIdioma('es'))
  it('los motivos se ven en inglés, pero lo que va a no-sirvió/motivos.txt queda en castellano', () => {
    ponerIdioma('en')
    const cand = { path: 'x.flac', ext: 'flac', codec: 'flac', kbps: 900, sampleRate: 44100, bits: 16, duration: 230, size: 1, grade: 'D', label: 'x', says: '', why: [],
      lufs: -9, cutoff: 22000, artist: null, title: null, album: null, flags: ['damaged'], clipEvents: 0, spectrum: [] } satisfies CandidateInfo
    const r = verify({ grade: 'D', duration: 200, clipEvents: 0, lufs: -9 }, cand)
    expect(r.problems.join(' ')).toMatch(/damaged.*isn't better.*Different length/)
    expect(r.problemsEs!.join(' ')).toMatch(/dañado.*No es mejor.*Dura distinto/)
    // "sin analizar" se reconoce por el dato, no por el texto (que cambia con el idioma)
    expect(verify({ grade: null, duration: 230, clipEvents: 0, lufs: -9 }, { ...cand, flags: [] })).toMatchObject({ ok: false, notAnalyzed: true })
  })
  it('la lista «Faltan o suenan mal» y su .csv salen en el idioma de la app, y "Traer una lista" lee los dos', () => {
    const w = new Wanted(lib.db)
    const es = w.export('csv').text
    expect(es).toMatch(/Artista;Título;Álbum/)
    ponerIdioma('en')
    const items = w.list()
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => /· (grade|not analyzed)/.test(i.quality))).toBe(true)
    const en = w.export('csv').text
    expect(en).toMatch(/^﻿Artist;Title;Album;Duration;Current quality;Worth getting;Status;Request/)
    expect(en).not.toMatch(/Artista|· nota /)
    // los dos encabezados se vuelven a leer igual: mismos temas, mismo artista y título
    const leer = (csv: string) => parseCsv(csv).entries.map((x) => `${x.artist} - ${x.title}`)
    expect(leer(en).length).toBe(items.length)
    expect(leer(en)).toEqual(leer(es))
  })
})

describe('"Bajar con NAPIA"', () => {
  it('el CSV para NAPIA lleva la nota y la calidad real de la copia que tenés, para que NAPIA traiga solo una mejor', () => {
    const w = new Wanted(lib.db)
    const items = w.list()
    const uno = items.find((i) => i.title === 'Uno')!
    expect(uno.grade).toMatch(/^[DF]$/)
    expect(uno.effKbps).toBeGreaterThan(0)
    const csv = w.export('napia-csv').text
    expect(csv.split('\r\n')[0]).toMatch(/^Artist,Title,Album,Length,Your Grade,Your Kbps,Your Quality,Your Flags,Your Clips,Your LUFS,Your PAILA Id$/)
    const leido = parseCsv(csv).entries.find((e) => e.title === 'Uno')!
    expect(leido.tengo).toMatchObject({ nota: uno.grade, kbps: uno.effKbps, que: uno.quality, marcas: (uno.flags ?? '').split(',').filter(Boolean) })
    expect(leido.tengo!.duracion).toBeCloseTo(uno.duration!, 0)
    expect(typeof leido.tengo!.lufs).toBe('number')
  })
})
