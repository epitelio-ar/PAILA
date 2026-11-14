// Lo que encontró la última medición de la etapa 3 (Ordenar aplicado sobre D:\PAILA-trabajo\Música-copia, 13/11/2026; bitácora
// docs/pruebas/mp5-etapa3-aplicar-400.md): un test por error, con el caso real achicado. `it.fails` = el error está hoy (el test
// pasa porque falla); quien lo arregle saca el `.fails` y el test tiene que pasar derecho. `it.todo` = decisión del autor.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { Organizer } from '@paila/core/organizer'
import { Trash } from '@paila/core/trash'
import { Playlists } from '@paila/core/playlists'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import { delNombre, elegirCarpetas } from '@paila/core/revision-armar'
import { propuestas } from '@paila/core/propuestas'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import type { DupGroup, DupItem } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')

/** La forma que ya tiene la Biblioteca del autor: disco con año, sin número de tema. */
const REGLA = { rule: '%artista%/%año% - %album%/%titulo%', dest: 'Biblioteca' } // idioma-ok: códigos de la regla

interface Tema { rel: string; artist?: string; title?: string; album?: string; year?: string; track?: string; bytes?: number }
let dir = '', db: Db | null = null
afterEach(() => { db?.close(); db = null; if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = '' })

/** Una base con estos temas; con `bytes`, también el archivo en el disco (de mentira: solo se mueve). */
function base(temas: Tema[]) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-aplicar400-'))
  const M = path.join(dir, 'M')
  fs.mkdirSync(M)
  const d = openDb(path.join(dir, 'paila.db'))
  db = d
  d.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', ?)").run(dir)
  d.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  const ins = d.prepare(`INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, album, year, track, duration)
    VALUES (1, ?, ?, ?, 'musica', ?, ?, ?, ?, ?, ?, 200)`)
  const ids = temas.map((t) => {
    let size = 1000, mtime = 1
    if (t.bytes) {
      const abs = path.join(M, ...t.rel.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.alloc(t.bytes, 7))
      const st = fs.statSync(abs); size = st.size; mtime = Math.round(st.mtimeMs)
    }
    return Number(ins.run(t.rel, size, mtime, path.extname(t.rel).slice(1), t.artist ?? null, t.title ?? null, t.album ?? null, t.year ?? null, t.track ?? null).lastInsertRowid)
  })
  const rootPath = () => M
  return { db: d, ids, M, organizer: new Organizer(d, rootPath), trash: new Trash(d, rootPath, new Playlists(d, () => null)) }
}
const item = (id: number, rel: string): DupItem => ({ id, rel, ext: 'mp3', size: 1, kbps: 320, duration: 200, grade: 'B', kind: 'musica' } as DupItem)
const vaciasDebajo = (d: string): string[] => !fs.existsSync(d) ? [] : (fs.readdirSync(d, { recursive: true }) as string[])
  .map((x) => path.join(d, x)).filter((p) => fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0)

