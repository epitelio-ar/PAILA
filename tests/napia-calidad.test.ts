// Tests de la calidad real en NAPIA (core/sockseek/calidad.ts y control.ts): qué es trucho según lo pedido, el análisis de
// archivos de verdad (hechos con ffmpeg y, si está, los del laboratorio), apartar a "descartados", buscar otra fuente sin los
// usuarios que lo compartían trucho (con el sockseek de mentira y archivos de audio reales), el resumen y el historial. Lo que
// viene a reemplazar una copia tuya: tests/napia-reemplazo.test.ts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { juzgar, revisarArchivo } from '@paila/core/sockseek/calidad'
import { ControlCalidad } from '@paila/core/sockseek/control'
import { DESCARTADOS, corregirIndice } from '@paila/core/sockseek/carpetas'
import { buildArgs } from '@paila/core/sockseek/args'
import { entradaDe, resumir, Tanda } from '@paila/core/sockseek/tanda'
import { watchable } from '@paila/core/inboxwatch'
import type { Calidad, TrackProgress } from '@paila/shared/napia'
import { OPCIONES, bajarLista, deps, hacerAudios } from './fixtures/napia-lista'

let dir: string
let a: (n: string) => string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-calidad-'))
  a = hacerAudios(dir)
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('qué es trucho', () => {
  it('lo que miente es trucho con cualquier calidad pedida; la nota baja, solo si se pidió calidad', () => {
    for (const c of ['cualquiera', 'buena', 'sinperdida'] as Calidad[]) {
      expect(juzgar(c, { grade: 'F', flags: ['upscaled'] }, false)).toBe('inflado')
      expect(juzgar(c, { grade: 'F', flags: ['fake_lossless'] }, true)).toBe('sinPerdidaFalso')
      expect(juzgar(c, { grade: 'F', flags: ['damaged'] }, true)).toBe('danado')
    }
    // un FLAC que viene de un MP3 de 256: suena bien, pero no es lo que dice
    expect(juzgar('buena', { grade: 'D', flags: ['maybe_transcoded'] }, true)).toBe('sinPerdidaFalso')
    // un MP3 de 128 honesto: con "cualquiera" sirve; con "320 o sin pérdida", es mucho peor que lo pedido
    expect(juzgar('cualquiera', { grade: 'D', flags: ['low_bitrate'] }, false)).toBeNull()
    expect(juzgar('buena', { grade: 'D', flags: ['low_bitrate'] }, false)).toBe('peorQuePedido')
    expect(juzgar('buena', { grade: 'C', flags: [] }, false)).toBeNull()
    // "solo sin pérdida": un MP3 (aunque sea un 320 real) no es lo pedido; un sin pérdida "como fue grabado" (B) sí
    expect(juzgar('sinperdida', { grade: 'B', flags: [] }, false)).toBe('peorQuePedido')
    expect(juzgar('sinperdida', { grade: 'B', flags: ['as_recorded'] }, true)).toBeNull()
    expect(juzgar('sinperdida', { grade: 'B', flags: ['cut20', 'cut20_mp3like'] }, true)).toBeNull()
    expect(juzgar('sinperdida', { grade: 'C', flags: ['low_samplerate'] }, true)).toBe('peorQuePedido')
  })

  it('analiza archivos de verdad: el inflado, el FLAC falso y los buenos', async () => {
    expect((await revisarArchivo(a('inflado.mp3'), 'buena', deps)).motivo).toBe('inflado')
    expect((await revisarArchivo(a('inflado.mp3'), 'cualquiera', deps)).motivo).toBe('inflado')
    const falso = await revisarArchivo(a('falso.flac'), 'sinperdida', deps)
    expect(falso).toMatchObject({ nota: 'F', motivo: 'sinPerdidaFalso' })
    expect(falso.dice).toMatch(/FLAC/)
    expect((await revisarArchivo(a('real.flac'), 'sinperdida', deps))).toMatchObject({ nota: 'A', motivo: null })
    expect((await revisarArchivo(a('m320.mp3'), 'buena', deps))).toMatchObject({ nota: 'B', motivo: null })
    expect((await revisarArchivo(a('m128.mp3'), 'buena', deps)).motivo).toBe('peorQuePedido')
    expect((await revisarArchivo(a('m128.mp3'), 'cualquiera', deps)).motivo).toBeNull()
  }, 120_000)

  it('un par de tropiezos al leerlo no es "dañado" (PAILA cuenta tropiezos desde el 24/10); un archivo roto de verdad, sí', async () => {
    const pocos = await revisarArchivo(a('tropiezos.mp3'), 'buena', deps)
    expect(pocos).toMatchObject({ nota: 'B', motivo: null })
    expect((await revisarArchivo(a('roto.mp3'), 'buena', deps)).motivo).toBe('danado')
    expect((await revisarArchivo(a('roto.mp3'), 'cualquiera', deps)).motivo).toBe('danado')
  }, 120_000)
})

