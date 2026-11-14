// Deshacer encadenado y sin restos (MASTERPLAN-5, etapa 4; core/history-cadena.ts, core/restos.ts), con archivos de verdad: aplicar
// repetidos → nombres → mover → tapas (cuatro Aplicar, y también todo junto en uno), deshacer todo, y la carpeta queda idéntica a la
// original, byte a byte y con 0 carpetas de más. Deshacer una tanda vieja ofrece la cadena; sin la cadena no se hace nada (riesgo 7);
// si algo de la cadena no se puede deshacer, la vieja tampoco. La tapa que puso PAILA va a la papelera, no se borra.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
import { Replacer } from '@paila/core/replace'
import { Improver } from '@paila/core/improve'
import { EmptyDirs } from '@paila/core/emptydirs'
import { History } from '@paila/core/history'
import { guardarRegla } from '@paila/core/estado-dejar'
import { proponerMover, proponerPapelera } from '@paila/core/propuestas'
import { aplicarTodo } from '@paila/core/aplicar'
import { C } from '@paila/core/history-cadena.textos'
import { ahora } from '@paila/core/reloj'
import { podarPapelera } from '@paila/core/restos'
import type { HistoryEntry } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const REGLA = { rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la regla y la carpeta de fábrica

/** Una carpeta de música de prueba con PAILA encima (base, cambios con respaldo, papelera, organizador e Historial). */
async function armar(temas: [string, Record<string, string>, number][], copias: [string, string][] = [], vacias: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-cadena-'))
  const M = (rel = '') => path.join(dir, 'M', ...rel.split('/').filter(Boolean))
  for (const [rel, meta, freq] of temas) {
    fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
  }
  for (const [de, a] of copias) fs.copyFileSync(M(de), M(a))
  for (const v of vacias) fs.mkdirSync(M(v), { recursive: true })
  const lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  guardarRegla(lib.db, REGLA)
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  const trash = new Trash(lib.db, rootPath, new Playlists(lib.db, (i) => lib.trackPath(i)))
  const organizer = new Organizer(lib.db, rootPath)
  const carpetas = new EmptyDirs(lib.db, () => lib.roots().map((r) => ({ id: r.id, path: r.path, available: true, rules: [] })))
  const histDeps = { changes, trash, organizer, replacer: new Replacer(lib.db, rootPath, ffprobe, ffmpeg), improver: new Improver(lib.db), carpetas, rootPath }
  const hist = new History(lib.db, histDeps)
  const id = (nombre: string) => (lib.db.prepare("SELECT id FROM files WHERE rel_path LIKE ? AND trashed_at IS NULL").get(`%${nombre}`) as { id: number }).id
  const deps = { db: lib.db, changes, trash, organizer }
  const jpg = () => { const f = path.join(dir, 'tapa.jpg'); execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', f]); return fs.readFileSync(f) }
  const tapa = (fileId: number) => changes.stage([fileId], 'folderCover', JSON.stringify({ mime: 'image/jpeg', ref: changes.covers.put(jpg()) }))
  const mover = () => proponerMover(lib.db, organizer.plan(REGLA, true).moves)
  return { dir, M, lib, changes, organizer, carpetas, hist, histDeps, id, deps, tapa, mover, cerrar: () => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
type Bib = Awaited<ReturnType<typeof armar>>

/** Cómo está la carpeta: cada archivo con su contenido (hash) y cada carpeta. Lo de PAILA (_PAILA) aparte. */
function foto(raiz: string) {
  const archivos: Record<string, string> = {}, carpetas: string[] = []
  const ir = (rel: string) => {
    for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (r === '_PAILA') continue
      if (e.isDirectory()) { carpetas.push(r); ir(r) } else archivos[r] = createHash('sha1').update(fs.readFileSync(path.join(raiz, r))).digest('hex')
    }
  }
  ir('')
  return { archivos, carpetas: carpetas.sort() }
}
const aplicar = async (b: Bib) => { const r = await aplicarTodo(b.deps); expect(r.failed).toEqual([]); return r.tanda! }
const entrada = (b: Bib, tanda: number) => b.hist.list().find((e) => e.kind === 'aplicar' && e.id === tanda) as HistoryEntry

const TEMAS: [string, Record<string, string>, number][] = [
  ['Descargas/uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' }, 300],
  ['Descargas/dos.mp3', { artist: 'La Renga', title: 'Dos', album: 'Disco A', date: '1996', track: '2' }, 500],
  ['Otros/tres.mp3', { artist: 'Soda', title: 'Tres', album: 'Disco B', date: '1990', track: '3' }, 700],
]

describe('repetidos → nombres → mover → tapas en cuatro Aplicar, y deshacer todo: idéntico al original', () => {
  let b: Bib, original: ReturnType<typeof foto>
  const t: Record<string, number> = {}
  beforeAll(async () => {
    b = await armar(TEMAS, [['Descargas/uno.mp3', 'Descargas/uno (1).mp3']])
    original = foto(b.M())
    proponerPapelera(b.lib.db, [{ id: b.id('uno (1).mp3'), kept: b.id('Descargas/uno.mp3') }], 'Duplicados'); t.repetidos = await aplicar(b)
    b.changes.stage([b.id('dos.mp3')], 'title', 'Dos (Remaster)'); t.nombres = await aplicar(b)
    b.mover(); t.mover = await aplicar(b)
    b.tapa(b.id('01 - Uno.mp3')); t.tapas = await aplicar(b)
  }, 120_000)
  afterAll(() => b.cerrar())

  it('cada Aplicar es una sola entrada del Historial, y cada una sabe qué vino después y la toca', () => {
    const l = b.hist.list()
    expect(l.filter((e) => e.kind === 'aplicar').map((e) => e.id)).toEqual([t.tapas, t.mover, t.nombres, t.repetidos])
    expect(l.filter((e) => e.kind !== 'aplicar')).toEqual([]) // las partes van adentro de su Aplicar
    expect(fs.existsSync(b.M('Biblioteca/La Renga/1996 - Disco A/cover.jpg'))).toBe(true)
    // los repetidos no los tocó nadie después; los nombres, sí: el tema renombrado se movió y en su carpeta se puso la tapa
    expect(entrada(b, t.repetidos).cadena ?? []).toEqual([])
    expect(entrada(b, t.nombres).cadena!.map((c) => c.id)).toEqual([t.tapas, t.mover])
    expect(entrada(b, t.mover).cadena!.map((c) => c.id)).toEqual([t.tapas])
    expect(entrada(b, t.tapas).cadena ?? []).toEqual([])
    expect(l.every((e) => e.canUndo)).toBe(true)
  })

  it('sin la cadena no se hace nada (nada a medias): el tema sigue movido y con tapa', async () => {
    await expect(b.hist.undo('aplicar', t.mover)).rejects.toThrow(C.hayCadena(1))
    expect(fs.existsSync(b.M('Biblioteca/La Renga/1996 - Disco A/01 - Uno.mp3'))).toBe(true)
    expect(fs.existsSync(b.M('Biblioteca/La Renga/1996 - Disco A/cover.jpg'))).toBe(true)
  })

  it('"Volver a como estaba" tiene un punto por cada Aplicar, con todo lo que deshace', () => {
    const ps = b.hist.puntos()
    expect(ps.map((p) => p.tanda)).toEqual([t.tapas, t.mover, t.nombres, t.repetidos])
    expect(ps.find((p) => p.tanda === t.nombres)!.entradas.map((e) => e.id)).toEqual([t.tapas, t.mover, t.nombres])
    expect(ps.every((p) => p.canUndo)).toBe(true)
  })

  it('deshacer el mover con su cadena: primero la tapa (a la papelera, no se borra), después el mover, sin Biblioteca/ vacía', async () => {
    const r = await b.hist.undo('aplicar', t.mover, { cadena: true })
    expect(r.failed).toEqual([])
    expect(r.tandas).toBe(2)
    expect(fs.existsSync(b.M('Biblioteca'))).toBe(false)
    expect(fs.existsSync(b.M('Descargas/uno.mp3'))).toBe(true)
    expect(fs.existsSync(b.M('Descargas/cover.jpg'))).toBe(false)
    const pap = fs.readdirSync(b.M('_PAILA/papelera')).find((d) => d.includes('_tapas-deshechas_'))!
    expect(fs.existsSync(path.join(b.M('_PAILA/papelera'), pap, 'Biblioteca', 'La Renga', '1996 - Disco A', 'cover.jpg'))).toBe(true)
    expect(entrada(b, t.nombres).cadena ?? []).toEqual([]) // lo que lo tocaba ya se deshizo
  }, 60_000)

  it('volver a como estaba antes de los repetidos: idéntico al original, byte a byte, con 0 carpetas de más', async () => {
    const r = await b.hist.volver(t.repetidos)
    expect(r.failed).toEqual([])
    expect(r.tandas).toBe(2)
    expect(foto(b.M())).toEqual(original)
    expect(b.hist.puntos()).toEqual([])
  }, 60_000)
})

describe('todo junto en un solo Aplicar, y deshacerlo de una', () => {
  let b: Bib, original: ReturnType<typeof foto>
  beforeAll(async () => {
    b = await armar(TEMAS, [['Descargas/dos.mp3', 'Descargas/dos copia.mp3']])
    original = foto(b.M())
  }, 60_000)
  afterAll(() => b.cerrar())

  it('papelera, nombres, mover y tapas en una tanda; Deshacer la deja idéntica, sin la tapa suelta ni carpetas nuevas', async () => {
    proponerPapelera(b.lib.db, [{ id: b.id('dos copia.mp3'), kept: b.id('Descargas/dos.mp3') }], 'Duplicados')
    b.changes.stage([b.id('tres.mp3')], 'title', 'Tres (En vivo)')
    b.mover()
    b.tapa(b.id('Descargas/uno.mp3'))
    const tanda = await aplicar(b)
    const e = entrada(b, tanda)
    expect(e.partes!.map((p) => p.kind)).toEqual(['papelera', 'tags', 'organizar', 'carpetas', 'tags'])
    expect(e.summary).toMatch(/^Aplicaste 6 cambios: 1 a la papelera, 1 de nombres y tags, 3 temas movidos, 1 tapa y 2 carpetas vacías sacadas$/)
    expect(b.hist.detail('aplicar', tanda).total).toBe(8) // 6 cambios y las 2 carpetas que quedaron vacías
    const r = await b.hist.undo('aplicar', tanda)
    expect(r.failed).toEqual([])
    expect(foto(b.M())).toEqual(original)
    expect(entrada(b, tanda).undone).toBe(true)
  }, 90_000)
})

describe('volver de la papelera no deja la carpeta de la tanda vacía (core/restos.ts, podarPapelera)', () => {
  it('saca la tanda vacía hasta la papelera (también con la carpeta unida "Rock/…") y deja lo que tiene algo', () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-podar-'))
    const mk = (rel: string) => fs.mkdirSync(path.join(raiz, ...rel.split('/')), { recursive: true })
    mk('_PAILA/papelera/t1_tanda-1/A/B'); mk('_PAILA/papelera/t2_tanda-2/C'); fs.writeFileSync(path.join(raiz, '_PAILA/papelera/t2_tanda-2/C/x.mp3'), 'x')
    mk('Rock/_PAILA/papelera/t3_tanda-3/D'); mk('Otra/vacia')
    podarPapelera(raiz, '_PAILA/papelera/t1_tanda-1/A/B')
    podarPapelera(raiz, '_PAILA/papelera/t2_tanda-2/C')
    podarPapelera(raiz, 'Rock/_PAILA/papelera/t3_tanda-3/D')
    podarPapelera(raiz, 'Otra/vacia') // fuera de la papelera: no se toca
    expect(fs.existsSync(path.join(raiz, '_PAILA/papelera/t1_tanda-1'))).toBe(false)
    expect(fs.existsSync(path.join(raiz, '_PAILA/papelera/t2_tanda-2/C/x.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(raiz, 'Rock/_PAILA/papelera/t3_tanda-3'))).toBe(false)
    expect(fs.existsSync(path.join(raiz, 'Rock/_PAILA/papelera'))).toBe(true)
    expect(fs.existsSync(path.join(raiz, '_PAILA/papelera'))).toBe(true)
    expect(fs.existsSync(path.join(raiz, 'Otra/vacia'))).toBe(true)
    fs.rmSync(raiz, { recursive: true, force: true })
  })
})

describe('el orden del Historial no depende del milisegundo', () => {
  it('dos cosas seguidas nunca quedan con la misma hora: la segunda va después (core/reloj.ts)', () => {
    const horas = Array.from({ length: 50 }, () => ahora())
    expect(new Set(horas).size).toBe(50)
    expect([...horas].sort()).toEqual(horas)
  })
})

describe('la cadena: lo que no se toca no se encadena, y lo que no se puede deshacer frena todo', () => {
  let b: Bib
  beforeAll(async () => { b = await armar(TEMAS, [], ['Biblioteca']) }, 60_000) // una carpeta tuya que ya estaba vacía
  afterAll(() => b.cerrar())

  it('dos tandas de tags en campos distintos del mismo tema no se tocan; en el mismo campo, sí', async () => {
    const uno = b.id('uno.mp3')
    b.changes.stage([uno], 'genre', 'Rock'); const g = await aplicar(b)
    b.changes.stage([uno], 'comment', 'hola'); const c = await aplicar(b)
    expect(entrada(b, g).cadena ?? []).toEqual([])
    b.changes.stage([uno], 'genre', 'Rock Nacional'); const g2 = await aplicar(b)
    expect(entrada(b, g).cadena!.map((x) => x.id)).toEqual([g2])
    expect(entrada(b, c).cadena ?? []).toEqual([])
    await b.hist.undo('aplicar', g, { cadena: true })
    await b.hist.undo('aplicar', c)
  }, 60_000)

  it('una carpeta tuya que ya estaba vacía queda al deshacer (solo se sacan las que creó PAILA)', async () => {
    b.mover(); const m = await aplicar(b)
    expect(fs.readdirSync(b.M('Biblioteca')).length).toBeGreaterThan(0)
    await b.hist.undo('aplicar', m)
    expect(fs.existsSync(b.M('Biblioteca'))).toBe(true)
    expect(fs.readdirSync(b.M('Biblioteca'))).toEqual([])
    expect(fs.existsSync(b.M('Descargas/uno.mp3'))).toBe(true)
  }, 60_000)

  it('Aplicar saca las carpetas que dejó vacías al mover, en la misma tanda, y deshacer las vuelve a poner', async () => {
    b.mover(); const m = await aplicar(b)
    expect([fs.existsSync(b.M('Descargas')), fs.existsSync(b.M('Otros'))]).toEqual([false, false])
    const e = entrada(b, m)
    expect(e.partes!.map((x) => x.kind)).toEqual(['organizar', 'carpetas'])
    expect(e.cadena ?? []).toEqual([])
    const r = await b.hist.undo('aplicar', m)
    expect(r.failed).toEqual([])
    expect(fs.existsSync(b.M('Descargas/uno.mp3'))).toBe(true)
    expect(fs.readdirSync(b.M('Biblioteca'))).toEqual([])
  }, 60_000)

  it('si algo de la cadena no se puede deshacer, la tanda vieja tampoco, y no se toca nada', async () => {
    // "Otros" no queda vacía al mover (tiene una subcarpeta con un texto); después se borra y Espacio la saca: va en la cadena del mover
    fs.mkdirSync(b.M('Otros/sub')); fs.writeFileSync(b.M('Otros/sub/leeme.txt'), 'hola')
    fs.mkdirSync(b.M('Descargas/fotos')); fs.writeFileSync(b.M('Descargas/fotos/x.txt'), 'x') // así este mover no saca ninguna carpeta él mismo
    b.mover(); const m = await aplicar(b)
    const raiz = b.lib.roots()[0]
    fs.rmSync(b.M('Otros/sub/leeme.txt'))
    expect(b.carpetas.remove([{ rootId: raiz.id, rel: 'Otros/sub' }, { rootId: raiz.id, rel: 'Otros' }]).removed).toBe(2)
    const antes = foto(b.M())
    // para el Historial, el disco de esas carpetas no está: deshacer "carpetas vacías" no se puede, y entonces el mover tampoco
    const sinDisco = new EmptyDirs(b.lib.db, () => [{ id: raiz.id, path: raiz.path, available: false, rules: [] }])
    const h = new History(b.lib.db, { ...b.histDeps, carpetas: sinDisco })
    const mov = h.list().find((x) => x.kind === 'aplicar' && x.id === m)!
    expect(mov.cadena!.map((x) => x.kind)).toEqual(['carpetas'])
    expect(mov.canUndo).toBe(false)
    expect(mov.whyNot).toMatch(/^Para deshacer esta hay que deshacer antes «Se sacaron 2 carpetas vacías», y esa no se puede/)
    await expect(h.undo('aplicar', m, { cadena: true })).rejects.toThrow(/Para deshacer esta/)
    expect(h.puntos().find((p) => p.tanda === m)).toMatchObject({ canUndo: false })
    expect(foto(b.M())).toEqual(antes)
    // con el disco, vuelve todo
    const r = await b.hist.volver(m)
    expect(r.failed).toEqual([])
    expect(fs.existsSync(b.M('Descargas/uno.mp3'))).toBe(true)
  }, 60_000)
})
