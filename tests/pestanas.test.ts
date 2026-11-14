// Las pestañas que avanzan (DECISIONES 01/11, opción D): cada pantalla de la barra vieja tiene su pestaña, en el orden que
// no obliga a volver, y las de DJ se ven solo con las herramientas para DJ.
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_TOP } from '../apps/paila/ui/src/nav'
import { HERRAMIENTAS, SECCIONES, hecha, partesDe, pestanasVisibles, seccionDe } from '../apps/paila/ui/src/secciones'

describe('pestañas', () => {
  it('ninguna pantalla queda sin pestaña ni en dos (salvo las herramientas sueltas, que van en su grupo plegado)', () => {
    const todas = [...NAV_TOP, ...NAV_GROUPS.flatMap((g) => g.items)].map((i) => i.page)
    for (const p of todas) {
      const en = SECCIONES.filter((s) => s.partes.includes(p) || s.detalle?.includes(p)).length
      expect(en, p).toBe(HERRAMIENTAS.includes(p) ? 0 : 1)
    }
  })
  it('la poda de la etapa 6: Análisis es detalle de Inicio, las herramientas sueltas salen de las pestañas y Traer una lista va con las playlists', () => {
    expect(HERRAMIENTAS).toEqual(['stats', 'space', 'comprimidos'])
    for (const h of HERRAMIENTAS) expect(seccionDe(h), h).toBeNull()
    expect(seccionDe('progress')!.id).toBe('inicio')
    expect(SECCIONES.find((s) => s.id === 'inicio')!.partes).toEqual(['home', 'problemas'])
    expect(seccionDe('requests')!.id).toBe('musica')
    expect(seccionDe('folderpl')!.id).toBe('musica')
    expect(seccionDe('tracklist')!.id).toBe('dj')
    expect(SECCIONES.find((s) => s.id === 'llevar')!.partes).toEqual(['carry'])
  })
  it('el orden: Inicio · Tu música · Ordenar · Sonido · Llevar · DJ, con Ordenar todo primero', () => {
    expect(SECCIONES.map((s) => s.id)).toEqual(['inicio', 'musica', 'ordenar', 'sonido', 'llevar', 'dj'])
    expect(SECCIONES.find((s) => s.id === 'ordenar')!.partes[0]).toBe('ordenar')
    expect(SECCIONES.find((s) => s.id === 'sonido')!.partes[0]).toBe('sonido') // Sonido de un vistazo (MASTERPLAN-5, etapa 5)
    expect(seccionDe('online')!.partes.indexOf('online')).toBeLessThan(seccionDe('tidy')!.partes.indexOf('tidy'))
    expect(seccionDe('ficha')!.id).toBe('musica')
    expect(seccionDe('settings')).toBeNull()
  })
  it('la pestaña DJ, solo con las herramientas para DJ', () => {
    expect(pestanasVisibles(false).map((s) => s.id)).toEqual(['inicio', 'musica', 'ordenar', 'sonido', 'llevar'])
    expect(pestanasVisibles(true).map((s) => s.id)).toContain('dj')
    const dj = SECCIONES.find((s) => s.id === 'dj')!
    expect(partesDe(dj, false)).toEqual([])
    expect(partesDe(dj, true)).toEqual(['rekordbox', 'setbuilder', 'separar', 'tracklist'])
  })
  it('una pestaña está hecha cuando todas sus partes del estado lo están; sin partes, nunca', () => {
    const ord = SECCIONES.find((s) => s.id === 'ordenar')!
    expect(hecha(ord, new Set(['repetidos', 'internet', 'nombres', 'tapas']))).toBe(false)
    expect(hecha(ord, new Set(['repetidos', 'internet', 'nombres', 'tapas', 'carpetas']))).toBe(true)
    expect(hecha(SECCIONES.find((s) => s.id === 'llevar')!, new Set())).toBe(false)
  })
})
