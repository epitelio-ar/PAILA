// Tests de lo que NAPIA baja para reemplazar una copia que ya tenés (la lista «Faltan o suenan mal» de PAILA, "Bajar con NAPIA"):
// la nota de tu copia viaja en el CSV, no se saltea aunque la tengas, y lo que baja sirve solo si es claramente mejor (mejor
// nota, o la misma con más calidad real y entera; sin huecos si la tuya no los tiene; sin saturar más ni durar distinto: la vara de
// la Bandeja, core/better.ts). Si no aparece una mejor: "No se encontró una copia mejor que la tuya".
// Decidido con el autor el 24/10 (docs/DECISIONES.md).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { esMejor, revisarArchivo } from '@paila/core/sockseek/calidad'
import { DESCARTADOS } from '@paila/core/sockseek/carpetas'
import { napiaCsv, sockseekCsv } from '@paila/core/listexport'
import { parseCsv } from '@paila/core/listparse'
import { saltearTenes } from '@paila/core/sockseek/yatenes'
import { listRows } from '@paila/core/sockseek/args'
import { entradaDe, resumir, Tanda } from '@paila/core/sockseek/tanda'
import type { LibTrack } from '@paila/core/listmatch'
import { verify } from '@paila/core/inboxflow'
import type { CandidateInfo } from '@paila/core/replace'
import { bajarLista, deps, hacerAudios } from './fixtures/napia-lista'

let dir: string
let a: (n: string) => string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-reemplazo-'))
  a = hacerAudios(dir)
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const tuya = (nota: string, kbps: number | null, que: string | null = null) => ({ nota, kbps, que })

