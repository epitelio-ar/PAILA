// Motor de operaciones único (core/ops/) y recuperación con la app abierta (core/recoverywatch.ts): chequeos previos de
// toda la tanda, mover verificado con diario, la Bandeja con diario y un disco que vuelve con PAILA abierta.
// Solo archivos sintéticos en carpetas temporales.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { OpLock } from '@paila/core/oplock'
import { OpJournal } from '@paila/core/journal'
import { guardWith, precheck } from '@paila/core/ops/checks'
import { runMoves, runMovesAsync } from '@paila/core/ops/run'
import type { Step } from '@paila/core/ops/types'
import { Organizer, logMove, type MoveData } from '@paila/core/organizer'
import { RecoveryWatch } from '@paila/core/recoverywatch'
import { recover } from '@paila/core/recovery'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
const tone = (rel: string, meta: Record<string, string> = {}) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
}
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
const openRows = () => (lib.db.prepare('SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL').get() as { n: number }).n
const move = (fileId: number | null, src: string, dst: string, extra: Partial<Step<MoveData>> = {}): Step<MoveData> =>
  ({ kind: 'mover', op: 'organizar', rootId: 1, fileId, src, dst, data: { batchId: 99, rootId: 1, fileId, from: src, to: dst }, ...extra })

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-ops-'))
  for (const n of ['a', 'b', 'c', 'd', 'e']) tone(`Sueltos/${n}.mp3`, { artist: 'Fulano', title: n.toUpperCase() })
  tone('Samples/kick.mp3')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  await lib.scan()
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('chequeos previos (toda la tanda, antes de tocar el primer archivo)', () => {
  it('con el candado registrado, nada corre sin tomarlo', async () => {
    const lock = new OpLock()
    guardWith(lib.db, lock)
    const steps = [move(idOf('Sueltos/a.mp3'), 'Sueltos/a.mp3', 'X/a.mp3')]
    expect(precheck(lib.db, steps, { rootPath }).fatal).toMatch(/candado/)
    expect(await lock.run('test', () => precheck(lib.db, steps, { rootPath }).fatal)).toBeNull()
    guardWith(lib.db, { busy: 'test' } as OpLock) // el resto de los tests corre "con el candado tomado"
  })
  it('si falta un disco o el espacio no alcanza, no arranca nada y lo dice', () => {
    const steps = [move(idOf('Sueltos/a.mp3'), 'Sueltos/a.mp3', 'X/a.mp3')]
    const off = runMoves(lib.db, steps, { rootPath: () => null, annotate: () => {} })
    expect(off.failed.map((f) => f.error)).toEqual(['El disco no está conectado'])
    expect(precheck(lib.db, [{ ...steps[0], bytes: 1e15 }], { rootPath }).fatal).toMatch(/^Falta espacio en el disco: hacen falta .* GB y quedan .* GB libres/)
    expect(fs.existsSync(M('Sueltos/a.mp3'))).toBe(true)
  })
  it('saltea con motivo: sample packs, archivos que cambiaron desde la vista previa y dos al mismo destino', () => {
    const st = fs.statSync(M('Sueltos/b.mp3'))
    const c = precheck(lib.db, [
      move(idOf('Samples/kick.mp3'), 'Samples/kick.mp3', 'X/kick.mp3'),
      move(idOf('Sueltos/b.mp3'), 'Sueltos/b.mp3', 'X/b.mp3', { size: st.size + 1, mtime: st.mtimeMs }),
      move(idOf('Sueltos/c.mp3'), 'Sueltos/c.mp3', 'X/mismo.mp3'),
      move(idOf('Sueltos/d.mp3'), 'Sueltos/d.mp3', 'X/MISMO.mp3'),
    ], { rootPath })
    expect(c.fatal).toBeNull()
    expect(c.failed.map((f) => [f.step.src, f.error])).toEqual([
      ['Samples/kick.mp3', 'Los sample packs no se tocan'],
      ['Sueltos/b.mp3', 'Cambió desde la vista previa: revisalo de nuevo'],
      ['Sueltos/d.mp3', 'Otro archivo de esta tanda va al mismo lugar'],
    ])
    expect(c.ok.map((s) => s.src)).toEqual(['Sueltos/c.mp3'])
  })
  it('a un sample pack se le pueden escribir tags (sin cambiarle el nombre); renombrarlo, no (laboratorio, 21/10)', () => {
    const id = idOf('Samples/kick.mp3')
    const tags: Step = { kind: 'escribir', op: 'tags', rootId: 1, fileId: id, src: 'Samples/kick.mp3', dst: 'Samples/kick.mp3', data: null }
    expect(precheck(lib.db, [tags], { rootPath }).failed).toEqual([])
    expect(precheck(lib.db, [{ ...tags, dst: 'Samples/Kick 01.mp3' }], { rootPath }).failed.map((f) => f.error)).toEqual(['Los sample packs no se tocan'])
  })
})

