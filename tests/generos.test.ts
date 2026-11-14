// Varios géneros por tema, uno solo a la vista (packages/shared/generos.ts; decisión del autor, 13/11, docs/DECISIONES.md): cómo
// se separan los que vienen juntos en el tag, cuál es el principal, y que la lista (orden y columna), la planilla, Estadísticas y las
// carpetas "Por género" usen ese mismo, el primero. Casos reales de la base del autor.
import { describe, expect, it } from 'vitest'
import { generoPrincipal, generos } from '@paila/shared/generos'
import { SORT_VALUES } from '@paila/shared/trackinfo'
import { tableCsv } from '@paila/shared/tablecsv'
import { targetFor, type TagRow } from '@paila/core/organizer'
import type { Track } from '@paila/shared/types'

describe('los géneros de un tema', () => {
  it.each([
    ['Reggaeton; Latin Music', ['Reggaeton', 'Latin Music']], // como los escribe PAILA
    ['Electronic, Latin, Pop', ['Electronic', 'Latin', 'Pop']],
    ['Hip Hop;Latin;Reggaeton', ['Hip Hop', 'Latin', 'Reggaeton']],
    ['Pop Rock/Electronic Rock/Alternative Rock', ['Pop Rock', 'Electronic Rock', 'Alternative Rock']],
    ['Rap/Hip Hop; Latin Music', ['Rap/Hip Hop', 'Latin Music']], // "Rap/Hip Hop" es uno solo (Deezer)
    ['Pop/Rock', ['Pop/Rock']], // uno solo (AllMusic)
    ['Minimal / Deep Tech', ['Minimal / Deep Tech']], // uno solo (Beatport)
    ['Rock; rock; Pop', ['Rock', 'Pop']],
    ['http___vk.com_usuario', []],
    ['WwW.ZonaCumbieros.NeT', []],
    ['____', []],
    ['', []],
  ])('%s', (tag, esperado) => { expect(generos(tag)).toEqual(esperado) })

  it('el principal es el primero que sirve, o ninguno', () => {
    expect(generoPrincipal('Reggaeton; Latin Music')).toBe('Reggaeton')
    expect(generoPrincipal('http://vk.com/x; Techno')).toBe('Techno')
    expect(generoPrincipal(null)).toBeNull()
  })
})

describe('uno solo a la vista, el mismo en todos lados', () => {
  const tema = (genre: string | null) => ({ id: 1, rel: 'x/a.mp3', artist: 'Bad Bunny', title: 'Tití Me Preguntó', genre } as unknown as Track)

  it('la lista ordena por el principal y la planilla lo escribe solo a él', () => {
    expect(SORT_VALUES.genre(tema('Reggaeton; Latin Music'))).toBe('reggaeton')
    const csv = tableCsv([tema('Reggaeton; Latin Music')], [{ key: 'genre', label: 'Género' }], { sep: ';', decimal: ',' }) // idioma-ok: el rótulo de la columna en la prueba
    expect(csv).toContain('Reggaeton')
    expect(csv).not.toContain('Latin Music')
  })

  it('las carpetas "Por género" usan el principal ("Electronic, Latin, Pop" va a "Electronic")', () => {
    const row = (genre: string | null): TagRow => ({ id: 1, rootId: 1, rel: 'x/a.mp3', ext: 'mp3', kind: 'musica', artist: 'Alguien', albumArtist: null, title: 'A', album: null, track: null, year: null, genre })
    const regla = { rule: '%genero%/%artista%/%titulo%', dest: 'Biblioteca' } // idioma-ok: la regla
    expect(targetFor(row('Electronic, Latin, Pop'), regla)).toBe('Biblioteca/Electronic/Alguien/A.mp3')
    expect(targetFor(row(null), regla)).toBe('Biblioteca/Sin género/Alguien/A.mp3')
  })
})
