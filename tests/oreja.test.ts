// Tests de la oreja-termómetro (shared/oreja.ts): limpieza 0–100 y nivel de la oreja con sus topes.
import { describe, expect, it } from 'vitest'
import { minimoParaVeredicto, oreja } from '@paila/shared/oreja'

describe('oreja', () => {
  it('sin nada analizado no hay limpieza', () => {
    expect(oreja({})).toEqual({ limpieza: null, nivel: 0, analizados: 0 })
  })
  it('todo en A es limpia; todo en B es un poquito; todo en C es bastante; todo en D es desastre', () => {
    expect(oreja({ A: 10 })).toMatchObject({ limpieza: 100, nivel: 0 })
    expect(oreja({ B: 10 })).toMatchObject({ limpieza: 75, nivel: 1 })
    expect(oreja({ B: 5, C: 5 })).toMatchObject({ limpieza: 63, nivel: 2 })
    expect(oreja({ C: 10 })).toMatchObject({ limpieza: 50, nivel: 3 })
    expect(oreja({ D: 10 })).toMatchObject({ limpieza: 25, nivel: 4 })
  })
  it('una biblioteca real (21/10) da 58: bastante', () => {
    expect(oreja({ 'A+': 9, A: 525, B: 1321, C: 212, D: 809, F: 280 })).toMatchObject({ limpieza: 58, nivel: 3, analizados: 3156 })
  })
  it('topes: casi todo en A pero con D o F no es "limpia"; muchas F son por lo menos "bastante"', () => {
    expect(oreja({ A: 97, F: 3 })).toMatchObject({ nivel: 1 })
    expect(oreja({ A: 80, F: 20 })).toMatchObject({ limpieza: 80, nivel: 3 })
  })
  it('lo que no es una nota no cuenta', () => {
    expect(oreja({ A: 10, sin: 50 })).toMatchObject({ limpieza: 100, analizados: 10 })
  })
})

describe('el mínimo para dar un veredicto (hallazgo 6)', () => {
  it('50 temas, o el 10 % si la colección es chica; nunca menos de 5 ni más que los que hay', () => {
    expect(minimoParaVeredicto(300)).toBe(30)
    expect(minimoParaVeredicto(5000)).toBe(50)
    expect(minimoParaVeredicto(20)).toBe(5)
    expect(minimoParaVeredicto(3)).toBe(3)
    expect(minimoParaVeredicto(0)).toBe(0)
  })
})
