// Palabras que sobran, aprendidas de la biblioteca (core/junkwords.ts, core/tidy-learned.ts): qué aprende de los temas
// identificados con seguridad, cada baranda del plan (versión, un solo disco o carpeta, nombre oficial, "No es basura") y
// cómo lo propone el asistente (con el motivo, en los temas que internet no encontró).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { JunkWords, VERSION, candidates, fixed, stripLearned } from '@paila/core/junkwords'

const VERSION_TEST = (s: string) => VERSION.test(s)
import { printKey } from '@paila/core/official-findings'
import { OnlineCache } from '@paila/core/online/http'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'

let dir: string, db: Db, n = 0
/** Un tema con su archivo, su huella y lo que contestó AcoustID (`official`: null = internet no lo encontró). */
const add = (rel: string, official: { artist: string; title: string; length?: number } | null, tags: { artist?: string; title?: string } = {}, duration = 200) => {
  const id = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, ?, 1, 1, 'musica', 'mp3', ?, ?, ?)").run(rel, tags.artist ?? null, tags.title ?? null, duration).lastInsertRowid)
  const cp = `HUELLA${++n}`
  db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, chromaprint) VALUES (?, 1, 1, 1, 'x', ?)").run(id, cp)
  if (official) new OnlineCache(db).put('acoustid', printKey(cp), 'ok', [{ score: 0.95, recordings: [{ source: 'acoustid', title: official.title, length: official.length ?? duration, credit: [{ name: official.artist, join: '' }] }] }])
  return id
}
const ARTISTS = ['Soda Stereo', 'Los Fabulosos Cadillacs', 'Charly Garcia', 'Babasonicos', 'Fito Paez', 'Divididos', 'Los Pericos']

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-palabras-'))
  db = openDb(path.join(dir, 'paila.db'))
  db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
  ARTISTS.forEach((a, i) => {
    const dirA = ['Rock', 'Descargas', 'Viejo'][i % 3]
    // basura de una página que no está en la lista fija: entre corchetes y al final con forma de web
    add(`${dirA}/${a} - Tema ${i} [Zona Descargas].mp3`, { artist: a, title: `Tema ${i}` })
    add(`${dirA}/${a} - Otro ${i} mp3full.net.mp3`, { artist: a, title: `Otro ${i}` })
    // un dato de versión: nunca es basura
    add(`${dirA}/${a} - Remixado ${i} (Club Remix).mp3`, { artist: a, title: `Remixado ${i}` })
    // al final, sin corchetes
    add(`${dirA}/${a} - Final ${i} HQ320.mp3`, { artist: a, title: `Final ${i}` })
  })
  // un disco entero con el código del sello: es de una sola carpeta y un solo artista (contexto, no basura)
  for (let i = 0; i < 8; i++) add(`Sello/Varios ${i % 2} - Pista ${i} [AL044].mp3`, { artist: `Varios ${i % 2}`, title: `Pista ${i}` })
  // una palabra que está en un nombre oficial ("Official Secrets" es un título real)
  ARTISTS.forEach((a, i) => add(`${['Rock', 'Descargas', 'Viejo'][i % 3]}/${a} - Secreto ${i} (Secrets).mp3`, { artist: a, title: `Secreto ${i}` }))
  add('Rock/Muse - Secrets.mp3', { artist: 'Muse', title: 'Secrets' })
  // la duración no coincide: no está identificado con seguridad (no enseña nada)
  add('Rock/Alguien - Larguísimo [Zona Descargas].mp3', { artist: 'Alguien', title: 'Larguísimo', length: 400 })
  // temas que internet no encontró: a estos les sirve
  add('Nuevos/Desconocido - Algo [Zona Descargas].mp3', null, { artist: 'Desconocido', title: 'Algo [Zona Descargas]' })
  add('Nuevos/Desconocido - Otra cosa mp3full.net.mp3', null)
})
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('qué aprende', () => {
  it('lo que sobra en muchos artistas y carpetas, en su lugar: corchetes, web o al final', () => {
    const r = new JunkWords(db).report()
    expect(r.identified).toBe(7 * 5 + 8 + 1)
    expect(r.words.map((w) => [w.shown, w.where, w.tracks, w.artists, w.folders])).toEqual(expect.arrayContaining([
      ['[Zona Descargas]', 'corchetes', 7, 7, 3], ['mp3full.net', 'web', 7, 7, 3], ['HQ320', 'final', 7, 7, 3],
    ]))
    expect(r.words).toHaveLength(3)
    const z = r.words.find((w) => w.key === 'zona descargas')!
    expect(z.applies).toBe(9) // los 7, el que dura distinto y el que internet no encontró
    expect(z.examples[0]).toEqual({ from: 'Soda Stereo - Tema 0 [Zona Descargas]', to: 'Soda Stereo - Tema 0' })
  })

  it('las barandas: versión, un solo disco, nombre oficial', () => {
    const why = new Map(new JunkWords(db).report().rejected.map((x) => [x.shown, x.why]))
    expect(why.get('(Club Remix)')).toMatch(/versión/)
    expect(why.get('[AL044]')).toMatch(/pocos artistas|pocas carpetas|misma carpeta/)
    expect(why.get('(Secrets)')).toMatch(/nombre oficial/)
  })

  it('"No es basura" la saca para siempre; apagada queda en la lista pero no se aplica', () => {
    const j = new JunkWords(db)
    j.setState('hq320', 'no_es')
    j.setState('mp3full.net', 'off')
    expect(j.report().words.find((w) => w.key === 'hq320')?.state).toBe('no_es')
    expect(j.active().map((w) => w.key)).toEqual(['zona descargas'])
    j.setState('hq320', 'on'); j.setState('mp3full.net', 'on')
  })
})