describe('última medición de la etapa 3: la vista previa y el Aplicar', () => {
  // "Biblioteca/Britney Spears/2013 - The Essential Britney Spears/": Womanizer.flac y Gimme More.m4a. Womanizer tiene una carta "¿Son el
  // mismo?" sin contestar (con la copia de DISCO CUMPLE). Ordenar no cuenta a ninguno de la carta para el disco (organizer.ts:203,
  // `quietos`), así que el disco queda de 1 y propone sacar Gimme More a la carpeta del artista; el Aplicar vuelve a calcular sin esa
  // regla (aplicar.ts:127), ve 2 y falla con "Con los nombres de ahora ya no se mueve". El original que se queda sí cuenta para su disco.
  it('la carta "¿Son el mismo?" sin contestar no saca del disco al otro tema del original', () => {
    const b = base([
      { rel: 'Biblioteca/Britney Spears/2013 - The Essential Britney Spears/Womanizer.flac', artist: 'Britney Spears', title: 'Womanizer', album: 'The Essential Britney Spears', year: '2013' },
      { rel: 'Biblioteca/Britney Spears/2013 - The Essential Britney Spears/Gimme More.m4a', artist: 'Britney Spears', title: 'Gimme More', album: 'The Essential Britney Spears', year: '2013' },
      { rel: 'DISCO CUMPLE/set diciembre/Britney Spears - Womanizer.mp3', artist: 'Britney Spears', title: 'Womanizer' },
    ])
    const [orig, gimme, copia] = b.ids
    const g: DupGroup = { level: 'probable', label: 'probable', why: 'mismos artista, título y duración', items: [item(orig, 'a'), item(copia, 'b')], keep: orig, similarity: null, warning: null, decidir: true }
    guardarRepetidos(b.db, [g])
    elegirCarpetas({ db: b.db, organizer: b.organizer }, REGLA)
    expect(propuestas(b.db, 'mover').map((p) => p.fileId)).not.toContain(gimme)
  })

  // 15 carpetas quedaron vacías después del Aplicar ("Biblioteca/Bours_", "Guns N' Roses/1993 - The Spaghetti Incident_", "Almafuerte/0001
  // - Toro y Pampa"…): Organizar mueve todos los temas a la carpeta con el nombre arreglado y deja la vieja vacía. Antes se limpiaba aparte
  // desde Espacio (punto 1, 24/10); en el Aplicar único de Ordenar quedan sin que nadie lo diga.
  it('Organizar no deja vacía la carpeta de la que sacó todos los temas, y deshacer la vuelve a poner', async () => {
    const b = base([
      { rel: 'Biblioteca/Bours_/Horn Of The Harad.mp3', artist: 'Bours', title: 'Horn Of The Harad', bytes: 2048 },
      { rel: 'Biblioteca/Bours_/Otro.mp3', artist: 'Bours', title: 'Otro', bytes: 2048 },
    ])
    const plan = b.organizer.plan(REGLA)
    expect(plan.moves).toHaveLength(2)
    const r = await b.organizer.apply(plan, { vaciar: true }) // como lo hace el Aplicar
    expect(r.moved).toBe(2)
    expect(fs.existsSync(path.join(b.M, 'Biblioteca', 'Bours_'))).toBe(false)
    // anotada como tanda de "Carpetas vacías": deshacer el mover (y esa) la vuelve a poner con sus temas
    expect(r.carpetas).not.toBeNull()
    const u = await b.organizer.undo(r.batchId!)
    expect(u.failed).toEqual([])
    expect(fs.readdirSync(path.join(b.M, 'Biblioteca', 'Bours_')).sort()).toEqual(['Horn Of The Harad.mp3', 'Otro.mp3'])
  })

  it('nunca saca una carpeta de sample packs ni la raíz, aunque quede vacía', async () => {
    const b = base([{ rel: 'Samples/Kit/Bours - Golpe.mp3', artist: 'Bours', title: 'Golpe', bytes: 2048 }])
    b.db.prepare("INSERT INTO rules (root_id, rel_prefix, kind) VALUES (1, 'Samples', 'produccion')").run()
    const r = await b.organizer.apply({ moves: [{ fileId: b.ids[0], rootId: 1, from: 'Samples/Kit/Bours - Golpe.mp3', to: 'Biblioteca/Bours/Golpe.mp3' }], extras: [], conflicts: 0, skipped: [] } as never, { vaciar: true })
    expect(r.moved).toBe(1)
    expect(r.carpetas ?? null).toBeNull()
    expect(fs.existsSync(path.join(b.M, 'Samples', 'Kit'))).toBe(true)
  })
})