describe('¿es mejor que la tuya? (la misma vara que la Bandeja)', () => {
  type Nota = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
  const r = (nota: Nota, effKbps: number, o: { marcas?: string[]; recortes?: number; lufs?: number | null; duracion?: number | null } = {}) =>
    ({ nota, effKbps, marcas: o.marcas ?? [], recortes: o.recortes ?? 0, lufs: o.lufs ?? -9, duracion: o.duracion ?? 200 })
  const tu = (nota: string, kbps: number | null, o: { marcas?: string[]; recortes?: number; lufs?: number; duracion?: number } = {}) =>
    ({ ...tuya(nota, kbps), marcas: o.marcas ?? [], recortes: o.recortes ?? 0, lufs: o.lufs ?? -9, duracion: o.duracion ?? 200 })

  it('sí con mejor nota; con la misma, solo con más calidad real y entera', () => {
    expect(esMejor(r('A', 1411), tu('B', 320))).toBe(true) // mejor nota
    expect(esMejor(r('B', 320), tu('D', 128))).toBe(true)
    expect(esMejor(r('A+', 2304), tu('A', 1411))).toBe(true)
    expect(esMejor(r('B', 320), tu('B', 320))).toBe(false) // lo mismo que tenés
    expect(esMejor(r('B', 1411), tu('B', 320))).toBe(true) // misma nota, más calidad real (un FLAC «como fue grabado» contra un MP3 de 320)
    expect(esMejor(r('C', 256), tu('C', 192))).toBe(true)
    expect(esMejor(r('A', 1411), tu('A', 1411))).toBe(false)
    expect(esMejor(r('B', 320), tu('A', 1411))).toBe(false) // peor
    expect(esMejor(r('B', 320), tu('B', null))).toBe(false) // misma nota y no se sabe cuánto rinde la tuya: no es «claramente» mejor
    expect(esMejor(r('D', 128), tu('?', null))).toBe(true) // tu copia sin nota: sirve cualquiera que pase la revisión
  })

  it('una con huecos no reemplaza a una limpia, ni una que satura más, ni una que dura distinto', () => {
    expect(esMejor(r('A', 1411, { marcas: ['gaps'] }), tu('C', 192))).toBe(false) // mejor nota, pero con huecos y la tuya está limpia
    expect(esMejor(r('A', 1411, { marcas: ['gaps'] }), tu('C', 192, { marcas: ['gaps'] }))).toBe(true) // la tuya también tiene huecos
    expect(esMejor(r('B', 1411, { marcas: ['gaps'] }), tu('B', 320, { marcas: ['gaps'] }))).toBe(false) // misma nota: tiene que estar entera
    expect(esMejor(r('A', 1411, { recortes: 300, lufs: -6 }), tu('B', 320, { recortes: 10, lufs: -9 }))).toBe(false) // otro master, más aplastado
    expect(esMejor(r('A', 1411, { recortes: 300, lufs: -8.5 }), tu('B', 320, { recortes: 10, lufs: -9 }))).toBe(true) // mismo volumen: no cuenta
    expect(esMejor(r('A', 1411, { duracion: 215 }), tu('B', 320, { duracion: 200 }))).toBe(false) // otra versión o cortada
    expect(esMejor(r('A', 1411, { duracion: 201.5 }), tu('B', 320, { duracion: 200 }))).toBe(true)
  })

  it('dice lo mismo que la Bandeja de PAILA con los mismos datos (así NAPIA no trae algo que la Bandeja después rechaza)', () => {
    const casos: [ReturnType<typeof r>, ReturnType<typeof tu>][] = [
      [r('A', 1411), tu('B', 320)], [r('B', 320), tu('B', 320)], [r('B', 1411), tu('B', 320)], [r('B', 320), tu('A', 1411)],
      [r('A', 1411, { marcas: ['gaps'] }), tu('C', 192)], [r('B', 1411, { marcas: ['gaps'] }), tu('B', 320, { marcas: ['gaps'] })],
      [r('A', 1411, { recortes: 300, lufs: -6 }), tu('B', 320, { recortes: 10, lufs: -9 })], [r('A', 1411, { duracion: 215 }), tu('B', 320)],
    ]
    for (const [nueva, mia] of casos) {
      const cand = { path: 'x', ext: 'flac', codec: 'flac', kbps: nueva.effKbps, sampleRate: 44100, bits: 16, duration: nueva.duracion, size: 1, grade: nueva.nota, label: 'x', says: '', why: [],
        lufs: nueva.lufs, cutoff: null, flags: nueva.marcas, clipEvents: nueva.recortes, effKbps: nueva.effKbps, spectrum: [], artist: null, title: null, album: null } satisfies CandidateInfo
      const bandeja = verify({ grade: mia.nota, duration: mia.duracion, clipEvents: mia.recortes, lufs: mia.lufs, flags: mia.marcas.join(','), effKbps: mia.kbps }, cand).ok
      expect([nueva, mia, esMejor(nueva, mia)]).toEqual([nueva, mia, bandeja])
    }
  })

  it('con archivos de verdad: un FLAC real reemplaza a un MP3 de 320; otro 320 no', async () => {
    const m320 = await revisarArchivo(a('m320.mp3'), 'buena', deps)
    const flac = await revisarArchivo(a('real.flac'), 'buena', deps)
    expect(esMejor(flac, tu('B', 320, { duracion: 30 }))).toBe(true)
    expect(esMejor(m320, tu('B', 320, { duracion: 30 }))).toBe(false)
    expect(esMejor(m320, tu('D', 128, { duracion: 30 }))).toBe(true)
    expect(m320.duracion).toBeCloseTo(30, 0)
  }, 120_000)

  it('misma nota con más calidad real pero con tropiezos al leerlo: ni NAPIA ni la Bandeja la toman (los tropiezos dejan la marca de huecos)', async () => {
    const trop = await revisarArchivo(a('tropiezos.mp3'), 'buena', deps)
    expect(trop).toMatchObject({ nota: 'B', motivo: null }) // no es trucho: 2 tropiezos no llegan a «Dañado»
    expect(trop.marcas).toContain('gaps')
    const mia = tu('B', 256, { duracion: 30 }) // la tuya: un MP3 de 256 limpio
    const limpia = await revisarArchivo(a('m320.mp3'), 'buena', deps) // la misma nota, más calidad real y entera: esa sí
    const cand = (r: typeof trop) => ({ path: 'x', ext: 'mp3', codec: 'mp3', kbps: 320, sampleRate: 44100, bits: null, duration: r.duracion, size: 1, grade: r.nota, label: 'x', says: '', why: [],
      lufs: r.lufs, cutoff: null, flags: r.marcas, clipEvents: r.recortes, effKbps: r.effKbps, spectrum: [], artist: null, title: null, album: null }) satisfies CandidateInfo
    const vieja = { grade: mia.nota, duration: mia.duracion, clipEvents: mia.recortes, lufs: mia.lufs, flags: '', effKbps: mia.kbps }
    expect([esMejor(trop, mia), verify(vieja, cand(trop)).ok]).toEqual([false, false])
    expect([esMejor(limpia, mia), verify(vieja, cand(limpia)).ok]).toEqual([true, true])
  }, 120_000)
})

