// "Pasar a tu Música" de la Bandeja (core/inboxadd.ts; decidido el 22/10): los temas que llegaron y no tenías
// van a la carpeta Recibidos de tu Música con vista previa, quedan en el Historial y deshacer los devuelve a la Bandeja.
// Con cientos de temas, pasar, deshacer y mandar a «no-sirvió» no congelan la ventana.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { InboxAdd, RECEIVED_DIR } from '@paila/core/inboxadd'
import { History, type HistoryDeps } from '@paila/core/history'
import { InboxFlow, REJECT_DIR, type FlowDeps } from '@paila/core/inboxflow'
import type { Inbox } from '@paila/core/inbox'
import type { Wanted } from '@paila/core/wanted'
import type { Replacer } from '@paila/core/replace'
import type { InboxResult } from '@paila/shared/types'

let dir: string, lib: Library, add: InboxAdd, hist: History
const M = () => path.join(dir, 'M'), B = () => path.join(dir, 'Bandeja')
const rootPath = (id: number) => lib.roots().find((r) => r.id === id && r.available)?.path ?? null
const res = (name: string, decision: InboxResult['decision'], extra: Partial<InboxResult> = {}): InboxResult => ({
  path: path.join(B(), name), name, ext: path.extname(name).slice(1), size: 4, kbps: null, duration: 200, codec: null, artist: null, title: null,
  match: null, missing: null, check: null, decision, why: 'x', checkedAt: '', libStamp: null, ...extra,
})

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-pasar-'))
  fs.mkdirSync(path.join(M(), RECEIVED_DIR), { recursive: true })
  fs.writeFileSync(path.join(M(), 'viejo.mp3'), 'x')
  fs.writeFileSync(path.join(M(), RECEIVED_DIR, 'Ya estaba.mp3'), 'ya')
  fs.mkdirSync(B(), { recursive: true })
  for (const f of ['Falta.mp3', 'Nuevo.flac', 'Reemplazo.mp3', 'Ya estaba.mp3']) fs.writeFileSync(path.join(B(), f), f)
  lib = new Library(path.join(dir, 'paila.db'), null)
  const root = await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext) VALUES (?, 'viejo.mp3', 1, 1, 'musica', 'mp3')").run(root.id)
  add = new InboxAdd(lib.db, { rootPath })
  hist = new History(lib.db, { rootPath, added: add, improver: { batches: () => [] } } as unknown as HistoryDeps)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Bandeja → tu Música', () => {
  const results = () => [
    res('Falta.mp3', 'falta', { missing: { wantedId: 1, artist: 'Soda Stereo', title: 'Trátame Suavemente', refRel: null } }),
    res('Nuevo.flac', 'sin-pareja'), res('Reemplazo.mp3', 'reemplazar'), res('Ya estaba.mp3', 'sin-pareja'),
  ]

  it('la vista previa ofrece solo lo que no tenías, en Recibidos y sin pisar nada; no toca nada', () => {
    const p = add.plan(results())
    expect(p.folder).toBe(path.join(M(), RECEIVED_DIR))
    expect(p.items.map((x) => [x.name, x.rel, x.decision])).toEqual([
      ['Falta.mp3', 'Recibidos/Falta.mp3', 'falta'], ['Nuevo.flac', 'Recibidos/Nuevo.flac', 'sin-pareja'], ['Ya estaba.mp3', 'Recibidos/Ya estaba (2).mp3', 'sin-pareja'],
    ])
    expect(p.items[0]).toMatchObject({ artist: 'Soda Stereo', title: 'Trátame Suavemente' })
    expect(fs.readdirSync(B()).sort()).toEqual(['Falta.mp3', 'Nuevo.flac', 'Reemplazo.mp3', 'Ya estaba.mp3'])
  })

  it('pasa los elegidos, queda en el Historial y deshacer los devuelve a la Bandeja', async () => {
    const p = add.plan(results())
    const r = await add.apply(p, [path.join(B(), 'Falta.mp3'), path.join(B(), 'Ya estaba.mp3')])
    expect(r.added).toBe(2)
    expect(fs.readFileSync(path.join(M(), RECEIVED_DIR, 'Falta.mp3'), 'utf8')).toBe('Falta.mp3')
    expect(fs.readFileSync(path.join(M(), RECEIVED_DIR, 'Ya estaba (2).mp3'), 'utf8')).toBe('Ya estaba.mp3')
    expect(fs.readFileSync(path.join(M(), RECEIVED_DIR, 'Ya estaba.mp3'), 'utf8')).toBe('ya') // lo que ya estaba, intacto
    expect(fs.readdirSync(B()).sort()).toEqual(['Nuevo.flac', 'Reemplazo.mp3'])
    const e = hist.list().find((x) => x.kind === 'bandeja')!
    expect(e).toMatchObject({ files: 2, canUndo: true, undone: false })
    expect(e.summary).toContain('2 temas de la Bandeja a tu Música')
    expect(hist.detail('bandeja', e.id).rows.map((x) => x.name)).toEqual(['Falta.mp3', 'Ya estaba (2).mp3'])
    const u = await add.undo(e.id)
    expect(u).toEqual({ done: 2, failed: [] })
    expect(fs.readdirSync(B()).sort()).toEqual(['Falta.mp3', 'Nuevo.flac', 'Reemplazo.mp3', 'Ya estaba.mp3'])
    expect(fs.readdirSync(path.join(M(), RECEIVED_DIR))).toEqual(['Ya estaba.mp3'])
    expect(hist.list().find((x) => x.kind === 'bandeja')).toMatchObject({ undone: true, canUndo: false })
  })

  it('si un archivo cambió de lugar desde la vista previa, se saltea con el motivo', async () => {
    const p = add.plan(results())
    fs.renameSync(path.join(B(), 'Nuevo.flac'), path.join(B(), 'Otro.flac'))
    const r = await add.apply(p, [path.join(B(), 'Nuevo.flac')])
    expect(r.added).toBe(0)
    expect(r.failed[0].error).toBe('Ya no está en la Bandeja')
  })
})

