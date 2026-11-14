// Géneros y artistas con varios valores ("Rap; Hip Hop"): cambiarlos y deshacer los deja como estaban, en MP3 con ID3v2.3 (que
// separa los valores con "/"), con ID3v2.4 y en FLAC. Lo encontró la corrida supervisada del motor único (23/10): en ID3v2.3
// deshacer no podía volver ("El campo genre no quedó guardado"). Solo archivos sintéticos.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'
import { underscoreDoubt } from '@paila/core/names'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, changes: Changes
const M = (rel: string) => path.join(dir, 'M', rel)
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const CASOS: [string, string[]][] = [
  ['v23.mp3', ['-id3v2_version', '3']],
  ['v24.mp3', ['-id3v2_version', '4']],
  ['varios.flac', []],
]

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-varios-'))
  fs.mkdirSync(path.join(dir, 'M'))
  for (const [name, args] of CASOS) {
    // ffmpeg guarda "Rap/Hip Hop" en ID3v2.3 (como lo deja Windows Media y muchos programas viejos) y como texto en los demás
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...args,
      '-metadata', `genre=${name.startsWith('v23') ? 'Rap/Hip Hop' : 'Rap; Hip Hop'}`, '-metadata', `artist=${name.startsWith('v23') ? 'Wisin/Yandel' : 'Wisin; Yandel'}`, '-metadata', 'title=Abusadora', M(name)])
  }
  // uso real del 24/10: «El campo artist no quedó guardado» con un artista con "/" en un MP3 (ID3v2.3)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-id3v2_version', '3', '-metadata', 'artist=Big One, FMK _ Ke Personajes', '-metadata', 'title=Un Finde CROSSOVER #2', M('barra.mp3')])
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('varios valores: cambiar y deshacer los deja como estaban', () => {
  for (const [name] of CASOS) {
    it(name, async () => {
      const before = readTags(M(name), { exact: true })
      expect(before).toMatchObject({ genre: 'Rap; Hip Hop', artist: 'Wisin; Yandel' })
      changes.stage([idOf(name)], 'genre', 'Prueba')
      changes.stage([idOf(name)], 'artist', 'Otro')
      const r = await changes.apply()
      expect(r.failed).toEqual([])
      expect(readTags(M(name))).toMatchObject({ genre: 'Prueba', artist: 'Otro' })
      const u = await changes.undo(r.batchId!)
      expect(u.failed).toEqual([])
      expect(readTags(M(name), { exact: true })).toEqual(before)
    })
  }
})

describe('un artista con "/" en un MP3 (ID3v2.3)', () => {
  it('se guarda (la librería lo relee partido: se compara nombre por nombre) y deshacer lo deja como estaba', async () => {
    const before = readTags(M('barra.mp3'), { exact: true })
    changes.stage([idOf('barra.mp3')], 'artist', 'Big One, FMK / Ke Personajes')
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    expect(readTags(M('barra.mp3')).artist?.split(';').map((x) => x.trim())).toEqual(['Big One, FMK', 'Ke Personajes'])
    const u = await changes.undo(r.batchId!)
    expect(u.failed).toEqual([])
    expect(readTags(M('barra.mp3'), { exact: true })).toEqual(before)
  })
  it('" _ " entre dos artistas se propone "&" (no "/"); en el título y en "AC_DC", como siempre', () => {
    expect(underscoreDoubt('Big One, FMK _ Ke Personajes', 'artist')).toMatchObject({ to: 'Big One, FMK & Ke Personajes' })
    expect(underscoreDoubt('El Reja _ El Flecha', 'artist')).toMatchObject({ to: 'El Reja & El Flecha' })
    expect(underscoreDoubt('Glock _ Nena Trampa Deluxe Edition', 'title')).toMatchObject({ to: 'Glock / Nena Trampa Deluxe Edition' })
    expect(underscoreDoubt('AC_DC', 'artist')).toMatchObject({ to: 'AC/DC' })
  })
})