describe('la copia tuya viaja de PAILA a NAPIA', () => {
  it('el CSV para NAPIA lleva la nota de tu copia y se vuelve a leer igual; sin copias, es el de sockseek', () => {
    const items = [
      { artist: 'Soda Stereo', title: 'Persiana Americana', album: 'Signos', duration: 287, tuya: { ...tuya('D', 128, 'MP3 128 kbps · nota D'), marcas: ['gaps', 'low_bitrate'], recortes: 42, lufs: -7.5, id: 31 } },
      { artist: 'Virus', title: 'Wadu Wadu', album: null, duration: null, tuya: null }, // te falta: no hay copia
      { artist: 'Daft Punk', title: 'Veridis Quo', album: null, duration: 345, tuya: tuya('A+', 2304) },
    ]
    const csv = napiaCsv(items)
    expect(csv.split('\r\n')[0]).toBe('Artist,Title,Album,Length,Your Grade,Your Kbps,Your Quality,Your Flags,Your Clips,Your LUFS,Your PAILA Id')
    const leido = parseCsv(csv).entries
    expect(leido.map((e) => e.tengo ?? null)).toEqual([
      { ...tuya('D', 128, 'MP3 128 kbps · nota D'), marcas: ['gaps', 'low_bitrate'], recortes: 42, lufs: -7.5, duracion: 287, id: 31 }, null,
      { ...tuya('A+', 2304), marcas: [], recortes: null, lufs: null, duracion: 345, id: null },
    ])
    expect(leido[0]).toMatchObject({ artist: 'Soda Stereo', title: 'Persiana Americana', album: 'Signos', duration: 287 })
    // sin nada que reemplazar sale el CSV de sockseek de siempre, y un CSV cualquiera no trae copias
    expect(napiaCsv(items.map((i) => ({ ...i, tuya: null })))).toBe(sockseekCsv(items))
    // la lee el mismo lector de siempre: el resto del CSV no cambia
    expect(leido[2]).toMatchObject({ artist: 'Daft Punk', title: 'Veridis Quo', duration: 345 })
    expect(parseCsv(sockseekCsv(items)).entries.every((e) => e.tengo === undefined)).toBe(true)
  })

  it('"Saltear lo que ya tenés" no saltea lo que viene a reemplazarse (lo tenés, pero se busca uno mejor)', () => {
    const lib = [{ id: 1, rel: 'Rock/Soda Stereo - Persiana Americana.mp3', ext: 'mp3', artist: 'Soda Stereo', title: 'Persiana Americana', duration: 287, grade: 'D', flags: null, isrc: null }] as unknown as LibTrack[]
    const tema = { artist: 'Soda Stereo', title: 'Persiana Americana', album: null, duration: 287 }
    // la tuya es una D: aunque no venga de la lista «Faltan o suenan mal», se baja para reemplazarla (uso real, 24/10)
    expect(saltearTenes([tema], lib)).toMatchObject({ tenes: [], mejorar: [{ title: 'Persiana Americana', nota: 'D' }] })
    expect(saltearTenes([tema], [{ ...lib[0], grade: 'A' }]).tenes).toHaveLength(1)
    const r = saltearTenes([{ ...tema, reemplaza: tuya('D', 128) }], lib)
    expect(r.tenes).toHaveLength(0)
    expect(r.faltan[0].reemplaza).toEqual(tuya('D', 128))
    // y la copia tuya sigue hasta las filas que se le pasan a sockseek (sin el remaster en el título)
    expect(listRows([{ ...tema, title: 'Persiana Americana - 2007 Remaster', reemplaza: tuya('D', 128) }], { sacarRemaster: true, primeros: null })[0]).toMatchObject({ title: 'Persiana Americana', reemplaza: tuya('D', 128) })
  })
})

