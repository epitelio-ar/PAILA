// NAPIA madura (MASTERPLAN-3, punto 6): bajar en tanda, el historial de lo bajado y otra búsqueda para lo que no se
// encontró (core/sockseek/tanda.ts y reintento.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Tanda, entradaDe, frenaLaTanda, leerHistorial, resumir, sacarDelHistorial, sumarAlHistorial } from '@paila/core/sockseek/tanda'
import { sugerida, variantes } from '@paila/core/sockseek/reintento'
import { Progress, problemOf } from '@paila/core/sockseek/progress'
import { ponerIdioma } from '@paila/shared/idioma'
import type { NapiaList, TrackProgress } from '@paila/shared/napia'

const lista = (name: string, n = 3): NapiaList => ({ name, source: 'Texto pegado', skipped: [], tracks: Array.from({ length: n }, (_, i) => ({ artist: 'A', title: `T${i}`, album: null, duration: null })) })
const tema = (title: string, state: TrackProgress['state'], extra: Partial<TrackProgress> = {}): TrackProgress => ({ artist: 'A', title, state, percent: null, detail: null, path: null, format: null, ...extra })

describe('bajar en tanda', () => {
  it('baja una lista detrás de otra, en orden, y se pueden sumar mientras baja', () => {
    const t = new Tanda()
    const a = t.sumar(lista('Uno')), b = t.sumar(lista('Dos'), { aBajar: 2 })
    expect(t.siguiente()?.id).toBe(a.id)
    t.empezar(a.id, 'C:/Música/NAPIA/Uno')
    expect(t.siguiente()).toBeNull() // de a una
    const c = t.sumar(lista('Tres'))
    t.terminar(a.id, { resumen: resumir([tema('T0', 'bajado'), tema('T1', 'noEncontrado'), tema('T2', 'bajado')]), cortada: false })
    expect(a.estado).toBe('terminada')
    expect(a.resumen).toMatchObject({ total: 3, bajados: 2, noEncontrados: 1 })
    expect(t.siguiente()?.id).toBe(b.id)
    t.empezar(b.id, 'x'); t.terminar(b.id, { resumen: resumir([]), cortada: false })
    expect(t.siguiente()?.id).toBe(c.id)
  })

  it('un problema que va a pasar igual con las siguientes (la cuenta, el router) frena la tanda; la pausa de búsquedas no', () => {
    expect(frenaLaTanda('claveMal')).toBe(true)
    expect(frenaLaTanda('routerTrabado')).toBe(true)
    expect(frenaLaTanda('noConecta')).toBe(true)
    expect(frenaLaTanda('pausaBusquedas')).toBe(false)
    expect(frenaLaTanda(null)).toBe(false)
    const t = new Tanda()
    const a = t.sumar(lista('Uno')), b = t.sumar(lista('Dos'))
    t.empezar(a.id, 'x')
    t.terminar(a.id, { resumen: resumir([tema('T0', 'fallo')]), cortada: false, problema: { kind: 'claveMal', text: 'Soulseek no aceptó la contraseña.' } })
    expect(a.estado).toBe('frenada')
    expect(t.frenada?.motivo).toMatch(/contraseña/)
    expect(t.siguiente()).toBeNull()
    expect(b.estado).toBe('espera') // la que falta queda esperando
    t.seguir()
    expect(t.siguiente()?.id).toBe(b.id)
  })

  it('"Cortar todo" frena la tanda; "Saltear esta lista" corta la actual y sigue con la próxima', () => {
    const t = new Tanda()
    const a = t.sumar(lista('Uno')), b = t.sumar(lista('Dos')), c = t.sumar(lista('Tres'))
    t.empezar(a.id, 'x'); t.terminar(a.id, { resumen: resumir([tema('T0', 'cancelado')]), cortada: true, saltear: true })
    expect(a.estado).toBe('cortada')
    expect(t.siguiente()?.id).toBe(b.id)
    t.empezar(b.id, 'x'); t.terminar(b.id, { resumen: resumir([]), cortada: true })
    expect(t.frenada).not.toBeNull()
    expect(t.siguiente()).toBeNull()
    expect(c.estado).toBe('espera')
  })

  it('ordenar, renombrar y sacar solo lo que no está bajando; "otra vez" la vuelve a poner en espera; limpiar saca las terminadas', () => {
    const t = new Tanda()
    const a = t.sumar(lista('Uno')), b = t.sumar(lista('Dos')), c = t.sumar(lista('Tres'))
    t.mover(c.id, -1)
    expect(t.items.map((i) => i.list.name)).toEqual(['Uno', 'Tres', 'Dos'])
    t.empezar(a.id, 'x')
    t.mover(c.id, -1) // no pasa adelante de la que está bajando
    expect(t.items[0].id).toBe(a.id)
    expect(t.sacar(a.id)).toBe(false)
    t.renombrar(a.id, 'Otro nombre') // ya empezó: su carpeta no cambia
    expect(a.list.name).toBe('Uno')
    t.renombrar(b.id, 'Dos bis')
    expect(b.list.name).toBe('Dos bis')
    t.terminar(a.id, { resumen: resumir([tema('T0', 'bajado')]), cortada: false })
    t.deNuevo(a.id)
    expect(a.estado).toBe('espera')
    expect(a.resumen).toBeNull()
    t.empezar(a.id, 'x'); t.terminar(a.id, { resumen: resumir([]), cortada: false })
    t.limpiar()
    expect(t.items.map((i) => i.list.name)).toEqual(['Tres', 'Dos bis'])
    expect(t.sacar(c.id)).toBe(true)
  })
})

