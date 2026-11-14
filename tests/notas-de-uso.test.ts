// Notas de uso (core/notasdeuso.ts): guardar una nota con su captura, leer la lista (la más nueva primero), el tope de 5 acciones
// y una línea rota que no tira abajo la lista.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { armarPedido, guardarNota, listarNotas } from '@paila/core/notasdeuso'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notas-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('notas de uso', () => {
  it('sin carpeta todavía, la lista está vacía', () => {
    expect(listarNotas(path.join(tmp, 'no-existe'))).toEqual([])
  })

  it('guarda la nota en AAAA-MM-DD.jsonl con la captura al lado y la lee de vuelta', () => {
    const dir = path.join(tmp, 'a')
    const n = guardarNota(dir, { pantalla: 'Duplicados', acciones: ['Inicio', 'Biblioteca'], texto: '  no entendí este botón \n' }, PNG, new Date(2026, 9, 24, 18, 3, 41))
    expect(n).toEqual({ hora: '2026-10-24T18:03:41', pantalla: 'Duplicados', acciones: ['Inicio', 'Biblioteca'], texto: 'no entendí este botón', captura: '2026-10-24_180341.png' })
    expect(fs.readFileSync(path.join(dir, '2026-10-24.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, '2026-10-24_180341.png'))).toEqual(PNG)
    expect(listarNotas(dir)).toEqual([n])
  })

  it('sin captura la nota se guarda igual; la lista va de la más nueva a la más vieja, entre días', () => {
    const dir = path.join(tmp, 'b')
    guardarNota(dir, { pantalla: 'Inicio', acciones: [], texto: 'uno' }, null, new Date(2026, 9, 23, 10, 0, 0))
    guardarNota(dir, { pantalla: 'Inicio', acciones: [], texto: 'tres' }, null, new Date(2026, 9, 24, 9, 0, 0))
    guardarNota(dir, { pantalla: 'Inicio', acciones: [], texto: 'dos' }, null, new Date(2026, 9, 24, 8, 0, 0))
    const l = listarNotas(dir)
    expect(l.map((x) => x.texto)).toEqual(['tres', 'dos', 'uno'])
    expect(l.every((x) => x.captura === null)).toBe(true)
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.png'))).toEqual([])
  })

  it('guarda las últimas 5 acciones', () => {
    const dir = path.join(tmp, 'c')
    const n = guardarNota(dir, { pantalla: 'x', acciones: ['1', '2', '3', '4', '5', '6', '7'], texto: 't' }, null)
    expect(n.acciones).toEqual(['3', '4', '5', '6', '7'])
  })

  it('una línea rota se salta', () => {
    const dir = path.join(tmp, 'd')
    guardarNota(dir, { pantalla: 'x', acciones: [], texto: 'bien' }, null, new Date(2026, 9, 24, 8, 0, 0))
    fs.appendFileSync(path.join(dir, '2026-10-24.jsonl'), '{"hora":"2026-10-24T09\n')
    expect(listarNotas(dir).map((x) => x.texto)).toEqual(['bien'])
  })
})

describe('mandar una nota a PAILA', () => {
  const nota = { hora: '2026-10-24T20:35:08', pantalla: 'Configuración', acciones: ['Inicio', 'F:\Música\secreto'], texto: 'no tiene sentido ese botón\nsegunda línea', captura: 'x.png' }
  it('arma el pedido con la nota, la pantalla y la versión, y nada más', () => {
    const p = armarPedido(nota, '0.5.15')
    expect(p.titulo).toBe('[Configuración] no tiene sentido ese botón')
    expect(p.cuerpo).toContain('segunda línea')
    expect(p.cuerpo).toContain('Versión de PAILA: 0.5.15')
    expect(p.cuerpo).not.toContain('secreto')
    expect(p.url.startsWith('https://github.com/epitelio-ar/PAILA/issues/new?title=')).toBe(true)
    expect(decodeURIComponent(p.url)).toContain('Pantalla: Configuración')
  })
  it('por mail usa mailto y va codificado', () => {
    const p = armarPedido(nota, '0.5.15', 'mail')
    expect(p.url.startsWith('mailto:')).toBe(true)
    expect(p.url).not.toContain(' ')
  })
  it('un título largo se corta', () => {
    expect(armarPedido({ ...nota, texto: 'a'.repeat(200) }, '1').titulo.length).toBeLessThan(90)
  })
})