describe('última medición de la etapa 3: deshacer', () => {
  // Después de deshacer el Aplicar, robocopy contra el original marcó 13 carpetas de más: "_PAILA/papelera/2026-11-13_10-12-26_tanda-6_fcka/"
  // con sus subcarpetas, vacías (los 7 temas volvieron a su lugar y la carpeta de la tanda quedó)
  it('volver de la papelera no deja vacía la carpeta de la tanda', async () => {
    const b = base([{ rel: 'pendrive/Contents/UnknownArtist/UnknownAlbum/Rompe.mp3', artist: 'Daddy Yankee', title: 'Rompe', bytes: 2048 }])
    const t = await b.trash.trash(b.ids, 'Duplicados') // idioma-ok: el motivo
    expect(t.moved).toBe(1)
    const r = await b.trash.restore(t.batchId!)
    expect(r.moved).toBe(1)
    expect(fs.existsSync(path.join(b.M, 'pendrive/Contents/UnknownArtist/UnknownAlbum/Rompe.mp3'))).toBe(true)
    expect(vaciasDebajo(path.join(b.M, '_PAILA', 'papelera'))).toEqual([])
  })

  // 14 archivos volvieron con los mismos bytes y la fecha de hoy; el autor (13/11): deshacer devuelve también la fecha (core/fechas.ts)
  it('deshacer un cambio de tags devuelve también la fecha del archivo, exacta', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-aplicar400-'))
    const M = path.join(dir, 'M'), tema = path.join(M, 'Sumo', 'Divididos.mp3')
    fs.mkdirSync(path.dirname(tema), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-metadata', 'artist=Sumo', '-metadata', 'title=Divididos', tema])
    const vieja = new Date('2019-05-04T03:02:01.234Z')
    fs.utimesSync(tema, vieja, vieja)
    const antes = { ns: fs.statSync(tema, { bigint: true }).mtimeNs, bytes: fs.readFileSync(tema) }
    const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    try {
      await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
      await lib.scan()
      const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
      const id = (lib.db.prepare('SELECT id FROM files').get() as { id: number }).id
      ch.stage([id], 'genre', 'Rock')
      const r = await ch.apply()
      expect(r.failed).toEqual([])
      expect(fs.statSync(tema, { bigint: true }).mtimeNs).not.toBe(antes.ns)
      const u = await ch.undo(r.batchId!)
      expect(u.failed).toEqual([])
      expect(fs.readFileSync(tema).equals(antes.bytes)).toBe(true)
      expect(fs.statSync(tema, { bigint: true }).mtimeNs).toBe(antes.ns)
      // la base anota la fecha que quedó (el archivo no "cambió por afuera")
      expect((lib.db.prepare('SELECT mtime FROM files WHERE id = ?').get(id) as { mtime: number }).mtime).toBe(fs.statSync(tema).mtimeMs)
    } finally { lib.close() }
  })
})

describe('última medición de la etapa 3: sugerencias de "¿De quién es?"', () => {
  // "Electronica/House/Unknown Artist - A1 I Wish VINYL ONLY  [FLIP].aiff": la carta sugería artista "Unknown Artist" (un "no sé" de
  // otro programa, isPlaceholder en core/names.ts) y título "A1 I Wish VINYL ONLY" (revision-armar.ts, delNombre)
  it('no sugiere "Unknown Artist" de artista', () => {
    expect(delNombre('Electronica/House/Unknown Artist - A1 I Wish VINYL ONLY  [FLIP].aiff')?.artista ?? null).not.toBe('Unknown Artist')
  })

  // "pendrive/…/AL046 - KASST - Hope Im Alone.mp3": sugería artista "AL046" (el código de catálogo del sello, isCatalog) y título
  // "KASST - Hope Im Alone"; el artista es KASST
  it('saltea el código de catálogo del sello: "AL046 - KASST - Hope Im Alone" → KASST / Hope Im Alone', () => {
    expect(delNombre('pendrive/ambien-introsoutros/AL046 - KASST - Hope Im Alone.mp3')).toEqual({ artista: 'KASST', titulo: 'Hope Im Alone' })
  })
})
