// Lo que encontró el ensayo general del punto 1 en "Arreglar nombres y tags" (docs/pruebas/2026-10-24-ensayo-punto-1.md), con
// los nombres reales: lo que PAILA había completado el 19/10 sin el "_" del final se volvía a proponer CON el "_".
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { tidy } from '@paila/core/tidy'
import { caseFromFile, keepCase } from '@paila/core/tidy-official'
import { rulesOf } from '@paila/shared/tidy-profiles'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
const FILES = [
  'Trap/Ysy A, SPONSOR DIOS, BAXIAN - CUÁNTOS TÉRMINOS_ [www.slider.kz].mp3',
  'Techno/The Chemical Brothers - Got Glint_ [www.slider.kz].mp3',
  'Techno/Bours_ - Horn Of The Harad [www.slider.kz].mp3',
  'Techno/Fur Coat, Julian Wassermann - 3.33 [www.slider.kz].mp3',
]

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-nombres-ensayo-'))
  for (const rel of FILES) {
    const out = path.join(dir, 'M', ...rel.split('/'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', out])
  }
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  // como quedaron el 19/10: el asistente completó artista y título (en una tanda grande) sin el "_" del final
  const done: [string, string, string][] = [
    ['CUÁNTOS', 'Ysy A, SPONSOR DIOS, BAXIAN', 'CUÁNTOS TÉRMINOS'], ['Got Glint', 'The Chemical Brothers', 'Got Glint'],
    ['Bours', 'Bours', 'Horn Of The Harad'], ['3.33', 'Fur Coat, Julian Wassermann', '33'],
  ]
  const ins = lib.db.prepare("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (1, ?, ?, ?, NULL, ?, '2026-10-19T04:49:30.625Z')")
  for (const [like, artist, title] of done) {
    const f = lib.db.prepare('SELECT id, rel_path AS rel FROM files WHERE rel_path LIKE ?').get(`%${like}%`) as { id: number; rel: string }
    lib.db.prepare('UPDATE files SET artist = ?, title = ? WHERE id = ?').run(artist, title, f.id)
    ins.run(f.id, f.rel, 'artist', artist); ins.run(f.id, f.rel, 'title', title)
    for (let i = 0; i < 10; i++) ins.run(f.id, f.rel, 'genre', null) // una tanda grande, como las del asistente
  }
}, 60_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('nombres oficiales con las mayúsculas del tema (el autor, 24/10)', () => {
  it('si solo cambian mayúsculas no se propone nada; tildes y títulos cortados conservan las mayúsculas de antes', () => {
    expect(keepCase('COACH', 'Coach')).toBeNull()
    expect(keepCase('Mi Vecinita', 'Mi vecinita')).toBeNull()
    expect(keepCase('Esa Carita Que Me Llevas', 'esa carita que me llevas')).toBeNull()
    expect(keepCase('Nunca Sere Policia', 'Nunca seré policía')).toBe('Nunca Seré Policía')
    expect(keepCase('Tan Bionica', 'Tan Biónica')).toBe('Tan Biónica')
    expect(keepCase('Voy A Bailar A La Nave Del Olv', 'Voy a bailar a la nave del olvido')).toBe('Voy A Bailar A La Nave Del Olvido')
    expect(keepCase('Moscas Verdes Para El Charlata', 'Moscas verdes para el charlatán')).toBe('Moscas Verdes Para El Charlatán')
    // lo que de verdad cambia va como viene
    expect(keepCase('Los Redondos', 'Patricio Rey y sus Redonditos de Ricota')).toBe('Patricio Rey y sus Redonditos de Ricota')
    expect(keepCase('Led Zepplin', 'Led Zeppelin')).toBe('Led Zeppelin')
    expect(keepCase(null, 'Trickfinger')).toBe('Trickfinger')
  })

  it('con el tag vacío, las mayúsculas salen del nombre del archivo si dice lo mismo (MusicBrainz escribe "Casi un g")', () => {
    expect(caseFromFile('YSY A Casi un G.mp3', 'Casi un g')).toBe('Casi un G')
    expect(caseFromFile('Como Le Digo.mp3', 'Como le digo')).toBe('Como Le Digo')
    expect(caseFromFile('Amor Infiel.mp3', 'Amor infiel')).toBe('Amor Infiel')
    expect(caseFromFile('10 Cristo es Marquitos di Palma.mp3', 'Cristo es Marquitos Di Palma')).toBe('Cristo es Marquitos di Palma')
    // si el nombre del archivo no lo dice, va como viene
    expect(caseFromFile('100mc4_(Original Mix).wav', 'Trickfinger')).toBe('Trickfinger')
  })
})

describe('ensayo general del punto 1: Arreglar nombres', () => {
  it('no cambia "CUÁNTOS TÉRMINOS" por "CUÁNTOS TÉRMINOS_": lo deja y propone el "?" para mirar a mano', () => {
    const r = tidy(lib.db, undefined, undefined, rulesOf('oficial'))
    const tag = (like: string, f: 'artist' | 'title') => r.changes.find((c) => c.rel.includes(like) && c.field === f)
    expect(tag('CUÁNTOS', 'title')).toBeUndefined()
    expect(tag('Got Glint', 'title')).toBeUndefined()
    expect(tag('Bours', 'artist')).toBeUndefined()
    const dudas = r.review.filter((x) => !x.staged).map((x) => [x.field, x.from, x.to])
    expect(dudas).toContainEqual(['title', 'CUÁNTOS TÉRMINOS', 'CUÁNTOS TÉRMINOS?'])
    expect(dudas).toContainEqual(['title', 'Got Glint', 'Got Glint?'])
    // lo que de verdad estaba mal se sigue corrigiendo ("33" → "3.33")
    expect(tag('3.33', 'title')).toMatchObject({ from: '33', to: '3.33' })
    // el nombre del archivo igual se limpia (sin tocar el "_", que es del nombre)
    expect(r.changes.find((c) => c.rel.includes('CUÁNTOS') && c.field === 'filename')?.to).toBe('Ysy A, SPONSOR DIOS, BAXIAN - CUÁNTOS TÉRMINOS_')
  })
})
