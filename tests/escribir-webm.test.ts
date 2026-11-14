// Un WebM (aunque se llame .mp3, como "Ella Baila Sola" del punto 1 real del 24/10) figura de entrada como "no se le pueden escribir
// tags", como un WMA, en vez de fallar al aplicar: en Arreglar nombres va trabado a "para mirar a mano" y en Volumen parejo, a los que
// no se escriben. Uno que trae un ID3 pegado adelante sí se escribe (core/extensions.ts). Con archivos de verdad (core/tagio.ts, cantWrite).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { cantWrite } from '@paila/core/tagio'
import { tidy } from '@paila/core/tidy'
import { gainPlan } from '@paila/core/replaygain'
import { rulesOf } from '@paila/shared/tidy-profiles'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, root: number
const M = (n: string) => path.join(dir, 'M', n)
const opus = (out: string, fmt: string) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', fmt, out])
const add = (rel: string, codec: string, title: string) =>
  Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec, duration, artist, title, probed_at) VALUES (?, ?, 1, 1, 'musica', ?, ?, 200, 'Eslabon Armado', ?, 'x')")
    .run(root, rel, path.extname(rel).slice(1).toLowerCase(), codec, title).lastInsertRowid)

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-webm-'))
  fs.mkdirSync(M(''), { recursive: true })
  opus(M('Ella Baila Sola.mp3'), 'webm') // un WebM pelado con nombre de MP3
  opus(M('con id3.webm.tmp'), 'webm')
  // el mismo WebM con un ID3 vacío pegado adelante: así vienen otros "MP3" bajados de YouTube, y a esos sí se les escribe
  fs.writeFileSync(M('Con ID3.mp3'), Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), fs.readFileSync(M('con id3.webm.tmp'))]))
  fs.rmSync(M('con id3.webm.tmp'))
  opus(M('Bien.ogg'), 'ogg')
  opus(M('CALLEJERO FINO.webm'), 'webm')
  lib = new Library(path.join(dir, 'paila.db'), null)
  root = (await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])).id
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('a un WebM no se le escriben tags, y se dice de entrada', () => {
  it('la regla: WebM no; un .mp3 que por dentro es WebM, tampoco; con un ID3 adelante, sí; un .ogg, sí; un WMA, sí (core/asftags.ts)', () => {
    expect(cantWrite({ ext: 'wma', codec: 'wmav2' }, null)).toBeNull()
    expect(cantWrite({ ext: 'webm', codec: 'opus' }, M('CALLEJERO FINO.webm'))).toMatch(/No se escriben tags en \.webm/)
    expect(cantWrite({ ext: 'mp3', codec: 'opus' }, M('Ella Baila Sola.mp3'))).toMatch(/por dentro es un video WebM/)
    expect(cantWrite({ ext: 'mp3', codec: 'opus' }, M('Con ID3.mp3'))).toBeNull()
    expect(cantWrite({ ext: 'ogg', codec: 'opus' }, M('Bien.ogg'))).toBeNull()
    expect(cantWrite({ ext: 'mp3', codec: 'mp3' }, () => { throw new Error('no hace falta mirar el archivo') })).toBeNull()
  })

  it('Arreglar nombres lo manda trabado a "para mirar a mano"; Volumen parejo, a los que no se escriben', async () => {
    const ella = add('Ella Baila Sola.mp3', 'opus', 'Ella Baila Sola (Video Oficial)')
    const id3 = add('Con ID3.mp3', 'opus', 'Con ID3 (Video Oficial)')
    const pathOf = (id: number) => (id === ella ? M('Ella Baila Sola.mp3') : id === id3 ? M('Con ID3.mp3') : null)
    const r = tidy(lib.db, ['junk'], pathOf, rulesOf('oficial'))
    expect(r.changes.filter((c) => c.id === ella)).toEqual([])
    expect(r.review.find((x) => x.id === ella)).toMatchObject({ field: 'title', to: 'Ella Baila Sola', blocked: true, why: expect.stringMatching(/WebM/) })
    expect(r.changes.find((c) => c.id === id3)).toMatchObject({ field: 'title', to: 'Con ID3' }) // con el ID3 adelante, sí
    const plan = await gainPlan(lib.db, pathOf)
    const t = plan.albums.flatMap((a) => a.tracks).find((x) => x.id === ella)!
    expect(t.why).toMatch(/WebM/)
    expect(plan.cantWrite).toBe(1)
  })
})
