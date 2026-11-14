// Lo que arregló la prueba de usabilidad del 27/10/2026 (docs/pruebas/2026-10-27-usabilidad.md): que las herramientas se vean,
// que el camino esté arriba, que se diga adónde va lo que falta y que los errores lleguen en palabras.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { motivo } from '@paila/core/changes.textos'
import { sinConexion } from '@paila/core/online/http'

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const err = (code: string) => Object.assign(new Error(`${code}: algo, open 'C:\\x.mp3'`), { code })

describe('se encuentra sin buscar', () => {
  it('las herramientas están en las pestañas y las playlists solo en «Tu música»: ninguna empuja a la otra (con 66 playlists quedaban a 2.400 px)', () => {
    const side = read('apps/paila/ui/src/Sidebar.tsx')
    expect(side.indexOf("sec.id !== 'musica'")).toBeGreaterThan(0)
    expect(side.indexOf("sec.id === 'musica'")).toBeLessThan(side.indexOf('<Group id="pl"'))
  })

  it('en el Inicio, el estado de la colección va antes que el héroe (antes quedaba abajo, casi fuera de la vista)', () => {
    const home = read('apps/paila/ui/src/Home.tsx')
    expect(home.indexOf('<Estado e=')).toBeGreaterThan(0)
    expect(home.indexOf('<Estado e=')).toBeLessThan(home.indexOf('className="heroe"'))
  })

  it('Traer una lista dice a la vista adónde van los que faltan, no solo en el tooltip', () => {
    const req = read('apps/paila/ui/src/Requests.tsx')
    expect(read('apps/paila/ui/src/Requests.textos.ts')).toMatch(/vanALista: \{ es: .*Faltan o suenan mal/)
    expect(req).toMatch(/counts\.falta \+ counts\.baja > 0 && <span[^>]*>\{T\.vanALista\(/)
  })
})

describe('los errores llegan en palabras', () => {
  it('un archivo abierto en otro programa, sin permiso, disco lleno o que ya no está', () => {
    expect(motivo(err('EBUSY'))).toMatch(/abierto en otro programa/)
    expect(motivo(err('EPERM'))).toMatch(/No se deja escribir/)
    expect(motivo(err('EACCES'))).toMatch(/No se deja escribir/)
    expect(motivo(err('ENOSPC'))).toBe('No hay lugar en el disco')
    expect(motivo(err('ENOENT'))).toMatch(/ya no está/)
    // el código también se reconoce si viene solo en el mensaje (un error re-lanzado)
    expect(motivo(new Error('EBUSY: resource busy or locked'))).toMatch(/abierto en otro programa/)
    // lo que ya viene en palabras queda como está
    expect(motivo(new Error('El archivo cambió desde la vista previa'))).toBe('El archivo cambió desde la vista previa')
  })

  it('sin internet se distingue de "el servicio no lo encontró" (para no anotarlo como ya preguntado)', () => {
    expect(sinConexion(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.discogs.com'), { code: 'ENOTFOUND' }) }))).toBe(true)
    expect(sinConexion(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
    expect(sinConexion(new Error('Discogs respondió 404'))).toBe(false)
    expect(sinConexion(new Error('MusicBrainz pide ir más despacio: reintentá en un rato'))).toBe(false)
  })
})

describe('decisiones del 27/10: barra lateral, playlists, Inicio y Programas de DJ', () => {
  it('el pie de la barra es un renglón de íconos: sin el interruptor de DJ ni Historieta/Sobrio (están en Configuración)', () => {
    const side = read('apps/paila/ui/src/Sidebar.tsx')
    expect(side).toContain('className="side-iconos"')
    expect(side).not.toMatch(/side-switch|side-estilo|useEstiloPaila|setDjTools/)
    expect(read('apps/paila/ui/src/Settings.tsx')).toMatch(/EstiloChooser/)
    expect(read('apps/paila/ui/src/Settings.tsx')).toMatch(/setDjTools/)
  })

  it('la barra muestra pocas playlists y «Ver todas», que abre la pantalla Playlists; al arrastrar temas se ven todas', () => {
    const side = read('apps/paila/ui/src/Sidebar.tsx')
    expect(side).toMatch(/data-page="playlists"/)
    expect(side).toMatch(/ids=\{arrastrando \? /)
    expect(read('apps/paila/ui/src/App.tsx')).toMatch(/playlists: \(\) => <PlaylistsPage/)
  })

  it('idsDeLaBarra: primero las fijadas, después las últimas usadas, sin repetir y solo las que existen', async () => {
    const { idsDeLaBarra, EN_BARRA } = await import('../apps/paila/ui/src/playlistsUso')
    const existen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(idsDeLaBarra([5], [3, 5, 9, 99], existen)).toEqual([5, 3, 9])
    expect(idsDeLaBarra([], [], existen)).toEqual([])
    expect(idsDeLaBarra([], [1, 2, 3, 4, 5, 6, 7, 8, 9], existen)).toHaveLength(EN_BARRA)
    // muchas fijadas: todas se ven (hasta 12)
    expect(idsDeLaBarra([1, 2, 3, 4, 5, 6, 7, 8], [9], existen)).toHaveLength(8)
  })

  it('Inicio: con algo pendiente en el estado queda un solo botón principal (sin «Limpiar: qué conviene conseguir»)', () => {
    const home = read('apps/paila/ui/src/Home.tsx')
    expect(home).toContain('const falta = ')
    expect(home).toMatch(/\{falta\s*\? <Boton variant="ghost"[^]*?T\.verProblemas/)
    expect(read('apps/paila/ui/src/Termometro.tsx')).toMatch(/leyenda: \{ es: 'Cera: /)
  })

  it('Programas de DJ: «Exportar» va antes que «¿Qué equipo usás?»', () => {
    const rb = read('apps/paila/ui/src/Rekordbox.tsx')
    expect(rb.indexOf('<h4>{T.h6}</h4>')).toBeGreaterThan(0)
    expect(rb.indexOf('<h4>{T.h6}</h4>')).toBeLessThan(rb.indexOf('<h4>{T.h1}</h4>'))
    expect(read('apps/paila/ui/src/Rekordbox.textos.ts')).toMatch(/h6: \{ es: '1\. Exportar/)
  })

  it('Faltan o suenan mal: «Bajar con NAPIA» y «Exportar» antes que las casillas de qué incluir', () => {
    const w = read('apps/paila/ui/src/WantedList.tsx')
    expect(w.indexOf('onClick={toNapia}')).toBeGreaterThan(0)
    expect(w.indexOf('onClick={toNapia}')).toBeLessThan(w.indexOf('className="wl-incluir"'))
  })
})
