// Las propuestas guardadas y un solo Aplicar (core/propuestas.ts, core/aplicar.ts; MASTERPLAN-5, etapa 2), con archivos de verdad:
// lo propuesto queda en la base; Aplicar hace papelera → nombres → mover → tapas en ese orden y anota una tanda; nada se aplica sobre
// un archivo que cambió desde que se miró (riesgo 2); nunca un "(2)" sin aceptarlo (riesgo 3); y "Dejar como está" lo respetan
// Duplicados, Nombres y Tapas.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Organizer } from '@paila/core/organizer'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Playlists } from '@paila/core/playlists'
import { albumGroups } from '@paila/core/albums'
import { Covers } from '@paila/core/covers'
import type { AlbumCheck } from '@paila/core/albumrun'
import { tapasAlDia } from '@paila/core/covers-guardadas'
import { tidy } from '@paila/core/tidy'
import { dejarComoEsta, guardarRegla } from '@paila/core/estado-dejar'
import { proponerMover, proponerPapelera, propuestas, T as TP } from '@paila/core/propuestas'
import { aplicarTodo, descartar, paraAplicar } from '@paila/core/aplicar'
import { guardarRepetidos, repetidosAlDia } from '@paila/core/repetidos-guardados'
import type { CoverProposal, DupGroup } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const REGLA = { rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la regla y la carpeta de fábrica

/** Una carpeta de música de prueba con PAILA encima (base, cambios, papelera y organizador). */
async function armar(temas: [string, Record<string, string>, number][], copias: [string, string][] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-aplicar-'))
  const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
  for (const [rel, meta, freq] of temas) {
    fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
  }
  for (const [de, a] of copias) fs.copyFileSync(M(de), M(a))
  const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  const trash = new Trash(lib.db, rootPath, new Playlists(lib.db, (i) => lib.trackPath(i)))
  const organizer = new Organizer(lib.db, rootPath)
  const id = (nombre: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${nombre}`) as { id: number }).id
  const rel = (fileId: number) => (lib.db.prepare('SELECT rel_path AS r FROM files WHERE id = ?').get(fileId) as { r: string }).r
  /** Cambia el archivo "por afuera" (como un editor de tags): otro tamaño y otra fecha. */
  const tocar = (fileId: number) => { const p = lib.trackPath(fileId)!; fs.appendFileSync(p, Buffer.alloc(64)); const t = new Date(Date.now() + 60_000); fs.utimesSync(p, t, t) }
  const deps = { db: lib.db, changes, trash, organizer }
  return { dir, M, lib, changes, trash, organizer, id, rel, tocar, deps, cerrar: () => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
type Bib = Awaited<ReturnType<typeof armar>>
const jpg = (dir: string) => { const f = path.join(dir, 'tapa.jpg'); execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', f]); return fs.readFileSync(f) }

describe('un solo Aplicar: papelera → nombres → mover → tapas, en una tanda', () => {
  let b: Bib
  beforeAll(async () => {
    b = await armar([
      ['Descargas/uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' }, 300],
      ['Descargas/dos.mp3', { artist: 'La Renga', title: 'Dos', album: 'Disco A', date: '1996', track: '2' }, 500],
    ], [['Descargas/uno.mp3', 'Descargas/uno (1).mp3']])
    guardarRegla(b.lib.db, REGLA)
  }, 60_000)
  afterAll(() => b.cerrar())

  it('lo propuesto queda en la base (salís y volvés: sigue ahí) y va a la misma lista que los cambios de tags', () => {
    const uno = b.id('Descargas/uno.mp3'), copia = b.id('uno (1).mp3'), dos = b.id('dos.mp3')
    proponerPapelera(b.lib.db, [{ id: copia, kept: uno }], 'Duplicados')
    b.changes.stage([dos], 'title', 'Dos (Remaster)')
    // Organizar mira cómo van a quedar: la copia que se va no choca ("(2)") y "Dos" ya se llama como se va a llamar
    const plan = b.organizer.plan(REGLA, true)
    expect(plan.clashes).toEqual([])
    expect(plan.moves.map((m) => m.to).sort()).toEqual(['Biblioteca/La Renga/1996 - Disco A/01 - Uno.mp3', 'Biblioteca/La Renga/1996 - Disco A/02 - Dos (Remaster).mp3'])
    expect(b.organizer.plan(REGLA).clashes!.length).toBe(1) // sin mirar el futuro, la copia chocaba
    proponerMover(b.lib.db, plan.moves)
    b.changes.stage([uno], 'folderCover', JSON.stringify({ mime: 'image/jpeg', ref: b.changes.covers.put(jpg(b.dir)) }))
    const lista = paraAplicar(b.lib.db, b.changes)
    expect(lista.map((c) => c.field).sort()).toEqual(['folderCover', 'mover', 'mover', 'papelera', 'title'])
    expect(lista.filter((c) => c.field === 'papelera' || c.field === 'mover').every((c) => c.id < 0)).toBe(true)
    expect(propuestas(b.lib.db).length).toBe(3)
  })

  it('Aplicar lo hace en orden: la copia a la papelera, el nombre escrito, se mueve con el nombre nuevo y la tapa va a la carpeta nueva', async () => {
    const uno = b.id('Descargas/uno.mp3'), dos = b.id('dos.mp3')
    const r = await aplicarTodo(b.deps)
    expect(r.failed).toEqual([])
    expect(r.partes).toEqual({ papelera: 1, tags: 1, mover: 2, tapas: 1, reemplazos: 0 })
    expect(b.rel(dos)).toBe('Biblioteca/La Renga/1996 - Disco A/02 - Dos (Remaster).mp3')
    expect(b.rel(uno)).toBe('Biblioteca/La Renga/1996 - Disco A/01 - Uno.mp3')
    expect(fs.existsSync(b.M('Biblioteca/La Renga/1996 - Disco A/cover.jpg'))).toBe(true)
    expect(fs.existsSync(b.M('Descargas/cover.jpg'))).toBe(false)
    expect(fs.existsSync(b.M('Descargas/uno (1).mp3'))).toBe(false)
    expect(paraAplicar(b.lib.db, b.changes)).toEqual([])
    const tanda = b.lib.db.prepare('SELECT partes FROM tandas WHERE id = ?').get(r.tanda) as { partes: string }
    // con "carpetas": la de donde salió todo quedó vacía y se sacó (decisión del autor del 13/11)
    expect(Object.keys(JSON.parse(tanda.partes)).sort()).toEqual(['carpetas', 'mover', 'papelera', 'tags', 'tapas'])
  }, 60_000)

  it('cada parte se sigue deshaciendo desde el Historial: deshacer el mover devuelve los temas', async () => {
    const uno = b.id('01 - Uno.mp3')
    const r = await b.organizer.undo(b.organizer.batches()[0].batchId)
    expect(r.failed).toEqual([])
    expect(b.rel(uno)).toBe('Descargas/uno.mp3')
  }, 30_000)
})

describe('nada se aplica sobre un archivo que cambió (riesgo 2) ni con un "(2)" sin aceptar (riesgo 3)', () => {
  let b: Bib
  beforeAll(async () => {
    b = await armar([
      ['A/uno.mp3', { artist: 'Soda', title: 'Uno', album: 'Disco', date: '1990', track: '1' }, 300],
      ['A/dos.mp3', { artist: 'Soda', title: 'Dos', album: 'Disco', date: '1990', track: '2' }, 500],
      ['B/mismo.mp3', { artist: 'Fito', title: 'Igual' }, 700],
      ['C/mismo.mp3', { artist: 'Fito', title: 'Igual' }, 900], // otro tema con los mismos tags: no es un repetido
      ['D/tres.mp3', { artist: 'Soda', title: 'Tres' }, 1100],
    ], [['A/uno.mp3', 'A/uno copia.mp3']])
    guardarRegla(b.lib.db, REGLA)
  }, 60_000)
  afterAll(() => b.cerrar())

  it('un repetido que se editó afuera después de proponerlo no va a la papelera: vuelve a la lista con el motivo', async () => {
    const copia = b.id('uno copia.mp3')
    proponerPapelera(b.lib.db, [{ id: copia, kept: b.id('A/uno.mp3') }], 'Duplicados')
    b.tocar(copia)
    const r = await aplicarTodo(b.deps)
    expect(r.partes.papelera).toBe(0)
    expect(fs.existsSync(b.lib.trackPath(copia)!)).toBe(true)
    expect(paraAplicar(b.lib.db, b.changes).find((c) => c.fileId === copia)?.error).toMatch(/Cambió/)
    descartar(b.lib.db, b.changes)
  }, 30_000)

  it('un cambio de nombre sobre un archivo que cambió afuera no se escribe', async () => {
    const dos = b.id('A/dos.mp3')
    b.changes.stage([dos], 'title', 'Dos bis')
    b.tocar(dos)
    const antes = fs.readFileSync(b.lib.trackPath(dos)!)
    const r = await aplicarTodo(b.deps)
    expect(r.partes.tags).toBe(0)
    expect(r.failed[0].error).toBe(TP.cambio)
    expect(fs.readFileSync(b.lib.trackPath(dos)!).equals(antes)).toBe(true)
    descartar(b.lib.db, b.changes)
  }, 30_000)

  it('lo que PAILA misma escribe no cuenta como cambio de afuera: un tag y después la tapa del mismo tema', async () => {
    const uno = b.id('A/uno.mp3')
    b.changes.stage([uno], 'title', 'Uno bis')
    b.changes.stage([uno], 'folderCover', JSON.stringify({ mime: 'image/jpeg', ref: b.changes.covers.put(jpg(b.dir)) }))
    const r = await aplicarTodo(b.deps)
    expect(r.failed).toEqual([])
    expect(r.partes).toMatchObject({ tags: 1, tapas: 1 })
  }, 30_000)

  it('si al aplicar el lugar ya no es el que se vio, no se mueve: vuelve a Organizar con el motivo', async () => {
    const tres = b.id('tres.mp3')
    proponerMover(b.lib.db, [{ fileId: tres, rootId: 1, from: b.rel(tres), to: 'Otro/lugar/tres.mp3' }])
    const r = await aplicarTodo(b.deps)
    expect(r.partes.mover).toBe(0)
    expect(r.failed[0].error).toMatch(/otro lugar/i)
    expect(b.rel(tres)).toBe('D/tres.mp3')
  }, 30_000)
  it('dos temas distintos que irían al mismo lugar: el que choca no se suma sin aceptar el "(2)", y nunca aparece un "(2)" solo', async () => {
    await b.lib.scan() // lo que se tocó afuera en las pruebas de arriba: PAILA lo ve al escanear
    const plan = b.organizer.plan(REGLA, true)
    const choca = new Set(plan.clashes!.map((c) => c.fileId))
    expect(choca.size).toBe(1)
    proponerMover(b.lib.db, plan.moves.filter((m) => !choca.has(m.fileId))) // como Organizar sin tildar "moverlos igual"
    const r = await aplicarTodo(b.deps)
    expect(r.failed).toEqual([])
    const lugares = (b.lib.db.prepare('SELECT rel_path AS r FROM files').all() as { r: string }[]).map((x) => x.r)
    expect(lugares.filter((l) => / \(2\)\./.test(l))).toEqual([])
    expect(lugares.filter((l) => /mismo\.mp3$/.test(l)).length).toBe(1) // el que chocaba quedó donde estaba
  }, 30_000)

})

describe('"Dejar como está" lo respetan Duplicados, Nombres y Tapas, y lo encontrado sigue ahí al volver', () => {
  let b: Bib
  beforeAll(async () => {
    b = await armar([
      ['X/uno.mp3', { artist: 'Charly', title: 'Uno', album: 'Disco C', date: '1983', track: '1' }, 300],
      ['X/dos.mp3', { artist: 'Charly', title: 'Dos', album: 'Disco C', date: '1983', track: '2' }, 500],
      ['X/sin artista.mp3', { title: 'Algo' }, 700],
    ], [['X/uno.mp3', 'X/uno (1).mp3']])
  }, 60_000)
  afterAll(() => b.cerrar())

  it('Duplicados: el grupo guardado vuelve al día (con la copia elegida), un archivo que cambió lo saca, y "Dejar como está" no lo muestra más', async () => {
    const uno = b.id('X/uno.mp3'), copia = b.id('uno (1).mp3')
    const grupo = { level: 'exact', label: '', why: '', keep: uno, similarity: null, warning: null,
      items: [uno, copia].map((id) => ({ id, rel: b.rel(id), ext: 'mp3', size: 1, kbps: null, duration: 1, grade: null, kind: 'musica', tagged: true, artist: null, title: null, playlists: [] })) } as DupGroup
    guardarRepetidos(b.lib.db, [grupo])
    proponerPapelera(b.lib.db, [{ id: copia, kept: uno }], 'Duplicados')
    expect(repetidosAlDia(b.lib.db)!.grupos[0].propuesto).toBe(uno)
    dejarComoEsta(b.lib.db, 'repetidos', [uno, copia])
    expect(repetidosAlDia(b.lib.db)!.grupos).toEqual([])
    dejarComoEsta(b.lib.db, 'repetidos', 'todos', false)
    b.tocar(copia); await b.lib.scan() // lo cambiado afuera: PAILA lo ve al escanear
    expect(repetidosAlDia(b.lib.db)).toMatchObject({ grupos: [], cambiaron: 1 })
    descartar(b.lib.db, b.changes)
  })

  it('Nombres: un tema que dejaste como está no recibe propuestas', () => {
    const sin = b.id('sin artista.mp3')
    const antes = tidy(b.lib.db, undefined, (i) => b.lib.trackPath(i)).changes.filter((c) => c.id === sin)
    expect(antes.length).toBeGreaterThan(0)
    dejarComoEsta(b.lib.db, 'nombres', [sin])
    expect(tidy(b.lib.db, undefined, (i) => b.lib.trackPath(i)).changes.filter((c) => c.id === sin)).toEqual([])
  })

  it('Tapas: lo encontrado se lee al día (aunque Organizar movió el disco), se puede sumar igual, y "Dejar como está" lo saca', async () => {
    const disco = albumGroups(b.lib.db, 2).find((g) => g.album === 'Disco C')!
    const sha = b.changes.covers.put(jpg(b.dir))
    const p: CoverProposal = { key: disco.key, dir: disco.dir, artist: 'Charly', album: 'Disco C', tracks: 2, current: null, without: 2, folder: null,
      proposed: { sha, width: 16, height: 16, bytes: 1, source: 'prueba' }, embed: 2, folderFile: true, windowsFolder: false, why: null }
    const cv = new Covers(b.lib.db, b.changes, (i) => b.lib.trackPath(i), {} as AlbumCheck, { ua: 'prueba', useDeezer: () => false })
    cv.last = [p]; for (const t of disco.tracks) cv.sides.set(t.id, 0)
    // Organizar mueve el disco después de buscar: antes proponía "la tapa de 0 temas"
    await b.organizer.apply(b.organizer.plan(REGLA))
    expect(cv.stage([disco.key]).tracks).toBe(disco.tracks.length)
    expect(tapasAlDia(b.lib.db, [p], '2000-01-01')[0]).toMatchObject({ staged: true })
    descartar(b.lib.db, b.changes)
    dejarComoEsta(b.lib.db, 'tapas', disco.tracks.map((t) => t.id))
    expect(tapasAlDia(b.lib.db, [p], '2000-01-01')).toEqual([])
  }, 30_000)
})
