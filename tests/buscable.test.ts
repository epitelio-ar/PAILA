// A NAPIA y a sockseek no van los temas que no se pueden buscar: sin artista y con un título de pista genérico. En la prueba
// de la persona 1 (31/10/2026) NAPIA buscó "AudioTrack 08" sin artista y, claro, nadie lo tenía.
import { describe, expect, it } from 'vitest'
import { sePuedeBuscar } from '@paila/core/wanted'

describe('qué se puede buscar en Soulseek', () => {
  it('sin artista y con nombre de pista genérico, no', () => {
    for (const title of ['AudioTrack 08', 'Track 01', 'track01', 'Pista 3', 'Tema 12', '07', '', '  '])
      expect(sePuedeBuscar({ artist: '', title }), title).toBe(false)
    expect(sePuedeBuscar({ artist: null, title: null })).toBe(false)
  })
  it('con artista, o con un título de verdad, sí', () => {
    expect(sePuedeBuscar({ artist: '', title: 'Muchachos, hoy nos volvimos a ilusionar' })).toBe(true)
    expect(sePuedeBuscar({ artist: 'Blink-182', title: '7' })).toBe(true)
    expect(sePuedeBuscar({ artist: 'Los Gardelitos', title: 'Los Querandíes' })).toBe(true)
    expect(sePuedeBuscar({ artist: '', title: 'Track 01 (Remix de Juan)' })).toBe(true)
    expect(sePuedeBuscar({ artist: 'Alguien', title: '' })).toBe(false)
  })
})
