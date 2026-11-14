// Las carpetas en bloques, sin códigos con % (apps/paila/ui/src/ordenarRegla.ts): cada forma se pasa a la regla que entiende Organizar
// y vuelve igual, la de fábrica es la de siempre, y las dos tildes (número del tema, año del disco) cambian solo lo que dicen.
import { describe, expect, it } from 'vitest'
import { aRegla, deRegla, esForma, FORMA_DE_FABRICA, FORMAS } from '../apps/paila/ui/src/ordenarRegla'
import { REGLA_ORDENAR } from '@paila/core/forma-actual'

describe('las carpetas en bloques', () => {
  it('la forma de fábrica es la de Ordenar: disco con año y sin número (el autor, 13/11)', () => {
    expect(aRegla(FORMA_DE_FABRICA)).toEqual(REGLA_ORDENAR)
    expect(FORMA_DE_FABRICA.numero).toBe(false)
  })

  it('sin número y sin año (pedido del autor, 13/11)', () => {
    expect(aRegla({ ...FORMA_DE_FABRICA, numero: false, anio: false }).rule).toBe('%artista%/%album%/%titulo%')
    expect(aRegla({ ...FORMA_DE_FABRICA, ...FORMAS.generos, numero: true }).rule).toBe('%genero%/%artista%/%n% - %titulo%')
    expect(aRegla({ ...FORMA_DE_FABRICA, archivo: 'artistaTitulo', soloCarpetas: true })).toEqual({ rule: '%artista%/%año% - %album%/%artista% - %titulo%', dest: 'Biblioteca', soloCarpetas: true })
  })

  it('cada forma vuelve igual al abrir el editor', () => {
    for (const k of Object.keys(FORMAS) as (keyof typeof FORMAS)[]) {
      for (const numero of [true, false]) for (const anio of [true, false]) {
        const f = { ...FORMA_DE_FABRICA, ...FORMAS[k], numero, anio }
        const o = aRegla(f)
        expect(deRegla(o)).toMatchObject({ niveles: f.niveles, archivo: f.archivo, numero })
        expect(esForma(o, k)).toBe(true)
      }
    }
  })

  it('una regla escrita a mano que los bloques no saben armar queda en el modo avanzado', () => {
    expect(deRegla({ rule: '%albumartista%/%album%/%titulo%', dest: '' })).toBeNull()
    expect(deRegla({ rule: '%artista% - %titulo%', dest: '' })).toMatchObject({ niveles: [], archivo: 'artistaTitulo', numero: false })
  })
})
