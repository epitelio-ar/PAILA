// Lo que el Inicio dice del estado de la colección (apps/paila/ui/src/Estado.lista.ts; MASTERPLAN-5, 2.3): un renglón por parte
// con su número de verdad, el que sigue es la primera parte con algo para hacer, sin veredicto con pocos datos, y Organizar avisa
// en un renglón lo que conviene antes. Reemplaza a tests/pasos.test.ts (las marcas se fueron el 02/11).
import { afterAll, describe, expect, it } from 'vitest'
import { ponerIdioma } from '@paila/shared/idioma'
import type { EstadoColeccion, GrupoCuenta, GrupoEstado } from '@paila/shared/types'
import { convieneAntes, hechos, renglones, siguiente } from '../apps/paila/ui/src/Estado.lista'

ponerIdioma('es')
afterAll(() => ponerIdioma('es'))
const g = (n: number | null, o: Partial<GrupoCuenta> = {}): GrupoCuenta => ({ n, filas: n ? [{ ids: [1], texto: 'x' }] : [], dejados: 0, ...o })
const estado = (grupos: Partial<Record<GrupoEstado, GrupoCuenta>> = {}, o: Partial<EstadoColeccion> = {}): EstadoColeccion => ({
  total: 300, escuchados: 300, hayVeredicto: true, regla: { rule: '%artista%/%titulo%', dest: 'Biblioteca' },
  grupos: { repetidos: g(0), internet: g(0), nombres: g(0), tapas: g(0), carpetas: g(0), sonido: g(0), ...grupos }, ...o,
})

describe('el estado en el Inicio', () => {
  it('un renglón por parte, en orden, con los números de verdad', () => {
    const r = renglones(estado({ repetidos: g(20, { aparte: 2 }), carpetas: g(278, { aparte: 8 }), tapas: g(5, { aparte: 3 }) }))
    expect(r.map((x) => x.clave)).toEqual(['escuchar', 'repetidos', 'internet', 'nombres', 'tapas', 'carpetas', 'sonido'])
    expect(r[1].texto).toBe('20 copias repetidas para la papelera · 2 grupos para decidir vos')
    expect(r.find((x) => x.clave === 'carpetas')!.texto).toBe('270 temas fuera de su carpeta · 8 temas cambiarían de nombre')
    expect(r.find((x) => x.clave === 'tapas')!.texto).toBe('2 discos con tapa para poner · 3 discos sin revisar')
    expect(r.find((x) => x.clave === 'internet')).toMatchObject({ como: 'hecho', texto: 'todo buscado' })
  })

  it('lo que sigue es la primera parte con algo para hacer; con todo en 0 no hay botón', () => {
    expect(siguiente(renglones(estado({ nombres: g(3), carpetas: g(10) })))!.clave).toBe('nombres')
    expect(siguiente(renglones(estado()))).toBeNull()
    // escuchar lo hace PAILA sola: no es "lo que sigue"
    expect(siguiente(renglones(estado({}, { escuchados: 10 })))).toBeNull()
  })

  it('si deshacés Organizar, vuelve a decir cuántos temas están fuera de su carpeta', () => {
    expect(renglones(estado({ carpetas: g(0) })).find((x) => x.clave === 'carpetas')!.como).toBe('hecho')
    const despues = renglones(estado({ carpetas: g(267) }))
    expect(despues.find((x) => x.clave === 'carpetas')).toMatchObject({ como: 'falta', texto: '267 temas fuera de su carpeta' })
    expect(siguiente(despues)!.clave).toBe('carpetas')
  })

  it('sin veredicto con pocos datos, y mientras cuenta no da por hecho nada', () => {
    const r = renglones(estado({ sonido: g(null, { espera: 'escuchando' }), repetidos: g(null, { espera: 'calculando' }) }, { escuchados: 20 }))
    expect(r.find((x) => x.clave === 'sonido')).toMatchObject({ como: 'espera', texto: 'cuando PAILA termine de escuchar' })
    expect(r.find((x) => x.clave === 'repetidos')).toMatchObject({ como: 'espera', texto: 'contando…' })
    expect(r[0]).toMatchObject({ como: 'falta', texto: '20 de 300 temas' })
    expect(hechos(r).has('sonido')).toBe(false)
    expect(hechos(r).has('repetidos')).toBe(false)
  })

  it('lo dejado como está no cuenta, pero se dice', () => {
    const r = renglones(estado({ nombres: g(0, { dejados: 4 }) }))
    expect(r.find((x) => x.clave === 'nombres')).toMatchObject({ como: 'hecho', texto: 'sin faltantes · 4 dejados como están' })
  })

  it('Organizar avisa lo que conviene antes, sin bloquear', () => {
    expect(convieneAntes(renglones(estado({ repetidos: g(10), nombres: g(2), sonido: g(5) })))).toBe(
      'Conviene antes: Repetidos (10 copias repetidas para la papelera), Nombres (2 temas sin artista o con el nombre roto)')
    expect(convieneAntes(renglones(estado({ sonido: g(5) })))).toBe('')
  })
})
