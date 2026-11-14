// Test de trampa del riesgo 1 (docs/MASTERPLAN-5-borrador.md): Duplicados nunca propone tirar un tema que no es repetido. En la
// prueba de la persona 2 (01/11) "05 - Comentario" fue a la papelera como repetido de "03 - Comentario": dos pistas distintas del mismo
// disco, con el mismo nombre y casi la misma duración. Sin el análisis (sin huellas), solo los une el nombre.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { findDuplicates, pistasDelMismoDisco } from '@paila/core/duplicates'
import type { DupGroup } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, grupos: DupGroup[]
const tone = (rel: string, freq: number, dur: number, meta: Record<string, string>) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`, '-b:a', '32k', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}
const grupoDe = (nombre: string) => grupos.find((g) => g.items.some((i) => i.rel.endsWith(nombre)))

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dups-trampa-'))
  const c = { artist: 'Diálogos', title: 'Comentario', album: 'Redondos' }
  tone('Diálogos/Redondos/03 - Comentario.mp3', 300, 75, c) // la trampa: dos pistas distintas del mismo disco
  tone('Diálogos/Redondos/05 - Comentario.mp3', 500, 78, c)
  const s = { artist: 'Bajo Fondo', title: 'Al que he sangrado' }
  tone('Rock/Al que he sangrado.mp3', 350, 153, s) // la otra trampa: misma canción, 3 s de diferencia, carpetas distintas
  tone('Sueltos/Al que he sangrado (2).mp3', 360, 156, s)
  const v = { artist: 'Virus', title: 'Una luna de miel en la mano' }
  tone('Rock/Virus/Una luna.mp3', 400, 200, v) // un probable de verdad: mismo nombre, casi la misma duración
  tone('Descargas/Una luna.mp3', 410, 200.6, v)
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  grupos = await findDuplicates(lib.db, (i) => lib.trackPath(i))
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Duplicados no propone tirar lo que no es repetido', () => {
  it('dos pistas distintas del mismo disco con el mismo nombre: Versiones, nunca a la papelera', () => {
    const g = grupoDe('05 - Comentario.mp3')!
    expect(g).toBeDefined() // se juntan por el nombre (es lo que pasaba): tienen que quedar en Versiones
    expect(g.level).toBe('version'); expect(g.keep).toBeNull()
  })
  it('el mismo nombre con duración distinta y sin el sonido que lo confirme: queda para decidir vos, sin tildar', () => {
    const g = grupoDe('Al que he sangrado (2).mp3')
    if (g) expect(g.level === 'version' || g.decidir === true).toBe(true)
  })
  it('un probable de verdad queda para decidir vos (no se tilda de fábrica)', () => {
    const g = grupoDe('Descargas/Una luna.mp3')!
    expect(g.level).toBe('probable')
    expect(g.decidir).toBe(true)
  })
  it('ninguna trampa queda propuesta para la papelera', () => {
    const tirables = grupos.filter((g) => g.keep != null && !g.decidir).flatMap((g) => g.items.filter((i) => i.id !== g.keep).map((i) => i.rel))
    expect(tirables.some((r) => /Comentario|sangrado/.test(r))).toBe(false)
  })
  it('pistas del mismo disco: por el número de adelante, en la misma carpeta', () => {
    expect(pistasDelMismoDisco([{ rel: 'A/D/03 - X.mp3' }, { rel: 'A/D/05 - X.mp3' }])).toBe(true)
    expect(pistasDelMismoDisco([{ rel: 'A/D/03 - X.mp3' }, { rel: 'B/03 - X.mp3' }])).toBe(false)
    expect(pistasDelMismoDisco([{ rel: 'A/D/X.mp3' }, { rel: 'A/D/X (2).mp3' }])).toBe(false)
  })
})
