// Tests de "Pasar a otra compu" (core/mudanza.ts y core/mudanza-traer.ts): exportar todo sin las claves, traerlo con la
// Música en otra carpeta (mayúsculas y acentos de Mac, temas movidos, renombrados, con otra fecha, borrados y nuevos), sin
// volver a analizar nada y sin tocar un solo archivo de música.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { openDb } from '@paila/core/db'
import { abrirMudanza, carpetasDe, contar, exportarTodo, leerMudanza } from '@paila/core/mudanza'
import { armarTraida, emparejar, emparejarCarpeta, ponerTraida, TRAIDA } from '@paila/core/mudanza-traer'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const SECRETO = 'clave-secreta-de-prueba-1234567890'
let dir: string
let lib: Library
let archivo: string
const tone = (base: string, rel: string, f: number) => { const out = path.join(dir, base, ...rel.split('/')); fs.mkdirSync(path.dirname(out), { recursive: true }); execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${1 + (f - 300) / 50}`, out]) }
const one = <T>(db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as T
/** Cada archivo de una carpeta con su contenido: para ver que traer no tocó nada. */
const foto = (d: string) => fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => { const p = path.join(e.parentPath, e.name); const st = fs.statSync(p); return `${path.relative(d, p)}|${st.size}|${st.mtimeMs}` }).sort()

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mudanza-'))
  tone('M', 'Rock/Ánimo.mp3', 300); tone('M', 'Rock/Bajo.mp3', 350); tone('M', 'Cumbia/Cielo.mp3', 400)
  tone('M', 'Cumbia/Dulce.mp3', 450); tone('M', 'Viejo/Eco.mp3', 500); tone('M', 'Viejo/Fin.mp3', 550)
  fs.mkdirSync(path.join(dir, 'origen'))
  lib = new Library(path.join(dir, 'origen', 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  // un análisis hecho (con sus huellas) para cada tema, como si hubiera tardado horas
  lib.db.exec("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, bpm, audio_md5, audio_size, audio_mtime) SELECT id, 999, size, mtime, 'ayer', 'A', 124, 'md5-' || id, size, mtime FROM files")
  const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  const fiesta = pl.create('Fiesta')
  pl.addTracks(fiesta, lib.tracks().map((r) => r[0] as number))
  const set = (k: string, v: string) => lib.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v)
  set('claves.discogs', `dpapi:${SECRETO}`); set('claves.prueba.discogs', '{"ok":true}'); set('inbox_dir', path.join(dir, 'no-existe'))
  set('tidy.reglas', '["feat"]'); set('tabla.vistas', '[{"id":1},{"id":2}]')
  lib.db.prepare("INSERT INTO artist_dict (key, from_name, to_name, origin, created_at) VALUES ('balvin', 'Balvin', 'J Balvin', 'usuario', 'hoy')").run()
  lib.db.prepare("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (1, 1, 'Rock/Ánimo.mp3', 'artist', 'x', 'y', 'hoy')").run()
  lib.db.prepare("INSERT INTO pending_changes (file_id, field, before, after, created_at) VALUES (2, 'title', 'Bajo', 'El bajo', 'hoy')").run()
  lib.db.prepare("INSERT INTO op_journal (op, root_id, src_rel, started_at) VALUES ('mover', 1, 'Rock/Bajo.mp3', 'hoy')").run()
  lib.db.prepare("INSERT INTO inbox_items (path, size, mtime, result, checked_at) VALUES ('C:/Bandeja/x.mp3', 1, 1, 'ok', 'hoy')").run()
  fs.mkdirSync(path.join(dir, 'origen', 'tapas'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'origen', 'tapas', 'abc.jpg'), 'tapa')
  archivo = path.join(dir, 'todo.paila')
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Exportar todo', () => {
  it('lleva la base entera y las tapas, pero ni una clave (ni escondida en el archivo)', () => {
    const r = exportarTodo(lib.db, archivo, { version: '0.5.0', ventana: { 'paila.volume': '0.7' }, estilo: 'historieta', tapas: path.join(dir, 'origen', 'tapas') })
    expect(r.clavesQuitadas).toEqual(['discogs'])
    expect(fs.readFileSync(archivo).includes(SECRETO)).toBe(false)
    const db = new DatabaseSync(archivo, { readOnly: true })
    expect(one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'claves.%'").n).toBe(0)
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM op_journal').n).toBe(0) // nada a medias para terminar en otra compu
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM inbox_items').n).toBe(0)
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM mudanza_tapas').n).toBe(1)
    expect(contar(db)).toEqual(contar(lib.db))
    db.close()
    expect(fs.existsSync(`${archivo}-wal`)).toBe(false) // un solo archivo
  })

  it('dice qué trae, de dónde y qué claves hay que volver a pegar', () => {
    const r = leerMudanza(archivo)
    expect(r.version).toBe('0.5.0')
    // el sistema de la compu donde se exportó (en la Mac de GitHub, "Mac")
    expect(r.sistema).toBe(process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux')
    expect(r.carpetas).toEqual([{ rootId: 1, origen: path.join(dir, 'M'), disco: expect.any(String), temas: 6, sugerida: path.join(dir, 'M') }])
    expect(r.conteos).toMatchObject({ temas: 6, analizados: 6, huellas: 6, playlists: 1, enPlaylists: 6, historial: 1, pendientes: 1, vistas: 2, diccionario: 1 })
    expect(r.clavesQuitadas).toEqual(['discogs'])
  })

  it('no abre lo que no es de PAILA ni lo de una PAILA más nueva', () => {
    const otro = path.join(dir, 'otro.db')
    new DatabaseSync(otro).close()
    expect(() => abrirMudanza(otro)).toThrow(/no es de "Exportar todo"/)
    const nueva = path.join(dir, 'nueva.paila')
    fs.copyFileSync(archivo, nueva)
    const db = new DatabaseSync(nueva); db.exec('PRAGMA user_version = 9999'); db.close()
    expect(() => leerMudanza(nueva)).toThrow(/más nueva/)
  })
})

describe('Traer de otra compu', () => {
  let N: string
  let antes: string[]
  const mtime = (rel: string) => fs.statSync(path.join(dir, 'M', ...rel.split('/'))).mtime

  beforeAll(() => {
    // la Música en la compu nueva: un nombre en mayúsculas y con el acento como los guarda un Mac (NFD), un tema movido de carpeta,
    // otro renombrado (misma fecha), otro copiado sin conservar la fecha, uno que no se trajo y uno nuevo
    N = path.join(dir, 'N')
    const copiar = (de: string, a: string, fecha?: Date) => { const dst = path.join(N, ...a.split('/')); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(dir, 'M', ...de.split('/')), dst); const t = fecha ?? mtime(de); fs.utimesSync(dst, t, t) }
    copiar('Rock/Ánimo.mp3', 'Rock/ÁNIMO.mp3'.normalize('NFD'))
    copiar('Rock/Bajo.mp3', 'Rock/Bajo.mp3', new Date('2030-01-01T00:00:00Z'))
    copiar('Cumbia/Cielo.mp3', 'Otras/Cielo.mp3')
    copiar('Cumbia/Dulce.mp3', 'Cumbia/Dulce (remaster).mp3')
    copiar('Viejo/Eco.mp3', 'Viejo/Eco.mp3')
    tone('N', 'Nuevos/Gol.mp3', 600)
    antes = foto(N)
  })

  it('encuentra cada tema por su ruta, mayúsculas, nombre o fecha, y dice cuáles faltan', async () => {
    const p = await emparejarCarpeta(archivo, 1, N)
    expect(p.resumen).toMatchObject({ porRuta: 2, porMayusculas: 1, porNombre: 1, porFecha: 1, faltan: 1, yaFaltaban: 0, ejemplosFaltan: ['Viejo/Fin.mp3'], nuevos: 1, cambiados: 0 })
  })

  it('arma la base nueva: playlists, historial, análisis y pendientes intactos, sin volver a analizar ni tocar la música', async () => {
    const p = await emparejarCarpeta(archivo, 1, N)
    const datos = path.join(dir, 'destino')
    fs.mkdirSync(datos, { recursive: true })
    const t = await armarTraida(archivo, path.join(datos, TRAIDA), [p], { conservar: [{ key: 'claves.acoustid', value: 'dpapi:de-esta-compu' }], tapas: path.join(datos, 'tapas') })
    expect(t).toMatchObject({ ventana: { 'paila.volume': '0.7' }, estilo: 'historieta', tapas: 1, rutasQuitadas: ['inbox_dir'] })
    expect(ponerTraida(datos)).toBe(true)
    const nueva = new Library(path.join(datos, 'paila.db'), findFfprobe())
    try {
      expect(nueva.roots()).toMatchObject([{ path: N, available: true }])
      const c = contar(nueva.db)
      expect(c).toMatchObject({ temas: 6, analizados: 6, huellas: 6, playlists: 1, enPlaylists: 6, historial: 1, pendientes: 1, vistas: 2, diccionario: 1 })
      expect(nueva.pendingAnalysis()).toBe(0) // ni el que llegó con otra fecha se vuelve a analizar
      const bajo = one<{ m: number; s: number; a: number }>(nueva.db, "SELECT f.mtime AS m, a.src_mtime AS s, a.audio_mtime AS a FROM files f JOIN analysis a ON a.file_id = f.id WHERE f.rel_path = 'Rock/Bajo.mp3'")
      expect([bajo.s, bajo.a]).toEqual([bajo.m, bajo.m])
      expect(one<{ r: string }>(nueva.db, "SELECT rel_path AS r FROM files WHERE rel_path LIKE 'Rock/%' ORDER BY size LIMIT 1").r).toBe('Rock/A\u0301NIMO.mp3'.normalize('NFD'))
      expect(one<{ m: string | null }>(nueva.db, "SELECT missing_at AS m FROM files WHERE rel_path = 'Viejo/Fin.mp3'").m).not.toBeNull()
      expect(one<{ v: string }>(nueva.db, "SELECT value AS v FROM settings WHERE key = 'claves.acoustid'").v).toBe('dpapi:de-esta-compu')
      expect(fs.readFileSync(path.join(datos, 'tapas', 'abc.jpg'), 'utf8')).toBe('tapa')
      // el primer escaneo solo lee el tema nuevo: los traídos ya están al día
      const s = await nueva.scan()
      expect(s.toProbe).toBe(1)
      expect(nueva.trackCount()).toBe(6) // 5 encontrados + el nuevo; Fin sigue desaparecido, con su playlist
      expect(foto(N)).toEqual(antes)
    } finally { nueva.close() }
  })

  it('no deja traer dos carpetas de la otra compu al mismo lugar', async () => {
    const p = await emparejarCarpeta(archivo, 1, N)
    await expect(armarTraida(archivo, path.join(dir, 'x.db'), [p, { ...p, resumen: { ...p.resumen, rootId: 2 } }])).rejects.toThrow(/mismo lugar/)
  })

  it('al abrir, la base de antes no se borra: queda en respaldos', () => {
    const datos = path.join(dir, 'reemplazo')
    fs.mkdirSync(datos)
    fs.writeFileSync(path.join(datos, 'paila.db'), 'vieja'); fs.writeFileSync(path.join(datos, 'paila.db-wal'), 'diario')
    expect(ponerTraida(datos)).toBe(false)
    fs.writeFileSync(path.join(datos, TRAIDA), 'nueva')
    expect(ponerTraida(datos)).toBe(true)
    expect(fs.readFileSync(path.join(datos, 'paila.db'), 'utf8')).toBe('nueva')
    expect(fs.readdirSync(path.join(datos, 'respaldos')).sort()).toEqual([expect.stringMatching(/_reemplazada-al-traer\.db$/), expect.stringMatching(/_reemplazada-al-traer\.db-wal$/)])
  })
})

describe('de Windows a Mac y de Mac a Windows', () => {
  const e = (id: number, rel: string, size = 100, mtime = 1000) => ({ id, rel, size, mtime })
  it('reconoce acentos descompuestos y mayúsculas; lo dudoso no lo engancha', () => {
    const p = emparejar(1, '/Users/ana/Music', [e(1, 'Cumbia/Ñandú.mp3'), e(2, 'A/Igual.mp3', 5), e(3, 'B/Igual.mp3', 5)],
      [{ rel: 'cumbia/ñandú.mp3'.normalize('NFD'), size: 100, mtime: 9 }, { rel: 'X/Igual.mp3', size: 5, mtime: 9 }, { rel: 'Y/Igual.mp3', size: 5, mtime: 9 }])
    expect(p.resumen).toMatchObject({ porMayusculas: 1, porNombre: 0, faltan: 2, nuevos: 2 })
  })
  it('un renombrado solo se engancha por fecha si es el único con ese tamaño y fecha', () => {
    const p = emparejar(1, 'x', [e(1, 'a.mp3', 7, 5000), e(2, 'b.mp3', 7, 5000)], [{ rel: 'c.mp3', size: 7, mtime: 5000 }])
    expect(p.resumen.porFecha).toBe(0)
    expect(emparejar(1, 'x', [e(1, 'a.mp3', 7, 5000)], [{ rel: 'c.mp3', size: 7, mtime: 6500 }]).resumen.porFecha).toBe(1)
  })
  it('separa los que ya faltaban en la otra compu de los que se perdieron en el camino', () => {
    const p = emparejar(1, 'x', [{ ...e(1, 'a.mp3'), falta: true }, e(2, 'b.mp3', 9)], [])
    expect(p.resumen).toMatchObject({ faltan: 2, yaFaltaban: 1 })
  })
  it('muestra la carpeta de origen como era en su sistema', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mudanza-rutas-'))
    const db = openDb(path.join(d, 'p.db'))
    try {
      db.exec("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'a', 'Mac', '/'), (2, 'b', 'SSD', 'D:\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'Users/ana/Music', 'x'), (2, 2, 'Música', 'x'), (3, 2, '', 'x')")
      expect(carpetasDe(db).map((c) => c.origen)).toEqual(['/Users/ana/Music', 'D:\\Música', 'D:\\'])
    } finally { db.close(); fs.rmSync(d, { recursive: true, force: true }) }
  })
})
