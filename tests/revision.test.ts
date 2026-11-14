// La revisión única, "Ordenar" (core/revision.ts, core/revision-armar.ts, core/revision-apagados.ts; MASTERPLAN-5, etapa 3), con
// archivos de verdad: PAILA suma sola los repetidos comprobados, los nombres y las carpetas; lo "probable por nombre" nunca entra
// tildado (riesgo 1, test de trampa); dos que irían al mismo lugar no se mueven hasta decidir (riesgo 3); lo destildado queda a la
// vista, no se aplica y no cuenta para la carpeta; y las cartas de "Para decidir vos" resuelven ahí mismo.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Organizer } from '@paila/core/organizer'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Playlists } from '@paila/core/playlists'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import { aplicarTodo, paraAplicar } from '@paila/core/aplicar'
import { leerRevision } from '@paila/core/revision'
import { armarCarpetas, armarRepetidos, decidir, delNombre, elegirCarpetas, modoCarpetas } from '@paila/core/revision-armar'
import { apagar, claveCambio } from '@paila/core/revision-apagados'
import type { DupGroup, DupItem } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const REGLA = { rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la regla y la carpeta de fábrica

async function armar(temas: [string, Record<string, string>, number][], copias: [string, string][] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-revision-'))
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
  const d = { db: lib.db, changes, organizer, trash }
  const leer = () => leerRevision(lib.db, changes, organizer)
  return { dir, lib, changes, organizer, id, rel, d, leer, cerrar: () => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const item = (id: number, rel: string): DupItem => ({ id, rel, ext: 'mp3', size: 1, kbps: 128, duration: 1, grade: 'B', kind: 'musica' } as DupItem)
const grupo = (level: DupGroup['level'], items: DupItem[], keep: number | null, decidirlo = false): DupGroup =>
  ({ level, label: level, why: 'prueba', items, keep, similarity: null, warning: null, ...(decidirlo ? { decidir: true } : {}) })

let b: Awaited<ReturnType<typeof armar>> | null = null
afterEach(() => { b?.cerrar(); b = null })

describe('Ordenar se arma solo', () => {
  it('los repetidos comprobados entran tildados; los "probables por nombre" nunca, van a Para decidir vos (trampa)', async () => {
    b = await armar([
      ['A/uno.mp3', { artist: 'La Renga', title: 'Uno' }, 300],
      ['A/Comentario.mp3', { artist: 'La Renga', title: 'Comentario' }, 700],
      ['B/05 - Comentario.mp3', { artist: 'Otro', title: 'Comentario' }, 900],
    ], [['A/uno.mp3', 'B/uno.mp3']])
    const uno = b.id('A/uno.mp3'), copia = b.id('B/uno.mp3'), c1 = b.id('A/Comentario.mp3'), c2 = b.id('05 - Comentario.mp3')
    guardarRepetidos(b.lib.db, [grupo('exact', [item(uno, 'A/uno.mp3'), item(copia, 'B/uno.mp3')], uno),
      grupo('probable', [item(c1, 'A/Comentario.mp3'), item(c2, 'B/05 - Comentario.mp3')], c1, true)])
    armarRepetidos(b.lib.db)
    const r = b.leer()
    expect(r.grupos.rep.map((f) => [f.fileId, f.on])).toEqual([[copia, true]])
    expect(r.grupos.rep[0].antes).toBe('A/uno.mp3') // la copia que se queda
    // el falso repetido no está en la papelera, ni tildado ni destildado: es una carta
    expect(r.grupos.rep.some((f) => f.fileId === c1 || f.fileId === c2)).toBe(false)
    expect(r.decidir.filter((c) => c.tipo === 'par').map((c) => c.clave)).toEqual([`par|${c1},${c2}`])
    // "son distintos": no vuelve
    decidir(b.d, `par|${c1},${c2}`, 'distintos')
    expect(b.leer().decidir.filter((c) => c.tipo === 'par')).toEqual([])
  }, 60_000)

  it('las carpetas se preguntan una vez: sin contestar no se mueve nada; "No tocar mis carpetas" deja el grupo vacío', async () => {
    b = await armar([['Descargas/uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' }, 300]])
    expect(modoCarpetas(b.lib.db)).toBeNull()
    armarCarpetas(b.d)
    expect(b.leer().grupos.mov).toEqual([])
    elegirCarpetas(b.d, REGLA)
    // un disco con un solo tema va directo a la carpeta del artista (organizer.ts)
    expect(b.leer().grupos.mov.map((f) => f.despues)).toEqual(['Biblioteca/La Renga/Uno.mp3'])
    elegirCarpetas(b.d, null)
    expect(modoCarpetas(b.lib.db)).toBe('no-tocar')
    expect(b.leer().grupos.mov).toEqual([])
  }, 60_000)
})

describe('lo destildado', () => {
  it('queda a la vista, no se aplica, y la carpeta se calcula sin ese cambio', async () => {
    b = await armar([['Descargas/uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' }, 300]])
    const uno = b.id('uno.mp3')
    b.changes.stage([uno], 'title', 'Uno (Remaster)')
    elegirCarpetas(b.d, REGLA)
    expect(b.leer().grupos.mov[0].despues).toBe('Biblioteca/La Renga/Uno (Remaster).mp3')
    apagar(b.lib.db, [claveCambio(uno, 'title')])
    armarCarpetas(b.d)
    const r = b.leer()
    expect(r.grupos.nom.map((f) => [f.campo, f.on])).toEqual([['title', false]])
    expect(r.grupos.mov[0].despues).toBe('Biblioteca/La Renga/Uno.mp3')
    expect(paraAplicar(b.lib.db, b.changes).map((c) => c.field)).toEqual(['mover'])
    const res = await aplicarTodo(b.d)
    expect(res.partes).toMatchObject({ tags: 0, mover: 1 })
    expect(b.rel(uno)).toBe('Biblioteca/La Renga/Uno.mp3')
    // sigue en la lista, destildado, para cuando lo quieras
    expect(b.leer().grupos.nom.map((f) => [f.campo, f.on])).toEqual([['title', false]])
  }, 60_000)

  it('lo que vino de internet va en su propio grupo', async () => {
    b = await armar([['A/uno.mp3', { artist: 'La Renga', title: 'Uno' }, 300]])
    const uno = b.id('uno.mp3')
    b.changes.stageMany([{ id: uno, field: 'album', value: 'Despedazado por mil partes' }], 'internet')
    b.changes.stageMany([{ id: uno, field: 'title', value: 'Uno!' }], 'reglas')
    const r = b.leer()
    expect(r.grupos.net.map((f) => f.campo)).toEqual(['album'])
    expect(r.grupos.nom.map((f) => f.campo)).toEqual(['title'])
  }, 60_000)
})

describe('Para decidir vos', () => {
  it('dos que irían al mismo lugar no se mueven hasta elegir; "los dos" les pone "(2)"', async () => {
    b = await armar([
      ['A/x.mp3', { artist: 'Led Zeppelin', title: 'Hats Off', album: 'III', track: '10' }, 300],
      ['B/y.mp3', { artist: 'Led Zeppelin', title: 'Hats Off', album: 'III', track: '10' }, 600],
    ])
    elegirCarpetas(b.d, REGLA)
    let r = b.leer()
    const choques = r.decidir.filter((c) => c.tipo === 'choque')
    expect(choques.length).toBe(1)
    const ch = choques[0] as Extract<typeof choques[number], { tipo: 'choque' }>
    expect(r.grupos.mov.some((f) => f.fileId === ch.fileId)).toBe(false)
    expect(ch.conId).not.toBeNull()
    decidir(b.d, ch.clave, 'version')
    r = b.leer()
    expect(r.decidir.filter((c) => c.tipo === 'choque')).toEqual([])
    expect(r.grupos.mov.length).toBe(2)
    expect(r.grupos.mov.some((f) => / \(\d\)\.mp3$/.test(f.despues ?? ''))).toBe(true)
  }, 60_000)

  it('elegir cuál se queda manda el otro a la papelera y el que queda se mueve', async () => {
    b = await armar([
      ['A/x.mp3', { artist: 'Led Zeppelin', title: 'Hats Off', album: 'III', track: '10' }, 300],
      ['B/y.mp3', { artist: 'Led Zeppelin', title: 'Hats Off', album: 'III', track: '10' }, 600],
    ])
    elegirCarpetas(b.d, REGLA)
    const ch = b.leer().decidir.find((c) => c.tipo === 'choque') as Extract<ReturnType<typeof b.leer>['decidir'][number], { tipo: 'choque' }>
    decidir(b.d, ch.clave, { quedaId: ch.fileId })
    const r = b.leer()
    expect(r.grupos.rep.map((f) => f.fileId)).toEqual([ch.conId])
    expect(r.grupos.mov.map((f) => f.fileId)).toEqual([ch.fileId])
    expect(r.decidir.filter((c) => c.tipo === 'choque')).toEqual([])
  }, 60_000)

  it('un tema sin artista: lo sugiere el nombre del archivo y, al contestar, ya va a su carpeta', async () => {
    b = await armar([['Descargas/01 - Charly Garcia - Demoliendo hoteles.mp3', {}, 300]])
    elegirCarpetas(b.d, REGLA)
    const q = b.leer().decidir.find((c) => c.tipo === 'quien') as Extract<ReturnType<typeof b.leer>['decidir'][number], { tipo: 'quien' }>
    expect(q.sugerido).toEqual({ artista: 'Charly Garcia', titulo: 'Demoliendo hoteles' })
    decidir(b.d, q.clave, q.sugerido!)
    const r = b.leer()
    expect(r.decidir.filter((c) => c.tipo === 'quien')).toEqual([])
    expect(r.grupos.mov.map((f) => f.despues)).toEqual(['Biblioteca/Charly Garcia/Demoliendo hoteles.mp3'])
  }, 60_000)
})

describe('el nombre del archivo', () => {
  it.each([
    ['A/01 - Charly Garcia - Rezo por vos.mp3', { artista: 'Charly Garcia', titulo: 'Rezo por vos' }],
    ['A/Soda Stereo - Persiana americana [320].mp3', { artista: 'Soda Stereo', titulo: 'Persiana americana' }],
    ['A/Track 01.mp3', null],
  ])('%s', (rel, esperado) => { expect(delNombre(rel)).toEqual(esperado) })
})
