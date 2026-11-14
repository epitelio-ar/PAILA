// Tests de la muestra de NAPIA (core/sockseek/muestra.ts): un pedazo de lo que baja, revisado mientras baja. Qué se cree del
// pedazo (solo lo claro del espectro), cuándo alcanza, dónde está, y una lista con el sockseek de mentira: una fuente trucha que
// tarda muchísimo se corta apenas el pedazo suena trucho, sin esperar a que termine ni a que se note lenta.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LENTITUD } from '@paila/core/sockseek/lentitud'
import { aMedias, alcanza, sacarMuestra, truchaEn } from '@paila/core/sockseek/muestra'
import { revisarArchivo } from '@paila/core/sockseek/calidad'
import type { TrackProgress } from '@paila/shared/napia'
import { bajarLista, deps, ffmpeg, hacerAudios } from './fixtures/napia-lista'

let dir: string
let a: (n: string) => string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-muestra-'))
  a = hacerAudios(dir)
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const MB = 1024 * 1024
const bajando = (bytes: number, total: number): TrackProgress => ({ artist: 'A', title: 'T', state: 'bajando', percent: null, detail: null, path: null, format: 'mp3', fuente: 'ana', archivo: 'T.mp3', bytes, total })

describe('qué se cree de un pedazo', () => {
  const r = (marcas: string[]) => ({ marcas, nota: 'F', es: 'algo' })
  it('solo lo claro del espectro: inflado, o sin pérdida falso en un FLAC', () => {
    expect(truchaEn(r(['upscaled']), 'mp3')).toMatchObject({ motivo: 'inflado', nota: 'F' })
    expect(truchaEn(r(['fake_lossless']), 'flac')).toMatchObject({ motivo: 'sinPerdidaFalso' })
    expect(truchaEn(r(['fake_lossless']), 'mp3')).toBeNull()
    // no: la duda, el daño (cortado a la mitad tropieza) ni una nota baja sola
    expect(truchaEn(r(['maybe_transcoded']), 'flac')).toBeNull()
    expect(truchaEn(r(['damaged']), 'mp3')).toBeNull()
    expect(truchaEn(r([]), 'mp3')).toBeNull()
  })

  it('alcanza con un 30 % y por lo menos 1 MB', () => {
    expect(alcanza(bajando(3 * MB, 10 * MB))).toBe(true)
    expect(alcanza(bajando(2 * MB, 10 * MB))).toBe(false)
    expect(alcanza(bajando(0.5 * MB, 1.5 * MB))).toBe(false)
    expect(alcanza({ ...bajando(3 * MB, 10 * MB), state: 'bajado' })).toBe(false)
    expect(alcanza({ ...bajando(3 * MB, 10 * MB), archivo: null })).toBe(false)
  })

  it('el pedazo: con el nombre de allá, con los signos que Windows no deja, o parecido', () => {
    const c = path.join(dir, 'pedazos')
    fs.mkdirSync(c, { recursive: true })
    fs.writeFileSync(path.join(c, '01-el_bordo-posesivo.flac.incomplete'), 'x')
    fs.writeFileSync(path.join(c, 'Que_ Tema.mp3.incomplete'), 'x')
    fs.writeFileSync(path.join(c, 'Otro (Mix).mp3.incomplete'), 'x')
    // como lo manda sockseek: la carpeta de allá con barras de Windows
    const alla = (...p: string[]) => p.join('\\')
    expect(aMedias(c, alla('Musica', 'El Bordo', '01-el_bordo-posesivo.flac'))).toBe(path.join(c, '01-el_bordo-posesivo.flac.incomplete'))
    expect(aMedias(c, alla('Musica', 'Que: Tema.mp3'))).toBe(path.join(c, 'Que_ Tema.mp3.incomplete'))
    expect(aMedias(c, alla('x', 'Otro [Mix].mp3'))).toBe(path.join(c, 'Otro (Mix).mp3.incomplete'))
    expect(aMedias(c, alla('x', 'No está.mp3'))).toBeNull()
  })

  it('un pedazo de verdad (la primera mitad del archivo) dice lo mismo que el archivo entero', async () => {
    const c = path.join(dir, 'mitades')
    fs.mkdirSync(c, { recursive: true })
    const veredicto = async (n: string) => {
      const b = fs.readFileSync(a(n)), inc = path.join(c, `${n}.incomplete`)
      fs.writeFileSync(inc, b.subarray(0, Math.floor(b.length * 0.4)))
      const ext = path.extname(n).slice(1)
      const m = await sacarMuestra(ffmpeg, inc, ext, path.join(dir, 'tmp'))
      expect(m).not.toBeNull()
      const r = await revisarArchivo(m!, 'buena', deps)
      fs.rmSync(m!)
      return truchaEn(r, ext)?.motivo ?? null
    }
    expect(await veredicto('inflado.mp3')).toBe('inflado')
    expect(await veredicto('falso.flac')).toBe('sinPerdidaFalso')
    expect(await veredicto('m320.mp3')).toBeNull()
    expect(await veredicto('real.flac')).toBeNull()
  }, 60_000)
})

describe('una lista con una fuente trucha que tarda muchísimo', () => {
  it('se corta apenas el pedazo suena trucho y el tema llega de otro usuario', async () => {
    const t0 = Date.now()
    // con los tiempos de verdad: la fuente lenta recién se juzgaría al minuto; acá la corta la muestra
    const r = await bajarLista(path.join(dir, 'lista'), 'buena', {
      Uno: [['ana', a('inflado.mp3'), 'lenta'], ['beto', a('m320.mp3')]],
      Dos: [['caro', a('m320.mp3')]],
    }, { jobs: 2, lentitud: { ...LENTITUD, cada: 200 }, muestra: true })
    expect(r.cortes).toHaveLength(1)
    expect(r.cortes[0].muestra).toEqual(['Uno'])
    expect(r.porTitulo('Uno')).toMatchObject({ state: 'bajado', fuente: 'beto' })
    expect(r.porTitulo('Uno').calidad).toMatchObject({ estado: 'reemplazado', enMuestra: 1, descartadas: 0, intentos: 1, muestra: false, nota: 'B' })
    expect(r.porTitulo('Dos').calidad).toMatchObject({ estado: 'buena' })
    expect(r.vetadosPorRonda).toEqual([['ana']])
    expect(Date.now() - t0).toBeLessThan(40_000)
  }, 90_000)

  it('si solo aparece trucho, termina como "solo se encontró trucho" (para buscarlo de otra forma)', async () => {
    const r = await bajarLista(path.join(dir, 'solo'), 'buena', { Uno: [['ana', a('inflado.mp3'), 'lenta']] }, { lentitud: { ...LENTITUD, cada: 200 }, muestra: true })
    expect(r.porTitulo('Uno')).toMatchObject({ state: 'fallo', calidad: null })
    expect(r.porTitulo('Uno').detail).toMatch(/trucho/)
  }, 90_000)
})
