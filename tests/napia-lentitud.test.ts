// Tests de las fuentes lentas en NAPIA (core/sockseek/lentitud.ts y control.ts, lenta): cuándo una fuente es lenta, que solo se
// corta cuando es lo único que queda, y una lista entera con el sockseek de mentira bajando varios a la vez: una fuente lenta y
// dos truchos no frenan al resto (pedido del autor, 24/10: "como el primero está descargando lento, se para todo").
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LENTITUD, VigiaLentitud, escalar } from '@paila/core/sockseek/lentitud'
import { anotarBajados } from '@paila/core/sockseek/carpetas'
import { parseIndex } from '@paila/core/sockseek/indexcsv'
import { resumir } from '@paila/core/sockseek/tanda'
import type { TrackProgress } from '@paila/shared/napia'
import { bajarLista, hacerAudios } from './fixtures/napia-lista'

let dir: string
let a: (n: string) => string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-lentitud-'))
  a = hacerAudios(dir)
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const MB = 1024 * 1024
const tema = (title: string, state: TrackProgress['state'], bytes: number | null = null, total: number | null = null, fuente = 'ana'): TrackProgress =>
  ({ artist: 'A', title, state, percent: null, detail: null, path: null, format: null, fuente, bytes, total })

describe('cuándo una fuente es lenta', () => {
  /** Un tema de 10 MB que avanza `kbs` KB/s durante `seg` segundos, mirado cada 2 s. */
  const bajar = (v: VigiaLentitud, t: TrackProgress, kbs: number, seg: number, desde = 0) => {
    for (let s = 0; s <= seg; s += 2) { t.bytes = Math.min(t.total!, (t.bytes ?? 0) + (s ? kbs * 1024 * 2 : 0)); v.anotar([t], desde + s * 1000) }
    return desde + seg * 1000
  }

  it('al ritmo del último minuto le faltan más de 5 minutos: lenta; si no, no', () => {
    const v = new VigiaLentitud()
    const tortuga = tema('Tortuga', 'bajando', 0, 10 * MB), liebre = tema('Liebre', 'bajando', 0, 10 * MB)
    const fin = bajar(v, tortuga, 10, 70)
    bajar(v, liebre, 500, 70)
    expect(v.lenta(tortuga, fin)).toBe(true) // 10 KB/s: le falta casi una hora
    expect(v.lenta(liebre, fin)).toBe(false) // 500 KB/s: termina en segundos
  })

  it('no juzga antes del minuto, y empieza de cero si sockseek pasó a otro usuario', () => {
    const v = new VigiaLentitud()
    const t = tema('Tortuga', 'bajando', 0, 10 * MB)
    expect(v.lenta(t, bajar(v, t, 10, 40))).toBe(false)
    t.fuente = 'beto'; t.bytes = 0
    const fin = bajar(v, t, 10, 40, 40_000)
    expect(v.lenta(t, fin)).toBe(false)
    expect(v.lenta(t, bajar(v, t, 10, 30, fin))).toBe(true)
  })

  it('una que arrancó lenta y se puso rápida no se corta (mira el último minuto)', () => {
    const v = new VigiaLentitud()
    const t = tema('Arranca', 'bajando', 0, 50 * MB)
    let at = bajar(v, t, 5, 120)
    at = bajar(v, t, 800, 60, at)
    expect(v.lenta(t, at)).toBe(false)
  })

  it('solo se corta cuando es lo único que queda en marcha', () => {
    const v = new VigiaLentitud()
    const lenta = tema('Tortuga', 'bajando', 0, 10 * MB)
    const fin = bajar(v, lenta, 10, 70)
    const listo = tema('Listo', 'bajado'), noEsta = tema('No está', 'noEncontrado')
    expect(v.aCortar([lenta, tema('Buscando', 'buscando'), listo], fin)).toEqual([])
    expect(v.aCortar([lenta, tema('En espera', 'espera')], fin)).toEqual([])
    const rapida = tema('Liebre', 'bajando', 0, 10 * MB)
    bajar(v, rapida, 900, 70)
    expect(v.aCortar([lenta, rapida], fin)).toEqual([])
    expect(v.aCortar([lenta, listo, noEsta], fin)).toEqual([lenta])
    expect(v.aCortar([listo, noEsta], fin)).toEqual([])
  })

  it('los tiempos, en una escala más corta para las pruebas', () => {
    expect(escalar(LENTITUD, 0.05)).toMatchObject({ observar: 3000, ventana: 3000, maxRestante: 15_000 })
  })
})

