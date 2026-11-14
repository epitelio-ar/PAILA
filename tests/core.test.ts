// Tests del núcleo de la biblioteca: reglas de colección, análisis de carpetas y escaneo (core/library.ts).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeFolder, kindFor } from '@paila/core/collections'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

let dir: string
let lib: Library

function tone(rel: string, extra: string[] = []) {
  const out = path.join(dir, 'Musica', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...extra, out])
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-test-'))
  tone('Rock/La Renga/01 - Panic show.mp3', ['-metadata', 'artist=La Renga', '-metadata', 'title=Panic show'])
  tone('Electronica/House/Tema [www.slider.kz].mp3')
  tone('Samples7remixes/Sample Packs/Kick 01.wav')
  tone('Patricio Rey/2000 - Momo sampler/01 - Templo de Momo.mp3')
  tone("Compilados/One Shot '80 - Volume 10/13 - Radiorama.mp3")
  tone('PIONEER/Contents/x.mp3')
  tone('kingston/Contents/UnknownArtist/Unknown Album/a.mp3')
  tone('Mi Proyecto Project/Samples/Recorded/audio.wav')
  fs.writeFileSync(path.join(dir, 'Musica', 'Mi Proyecto Project', 'Mi Proyecto.als'), '')
  fs.writeFileSync(path.join(dir, 'Musica', 'Rock', 'La Renga', 'cover.jpg'), 'x')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
})

afterAll(() => {
  lib.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('reglas de colección', () => {
  it('usa la regla más específica', () => {
    const rules = [{ rel: 'A', kind: 'produccion' as const }, { rel: 'A/B', kind: 'excluir' as const }]
    expect(kindFor('A/x.wav', rules)).toBe('produccion')
    expect(kindFor('A/B/x.wav', rules)).toBe('excluir')
    expect(kindFor('AB/x.wav', rules)).toBe('musica')
  })
})

describe('análisis de carpeta', () => {
  it('sugiere tipos por nombre y contenido', async () => {
    const { totals, suggestions } = await analyzeFolder(path.join(dir, 'Musica'))
    const byRel = Object.fromEntries(suggestions.map((s) => [s.rel, s.kind]))
    expect(totals.audio).toBe(8)
    expect(byRel['PIONEER']).toBe('excluir')
    expect(byRel['Mi Proyecto Project']).toBe('excluir')
    expect(byRel['Samples7remixes']).toBe('produccion')
    expect(byRel['kingston/Contents']).toBe('revisar')
    expect(byRel['Rock']).toBe('musica')
    expect(byRel['Patricio Rey/2000 - Momo sampler']).toBeUndefined() // es un disco: hereda música
    expect(byRel['Compilados/One Shot \x2780 - Volume 10']).toBeUndefined()
  })
})

describe('biblioteca', () => {
  it('escanea respetando colecciones y exclusiones', async () => {
    const { suggestions } = await analyzeFolder(path.join(dir, 'Musica'))
    await lib.addRoot(path.join(dir, 'Musica'), suggestions.map((s) => ({ rel: s.rel, kind: s.kind })))
    const s = await lib.scan(2)
    expect(s.errors).toBe(0)
    expect(s.found).toBe(6) // PIONEER y el proyecto de Ableton no se miran
    const rows = lib.tracks()
    const kinds = rows.map((r) => r[3]).sort()
    expect(kinds).toEqual(['musica', 'musica', 'musica', 'musica', 'produccion', 'revisar'])
    const renga = rows.find((r) => String(r[2]).includes('Panic'))!
    expect(renga[11]).toBe('La Renga') // artist
    expect(renga[5]).toBe('mp3') // codec
  })

  it('el segundo escaneo no relee nada', async () => {
    const s = await lib.scan(2)
    expect(s.toProbe).toBe(0)
    expect(s.phase).toMatch(/no había cambios/)
    expect(s.outcome).toBe('ok') // con esto main.ts sigue con el análisis (antes miraba el texto de la fase)
  })

  it('detecta archivos borrados y cambios de regla', async () => {
    fs.rmSync(path.join(dir, 'Musica', 'Electronica', 'House', 'Tema [www.slider.kz].mp3'))
    const s = await lib.scan(2)
    expect(s.removed).toBe(1)
    const root = lib.roots()[0]
    lib.setRule(root.id, 'Rock', 'proyectos')
    expect(lib.tracks().find((r) => String(r[2]).includes('Panic'))![3]).toBe('proyectos')
    lib.setRule(root.id, 'kingston', 'excluir')
    expect(lib.trackCount()).toBe(4)
  })

  it('marca como no disponible un disco que no está', () => {
    lib.db.prepare("UPDATE volumes SET serial = 'FFFF-0000', last_mount = 'Q:\\'").run()
    const r = lib.roots()[0]
    expect(r.available).toBe(false)
    expect(lib.trackCount()).toBe(4) // los datos se conservan
  })
})
