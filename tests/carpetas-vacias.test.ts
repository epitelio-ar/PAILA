// Sacar las carpetas vacías desde Espacio (core/emptydirs.ts; punto 1 real del 24/10: después de Organizar quedaron 103): solo las
// vacías de verdad, de la más adentro a la de afuera, nunca la raíz, _PAILA, los sample packs, PIONEER ni un proyecto de Ableton;
// en el Historial, y Deshacer las vuelve a crear. Con carpetas de verdad.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { Space } from '@paila/core/space'
import { History, type HistoryDeps } from '@paila/core/history'

let dir: string, lib: Library, space: Space, hist: History
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const mk = (rel: string) => fs.mkdirSync(M(rel), { recursive: true })
const put = (rel: string, data = 'x') => { mk(path.posix.dirname(rel)); fs.writeFileSync(M(rel), data) }
const empties = () => space.junk().emptyDirs.map((d) => d.rel).sort()

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-vacias-'))
  mk('Rock/La Renga/1996 - Despedazado/CD2') // vacías anidadas: la de adentro y las que solo la tienen a ella
  mk('Viejo/Vacia')
  put('Rock/Divididos/01 - Que ves.mp3') // con un tema: no
  put('Oculta/desktop.ini') // con un archivo oculto: no está vacía
  mk('Samples/Kicks/Vacia') // dentro de un sample pack: no
  mk('PIONEER/rekordbox') // el export de Rekordbox: no
  put('Sets/Mi Proyecto Project/Ableton Project Info/x.cfg'); mk('Sets/Mi Proyecto Project/Samples/Recorded') // Ableton: no
  mk('_PAILA/papelera') // lo de PAILA: no
  lib = new Library(path.join(dir, 'paila.db'), null)
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  space = new Space(lib.db, () => lib.roots())
  const rootPath = (id: number) => lib.roots().find((r) => r.id === id)?.path ?? null
  hist = new History(lib.db, { rootPath, carpetas: space.empty, improver: { batches: () => [] } } as unknown as HistoryDeps)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })
afterEach(() => { delete process.env.PAILA_SOLO_LECTURA })

describe('Espacio: sacar carpetas vacías', () => {
  it('la vista previa trae solo las vacías de verdad, fuera de lo protegido', () => {
    expect(empties()).toEqual(['Rock/La Renga', 'Rock/La Renga/1996 - Despedazado', 'Rock/La Renga/1996 - Despedazado/CD2', 'Viejo', 'Viejo/Vacia'])
  })

  it('con PAILA abierta solo para mirar no saca nada', () => {
    process.env.PAILA_SOLO_LECTURA = '1'
    expect(() => space.empty.remove(space.junk().emptyDirs)).toThrow(/solo para mirar/)
    expect(fs.existsSync(M('Viejo/Vacia'))).toBe(true)
  })

  it('vuelve a mirar cada una: lo protegido, la raíz y lo que ya no está vacío no se toca', () => {
    const root = lib.roots()[0].id
    const r = space.empty.remove(['', '_PAILA/papelera', 'Samples/Kicks/Vacia', 'PIONEER/rekordbox', 'Sets/Mi Proyecto Project/Samples/Recorded', 'Oculta', '../afuera']
      .map((rel) => ({ rootId: root, rel })))
    expect(r.removed).toBe(0)
    expect(r.failed.map((f) => f.error)).toEqual(expect.arrayContaining([expect.stringMatching(/Ruta no válida/), expect.stringMatching(/sample pack/), expect.stringMatching(/Ya no está vacía/)]))
    for (const rel of ['_PAILA/papelera', 'Samples/Kicks/Vacia', 'PIONEER/rekordbox', 'Sets/Mi Proyecto Project/Samples/Recorded', 'Oculta']) expect(fs.existsSync(M(rel)), rel).toBe(true)
  })

  it('las saca de la más adentro a la de afuera, queda en el Historial y Deshacer las vuelve a crear', async () => {
    const r = space.empty.remove(space.junk().emptyDirs)
    expect(r).toMatchObject({ removed: 5, failed: [] })
    expect(fs.existsSync(M('Rock/La Renga'))).toBe(false)
    expect(fs.existsSync(M('Rock/Divididos/01 - Que ves.mp3'))).toBe(true)
    expect(empties()).toEqual([])
    const e = hist.list().find((x) => x.kind === 'carpetas')!
    expect(e).toMatchObject({ id: r.batch, files: 5, summary: 'Se sacaron 5 carpetas vacías', canUndo: true })
    expect(hist.detail('carpetas', e.id).rows.map((x) => x.name)).toContain('CD2')
    expect(await hist.undo('carpetas', e.id)).toEqual({ done: 5, failed: [] })
    expect(fs.existsSync(M('Rock/La Renga/1996 - Despedazado/CD2'))).toBe(true)
    expect(empties()).toHaveLength(5)
    expect(hist.list().find((x) => x.kind === 'carpetas')).toMatchObject({ undone: true, canUndo: false })
  })
})

describe.runIf(process.platform === 'win32')('Espacio: carpetas vacías con el "solo lectura" de Windows', () => {
  it('se les saca el atributo para sacarlas (en exFAT, si no, EPERM) y al deshacer se les vuelve a poner', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-vacias-ro-'))
    const R = (rel: string) => path.join(d, 'M', ...rel.split('/'))
    fs.mkdirSync(R('Rock/Limp Bizkit'), { recursive: true }); fs.writeFileSync(R('Rock/tema.mp3'), 'x')
    fs.chmodSync(R('Rock/Limp Bizkit'), 0o555) // como las que tuvieron ícono propio (desktop.ini)
    const l = new Library(path.join(d, 'paila.db'), null)
    try {
      await l.addRoot(R(''), [{ rel: '', kind: 'musica' }])
      const s = new Space(l.db, () => l.roots())
      const h = new History(l.db, { rootPath: (id: number) => l.roots().find((r) => r.id === id)?.path ?? null, carpetas: s.empty, improver: { batches: () => [] } } as unknown as HistoryDeps)
      expect(s.empty.remove(s.junk().emptyDirs)).toMatchObject({ removed: 1, failed: [] })
      expect(fs.existsSync(R('Rock/Limp Bizkit'))).toBe(false)
      const e = h.list().find((x) => x.kind === 'carpetas')!
      expect(await h.undo('carpetas', e.id)).toEqual({ done: 1, failed: [] })
      expect(fs.statSync(R('Rock/Limp Bizkit')).mode & 0o200).toBe(0) // vuelve de solo lectura
      fs.chmodSync(R('Rock/Limp Bizkit'), 0o777)
    } finally { l.close(); fs.rmSync(d, { recursive: true, force: true }) }
  })
})