// Los del laboratorio de archivos difíciles (npm run corpus), si están en esta compu: MP3 inflados y "sin pérdida" falsos reales.
const LAB = process.env.PAILA_CORPUS || 'C:\\PAILA-laboratorio'
const CASOS: [string, Calidad, string | null][] = [
  ['NO_VOCALS_130BPM_CMajor_DEM4_charly_garc_a___yo_ya_s___official_visualizer_.mp3', 'buena', 'inflado'], // dice 320, suena a menos
  ['DISCO CUMPLE/DISCOROCK/DISCOROCK 2/11. Alphaville - Big In Japan.flac', 'sinperdida', 'sinPerdidaFalso'], // FLAC de un MP3
  ['FIESTA AMIGOS vol2/FIESTA AMIGOS 2024/Tan Bionica - Ella.wav', 'buena', 'sinPerdidaFalso'], // WAV bajado de YouTube
  ['DISCO CUMPLE/HOUSE8090/08 - Cerrone - Supernature.flac', 'sinperdida', 'sinPerdidaFalso'], // FLAC de 32 kHz, de un juego
  ['Musica para acomodar/09 - Hold the Line.flac', 'sinperdida', null], // rip de CD: B
  ['Clics modernos/09. Ojos de video tape.flac', 'sinperdida', null], // master viejo, corte suave: B
  ['DISCO CUMPLE/Variete/VARIETE/The Police - Roxanne.flac', 'sinperdida', null], // corta en 20,4 kHz: B
]
const hayLab = CASOS.every(([f]) => fs.existsSync(path.join(LAB, f)))

describe.skipIf(!hayLab)('con los archivos del laboratorio', () => {
  for (const [f, calidad, motivo] of CASOS) {
    it(`${path.basename(f)} → ${motivo ?? 'sirve'}`, async () => {
      expect((await revisarArchivo(path.join(LAB, f), calidad, deps)).motivo).toBe(motivo)
    }, 120_000)
  }
})

describe('el control de calidad de una lista', () => {
  it('aparta lo trucho, busca otra fuente sin esos usuarios y deja anotado lo que solo estaba trucho', async () => {
    const r = await bajarLista(path.join(dir, 'lista'), 'buena', {
      Uno: [['ana', a('inflado.mp3')], ['beto', a('m320.mp3')]], // trucho, y otra fuente buena
      Dos: [['caro', a('m320.mp3')]], // bueno de entrada
      Tres: [['dani', a('inflado.mp3')], ['eli', a('inflado.mp3')], ['fede', a('inflado.mp3')], ['gabi', a('inflado.mp3')]], // trucho en todos lados
      Cuatro: [['hugo', a('falso.flac')]], // FLAC falso y nadie más lo tiene
    })
    const uno = r.porTitulo('Uno'), dos = r.porTitulo('Dos'), tres = r.porTitulo('Tres'), cuatro = r.porTitulo('Cuatro')
    expect(uno.calidad).toMatchObject({ estado: 'reemplazado', descartadas: 1, intentos: 1, nota: 'B' })
    expect(uno.fuente).toBe('beto')
    expect(path.dirname(uno.path!)).toBe(r.carpeta)
    expect(dos.calidad).toMatchObject({ estado: 'buena', descartadas: 0, intentos: 0 })
    expect(path.dirname(dos.path!)).toBe(r.carpeta)
    // hasta 3 fuentes más: las 4 copias truchas quedan en descartados
    expect(tres.calidad).toMatchObject({ estado: 'soloFalsa', descartadas: 4, intentos: 3, motivo: 'inflado' })
    expect(cuatro.calidad).toMatchObject({ estado: 'soloFalsa', descartadas: 1, motivo: 'sinPerdidaFalso' })
    // los vetados de cada vuelta: los que dieron copias truchas de lo que se vuelve a buscar
    expect(r.vetadosPorRonda[0].sort()).toEqual(['ana', 'dani', 'hugo'])
    expect(r.vetadosPorRonda[1]).toEqual(['dani', 'eli'])
    expect(r.vetadosPorRonda).toHaveLength(3)
    // nada se borró: en la carpeta, lo bueno; en descartados, cada copia trucha
    const descartados = fs.readdirSync(path.join(r.carpeta, DESCARTADOS))
    expect(descartados).toHaveLength(6)
    expect(fs.readdirSync(r.carpeta).filter((f) => f !== DESCARTADOS)).toHaveLength(2)
    expect(fs.readdirSync(r.trabajo.trabajo, { recursive: true }).filter((f) => /\.(mp3|flac)$/.test(String(f)))).toHaveLength(0)
    // la Bandeja de PAILA no mira lo descartado
    expect(watchable(r.destino, path.join(r.carpeta, DESCARTADOS, descartados[0]))).toBe(false)
    expect(watchable(r.destino, uno.path!)).toBe(true)
    // la cuenta, el resumen y el historial
    expect(r.control.cuenta()).toMatchObject({ activa: true, revisando: 0, descartados: 3, reemplazados: 1, soloFalsa: 2, buscandoOtra: false })
    const resumen = resumir(r.tracks)
    expect(resumen).toMatchObject({ total: 4, bajados: 2, descartados: 3, reemplazados: 1, soloFalsa: 2 })
    const tanda = new Tanda()
    const it = tanda.sumar({ name: 'Lista', source: 'x', tracks: [], skipped: [] })
    tanda.empezar(it.id, r.carpeta)
    tanda.terminar(it.id, { resumen, cortada: false })
    const e = entradaDe(it, r.tracks, new Date().toISOString(), new Date().toISOString())!
    expect(e).toMatchObject({ bajados: 2, descartados: 3, reemplazados: 1, soloFalsa: 2 })
    expect(e.llegaron.map((x) => x.title).sort()).toEqual(['Dos', 'Uno'])
    expect(e.faltan.map((x) => [x.title, x.estado]).sort()).toEqual([['Cuatro', 'soloFalsa'], ['Tres', 'soloFalsa']])
    // el índice de sockseek apunta a la copia buena (la próxima vez saltea Uno); lo que solo estaba trucho, a ninguna que exista
    const indice = fs.readFileSync(r.trabajo.indice, 'utf8')
    expect(indice).toContain(uno.path!.replace(/\\/g, '/'))
  }, 180_000)

  it('sin ffmpeg (sin revisión) todo pasa directo, como antes', async () => {
    const r = await bajarLista(path.join(dir, 'sin-revision'), 'buena', { Uno: [['ana', a('inflado.mp3')]] }, { revisar: false })
    expect(r.porTitulo('Uno').calidad ?? null).toBeNull()
    expect(path.dirname(r.porTitulo('Uno').path!)).toBe(r.carpeta)
    expect(r.control.cuenta()).toMatchObject({ activa: false, descartados: 0 })
    expect(r.vetadosPorRonda).toHaveLength(0)
  }, 60_000)
})