// Como la papelera (22/10): la Bandeja movía de un tirón en el proceso principal y con cientos de temas la ventana
// quedaba congelada. Ahora el motor cede el control entre paso y paso.
describe('la Bandeja no congela la app', () => {
  const N = 300
  /** Corre `fn` contando cuántas veces llegó a correr un reloj de 5 ms en el medio (con el motor de antes: 0). */
  const ticking = async <T>(fn: () => Promise<T>) => {
    let ticks = 0
    const iv = setInterval(() => { ticks++ }, 5)
    try { const r = await fn(); return { r, ticks } } finally { clearInterval(iv) }
  }

  it('pasar 300 temas a tu Música y deshacerlo deja correr la app en el medio', async () => {
    const names = Array.from({ length: N }, (_, i) => `Lote ${i}.mp3`)
    for (const n of names) fs.writeFileSync(path.join(B(), n), n)
    const p = add.plan(names.map((n) => res(n, 'sin-pareja')))
    const pending = add.apply(p, p.items.map((x) => x.path))
    expect(pending).toBeInstanceOf(Promise) // no bloquea: devuelve enseguida
    const ida = await ticking(() => pending)
    expect(ida.r).toMatchObject({ added: N, failed: [] })
    expect(ida.ticks).toBeGreaterThan(0)
    const vuelta = await ticking(() => add.undo(ida.r.batch))
    expect(vuelta.r).toEqual({ done: N, failed: [] })
    expect(vuelta.ticks).toBeGreaterThan(0)
    expect(names.every((n) => fs.existsSync(path.join(B(), n)))).toBe(true)
  })

  it('mandar 300 a «no-sirvió» (Reemplazar todos) tampoco bloquea', async () => {
    const flow = new InboxFlow(lib.db, {} as Inbox, {} as Wanted, {} as Replacer, {} as FlowDeps)
    const reject = Array.from({ length: N }, (_, i) => {
      const name = `Malo ${i}.mp3`
      fs.writeFileSync(path.join(B(), name), name)
      return { path: path.join(B(), name), name, reason: 'prueba' }
    })
    const r = await ticking(() => flow.apply(B(), { replace: [], reject, rekordbox: 0 }))
    expect(r.r).toEqual({ replaced: 0, rejected: N, failed: [] })
    expect(r.ticks).toBeGreaterThan(0)
    expect(fs.readdirSync(path.join(B(), REJECT_DIR)).filter((f) => f.startsWith('Malo '))).toHaveLength(N)
  })
})