describe('el historial de lo bajado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-historial-'))
  const file = path.join(dir, 'historial.json')
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('anota cada lista: cuándo, cuántos llegaron, cuántos no, adónde fueron y cuáles faltan', () => {
    const t = new Tanda()
    const a = t.sumar(lista('Rock nacional'))
    t.empezar(a.id, 'C:/Música/NAPIA/Rock nacional')
    const tracks = [tema('Uno', 'bajado', { path: 'C:/Música/NAPIA/Rock nacional/A - Uno.mp3' }), tema('Dos', 'noEncontrado', { detail: 'Nadie lo tiene compartido.' }), tema('Tres', 'fallo'), tema('Cuatro', 'yaEstaba')]
    t.terminar(a.id, { resumen: resumir(tracks, 2), cortada: false })
    const e = entradaDe(a, tracks, '2026-10-22T18:00:00Z', '2026-10-22T18:07:00Z')!
    expect(e).toMatchObject({ lista: 'Rock nacional', carpeta: 'C:/Música/NAPIA/Rock nacional', total: 4, bajados: 1, yaEstaban: 1, yaEnPaila: 2, noEncontrados: 1, noSePudieron: 1, cortada: false })
    expect(e.faltan).toEqual([{ artist: 'A', title: 'Dos', estado: 'noEncontrado', detalle: 'Nadie lo tiene compartido.' }, { artist: 'A', title: 'Tres', estado: 'fallo', detalle: null }])
    expect(e.llegaron).toEqual([{ artist: 'A', title: 'Uno', path: 'C:/Música/NAPIA/Rock nacional/A - Uno.mp3' }])
    sumarAlHistorial(file, e)
    sumarAlHistorial(file, { ...e, id: 'otra', lista: 'Cumbia' })
    expect(leerHistorial(file).map((x) => x.lista)).toEqual(['Cumbia', 'Rock nacional']) // la más nueva primero
    expect(sacarDelHistorial(file, 'otra').map((x) => x.lista)).toEqual(['Rock nacional'])
  })

  it('una lista cortada antes de empezar no se anota; sin archivo, el historial está vacío', () => {
    const t = new Tanda()
    const a = t.sumar(lista('Nada'))
    t.empezar(a.id, 'x')
    t.terminar(a.id, { resumen: resumir([tema('T0', 'cancelado')]), cortada: true })
    expect(entradaDe(a, [tema('T0', 'cancelado')], 'a', 'b')).toBeNull()
    expect(leerHistorial(path.join(dir, 'no-existe.json'))).toEqual([])
  })

  it('todo ya estaba en PAILA: se anota igual (no se buscó nada)', () => {
    const t = new Tanda()
    const a = t.sumar(lista('Todo repetido'))
    t.empezar(a.id, 'x')
    t.terminar(a.id, { resumen: resumir([], 3), cortada: false })
    expect(entradaDe(a, [], 'a', 'b')).toMatchObject({ total: 0, yaEnPaila: 3 })
  })
})

