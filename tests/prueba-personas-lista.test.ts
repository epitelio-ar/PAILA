// La lista de Spotify de la prueba con personas (scripts/prueba-personas-armar.ts): sale de la semilla, no repite título ni carga
// a un solo artista (la primera corrida, 27/10: 8 de 18 eran de Shakira y "La Tortura" dos veces), saca los artistas de orquesta
// ("X: Royal Philharmonic…") y los "Álbum desconocido", y PAILA la lee como un CSV de Exportify.
import { describe, expect, it } from 'vitest'
import { azar, elegirLista, listaSpotify, paraLista, type Hecho, type Tema } from '../scripts/prueba-personas-armar'
import { parseList } from '@paila/core/listparse'

const tema = (rel: string, artist: string, title: string, album = 'Disco'): Tema => ({ src: `F:/M/${rel}`, rel, size: 1, artist, title, album, isrc: '', ms: 200_000 })

describe('lista de Spotify de la prueba', () => {
  const shakira = ['Addicted to You', 'Chantaje', 'Inevitable', 'La Tortura', 'Hips Don\'t Lie', 'Ciega, Sordomuda'].map((t, i) => tema(`Shakira/${i}.mp3`, i === 3 ? 'Shakira; Alejandro Sanz' : 'Shakira', t))
  const otros = Array.from({ length: 20 }, (_, i) => tema(`Varios/${i}.mp3`, `Artista ${i}`, `Tema ${i}`))
  const tortura2 = tema('Sueltos/tortura.mp3', 'Shakira', 'La Tortura')
  const temas = [...shakira, tortura2, ...otros]
  const hechos: Hecho[] = [
    ...shakira.map((t) => ({ dst: t.rel, src: t.rel, que: 'disco: tal cual' })),
    { dst: 'x.mp3', src: tortura2.rel, que: 'mala calidad: re-codificado a MP3 96 kbps' },
    ...otros.map((t, i) => ({ dst: t.rel, src: t.rel, que: i < 4 ? 'mala calidad: re-codificado a MP3 128 kbps' : i < 8 ? `REPETIDO de ${t.rel}: copia idéntica con otro nombre` : 'tal cual' })),
  ]
  const faltan = [tema('F/1.mp3', 'David Firman: Royal Philharmonic Orchestra', 'Advocata Nostra'), ...Array.from({ length: 13 }, (_, i) => tema(`F/${i + 2}.mp3`, `Falta ${i}`, `Nuevo ${i}`))]

  it('la misma semilla elige lo mismo', () => {
    expect(azar(27).mezclar([1, 2, 3, 4, 5, 6])).toEqual(azar(27).mezclar([1, 2, 3, 4, 5, 6]))
    expect(elegirLista(hechos, temas, faltan, 27)).toEqual(elegirLista(hechos, temas, faltan, 27))
  })

  it('18 que están (sin dos "La Tortura" ni más de 2 de Shakira) y 12 que faltan, sin artistas de orquesta', () => {
    const { tiene, faltan: f } = elegirLista(hechos, temas, faltan, 27)
    expect(tiene).toHaveLength(18)
    expect(tiene.filter((t) => /shakira/i.test(t.artist)).length).toBeLessThanOrEqual(2)
    expect(tiene.filter((t) => t.title === 'La Tortura').length).toBeLessThanOrEqual(1)
    expect(f).toHaveLength(12)
    expect(f.every(paraLista)).toBe(true)
  })

  it('PAILA la lee como CSV de Exportify, con el título en lugar de "Álbum desconocido"', () => {
    const csv = listaSpotify([tema('a.mp3', 'Sumo', 'Kaya', 'Álbum desconocido (03/05/2006 16:34:34)')], [tema('b.mp3', 'Las "Pelotas"', 'Sin Hilo')], 27)
    expect(csv).not.toContain('desconocido')
    const l = parseList(csv, 'Para el viaje.csv')
    expect(l.source).toMatch(/Exportify/)
    expect(l.entries.map((e) => `${e.artist} - ${e.title}`).sort()).toEqual(['Las "Pelotas" - Sin Hilo', 'Sumo - Kaya'])
  })
})
