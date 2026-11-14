// Tests de Rekordbox (core/rekordbox.ts): exportar playlists y armar las rutas de los temas.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { DEVICES, Rekordbox, toLocation } from '@paila/core/rekordbox'
import { ponerIdioma } from '@paila/shared/idioma'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let pl: Playlists
let rb: Rekordbox
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const tone = (rel: string, extra: string[], meta: Record<string, string>) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-rb-'))
  tone('Rock/Uno & Dos.mp3', [], { artist: 'La "Renga"', title: 'Uno <1> & más', album: 'Álbum', date: '1996', genre: 'Rock' })
  tone('Rock/tres.flac', [], { artist: 'Otro', title: 'Tres' })
  tone('Rock/cuatro.wma', ['-c:a', 'wmav2'], { artist: 'WMA', title: 'Cuatro' })
  tone('Rock/cinco.wav', ['-ar', '96000'], { title: 'Cinco' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), pl)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Rekordbox', () => {
  it('arma la ubicación como URL', () => {
    expect(toLocation(['C:', 'Música', 'Tema uno #2 (live).mp3'].join('\\'))).toBe('file://localhost/C:/M%C3%BAsica/Tema%20uno%20%232%20%28live%29.mp3')
    expect(toLocation('/Users/x/a b.mp3')).toBe('file://localhost/Users/x/a%20b.mp3')
  })

  it('exporta el XML con colección, playlists en carpetas, escapes y sin los formatos que no lee', () => {
    const folder = pl.create('Fechas', 'folder')
    const l = pl.create('Sábado', 'list', folder)
    pl.addTracks(l, [id('tres.flac'), id('Uno & Dos.mp3'), id('cuatro.wma')])
    const dest = path.join(dir, 'rekordbox.xml')
    const r = rb.export({ scope: 'todo', playlistIds: [], dest })
    const xml = fs.readFileSync(dest, 'utf8')
    expect(r.tracks).toBe(3)
    expect(r.skipped.map((s) => s.rel)).toEqual(expect.arrayContaining(['Rock/cuatro.wma']))
    expect(xml).toContain('<COLLECTION Entries="3">')
    expect(xml).toContain('Artist="La &quot;Renga&quot;"')
    expect(xml).toContain('Name="Uno &lt;1&gt; &amp; más"')
    expect(xml).toContain('Kind="FLAC File"')
    expect(xml).toMatch(/Location="file:\/\/localhost\/[^"]*Uno%20%26%20Dos\.mp3"/)
    expect(xml).toContain('<NODE Name="Fechas" Type="0" Count="1">')
    expect(xml).toContain('<NODE Name="Sábado" Type="1" KeyType="0" Entries="2">') // el wma no entra
    expect((xml.match(/<TRACK Key=/g) ?? []).length).toBe(2)
    // las llaves de la playlist existen en la colección
    const ids = [...xml.matchAll(/<TRACK TrackID="(\d+)"/g)].map((m) => m[1])
    for (const k of [...xml.matchAll(/<TRACK Key="(\d+)"/g)].map((m) => m[1])) expect(ids).toContain(k)
    expect((xml.match(/<NODE/g) ?? []).length).toBe((xml.match(/<\/NODE>|<NODE[^>]*\/>/g) ?? []).length) // todos los nodos cierran
  })

  it('solo playlists elegidas y registra lo exportado', () => {
    const dest = path.join(dir, 'solo.xml')
    const only = pl.tree().find((n) => n.name === 'Sábado')!
    const r = rb.export({ scope: 'playlists', playlistIds: [only.id], dest })
    expect(r.tracks).toBe(2)
    expect(r.playlists).toBe(1)
    expect(rb.exportedIds().has(id('tres.flac'))).toBe(true)
    expect(rb.exportedIds([id('cinco.wav')]).size).toBe(1) // exportado en la primera corrida (scope todo)
  })

  it('compatibilidad por equipo', () => {
    const viejas = rb.compatibility('cdj-viejas')
    expect(viejas.issues.map((i) => path.basename(i.rel)).sort()).toEqual(['cinco.wav', 'cuatro.wma', 'tres.flac'])
    const nxs2 = rb.compatibility('cdj-nxs2')
    expect(nxs2.issues.map((i) => path.basename(i.rel)).sort()).toEqual(['cinco.wav', 'cuatro.wma']) // wav a 96 kHz y wma
    expect(nxs2.issues.find((i) => i.rel.endsWith('cinco.wav'))!.reason).toMatch(/96 kHz/)
    expect(rb.compatibility('cdj-3000').issues.map((i) => path.basename(i.rel))).toEqual(['cuatro.wma'])
  })

  it('el muestreo alto viene como dato (maxKhz): la pantalla agrupa con eso y no con el texto, que cambia con el idioma', () => {
    try {
      for (const i of ['es', 'en'] as const) {
        ponerIdioma(i)
        const issues = rb.compatibility('cdj-nxs2').issues
        expect(issues.find((x) => x.rel.endsWith('cinco.wav'))!.maxKhz).toBe(48)
        expect(issues.find((x) => x.rel.endsWith('cuatro.wma'))!.maxKhz).toBeUndefined()
      }
      expect(rb.compatibility('cdj-nxs2').issues.find((x) => x.rel.endsWith('cinco.wav'))!.reason).toBe('96 kHz: this gear goes up to 48 kHz')
      expect(DEVICES[0].label).toBe('CDJ-2000 / CDJ-2000nexus (the oldest)')
    } finally { ponerIdioma('es') }
    expect(DEVICES[0].label).toBe('CDJ-2000 / CDJ-2000nexus (las más viejas)')
  })

  it('en inglés el rekordbox.xml sale igual (lo que va al archivo no se traduce)', () => {
    const es = path.join(dir, 'es.xml'), en = path.join(dir, 'en.xml')
    rb.export({ scope: 'todo', playlistIds: [], dest: es })
    try { ponerIdioma('en'); rb.export({ scope: 'todo', playlistIds: [], dest: en }) } finally { ponerIdioma('es') }
    expect(fs.readFileSync(en, 'utf8')).toBe(fs.readFileSync(es, 'utf8'))
  })

  it('orden armónico: tono cercano y BPM creciente', () => {
    const f = lib.tracks().map((r) => r[0] as number)
    const set = (i: number, bpm: number, camelot: string) => lib.db.prepare('INSERT OR REPLACE INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm, camelot) VALUES (?, 1, 0, 0, ?, ?, ?)').run(i, new Date().toISOString(), bpm, camelot)
    set(f[0], 128, '8A'); set(f[1], 120, '3B'); set(f[2], 126, '9A'); set(f[3], 124, '8B')
    const order = rb.harmonicOrder([f[0], f[1], f[2], f[3]])
    expect(order).toHaveLength(4)
    expect(order[0]).toBe(f[1]) // el de BPM más bajo
    expect(new Set(order).size).toBe(4)
    expect(rb.harmonicOrder([f[0]])).toEqual([f[0]])
  })
})
