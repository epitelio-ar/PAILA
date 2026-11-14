// NAPIA: dónde queda lo bajado sin mezclar archivos de sockseek con la música. La carpeta de cada lista ("<lista>", sin el día),
// la carpeta de trabajo y el índice en los datos de NAPIA, pasar cada tema al terminar (sin pisar, entre discos), corregir
// el índice para que la próxima vez saltee lo bajado, el disco (espacio, externo), los argumentos (índice aparte y sin las
// acciones al terminar de la config) y la carpeta de NAPIA que PAILA ofrece como Bandeja. Con el sockseek de mentira.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Reparto, carpetaLista, corregirIndice, entregar, esExterno, infoDisco, nombreLibre, rutasTrabajo } from '@paila/core/sockseek/carpetas'
import { ACCION_VACIA, buildArgs, listCsv } from '@paila/core/sockseek/args'
import { resumenIndice } from '@paila/core/sockseek/indexcsv'
import { SockseekRun } from '@paila/core/sockseek/run'
import { bandejaCubre, napiaFolder, napiaJsonCandidates, pailaDbCandidates } from '@paila/core/sockseek/paila'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-carpetas-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const FALSO = path.join(__dirname, 'fixtures', 'sockseek-falso.mjs')

describe('la carpeta de cada lista y la de trabajo', () => {
  it('"<lista>" sin el día (siempre la misma), con el nombre limpio para Windows', () => {
    expect(carpetaLista('80s Mood')).toBe('80s Mood')
    expect(carpetaLista('Rock: lo mejor?')).toBe('Rock lo mejor')
  })
  it('sockseek trabaja en los datos de NAPIA: trabajo\\<lista>\\ y el índice en indices\\<lista>.csv', () => {
    expect(rutasTrabajo('D', '80s Mood')).toEqual({ trabajo: path.join('D', 'trabajo'), carpeta: path.join('D', 'trabajo', '80s Mood'), indice: path.join('D', 'indices', '80s Mood.csv') })
  })
  it('entregar no pisa: "tema (2).mp3"', () => {
    const dir = path.join(tmp, 'entregar'), dest = path.join(tmp, 'entregar-final')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'tema.mp3'), 'a')
    expect(entregar(path.join(dir, 'tema.mp3'), dest)).toBe(path.join(dest, 'tema.mp3'))
    fs.writeFileSync(path.join(dir, 'tema.mp3'), 'b')
    expect(entregar(path.join(dir, 'tema.mp3'), dest)).toBe(path.join(dest, 'tema (2).mp3'))
    expect(nombreLibre(dest, 'tema.mp3')).toBe(path.join(dest, 'tema (3).mp3'))
    expect(fs.readdirSync(dir)).toEqual([])
  })
  it('corregirIndice cambia solo las rutas movidas (con comillas y barras de cualquier tipo)', () => {
    const f = path.join(tmp, 'indice.csv')
    const viejo = path.join(tmp, 'trabajo', 'L', 'Uno, dos.mp3').replace(/\\/g, '/')
    fs.writeFileSync(f, `filepath,artist,album,title,length,tracktype,state,failurereason\n"${viejo}",A,,Uno,-1,0,1,0\n,B,,Dos,-1,0,2,9\n`)
    const nuevo = path.join(tmp, 'final', 'Uno, dos.mp3')
    expect(corregirIndice(f, new Map([[viejo.replace(/\//g, '\\'), nuevo]]))).toBe(1)
    const text = fs.readFileSync(f, 'utf8')
    expect(text).toContain(`"${nuevo.replace(/\\/g, '/')}",A,,Uno`)
    expect(text).toContain(',B,,Dos,-1,0,2,9')
    expect(corregirIndice(path.join(tmp, 'no-esta.csv'), new Map([['a', 'b']]))).toBe(0)
  })
})

describe('el disco', () => {
  it('externo: USB o extraíble; interno: SATA, NVMe; sin datos: no se sabe', () => {
    expect([esExterno('USB', 'Fixed'), esExterno('SATA', 'Fixed'), esExterno('NVMe', 'Fixed'), esExterno('', 'Removable'), esExterno('', '')]).toEqual([true, false, false, true, null])
  })
  it('el espacio libre de una carpeta que todavía no existe (mide la más cercana que sí)', () => {
    const d = infoDisco(path.join(tmp, 'todavia', 'no', 'existe'))
    expect(d.libre).toBeGreaterThan(0)
    expect(d.raiz).toBe(path.parse(tmp).root)
    expect(d.red).toBe(false)
  })
})

describe('los argumentos', () => {
  it('el índice aparte y una acción al terminar vacía, que pisa las de la config (como "mover a Completo")', () => {
    const args = buildArgs({ csvPath: 'x.csv', outputDir: 'T', options: { calidad: 'buena', sacarRemaster: true, primeros: null, saltearTenes: false }, indexPath: 'I/x.csv', sinAcciones: true })
    expect(args.slice(args.indexOf('--index-path'), args.indexOf('--index-path') + 2)).toEqual(['--index-path', 'I/x.csv'])
    expect(args[args.indexOf('--on-complete') + 1]).toBe(ACCION_VACIA)
    expect(ACCION_VACIA).toMatch(/^when=success scope=track hidden -- \S/)
  })
})

describe('PAILA ofrece la carpeta de NAPIA como Bandeja', () => {
  it('lee el destino del napia.json (la portable primero); sin NAPIA, null', () => {
    const app = path.join(tmp, 'appdata'), port = path.join(tmp, 'portable')
    expect(napiaJsonCandidates(app, port)).toEqual([path.join(port, 'NAPIA-datos', 'napia.json'), path.join(app, 'NAPIA', 'napia.json')])
    expect(napiaFolder(napiaJsonCandidates(app))).toBeNull()
    fs.mkdirSync(path.join(app, 'NAPIA'), { recursive: true })
    fs.writeFileSync(path.join(app, 'NAPIA', 'napia.json'), JSON.stringify({ options: {} }))
    expect(napiaFolder(napiaJsonCandidates(app))).toBeNull()
    fs.writeFileSync(path.join(app, 'NAPIA', 'napia.json'), JSON.stringify({ destino: 'C:\\Users\\x\\Music\\NAPIA' }))
    expect(napiaFolder(napiaJsonCandidates(app))).toBe('C:\\Users\\x\\Music\\NAPIA')
  })
  it('con una carpeta de datos aparte (la prueba con personas), solo esa: nunca la NAPIA ni la PAILA de verdad', () => {
    const app = path.join(tmp, 'appdata'), port = path.join(tmp, 'portable'), prueba = path.join(tmp, 'prueba')
    expect(napiaJsonCandidates(app, port, path.join(prueba, 'napia-datos'))).toEqual([path.join(prueba, 'napia-datos', 'napia.json')])
    expect(napiaFolder(napiaJsonCandidates(app, undefined, path.join(prueba, 'napia-datos')))).toBeNull() // la de appdata tiene destino, pero no cuenta
    expect(pailaDbCandidates(app, port, path.join(prueba, 'datos'))).toEqual([path.join(prueba, 'datos', 'paila.db')])
  })
  it('la Bandeja la cubre si vigila esa carpeta o una que la contiene', () => {
    expect(bandejaCubre('C:\\Users\\x\\Music', 'C:\\Users\\x\\Music\\NAPIA')).toBe(true)
    expect(bandejaCubre('c:/users/x/music/napia/', 'C:\\Users\\x\\Music\\NAPIA')).toBe(true)
    expect(bandejaCubre('D:\\Soulseek\\Completo', 'C:\\Users\\x\\Music\\NAPIA')).toBe(false)
    expect(bandejaCubre('C:\\Users\\x\\Music\\NAP', 'C:\\Users\\x\\Music\\NAPIA')).toBe(false)
    expect(bandejaCubre(null, 'C:\\x')).toBe(false)
  })
})

describe('una corrida como la de NAPIA (sockseek de mentira)', () => {
  it('lo bajado aparece en "<lista>", sin _index.csv ni .incomplete; otro día, en la misma carpeta y "ya estaba"', async () => {
    const datos = path.join(tmp, 'datos'), destino = path.join(tmp, 'Musica', 'NAPIA')
    const rows = [{ artist: 'Soda Stereo', title: 'De Musica Ligera', album: null, duration: 211 }, { artist: 'Los Redondos', title: 'Tema Inexistente', album: null, duration: null }]
    const r = rutasTrabajo(datos, 'Mi lista')
    const csv = path.join(datos, 'listas', 'Mi lista.csv')
    fs.mkdirSync(path.dirname(csv), { recursive: true })
    fs.writeFileSync(csv, listCsv(rows, { sacarRemaster: true, primeros: null, saltearTenes: false }))
    const correr = async () => {
      const reparto = new Reparto(r.trabajo, path.join(destino, carpetaLista('Mi lista')))
      const args = buildArgs({ csvPath: csv, outputDir: r.trabajo, options: { calidad: 'buena', sacarRemaster: true, primeros: null, saltearTenes: false }, indexPath: r.indice, sinAcciones: true })
      const run: SockseekRun = new SockseekRun({ command: process.execPath, args: [FALSO, ...args] }, rows, () => reparto.repartir(run.progress.tracks))
      await run.done
      reparto.cerrar(run.progress.tracks, r.indice)
      return run
    }
    const a = await correr()
    const final = path.join(destino, 'Mi lista')
    expect(fs.readdirSync(final)).toEqual(['Soda Stereo - De Musica Ligera.mp3'])
    expect(a.progress.tracks[0].path).toBe(path.join(final, 'Soda Stereo - De Musica Ligera.mp3'))
    // en la carpeta de trabajo no queda música; el índice está en los datos de NAPIA, con la ruta nueva
    expect(fs.readdirSync(r.carpeta).filter((f) => !f.endsWith('.incomplete'))).toEqual([])
    expect(fs.existsSync(path.join(final, '_index.csv'))).toBe(false)
    expect(fs.readFileSync(r.indice, 'utf8')).toContain(path.join(final, 'Soda Stereo - De Musica Ligera.mp3').replace(/\\/g, '/'))
    expect(resumenIndice(r.indice, r.carpeta)).toMatchObject({ bajados: 1, noEncontrados: 1 })
    const b = await correr()
    expect(b.progress.tracks.map((t) => t.state)).toEqual(['yaEstaba', 'noEncontrado'])
    expect(fs.readdirSync(final)).toEqual(['Soda Stereo - De Musica Ligera.mp3'])
  })
})