describe('mover con el motor', () => {
  it('diario → mover → verificar → confirmar: la base al día y el diario vacío; nunca pisa', () => {
    const id = idOf('Sueltos/e.mp3')
    fs.mkdirSync(M('Ocupado'), { recursive: true })
    fs.writeFileSync(M('Ocupado/e.mp3'), 'otra cosa')
    const r = runMoves(lib.db, [move(id, 'Sueltos/e.mp3', 'Ocupado/e.mp3'), move(id, 'Sueltos/e.mp3', 'Fulano/e.mp3')], { rootPath, annotate: (s) => logMove(lib.db, s.data) })
    expect(r.failed.map((f) => f.error)).toEqual(['Ya existe un archivo en el destino'])
    expect(r.done.map((s) => s.dst)).toEqual(['Fulano/e.mp3'])
    expect(fs.readFileSync(M('Ocupado/e.mp3'), 'utf8')).toBe('otra cosa')
    expect(lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id)).toEqual({ rel: 'Fulano/e.mp3' })
    expect(openRows()).toBe(0)
  })
})

describe('recuperación con la app abierta (vuelve un disco)', () => {
  it('lo que quedó a medias en un disco desconectado se resuelve cuando vuelve, sin reabrir PAILA', async () => {
    // corte "de verdad" del lado del disco: se anotó y se movió, pero el disco se fue antes de anotar el resultado
    const id = idOf('Sueltos/a.mp3')
    const data: MoveData = { batchId: 50, rootId: 1, fileId: id, from: 'Sueltos/a.mp3', to: 'Fulano/a.mp3' }
    new OpJournal(lib.db).begin({ op: 'organizar', rootId: 1, fileId: id, src: data.from, dst: data.to, data })
    fs.renameSync(M('Sueltos/a.mp3'), M('Fulano/a.mp3'))
    // carpetas de trabajo de una conversión en marcha: con la app abierta no se tocan
    const work = path.join(dir, 'convert')
    fs.mkdirSync(work, { recursive: true })
    fs.writeFileSync(path.join(work, 'a-medio-convertir.flac'), 'x')
    let connected = false
    const lock = new OpLock()
    const seen: number[] = []
    const watch = new RecoveryWatch(lib.db, { rootPath: (r) => (connected ? rootPath(r) : null), ffmpeg, workDirs: [work], lock, onResolved: (_r, n) => seen.push(n) })
    expect(await watch.check()).toBe(0) // el disco sigue sin estar
    expect(openRows()).toBe(1)
    connected = true
    let inside = 0
    await lock.run('otra operación', async () => { inside = await watch.check() })
    expect(inside).toBe(0) // con otra operación en marcha, espera a la vuelta siguiente
    expect(await watch.check()).toBe(1)
    expect(seen).toEqual([1])
    expect(openRows()).toBe(0)
    expect(lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id)).toEqual({ rel: 'Fulano/a.mp3' })
    expect(lib.db.prepare('SELECT COUNT(*) AS n FROM moves_log WHERE batch_id = 50').get()).toEqual({ n: 1 })
    expect(fs.existsSync(path.join(work, 'a-medio-convertir.flac'))).toBe(true)
    expect(await watch.check()).toBe(0) // nada más que hacer
  })
  it('Organizar entero con el motor y su deshacer, en la misma biblioteca', async () => {
    const org = new Organizer(lib.db, rootPath)
    const r = await org.apply(org.plan({ rule: '%artista%/%titulo%', dest: 'Bib' }))
    expect(r.failed).toEqual([])
    expect(r.moved).toBeGreaterThan(0)
    expect((await org.undo(r.batchId!)).failed).toEqual([])
    expect(openRows()).toBe(0)
  })
})