describe('una lista con temas para reemplazar', () => {
  it('se queda solo con una copia claramente mejor; si no aparece: "No se encontró una copia mejor que la tuya"', async () => {
    const r = await bajarLista(path.join(dir, 'lista'), 'buena', {
      Cinco: [['jose', a('m320.mp3')], ['kiko', a('real.flac')]], // tenés un B de 320: el primero (otro 320) no es mejor; el FLAC sí
      Seis: [['lalo', a('real.flac')]], // tenés un A: el FLAC es igual, y nadie más lo tiene
      Siete: [['mora', a('m320.mp3')]], // tenés un D: el 320 ya es mejor
      Ocho: [['nico', a('m320.mp3')]], // no venía a reemplazar nada: un 320 bueno alcanza
    }, { tuyas: { Cinco: tuya('B', 320, 'MP3 320 kbps · nota B'), Seis: tuya('A', 1411, 'FLAC · nota A'), Siete: tuya('D', 128, 'MP3 128 kbps · nota D') } })
    const cinco = r.porTitulo('Cinco'), seis = r.porTitulo('Seis'), siete = r.porTitulo('Siete'), ocho = r.porTitulo('Ocho')
    expect(cinco.calidad).toMatchObject({ estado: 'reemplazado', nota: 'A', descartadas: 1, intentos: 1, motivo: 'noEsMejor' }) // el motivo es el de la copia descartada
    expect(cinco.fuente).toBe('kiko')
    expect(path.dirname(cinco.path!)).toBe(r.carpeta)
    expect(seis.calidad).toMatchObject({ estado: 'sinMejor', motivo: 'noEsMejor', descartadas: 1, tuya: tuya('A', 1411, 'FLAC · nota A') })
    expect(siete.calidad).toMatchObject({ estado: 'buena', nota: 'B', descartadas: 0 })
    expect(ocho.calidad).toMatchObject({ estado: 'buena', nota: 'B', tuya: null })
    // lo que no era mejor quedó en descartados (no se borra nada)
    expect(fs.readdirSync(path.join(r.carpeta, DESCARTADOS))).toHaveLength(2)
    expect(r.vetadosPorRonda[0].sort()).toEqual(['jose', 'lalo'])
    // la cuenta, el resumen y el historial: lo que no consiguió una mejor va con lo que falta, con su motivo
    expect(r.control.cuenta()).toMatchObject({ descartados: 2, reemplazados: 1, soloFalsa: 0, sinMejor: 1 })
    const resumen = resumir(r.tracks)
    expect(resumen).toMatchObject({ total: 4, bajados: 3, descartados: 2, reemplazados: 1, soloFalsa: 0, sinMejor: 1 })
    const tanda = new Tanda()
    const it = tanda.sumar({ name: 'Lista', source: 'x', tracks: [], skipped: [] })
    tanda.empezar(it.id, r.carpeta)
    tanda.terminar(it.id, { resumen, cortada: false })
    const e = entradaDe(it, r.tracks, new Date().toISOString(), new Date().toISOString())!
    expect(e.faltan).toEqual([{ artist: 'A', title: 'Seis', estado: 'sinMejor', detalle: 'No se encontró una copia mejor que la tuya.' }])
    expect(e).toMatchObject({ bajados: 3, sinMejor: 1, soloFalsa: 0 })
  }, 180_000)

  it('un trucho que viene a reemplazar tu copia también termina en "sin una mejor", no en "solo trucho"', async () => {
    const r = await bajarLista(path.join(dir, 'trucho'), 'buena', { Nueve: [['oli', a('inflado.mp3')]] }, { tuyas: { Nueve: tuya('D', 128) } })
    expect(r.porTitulo('Nueve').calidad).toMatchObject({ estado: 'sinMejor', motivo: 'inflado', descartadas: 1 })
    expect(r.control.cuenta()).toMatchObject({ sinMejor: 1, soloFalsa: 0 })
  }, 120_000)
})