describe('otra búsqueda para lo que no se encontró', () => {
  const v = (artist: string, title: string) => variantes({ artist, title })

  it('sin el "feat." (en el título o en el artista) y sin remasters, diciendo qué sacó', () => {
    const [limpia] = v('Daddy Yankee', 'Con Calma (feat. Snow)')
    expect(limpia).toMatchObject({ tipo: 'limpia', artist: 'Daddy Yankee', title: 'Con Calma', cambios: ['Sin «(feat. Snow)»'] })
    expect(v('Queen', 'Bohemian Rhapsody - Remastered 2011')[0]).toMatchObject({ title: 'Bohemian Rhapsody', cambios: ['Sin «- Remastered 2011»'] })
    expect(v('Emilia feat. TINI', 'La Original')[0]).toMatchObject({ artist: 'Emilia', title: 'La Original', cambios: ['Sin «feat. TINI» en el artista'] })
    expect(v('Kidd Keo', 'Touchdown feat. Aleman')[0]).toMatchObject({ title: 'Touchdown', cambios: ['Sin «feat. Aleman»'] })
    // "Original Mix" y "Album Version" no cambian el tema: se sacan
    expect(v('Stephan Bodzin', 'Powers of Ten (Original Mix)')[0]).toMatchObject({ title: 'Powers of Ten' })
  })

  it('solo título y artista principal: el primero de los artistas y sin lo que va entre paréntesis (la versión se queda)', () => {
    const vs = v('Bizarrap, Quevedo', 'Quevedo: Bzrp Music Sessions, Vol. 52')
    expect(vs).toEqual([expect.objectContaining({ tipo: 'principal', artist: 'Bizarrap', title: 'Quevedo: Bzrp Music Sessions, Vol. 52', cambios: ['Solo «Bizarrap» como artista (sin «Quevedo»)'] })])
    const p = v('Soda Stereo', 'Té para tres (Gira Me Verás Volver)').find((x) => x.tipo === 'principal')!
    expect(p).toMatchObject({ title: 'Té para tres' })
    // los dúos con "&" o "y" no se parten: son un solo nombre
    expect(v('Simon & Garfunkel', 'The Boxer')).toEqual([])
    expect(v('Wisin y Yandel', 'Rakata')).toEqual([])
  })

  it('la versión original si era un remix (y sin el remixador en el artista); no es la sugerida', () => {
    const vs = v('Chris Lake, Fisher', 'Losing It (Fisher Remix)')
    const o = vs.find((x) => x.tipo === 'original')!
    expect(o).toMatchObject({ artist: 'Chris Lake', title: 'Losing It' })
    expect(o.cambios[0]).toMatch(/Sin «\(Fisher Remix\)»: busca el tema original/)
    expect(o.cambios).toContain('Sin «Fisher» en el artista (es quien hizo la versión)')
    expect(sugerida(vs)?.tipo).toBe('principal') // la sugerida no cambia de versión: si era un remix, lo querías así
    expect(sugerida(vs)).toMatchObject({ artist: 'Chris Lake', title: 'Losing It (Fisher Remix)' })
    // en vivo también es otra versión
    expect(v('Charly García', 'Demoliendo hoteles - En Vivo')).toEqual([expect.objectContaining({ tipo: 'original', title: 'Demoliendo hoteles' })])
    // solo la original: no hay sugerida (se busca igual que antes, o la elegís)
    expect(sugerida(v('Charly García', 'Demoliendo hoteles - En Vivo'))).toBeNull()
  })

  it('no propone lo que da la misma búsqueda, ni repetidas, ni un título vacío', () => {
    expect(v('Virus', 'Wadu Wadu')).toEqual([])
    const vs = v('Daddy Yankee feat. Snow', 'Con Calma (feat. Snow) - Remastered 2019')
    expect(vs).toHaveLength(1)
    expect(vs[0]).toMatchObject({ artist: 'Daddy Yankee', title: 'Con Calma' })
    expect(vs[0].cambios).toEqual(['Sin «(feat. Snow)»', 'Sin «- Remastered 2019»', 'Sin «feat. Snow» en el artista'])
    expect(v('Alguien', '(Intro)')).toEqual([])
  })
})

describe('en inglés', () => {
  afterEach(() => ponerIdioma('es'))

  it('cambian las etiquetas y lo que dice qué cambió, pero la búsqueda que va a sockseek es la misma', () => {
    const v = (artist: string, title: string) => variantes({ artist, title })
    const es = v('Chris Lake, Fisher', 'Losing It (Fisher Remix)')
    ponerIdioma('en')
    const en = v('Chris Lake, Fisher', 'Losing It (Fisher Remix)')
    expect(en.map(({ tipo, artist, title }) => ({ tipo, artist, title }))).toEqual(es.map(({ tipo, artist, title }) => ({ tipo, artist, title })))
    const o = en.find((x) => x.tipo === 'original')!
    expect(o.etiqueta).toBe('The original version')
    expect(o.cambios).toContain('Without «Fisher» in the artist (they made that version)')
  })

  it('el motivo de una tanda frenada sale en el idioma de ese momento', () => {
    ponerIdioma('en')
    const t = new Tanda()
    const a = t.sumar(lista('Uno'))
    t.empezar(a.id, 'C:/Música/NAPIA/Uno')
    t.terminar(a.id, { resumen: resumir([]), cortada: true })
    expect(t.frenada?.motivo).toBe('You stopped the download.')
  })

  it('los avisos de sockseek se reconocen igual (sus patrones son en inglés) y se explican en inglés', () => {
    ponerIdioma('en')
    expect(problemOf('Login failed: missing username')).toEqual({ kind: 'sinCuenta', text: 'Your Soulseek account is missing from sockseek\'s settings.' })
    const p = new Progress([{ artist: 'A', title: 'Uno' }])
    p.stdout(JSON.stringify({ type: 'track_state', data: { artist: 'A', title: 'Uno', terminalOutcome: 'Failed', failureReason: 'NoSearchResults' } }))
    expect(p.tracks[0]).toMatchObject({ state: 'noEncontrado', detail: 'Nobody is sharing it (or it has another name).' })
  })
})
