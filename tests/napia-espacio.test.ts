// NAPIA avisa antes de arrancar si la tanda no entra en el disco (el autor, 1/11: 1.350 temas a C: con 26 GB libres).
import { describe, expect, it } from 'vitest'
import { espacioTanda, MB_POR_TEMA } from '../apps/napia/ui/src/espacio'

describe('NAPIA: ¿entra la tanda en el disco?', () => {
  it('1.350 temas no entran en 26 GB', () => {
    const r = espacioTanda(1350, 26e9)
    expect(r.noEntra).toBe(true)
    expect(r.ocupa).toBe(1350 * MB_POR_TEMA)
  })
  it('50 temas sí entran, y sin saber el espacio libre no se avisa', () => {
    expect(espacioTanda(50, 26e9).noEntra).toBe(false)
    expect(espacioTanda(1350, null).noEntra).toBe(false)
    expect(espacioTanda(0, 0).noEntra).toBe(false)
  })
})

import { soloQue } from '@paila/core/wanted'
describe('Faltan o suenan mal: qué parte mandar (el autor, 1/11)', () => {
  it('"calidad" es lo que ya tenés; "faltan", lo que no; "todo", las dos', () => {
    expect(soloQue({ fileId: 3 }, 'calidad')).toBe(true)
    expect(soloQue({ fileId: null }, 'calidad')).toBe(false)
    expect(soloQue({ fileId: null }, 'faltan')).toBe(true)
    expect(soloQue({ fileId: 3 }, 'faltan')).toBe(false)
    expect(soloQue({ fileId: 3 })).toBe(true)
    expect(soloQue({ fileId: null }, 'todo')).toBe(true)
  })
})