describe('el reparto con revisión', () => {
  it('no pasa nada a la carpeta hasta que la revisión dice que sirve; también lo que quedó en trabajo de otra vez', async () => {
    const base = path.join(dir, 'reparto')
    const trabajo = path.join(base, 'trabajo'), carpeta = path.join(base, 'Lista')
    fs.mkdirSync(path.join(trabajo, 'Lista'), { recursive: true })
    const f1 = path.join(trabajo, 'Lista', 'a.mp3'), f2 = path.join(trabajo, 'Lista', 'b.mp3')
    fs.copyFileSync(a('m320.mp3'), f1); fs.copyFileSync(a('inflado.mp3'), f2)
    let suelta: () => void = () => {}
    const espera = new Promise<void>((r) => { suelta = r })
    const control = new ControlCalidad({ trabajo, carpeta, calidad: 'buena', revisar: async (f, c) => { await espera; return revisarArchivo(f, c, deps) } })
    const t1: TrackProgress = { artist: 'A', title: 'a', state: 'bajado', percent: 100, detail: null, path: f1, format: 'mp3', fuente: 'x' }
    // "ya estaba" en la carpeta de trabajo: NAPIA se cerró antes de moverlo la vez anterior
    const t2: TrackProgress = { artist: 'A', title: 'b', state: 'yaEstaba', percent: null, detail: null, path: f2, format: null }
    control.ver([t1, t2])
    expect(t1.calidad?.estado).toBe('revisando')
    expect(fs.existsSync(f1) && fs.existsSync(f2)).toBe(true)
    expect(control.cuenta().revisando).toBe(2)
    suelta()
    await control.vacio()
    expect(path.dirname(t1.path!)).toBe(carpeta)
    expect(path.dirname(t2.path!)).toBe(path.join(carpeta, DESCARTADOS))
    expect(t2.calidad?.estado).toBe('trucho')
    const movidos = control.reparto.movidos
    expect(movidos.get(f1)).toBe(t1.path)
    expect(movidos.has(f2)).toBe(false) // lo trucho no va al índice: la próxima vez se vuelve a buscar
    expect(corregirIndice(path.join(base, 'no-hay.csv'), movidos)).toBe(0)
  }, 60_000)

  it('a sockseek se le pasan los usuarios vetados', () => {
    const args = buildArgs({ csvPath: 'x.csv', outputDir: null, options: OPCIONES('buena'), vetados: ['ana', 'beto'] })
    expect(args.slice(args.indexOf('--banned-users'), args.indexOf('--banned-users') + 2)).toEqual(['--banned-users', 'ana,beto'])
    expect(buildArgs({ csvPath: 'x.csv', outputDir: null, options: OPCIONES('buena') })).not.toContain('--banned-users')
  })
})