describe('Bandeja con diario', () => {
  it('un corte entre copiar y sacar el original (otro disco) se resuelve al abrir; lo de PAILA se limpia', async () => {
    const work = path.join(dir, 'inbox-zip', 'pack-1')
    const used = path.join(dir, 'Bandeja', 'usados')
    fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(used, { recursive: true })
    const src = path.join(work, 'tema.flac'), dst = path.join(used, 'tema.flac')
    fs.writeFileSync(src, 'audio'); fs.copyFileSync(src, dst)
    lib.db.prepare("INSERT INTO inbox_items (path, size, mtime, result, checked_at) VALUES (?, 5, 1, '{}', '2026-10-21')").run(src)
    new OpJournal(lib.db).begin({ op: 'bandeja', rootId: null, fileId: null, src, dst, data: { file: src, dest: dst } })
    const rep = await recover(lib.db, { rootPath, ffmpeg, inboxWork: path.join(dir, 'inbox-zip') })
    expect(rep.items.at(-1)).toMatchObject({ result: 'completado', op: 'Bandeja: pasar a usados/ o no-sirvió/' })
    expect(fs.existsSync(src)).toBe(false)
    expect(fs.readFileSync(dst, 'utf8')).toBe('audio')
    expect(lib.db.prepare('SELECT COUNT(*) AS n FROM inbox_items WHERE path = ?').get(src)).toEqual({ n: 0 })
  })
  it('runMoves de la Bandeja (rutas completas) deja el diario vacío', () => {
    const a = path.join(dir, 'Bandeja', 'nuevo.mp3'), b = path.join(dir, 'Bandeja', 'usados', 'nuevo.mp3')
    fs.writeFileSync(a, 'x')
    const r = runMoves(lib.db, [{ kind: 'sacar', op: 'bandeja', rootId: null, fileId: null, src: a, dst: b, data: null }], { rootPath, annotate: () => {} })
    expect(r.failed).toEqual([])
    expect(fs.existsSync(b) && !fs.existsSync(a)).toBe(true)
    expect(openRows()).toBe(0)
  })
})

// Corte real con la app compilada (22/10): Organizar movía todo de un tirón en el proceso principal; con 436 temas la ventana
// quedaba 4 s congelada (con 2.886, casi un minuto), la barra no avanzaba y Cancelar no llegaba nunca.
describe('mover sin congelar la app', () => {
  it('entre paso y paso la app sigue respondiendo, y Cancelar llega en el medio', async () => {
    const base = path.join(dir, 'Muchos')
    fs.mkdirSync(path.join(base, 'a'), { recursive: true })
    const steps = Array.from({ length: 200 }, (_, i) => {
      fs.writeFileSync(path.join(base, 'a', `${i}.mp3`), 'x')
      return { kind: 'sacar', op: 'bandeja', rootId: null, fileId: null, src: path.join(base, 'a', `${i}.mp3`), dst: path.join(base, 'b', `${i}.mp3`), data: null } as Step<null>
    })
    let ticks = 0, cancel = false
    const iv = setInterval(() => { ticks++ }, 5)
    setTimeout(() => { cancel = true }, 60)
    // cada paso tarda unos ms (diario sincronizado + 2 ms más, como un disco lento)
    const slow = () => { const t = Date.now(); while (Date.now() - t < 2) { /* ocupado */ } }
    const r = await runMovesAsync(lib.db, steps, { rootPath, annotate: slow }, { isCancelled: () => cancel })
    clearInterval(iv)
    expect(ticks).toBeGreaterThan(0) // con el motor de antes, 0: el reloj no corría hasta el final
    expect(r.cancelled).toBe(true)
    expect(r.done.length).toBeGreaterThan(0)
    expect(r.done.length).toBeLessThan(200)
    // lo hecho quedó hecho y anotado; lo demás, sin tocar
    expect(fs.readdirSync(path.join(base, 'b')).length).toBe(r.done.length)
    expect(fs.readdirSync(path.join(base, 'a')).length).toBe(200 - r.done.length)
    expect(openRows()).toBe(0)
  })
  it('Organizar y su deshacer no bloquean: devuelven una promesa', async () => {
    const org = new Organizer(lib.db, rootPath)
    const p = org.apply({ moves: [], alreadyOk: 0, skipped: [], extras: [], conflicts: 0 })
    expect(p).toBeInstanceOf(Promise)
    expect((await p).moved).toBe(0)
  })
})