describe('el índice de la lista', () => {
  it('anotarBajados cambia el renglón del tema o lo suma, con su álbum y duración (así sockseek lo saltea)', () => {
    const f = path.join(dir, 'indice.csv')
    fs.writeFileSync(f, 'filepath,artist,album,title,length,tracktype,state,failurereason\n,A,Disco,Uno,200,0,0,0\nC:/x/dos.mp3,A,,Dos,-1,0,1,0\n')
    expect(anotarBajados(f, [{ artist: 'a', title: 'uno', path: 'D:\\Lista\\Uno.flac' }, { artist: 'B', title: 'Tres', album: 'Otro', duration: 181.4, path: 'D:\\Lista\\Tres.mp3' }])).toBe(2)
    const rows = parseIndex(fs.readFileSync(f, 'utf8'))
    expect(rows.map((r) => [r.title, r.state, r.path, r.album])).toEqual([['Uno', 'bajado', 'D:/Lista/Uno.flac', 'Disco'], ['Dos', 'bajado', 'C:/x/dos.mp3', ''], ['Tres', 'bajado', 'D:/Lista/Tres.mp3', 'Otro']])
    expect(fs.readFileSync(f, 'utf8')).toContain(',B,Otro,Tres,181,0,1,0')
    expect(anotarBajados(path.join(dir, 'no-existe.csv'), [{ artist: 'A', title: 'Uno', path: 'x' }])).toBe(0)
  })
})

describe('una lista con fuentes lentas y truchos', () => {
  it('una fuente lenta y dos truchos no frenan al resto; lo lento va a otra fuente y cuenta como un intento', async () => {
    const t0 = Date.now()
    const r = await bajarLista(path.join(dir, 'lista'), 'buena', {
      Lenta: [['tortuga', a('m320.mp3'), 'lenta'], ['liebre', a('m320.mp3')]], // lenta en la lista; otro usuario la tiene bien
      Uno: [['ana', a('inflado.mp3')], ['beto', a('m320.mp3')]], // trucho, y otra fuente buena
      Dos: [['caro', a('m320.mp3')]], // bueno de entrada
      Tres: [['dani', a('falso.flac')], ['eli', a('m320.mp3')]], // trucho, y otra fuente buena
      Cinco: [['hugo', a('inflado.mp3')], ['ivan', a('m320.mp3'), 'lenta'], ['juan', a('m320.mp3')]], // trucho, después lenta, después buena
      Seis: [['kike', a('m320.mp3'), 'lenta']], // solo lo tiene uno, lentísimo
    }, { jobs: 6, lentitud: escalar(LENTITUD, 0.05) })
    const t = (x: string) => r.porTitulo(x)

    // lo bueno llegó sin esperar a las lentas: la primera se cortó bastante después
    expect(r.cortes[0].titulos.sort()).toEqual(['Lenta', 'Seis'])
    expect(r.llego.get('Dos')!).toBeLessThan(r.cortes[0].at - 2000)
    // la vuelta de otra fuente baja todo junto: Cinco iba lenta y se cortó sola, sin frenar a Uno, Tres ni Lenta
    expect(r.cortes[1].titulos).toEqual(['Cinco'])
    expect(r.cortes).toHaveLength(2)

    expect(t('Lenta')).toMatchObject({ state: 'bajado', fuente: 'liebre', detail: null })
    expect(t('Lenta').calidad).toMatchObject({ estado: 'buena', descartadas: 0, lentas: 1, intentos: 1, nota: 'B' })
    expect(path.dirname(t('Lenta').path!)).toBe(r.carpeta)
    expect(t('Uno').calidad).toMatchObject({ estado: 'reemplazado', descartadas: 1, intentos: 1 })
    expect(t('Tres').calidad).toMatchObject({ estado: 'reemplazado', descartadas: 1, intentos: 1 })
    expect(t('Dos').calidad).toMatchObject({ estado: 'buena', intentos: 0 })
    expect(t('Cinco')).toMatchObject({ state: 'bajado', fuente: 'juan' })
    expect(t('Cinco').calidad).toMatchObject({ estado: 'reemplazado', descartadas: 1, lentas: 1, intentos: 2 })
    // solo fuentes lentas: no se pudo, como cualquier otro que falló (va a "Buscar de otra forma")
    expect(t('Seis')).toMatchObject({ state: 'fallo', calidad: null })
    expect(t('Seis').detail).toMatch(/lentas/)
    // los vetados de la segunda vuelta: el que dio Cinco trucho y el que iba lento
    expect(r.vetadosPorRonda[1].sort()).toEqual(['hugo', 'ivan'])

    expect(resumir(r.tracks)).toMatchObject({ total: 6, bajados: 5, noSePudieron: 1, descartados: 3, reemplazados: 3, soloFalsa: 0, sinTerminar: 0 })
    // lo que llegó de otra fuente después de la lenta queda en el índice: la próxima vez se saltea
    const indice = parseIndex(fs.readFileSync(r.trabajo.indice, 'utf8'))
    expect(indice.find((x) => x.title === 'Lenta')).toMatchObject({ state: 'bajado', path: t('Lenta').path!.replace(/\\/g, '/') })
    // y todo junto tardó segundos, no lo que tarda una fuente lenta
    expect(Date.now() - t0).toBeLessThan(60_000)
  }, 120_000)
})
