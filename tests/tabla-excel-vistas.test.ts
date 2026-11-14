// La biblioteca a Excel (shared/tablecsv.ts: separador, coma decimal, acentos, fórmulas) y las vistas guardadas de la tabla
// (core/views.ts) (MASTERPLAN-3, 4).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { csvFormatFor, tableCsv } from '@paila/shared/tablecsv'
import { openDb } from '@paila/core/db'
import { MAX_VIEWS, Views } from '@paila/core/views'
import type { Track } from '@paila/shared/types'

const t = (x: Partial<Track>): Track => ({ id: 1, rootId: 1, rel: 'Rock/Soda Stereo - De música ligera.mp3', kind: 'musica', ext: 'mp3', size: 8_123_456, duration: 213.4, ...x } as Track)

describe('la tabla a Excel', () => {
  it('el separador y la coma decimal salen del idioma de Windows', () => {
    expect(csvFormatFor('es-AR')).toEqual({ sep: ';', decimal: ',' })
    expect(csvFormatFor('es-ES')).toEqual({ sep: ';', decimal: ',' })
    expect(csvFormatFor('en-US')).toEqual({ sep: ',', decimal: '.' })
    expect(csvFormatFor('no-es-un-idioma')).toEqual({ sep: ',', decimal: '.' })
  })

  it('las columnas que se ven, en su orden; marca de UTF-8, números como números y duración h:mm:ss', () => {
    const cols = [{ key: 'artist' as const, label: 'Artista' }, { key: 'title' as const, label: 'Título' }, { key: 'bpm' as const, label: 'BPM' }, { key: 'duration' as const, label: 'Duración' }, { key: 'size' as const, label: 'Tamaño' }, { key: 'folder' as const, label: 'Carpeta' }, { key: 'grade' as const, label: 'Nota' }]
    const csv = tableCsv([
      t({ artist: 'Soda Stereo', title: 'De Música Ligera', bpm: 120.46, grade: 'A' }),
      t({ id: 2, rel: 'Sueltos/Sin tags - Tema; con punto y coma.mp3', duration: 3725, size: 999 }),
    ], cols, { sep: ';', decimal: ',' })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Artista;Título;BPM;Duración;Tamaño (MB);Carpeta;Nota',
      'Soda Stereo;De Música Ligera;120,5;0:03:33;8,1;Rock;A',
      'Sin tags;"Tema; con punto y coma";;1:02:05;0;Sueltos;',
      '',
    ])
    expect(tableCsv([t({ artist: 'A', title: 'B', bpm: 99.5 })], [{ key: 'bpm', label: 'BPM' }], { sep: ',', decimal: '.' }).slice(1)).toBe('BPM\r\n99.5\r\n')
  })

  it('corrida del 22/10: el muestreo también con la coma decimal', () => {
    expect(tableCsv([t({ sampleRate: 44100, bits: 16 })], [{ key: 'sampleRate', label: 'Muestreo' }], { sep: ';', decimal: ',' }).split('\r\n')[1]).toBe('44,1 kHz / 16 bits')
  })

  it('comillas, saltos de línea y textos que Excel tomaría como fórmula', () => {
    const csv = tableCsv([t({ artist: '=HYPERLINK("x")', title: 'Dice "hola"\nchau', album: '-Intro-', genre: '- 2 -' })],
      [{ key: 'artist', label: 'Artista' }, { key: 'title', label: 'Título' }, { key: 'album', label: 'Álbum' }, { key: 'genre', label: 'Género' }], { sep: ';', decimal: ',' })
    expect(csv.slice(1).split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")";"Dice ""hola"" chau";'-Intro-;- 2 -`)
  })
})

describe('vistas guardadas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-vistas-'))
  const db = openDb(path.join(dir, 'paila.db'))
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const v = (name: string, query = '') => ({ name, kind: 'musica' as const, problem: null, query, sort: { key: 'bpm', dir: -1 as const }, columns: ['artist', 'title', 'bpm'] })

  it('guardar, volver a leer (viven en la base), reemplazar por nombre, renombrar y borrar', () => {
    const views = new Views(db)
    expect(views.list()).toEqual([])
    const [a] = views.save(v('Para el sábado', ' cumbia '))
    expect(a).toMatchObject({ name: 'Para el sábado', query: 'cumbia', sort: { key: 'bpm', dir: -1 }, columns: ['artist', 'title', 'bpm'] })
    views.save({ ...v('Malas'), problem: 'low', columns: [] })
    expect(new Views(db).list().map((x) => [x.name, x.problem, x.columns])).toEqual([['Para el sábado', null, ['artist', 'title', 'bpm']], ['Malas', 'low', null]])
    // mismo nombre (sin importar mayúsculas): se reemplaza en su lugar, con el mismo id
    const again = views.save(v('para el SÁBADO', 'cuarteto'))
    expect(again).toHaveLength(2)
    expect(again[0]).toMatchObject({ id: a.id, name: 'para el SÁBADO', query: 'cuarteto' })
    expect(() => views.rename(again[1].id, 'Para el sábado')).toThrow(/Ya hay una vista/)
    expect(views.rename(again[1].id, 'Mala calidad').map((x) => x.name)).toEqual(['para el SÁBADO', 'Mala calidad'])
    expect(() => views.save(v('  '))).toThrow(/nombre/)
    expect(views.remove(a.id).map((x) => x.name)).toEqual(['Mala calidad'])
    views.remove(again[1].id)
    expect(db.prepare("SELECT 1 FROM settings WHERE key = 'tabla.vistas'").get()).toBeUndefined()
  })

  it(`hasta ${MAX_VIEWS} vistas; algo roto en la base no rompe la barra lateral`, () => {
    const views = new Views(db)
    for (let i = 0; i < MAX_VIEWS; i++) views.save(v(`Vista ${i}`))
    expect(() => views.save(v('Una más'))).toThrow(/borrá alguna/)
    db.prepare("UPDATE settings SET value = 'esto no es JSON' WHERE key = 'tabla.vistas'").run()
    expect(views.list()).toEqual([])
  })
})
