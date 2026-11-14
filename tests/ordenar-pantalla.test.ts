// La pantalla Ordenar (apps/paila/ui/src), lo que se vio al recorrerla con la base real (13/11): los ejemplos de las carpetas
// muestran temas variados y completos (no los dos primeros por orden alfabético, del mismo disco), "Cómo va a quedar" cuenta bien
// las carpetas, la carta de un choque no muestra el "(2)", el grupo abierto no sale girado y releer la lista no se dispara sola.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { elegirEjemplos, sinNumero } from '../apps/paila/ui/src/ordenarRegla'
import { arbolDe, carpetasDe } from '../apps/paila/ui/src/arbolCarpetas'

const UI = path.join(__dirname, '..', 'apps', 'paila', 'ui', 'src')
const leer = (f: string) => fs.readFileSync(path.join(UI, f), 'utf8')

describe('los ejemplos de cada forma de carpetas', () => {
  const moves = [
    { fileId: 1, to: 'Biblioteca/@RemixRemixes/El Telefono.mp3' },
    { fileId: 2, to: 'Biblioteca/Almafuerte/1998 - Toro y Pampa/09 - Toro y Pampa.flac' },
    { fileId: 3, to: 'Biblioteca/Almafuerte/1998 - Toro y Pampa/04 - Unas Estrofas Más.mp3' },
    { fileId: 4, to: 'Biblioteca/Guns N\' Roses/1987 - Appetite for Destruction/06 - Paradise City.mp3' },
    { fileId: 5, to: 'Biblioteca/#Ysya2020 Vol. 1/Una de Dos.mp3' },
    { fileId: 6, to: 'Biblioteca/Los Quara/2012 - Punto De Partida/05 - A un sólo segundo.mp3' },
  ]
  it('con la forma entera, de carpetas distintas y sin nombres raros', () => {
    const e = elegirEjemplos(moves, 2, 'Biblioteca')
    expect(e).toHaveLength(2)
    expect(e.every((m) => m.to.split('/').length === 4)).toBe(true)
    expect(new Set(e.map((m) => m.to.split('/')[1])).size).toBe(2)
    expect(e.some((m) => /[@#]/.test(m.to))).toBe(false)
  })
  it('siempre los mismos (la cuenta es fija) y, si no alcanza, los que haya', () => {
    expect(elegirEjemplos(moves, 2, 'Biblioteca')).toEqual(elegirEjemplos([...moves].reverse(), 2, 'Biblioteca'))
    expect(elegirEjemplos(moves.slice(0, 1), 2, 'Biblioteca')).toEqual(moves.slice(0, 1))
    expect(elegirEjemplos([], 2, '')).toEqual([])
  })
})

describe('"Cómo va a quedar"', () => {
  it('arma el árbol con cuántos temas hay en cada carpeta', () => {
    const a = arbolDe(['B/La Renga/Uno.mp3', 'B/La Renga/1996 - Despedazado/02 - Dos.mp3', 'B/Almafuerte/Tres.mp3', 'suelto.mp3'])
    expect(a.temas).toBe(4)
    expect(a.hojas).toEqual(['suelto.mp3'])
    expect(a.hijos.map((h) => [h.nombre, h.temas])).toEqual([['B', 3]])
    expect(a.hijos[0].hijos.map((h) => [h.nombre, h.temas])).toEqual([['Almafuerte', 1], ['La Renga', 2]])
    expect(carpetasDe(['B/La Renga/Uno.mp3', 'B/La Renga/Dos.mp3', 'B/Almafuerte/Tres.mp3', 'suelto.mp3'])).toBe(3)
  })
})

describe('las cartas y los grupos', () => {
  it('el lugar donde chocan se muestra sin el "(2)" que PAILA le pondría a uno', () => {
    expect(sinNumero('Biblioteca/Wanakin/Lola (2).mp3')).toBe('Biblioteca/Wanakin/Lola.mp3')
    expect(sinNumero('Biblioteca/Los Nota Lokos/Es La Que Va (versión 3-27).mp3')).toBe('Biblioteca/Los Nota Lokos/Es La Que Va (versión 3-27).mp3')
  })
  it('el grupo abierto no usa la clase "abierto" (marco.css la gira 90°: el grupo salía de costado)', () => {
    expect(fs.readFileSync(path.join(UI, 'styles', 'marco.css'), 'utf8')).toMatch(/\.abierto \{ transform: rotate\(90deg\)/)
    expect(leer('OrdenarGrupos.tsx')).not.toContain("ord-grupo${abierto ? ' abierto'")
    expect(leer('OrdenarGrupos.tsx')).toContain("ord-grupo${abierto ? ' ord-abierto'")
  })
  it('releer la lista no le avisa a la barra de arriba (su aviso volvía a releer: la app quedaba sin contestar)', () => {
    const s = leer('Ordenar.tsx')
    const releer = s.slice(s.indexOf('useAlCambiarCambios('), s.indexOf('})', s.indexOf('useAlCambiarCambios(')))
    expect(releer).toContain('window.paila.revision()')
    expect(releer).not.toContain('avisar.current()')
  })
})
