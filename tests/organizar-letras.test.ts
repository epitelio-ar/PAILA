// La letra de cada tema (.lrc, y .txt con el mismo nombre) viaja con su tema cuando Organizar lo mueve y toma su nombre nuevo, para
// que los reproductores la sigan encontrando; Deshacer la devuelve, y una letra que no es de ningún tema no se toca (punto 1 real
// del 24/10: los 15 .lrc de "El Círculo" de Kase.O se quedaban atrás). Con archivos de verdad (core/organizer-extras.ts).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { DEFAULT_RULE, Organizer } from '@paila/core/organizer'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, org: Organizer
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const DISCO = 'Rap/(2016) kase.O - El Círculo'
const tone = (rel: string, meta: Record<string, string>) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-letras-'))
  const disco = { artist: 'Kase.O', album: 'El círculo', date: '2016' }
  tone(`${DISCO}/Kase.O - El círculo - 01 - Intro (El círculo).flac`, { ...disco, title: 'Intro (El círculo)', track: '1' })
  tone(`${DISCO}/Kase.O - El círculo - 02 - Esto no para.flac`, { ...disco, title: 'Esto no para', track: '2' })
  fs.writeFileSync(M(`${DISCO}/Kase.O - El círculo - 01 - Intro (El círculo).lrc`), '[00:01.00] Intro')
  fs.writeFileSync(M(`${DISCO}/Kase.O - El círculo - 02 - Esto no para.lrc`), '[00:01.00] Esto no para')
  fs.writeFileSync(M(`${DISCO}/Kase.O - El círculo - 06 - Sin tema.lrc`), '[00:01.00] huérfana') // no hay tema con ese nombre
  fs.writeFileSync(M(`${DISCO}/info.txt`), 'del disco') // lo que acompaña al disco: viaja con su nombre
  tone('Sueltos/charly - demoliendo.mp3', { artist: 'Charly García', title: 'Demoliendo hoteles' })
  fs.writeFileSync(M('Sueltos/charly - demoliendo.txt'), 'letra en .txt')
  tone('Sueltos/otro - tema.mp3', { artist: 'Otro', title: 'Tema' }) // la carpeta no se va entera: el .txt de arriba viaja por ser letra
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  org = new Organizer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Organizar: la letra viaja con su tema', () => {
  it('la vista previa lleva cada .lrc (y el .txt de letra) con su tema y su nombre nuevo; la huérfana no', () => {
    const extras = org.plan({ rule: DEFAULT_RULE, dest: '' }).extras.map((x) => `${x.from} → ${x.to}`).sort()
    expect(extras).toEqual([
      `${DISCO}/Kase.O - El círculo - 01 - Intro (El círculo).lrc → Kase.O/2016 - El círculo/01 - Intro (El círculo).lrc`,
      `${DISCO}/Kase.O - El círculo - 02 - Esto no para.lrc → Kase.O/2016 - El círculo/02 - Esto no para.lrc`,
      `${DISCO}/info.txt → Kase.O/2016 - El círculo/info.txt`,
      'Sueltos/charly - demoliendo.txt → Charly García/Demoliendo hoteles.txt',
    ])
  })

  it('aplicar las mueve y Deshacer las devuelve', async () => {
    const r = await org.apply(org.plan({ rule: DEFAULT_RULE, dest: '' }))
    expect(r.failed).toEqual([])
    expect(fs.readFileSync(M('Kase.O/2016 - El círculo/01 - Intro (El círculo).lrc'), 'utf8')).toBe('[00:01.00] Intro')
    expect(fs.existsSync(M('Charly García/Demoliendo hoteles.txt'))).toBe(true)
    expect(fs.existsSync(M(`${DISCO}/Kase.O - El círculo - 06 - Sin tema.lrc`))).toBe(true) // la huérfana sigue donde estaba
    expect(org.plan({ rule: DEFAULT_RULE, dest: '' }).extras).toEqual([]) // un segundo Organizar no tiene nada que llevar
    await org.undo(r.batchId!)
    expect(fs.readFileSync(M(`${DISCO}/Kase.O - El círculo - 01 - Intro (El círculo).lrc`), 'utf8')).toBe('[00:01.00] Intro')
    expect(fs.existsSync(M(`${DISCO}/Kase.O - El círculo - 02 - Esto no para.lrc`))).toBe(true)
    expect(fs.existsSync(M('Sueltos/charly - demoliendo.txt'))).toBe(true)
    expect(fs.existsSync(M('Kase.O'))).toBe(false)
  })
})
