// Lo que encontró el ensayo general del punto 1 en Tapas (docs/pruebas/2026-10-24-ensayo-punto-1.md): "Led Zeppelin I" recibía la
// tapa de "Led Zeppelin II" de iTunes (sin espacios, "ledzeppelini" y "ledzeppelinii" se parecen un 95 %).
import { describe, expect, it } from 'vitest'
import { albumNumber, sameNumber } from '@paila/core/covers'

describe('ensayo general del punto 1: Tapas', () => {
  it('el número del final del disco cuenta: I no es II, Vol. 2 no es Vol. 3', () => {
    expect(albumNumber('Led Zeppelin I')).toBe(1)
    expect(albumNumber('Led Zeppelin II')).toBe(2)
    expect(albumNumber('Led Zeppelin IV')).toBe(4)
    expect(albumNumber('Use Your Illusion II')).toBe(2)
    expect(albumNumber('Ysya2020 Vol. 3')).toBe(3)
    expect(albumNumber('Thriller')).toBeNull()
    expect(albumNumber('Dance Mix')).toBeNull() // "mix" no es un número romano
    expect(sameNumber('Led Zeppelin I', 'Led Zeppelin II')).toBe(false)
    expect(sameNumber('Use Your Illusion II', 'Use Your Illusion 2')).toBe(true)
    expect(sameNumber('Pesados Vestigios', 'Pesados vestigios (Remastered)')).toBe(true)
    expect(sameNumber('Los Calientes Remixes', 'Los Calientes')).toBe(true)
  })
})
