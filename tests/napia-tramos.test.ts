// Tests de la lista en tramos de NAPIA (core/sockseek/tramos.ts): lo trucho se busca en otra fuente al terminar su tramo, no al
// final de la lista (el autor, 1/11: "para evitar que un tema descargado trucho quede pendiente hasta el fin de la cola"); lo que
// el índice ya tiene va sin contar; frenar no deja empezar otro tramo. Con el sockseek de mentira (tests/fixtures/napia-lista.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TRAMO, hechosEnIndice, partirEnTramos } from '@paila/core/sockseek/tramos'
import { resumir } from '@paila/core/sockseek/tanda'
import { bajarLista, hacerAudios } from './fixtures/napia-lista'

let dir: string
let a: (n: string) => string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-tramos-'))
  a = hacerAudios(dir)
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const fila = (title: string) => ({ artist: 'A', title })

describe('partir la lista en tramos', () => {
  it('de a 25 temas por hacer; lo que el índice ya tiene va en su tramo sin contar', () => {
    expect(TRAMO).toBe(25)
    const rows = ['1', '2', '3', '4', '5', '6', '7'].map(fila)
    const titulos = (ts: { title: string }[][]) => ts.map((t) => t.map((x) => x.title))
    expect(titulos(partirEnTramos(rows, new Set(), 3))).toEqual([['1', '2', '3'], ['4', '5', '6'], ['7']])
    // 2 y 3 ya están: el primer tramo lleva 3 por hacer igual
    expect(titulos(partirEnTramos(rows, new Set(['a|2', 'a|3']), 3))).toEqual([['1', '2', '3', '4', '5'], ['6', '7']])
    // lo ya hecho del final va con el último tramo (solo, sería un sockseek para saltear todo)
    expect(titulos(partirEnTramos(rows, new Set(['a|7']), 3))).toEqual([['1', '2', '3'], ['4', '5', '6', '7']])
    expect(titulos(partirEnTramos(rows, new Set(rows.map((r) => `a|${r.title}`)), 3))).toEqual([['1', '2', '3', '4', '5', '6', '7']])
    expect(partirEnTramos([], new Set())).toEqual([])
  })

  it('lo hecho sale del índice de sockseek: bajado o ya estaba (no lo que no se encontró)', () => {
    const f = path.join(dir, 'indice.csv')
    fs.writeFileSync(f, 'filepath,artist,album,title,length,tracktype,state,failurereason\nC:/x.mp3,A,,Uno,-1,0,1,0\n,A,,Dos,-1,0,2,9\nC:/y.mp3,B,,Tres,-1,0,3,0\n,A,,Cuatro,-1,0,0,0\n')
    expect([...hechosEnIndice(f)].sort()).toEqual(['a|uno', 'b|tres'])
    expect(hechosEnIndice(path.join(dir, 'no-existe.csv')).size).toBe(0)
  })
})

describe('una lista en tramos con el sockseek de mentira', () => {
  it('lo trucho del primer tramo ya se reemplazó cuando arranca el segundo', async () => {
    const r = await bajarLista(path.join(dir, 'lista'), 'buena', {
      Uno: [['ana', a('inflado.mp3')], ['beto', a('m320.mp3')]], // trucho, y otra fuente buena
      Dos: [['caro', a('m320.mp3')]],
      Tres: [['dani', a('m320.mp3')]],
      Cuatro: [['eli', a('falso.flac')], ['fede', a('m320.mp3')]], // trucho en el segundo tramo
      Cinco: [['gabi', a('m320.mp3')]],
    }, { tramo: 2, jobs: 2 })
    expect(r.alArrancar.map((t) => t.temas)).toEqual([['Uno', 'Dos'], ['Tres', 'Cuatro'], ['Cinco']])
    // antes: Uno esperaba a que terminara la lista entera
    expect(r.alArrancar[1].estados.Uno).toBe('reemplazado')
    expect(r.alArrancar[2].estados.Cuatro).toBe('reemplazado')
    expect(r.vetadosPorRonda).toEqual([['ana'], ['eli']])
    for (const t of ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']) expect(path.dirname(r.porTitulo(t).path!)).toBe(r.carpeta)
    expect(resumir(r.tracks)).toMatchObject({ total: 5, bajados: 5, descartados: 2, reemplazados: 2, sinTerminar: 0 })
    // los temas son los mismos de punta a punta: una sola lista para la pantalla, con el registro de cada tramo
    expect(r.lista.counts()).toMatchObject({ bajado: 5, espera: 0 })
    expect(r.lista.log.filter((l) => l.includes('Tramo')).length).toBe(3)
  }, 120_000)

  it('al retomar, lo que ya bajó no cuenta para el tramo y sockseek lo saltea', async () => {
    const base = path.join(dir, 'retomar')
    const fuentes = { Uno: [['ana', a('m320.mp3')]], Dos: [['beto', a('m320.mp3')]], Tres: [['caro', a('m320.mp3')]] } as Record<string, [string, string][]>
    await bajarLista(base, 'buena', { Uno: fuentes.Uno, Dos: fuentes.Dos }, { tramo: 2 })
    const r = await bajarLista(base, 'buena', fuentes, { tramo: 2 })
    expect(r.alArrancar.map((t) => t.temas)).toEqual([['Uno', 'Dos', 'Tres']])
    expect(r.porTitulo('Uno').state).toBe('yaEstaba')
    expect(r.porTitulo('Tres').state).toBe('bajado')
  }, 120_000)

  it('frenar no deja empezar otro tramo: lo que no arrancó queda cancelado', async () => {
    let tramos = 0
    const r = await bajarLista(path.join(dir, 'frenar'), 'buena', {
      Uno: [['ana', a('m320.mp3')]], Dos: [['beto', a('m320.mp3')]], Tres: [['caro', a('m320.mp3')]],
    }, { tramo: 1, frenar: () => tramos++ >= 1 })
    expect(r.alArrancar).toHaveLength(1)
    expect(r.tracks.map((t) => t.state)).toEqual(['bajado', 'cancelado', 'cancelado'])
  }, 120_000)
})
