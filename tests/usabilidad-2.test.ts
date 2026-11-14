// Lo que arregló la segunda tanda de la prueba de usabilidad (27/10/2026, docs/pruebas/2026-10-27-usabilidad-2.md): solo con
// teclado, en pantallas chicas y la barra lateral más corta. Medido en la app con scripts/teclado.ts y scripts/pantallas.ts.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { escribiendo } from '@paila/shared/teclas'
import { officialNames } from '@paila/core/official-run'
import type { Db } from '@paila/core/db'
import { buscarComandos } from '../apps/paila/ui/src/palette-buscar'

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...extra })

describe('las letras que se escriben no las agarra un atajo', () => {
  it('un campo sin type (el de Ctrl+K) es de texto: la S, la R o la M no prendían el aleatorio ni se perdían', () => {
    expect(escribiendo(el('INPUT', { type: '' }))).toBe(true)
    expect(escribiendo(el('INPUT', { type: 'text' }))).toBe(true)
    expect(escribiendo(el('INPUT', { type: 'search' }))).toBe(true)
    expect(escribiendo(el('TEXTAREA'))).toBe(true)
    expect(escribiendo(el('SELECT'))).toBe(true)
    expect(escribiendo(el('DIV', { isContentEditable: true }))).toBe(true)
  })

  it('en una casilla, un botón o fuera de un campo, los atajos de una letra siguen andando', () => {
    expect(escribiendo(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(escribiendo(el('INPUT', { type: 'radio' }))).toBe(false)
    expect(escribiendo(el('INPUT', { type: 'range' }))).toBe(false)
    expect(escribiendo(el('BUTTON'))).toBe(false)
    expect(escribiendo(null)).toBe(false)
  })

  it('el reproductor usa esa misma pregunta (antes miraba solo input[type=text] y compañía)', () => {
    const p = read('apps/paila/ui/src/Player.tsx')
    expect(p).toMatch(/if \(escribiendo\(e\.target\)\) return/)
    expect(p).not.toMatch(/input\[type=text\]/)
  })
})

describe('solo con teclado', () => {
  it('las ventanas compartidas se cierran con Escape (salvo ocupadas), llevan el foco adentro y lo devuelven', () => {
    const v = read('packages/diseno/src/Ventana.tsx')
    expect(v).toMatch(/e\.key === 'Escape'\) \{ if \(!ocupada\.current\)/)
    expect(v).toMatch(/\.focus\(\)/)
    expect(v).toMatch(/e\.key !== 'Tab'/) // Tab da vueltas adentro
    expect(v).toMatch(/antes\.focus\(\)/) // al cerrar vuelve a donde estaba
  })

  it('«Saltar al contenido» es lo primero, y al cambiar de pantalla el foco pasa a la pantalla (eran 49 Tab + 25–38 más)', () => {
    const app = read('apps/paila/ui/src/App.tsx')
    expect(app).toMatch(/<header className="top"><button className="saltar" onClick=\{irAlContenido\}>/) // lo primero del Tab
    expect(app).toMatch(/<main className="main" tabIndex=\{-1\}>/)
    expect(app).toMatch(/useFocoEnPantalla\(page\)/)
    expect(read('apps/paila/ui/src/atajos.ts')).toMatch(/a\.closest\('\.side, \.palette'\)\) document\.querySelector<HTMLElement>\('main\.main'\)\?\.focus/)
  })

  it('los renglones que se abren con un clic también se abren con Enter (Análisis, Espacio, Discos, ZIP, Traer una lista, Armar un set)', () => {
    for (const f of ['Progress', 'Space', 'AlbumsComplete', 'AlbumsGain', 'Comprimidos', 'Requests', 'SetBuilder']) expect(read(`apps/paila/ui/src/${f}.tsx`), f).toMatch(/\{\.\.\.conTeclado\(/)
  })
})

describe('pantallas chicas', () => {
  it('las herramientas ya no compiten con la Biblioteca en la barra: van en las pestañas, y «Tu música» muestra la Biblioteca abierta (01/11)', () => {
    const s = read('apps/paila/ui/src/Sidebar.tsx')
    expect(s).toContain('<Group id="biblioteca" title={T.biblioteca}>')
    expect(s).not.toContain('NAV_GROUPS.filter')
  })

  it('en una ventana angosta, el encabezado de la tabla acompaña a los temas y no empuja toda la ventana', () => {
    const t = read('apps/paila/ui/src/TrackTable.tsx')
    expect(t).toContain('className="thead" ref={headRef}')
    expect(t).toContain('headRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`')
    expect(read('apps/paila/ui/src/styles/table.css')).toContain('.table { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-x: hidden; }')
  })

  it('en una ventana baja, el reproductor y las barras de arriba y abajo ocupan menos', () => {
    const m = read('apps/paila/ui/src/styles/marco.css')
    expect(m).toMatch(/@media \(max-height: 640px\) \{\s*\.app \{ grid-template-rows: 48px 40px minmax\(0, 1fr\) 54px 22px; \}/)
  })
})

describe('biblioteca enorme', () => {
  it('los nombres oficiales miran si cambió algo una vez por segundo, no una vez por tema (con 100.000 temas la lista «Faltan o suenan mal» trababa la app)', () => {
    let miradas = 0
    const db = { prepare: () => ({ get: () => { miradas++; return { n: 100000, p: null, j: null, c: 0, l: null } }, all: () => [] }) } as unknown as Db
    const of = officialNames(db, 60_000) // una ventana larga: con la PC cargada, 40.000 llamadas pueden pasar del segundo
    for (let id = 1; id <= 40000; id++) expect(of(id)).toBeNull()
    expect(miradas).toBe(1)
    const siempre = officialNames(db, 0)
    for (let id = 1; id <= 5; id++) siempre(id)
    expect(miradas).toBe(6)
  })
})

describe('Ctrl+K', () => {
  const cmds = [
    { id: 'djtools', label: 'Apagar las herramientas para DJ y producción', hint: 'Programas de DJ, Armar un set y Separar voz' },
    { id: 'avanzado', label: 'Prender el modo avanzado', hint: 'Muestra el inspector y la cola del análisis' },
    { id: 'progress', label: 'Análisis', hint: 'Qué se está analizando' },
    { id: 'rekordbox', label: 'Programas de DJ', hint: 'Exportar a Rekordbox' },
    { id: 'organize', label: 'Organizar carpetas', hint: 'Acomoda tu Música en carpetas' },
    { id: 'folderpl', label: 'Carpetas → Playlists', hint: 'Convierte tus carpetas en playlists' },
    { id: 'dups', label: 'Duplicados', hint: 'El mismo tema repetido: te quedás con el mejor' },
    { id: 'requests', label: 'Traer una lista', hint: 'Una playlist de otro programa' },
  ]
  const primero = (q: string) => buscarComandos(cmds, q)[0]?.id

  it('el nombre exacto de una pantalla va primero: Enter ya no apaga las herramientas para DJ ni prende el modo avanzado', () => {
    expect(primero('Programas de DJ')).toBe('rekordbox')
    expect(primero('programas de dj')).toBe('rekordbox')
    expect(primero('Análisis')).toBe('progress')
    expect(primero('analisis')).toBe('progress')
    expect(primero('Carpetas')).toBe('folderpl') // empieza así, antes que «Organizar carpetas»
  })

  it('encuentra con las palabras de la gente y con el plural', () => {
    expect(primero('repetidos')).toBe('dups')
    expect(primero('spotify')).toBe('requests')
    expect(buscarComandos(cmds, '')).toHaveLength(cmds.length)
    expect(buscarComandos(cmds, 'zzz')).toEqual([])
  })
})
