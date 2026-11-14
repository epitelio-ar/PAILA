// El termómetro del Inicio (Termometro.tsx) dibuja la cera = 100 − limpieza. La barra y los niveles tienen que decir lo
// mismo que la oreja: sin los topes, el tramo donde cae el número es el nivel que da oreja().
import { describe, expect, it } from 'vitest'
import { oreja, NIVELES_OREJA } from '../packages/shared/oreja'
import { TRAMOS, tramoDe } from '../apps/paila/ui/src/tramos'

/** Una biblioteca de 1000 temas que da exactamente esa limpieza, sin D ni F (para que no entren los topes). */
function conLimpieza(l: number) {
  // limpieza = 100 − puntos/(n·4)·100 → puntos = (100 − l)·40 con n = 1000; se reparten en B (1), C (2)
  const puntos = (100 - l) * 40
  const C = Math.min(1000, Math.floor(puntos / 2)), B = puntos - C * 2
  return { A: 1000 - B - C, B, C }
}

describe('termómetro de cera', () => {
  it('los tramos van de 0 a 100 sin huecos', () => {
    expect(TRAMOS[0].desde).toBe(0)
    expect(TRAMOS.at(-1)!.hasta).toBe(100)
    TRAMOS.slice(1).forEach((t, i) => expect(t.desde).toBe(TRAMOS[i].hasta))
    expect(TRAMOS.map((t) => t.nombre)).toEqual(NIVELES_OREJA.map((x) => x.nombre))
  })

  it('sin topes, el tramo del número es el nivel de la oreja', () => {
    for (let l = 50; l <= 100; l++) {
      const o = oreja(conLimpieza(l))
      expect(o.limpieza).toBe(l)
      expect(tramoDe(100 - l), `limpieza ${l}`).toBe(o.nivel)
    }
  })

  it('los bordes caen como en oreja(): 60 de limpieza es "Algo", 59 es "Bastante"', () => {
    expect(TRAMOS[tramoDe(40)].nombre).toBe('Algo')
    expect(TRAMOS[tramoDe(41)].nombre).toBe('Bastante')
    expect(tramoDe(0)).toBe(0)
    expect(tramoDe(100)).toBe(4)
  })
})