describe('corrida supervisada del 20/10 (biblioteca real)', () => {
  it('"[Taapion Records]" al final ya la saca la lista fija (el sello entre corchetes solo cuenta al final)', () => {
    expect(fixed('[Taapion Records]')).toBe(true)
    expect(fixed('[www.slider.kz]')).toBe(true)
    expect(fixed('(Official Video)')).toBe(true)
    expect(fixed('[Zona Descargas]')).toBe(false)
  })
  it('"Disco" solo no es un dato de versión ("(Disco Escultura)" es un nombre); "Disco Mix" sí', () => {
    expect(candidates('A - B (Disco Escultura)', new Set(['a', 'b']))[0].key).toBe('disco escultura')
    expect(VERSION_TEST('disco escultura')).toBe(false)
    expect(VERSION_TEST('disco mix')).toBe(true)
  })
})

describe('sacarlas', () => {
  it('candidatos y sacar solo donde se aprendió', () => {
    const words = new Set(['soda', 'stereo', 'tema'])
    expect(candidates('Soda Stereo - Tema [Zona Descargas] www.bajate.com Extra HQ', words).map((c) => [c.key, c.where])).toEqual([
      ['zona descargas', 'corchetes'], ['bajate.com', 'web'], ['extra hq', 'final'],
    ])
    const w = [{ key: 'zona descargas', where: 'corchetes' as const }, { key: 'hq320', where: 'final' as const }]
    expect(stripLearned('Tema [Zona Descargas]', w)).toEqual({ text: 'Tema', used: ['zona descargas'] })
    expect(stripLearned('Tema HQ320', w)).toEqual({ text: 'Tema', used: ['hq320'] })
    expect(stripLearned('HQ320 en el medio de Tema', w).used).toEqual([]) // al final, no en el medio
    expect(stripLearned('Zona Descargas sin corchetes', w).used).toEqual([])
  })

  it('el asistente las propone con el motivo, en el título y en el nombre del archivo', () => {
    const ch = tidy(db, ['junk', 'filenames'], undefined, rulesOf('prolijo')).changes
    const t = ch.find((c) => c.rel === 'Nuevos/Desconocido - Algo [Zona Descargas].mp3' && c.field === 'title')!
    expect(t).toMatchObject({ to: 'Algo', rules: ['aprendidas'] })
    expect(t.note).toBe('palabra aprendida: «[Zona Descargas]» vista de más en 7 temas de 7 artistas')
    const f = ch.find((c) => c.rel === 'Nuevos/Desconocido - Otra cosa mp3full.net.mp3' && c.field === 'filename')!
    expect(f.to).toBe('Desconocido - Otra cosa')
    expect(f.note).toMatch(/mp3full\.net/)
    // con la regla apagada (perfil Mínimo) no se propone nada de esto
    expect(tidy(db, ['junk', 'filenames'], undefined, rulesOf('minimo')).changes.filter((c) => c.note?.includes('palabra aprendida'))).toEqual([])
  })
})
