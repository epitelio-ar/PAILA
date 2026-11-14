// Tests de operaciones seguras sobre archivos (core/safefs.ts): mover sin pisar y mandar tandas a la papelera.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { moveNoClobber, trashBatch } from '@paila/core/safefs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-safefs-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('mover sin pisar', () => {
  it('no pisa un archivo que ya está en el destino (en Windows renameSync lo haría en silencio)', () => {
    const a = path.join(dir, 'tema.mp3'), b = path.join(dir, 'papelera', '1', 'tema.mp3')
    fs.writeFileSync(a, 'nuevo'); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.writeFileSync(b, 'el que ya estaba en la papelera')
    expect(() => moveNoClobber(a, b)).toThrow(/no lo pisa/)
    expect(fs.readFileSync(a, 'utf8')).toBe('nuevo')
    expect(fs.readFileSync(b, 'utf8')).toBe('el que ya estaba en la papelera')
  })
  it('mueve creando las carpetas que falten, y deja cambiar solo las mayúsculas', () => {
    const a = path.join(dir, 'x.mp3'), b = path.join(dir, 'una/carpeta/nueva/x.mp3')
    fs.writeFileSync(a, 'x')
    moveNoClobber(a, b)
    expect(fs.existsSync(b) && !fs.existsSync(a)).toBe(true)
    const c = path.join(dir, 'una/carpeta/nueva/X.mp3')
    moveNoClobber(b, c)
    expect(fs.readdirSync(path.dirname(c))).toEqual(['X.mp3'])
  })
  it('cada tanda de la papelera tiene un nombre único aunque se repita el número', () => {
    const names = new Set(Array.from({ length: 50 }, () => trashBatch('tanda-1')))
    expect(names.size).toBe(50)
    expect([...names][0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_tanda-1_[a-z0-9_-]{4}$/)
  })
})
