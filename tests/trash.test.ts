// Tests de Duplicados y Papelera (core/trash.ts, duplicates.ts, purge.ts): detectar, mandar a la papelera (sin congelar la app) y vaciarla.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'
import { Space } from '@paila/core/space'
import { findDuplicates, normalize } from '@paila/core/duplicates'
import { purgeTrash, trashUsage } from '@paila/core/purge'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
/** ¿Está `rel` dentro de alguna tanda de la papelera? (las carpetas de tanda llevan fecha, hora y un código al azar) */
const inTrash = (root: string, rel: string) => fs.existsSync(path.join(root, '_PAILA/papelera')) && (fs.readdirSync(path.join(root, '_PAILA/papelera'), { recursive: true }) as string[]).some((f) => f.split(path.sep).join('/').endsWith('/' + rel))

let dir: string
let lib: Library
let pl: Playlists
let trash: Trash
const idOf = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))![0] as number
const tone = (rel: string, freq: number, dur: number, meta: Record<string, string> = {}, extra: string[] = []) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`, ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-trash-'))
  const meta = { artist: 'La Renga', title: 'Hablando de la Libertad' }
  tone('Rock/Libertad.mp3', 440, 4, meta)
  fs.copyFileSync(path.join(dir, 'M/Rock/Libertad.mp3'), path.join(dir, 'M/Rock/Libertad copia.mp3')) // idéntico
  tone('Otra/libertad (Original Mix).flac', 440, 4, { artist: 'LA RENGA', title: 'Hablando de la libertad' }) // mismo tema, otro formato
  tone('Otra/libertad extended.mp3', 440, 9, meta) // otra duración: NO es duplicado
  tone('Otra/Distinto.mp3', 880, 4, { artist: 'Otro', title: 'Distinto' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  trash = new Trash(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null, pl)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('duplicados y papelera', () => {
  it('normaliza nombres', () => {
    expect(normalize('Hablando de la Libertad (Original Mix)')).toBe(normalize('hablando de la libertad'))
    expect(normalize('Ñandú – Café')).toBe('nandu cafe')
  })

  it('encuentra idénticos y mismo tema en un solo grupo, y la versión de otra duración aparte (nunca para tirar)', async () => {
    const g = await findDuplicates(lib.db, (i) => lib.trackPath(i))
    expect(g.map((x) => x.level)).toEqual(['probable', 'version'])
    const dup = g[0]
    expect(dup.items.map((i) => path.basename(i.rel)).sort()).toEqual(['Libertad copia.mp3', 'Libertad.mp3', 'libertad (Original Mix).flac'])
    expect(dup.why).toContain('byte a byte') // dos son el mismo archivo
    // se queda la lossless (flac antes que mp3)
    expect(path.basename(dup.items.find((i) => i.id === dup.keep)!.rel)).toBe('libertad (Original Mix).flac')
    // la de 9 s es otra versión: se muestra junto a la que se queda, sin proponer tirar ninguna
    expect(g[1].keep).toBeNull()
    expect(g[1].items.map((i) => path.basename(i.rel))).toEqual(['libertad (Original Mix).flac', 'libertad extended.mp3'])
  })

  it('manda a la papelera, pasa las playlists a la copia que se queda y restaura todo', async () => {
    const keep = idOf('Libertad.mp3'), dup = idOf('Libertad copia.mp3')
    const l = pl.create('Mi lista')
    pl.addTracks(l, [dup, idOf('Distinto.mp3')])
    const dupFile = lib.trackPath(dup)!
    const r = await trash.trash([dup], 'Duplicado', new Map([[dup, keep]]))
    expect(r.failed).toEqual([])
    expect(fs.existsSync(dupFile)).toBe(false) // movido, no borrado
    expect(inTrash(path.join(dir, 'M'), 'Rock/Libertad copia.mp3')).toBe(true)
    expect(lib.tracks().some((t) => t[0] === dup)).toBe(false)
    expect(pl.trackIds(l)).toEqual([keep, idOf('Distinto.mp3')]) // la playlist ahora apunta a la copia buena
    await lib.scan() // el escaneo no la vuelve a ver ni la borra
    expect(lib.db.prepare('SELECT trashed_at FROM files WHERE id = ?').get(dup)).toMatchObject({ trashed_at: expect.any(String) })
    expect(trash.items()).toHaveLength(1)

    const back = await trash.restore(r.batchId!)
    expect(back.failed).toEqual([])
    expect(fs.existsSync(dupFile)).toBe(true)
    expect(lib.tracks().some((t) => t[0] === dup)).toBe(true)
    // la playlist queda exactamente como antes: vuelve el original a su lugar y la copia que lo reemplazaba sale (antes
    // quedaban los dos; lo encontró la prueba de punta a punta de la Fase D: 1.714 lugares en playlists → 1.787)
    expect(pl.trackIds(l)).toEqual([dup, idOf('Distinto.mp3')])
    expect(trash.batches()[0].restored).toBe(true)
  })

  it('no mueve sample packs y no restaura encima de otro archivo', async () => {
    const id = idOf('Distinto.mp3')
    lib.db.prepare("UPDATE files SET kind = 'produccion' WHERE id = ?").run(id)
    expect((await trash.trash([id], 'x')).failed[0].error).toMatch(/sample packs/)
    lib.db.prepare("UPDATE files SET kind = 'musica' WHERE id = ?").run(id)

    const dup = idOf('libertad extended.mp3')
    const orig = lib.trackPath(dup)!
    const r = await trash.trash([dup], 'prueba')
    fs.writeFileSync(orig, 'otro')
    expect((await trash.restore(r.batchId!)).failed[0].error).toMatch(/Ya hay otro/)
    fs.rmSync(orig)
    expect((await trash.restore(r.batchId!)).failed).toEqual([])
  })
})

// A7: "Vaciar papelera" es lo único que borra de verdad. Solo carpetas temporales: nunca la biblioteca real.
describe('vaciar papelera', () => {
  let d: string
  let l: Library
  let t: Trash
  const M = () => path.join(d, 'M')
  const P = (...p: string[]) => path.join(d, 'M/_PAILA/papelera', ...p)
  const id = (rel: string) => (l.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
  const write = (abs: string, data: string) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, data) }

  beforeAll(async () => {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-purge-'))
    const mk = (rel: string, f: number) => {
      const out = path.join(M(), ...rel.split('/'))
      fs.mkdirSync(path.dirname(out), { recursive: true })
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=2`, out])
    }
    mk('Rock/Uno.mp3', 300); mk('Rock/Dos.mp3', 400); mk('Rock/Tres.mp3', 500)
    l = new Library(path.join(d, 'paila.db'), findFfprobe())
    await l.addRoot(M(), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
    await l.scan()
    t = new Trash(l.db, (rid) => l.roots().find((r) => r.id === rid)?.path ?? null, new Playlists(l.db, (i) => l.trackPath(i)))
  })
  afterAll(() => { l.close(); fs.rmSync(d, { recursive: true, force: true }) })

  it('mide la papelera tanda por tanda, con fecha, tipo y tamaño', async () => {
    await t.trash([id('Rock/Uno.mp3')], 'Duplicados')
    await t.trash([id('Rock/Dos.mp3')], 'Duplicados')
    write(P('7', 'viejo.mp3'), 'x'.repeat(500)) // tanda vieja (numerada, de antes de A2)
    write(P('2020-01-01_10-00-00_tanda-99_abcd', 'Rock', 'antiguo.mp3'), 'y'.repeat(300)) // tanda de otra base, de hace años
    const u = trashUsage(l.db, () => l.roots())
    expect(u.folders).toHaveLength(4)
    expect(u.files).toBe(4)
    expect(u.bytes).toBe(u.folders.reduce((s, f) => s + f.bytes, 0))
    const temas = u.folders.filter((f) => f.kind === 'temas' && f.label.includes('Duplicados'))
    expect(temas).toHaveLength(2)
    expect(temas[0].bytes).toBe(fs.statSync(path.join(P(temas[0].folder), 'Rock', fs.readdirSync(path.join(P(temas[0].folder), 'Rock'))[0])).size)
    const old = u.folders.find((f) => f.folder.startsWith('2020'))!
    expect(old.ageDays).toBeGreaterThan(365 * 5)
    expect(old.createdAt.slice(0, 4)).toBe('2020')
    expect(temas[0].ageDays).toBe(0)
    expect(u.folders.find((f) => f.folder === '7')!.bytes).toBe(500)
  })

  it('borra solo las tandas elegidas, deja anotado cuándo y restaurar explica que ya no se puede', async () => {
    const before = trashUsage(l.db, () => l.roots())
    const old = before.folders.filter((f) => f.ageDays >= 30) // "solo lo de más de 30 días"
    expect(old.map((f) => f.folder)).toEqual(['2020-01-01_10-00-00_tanda-99_abcd'])
    const r = purgeTrash(l.db, () => l.roots(), old.map((f) => f.key))
    expect(r).toMatchObject({ deleted: 1, bytes: 300, folders: 1, failed: [], kept: [] })
    expect(fs.existsSync(P('2020-01-01_10-00-00_tanda-99_abcd'))).toBe(false)
    expect(trashUsage(l.db, () => l.roots()).folders).toHaveLength(3) // lo demás sigue

    const batch = t.batches().find((b) => !b.restored)!.batchId
    const key = before.folders.find((f) => fs.existsSync(path.join(P(f.folder), 'Rock/Uno.mp3')) || fs.existsSync(path.join(P(f.folder), 'Rock/Dos.mp3')))!
    const res = purgeTrash(l.db, () => l.roots(), [key.key])
    expect(res.deleted).toBe(1)
    expect(l.db.prepare('SELECT COUNT(*) AS n FROM trash_log WHERE purged_at IS NOT NULL').get()).toMatchObject({ n: 1 })
    expect(t.items()).toHaveLength(1) // lo vaciado ya no figura para restaurar
    const purgedBatch = (l.db.prepare('SELECT batch_id AS b FROM trash_log WHERE purged_at IS NOT NULL').get() as { b: number }).b
    expect((await t.restore(purgedBatch)).failed[0].error).toMatch(/Ya no se puede: se vació la papelera el \d\d\/\d\d\/\d{4}/)
    expect(batch).toBeGreaterThan(0)
  })

  it('nunca toca nada fuera de _PAILA/papelera, ni sigue accesos directos, ni borra sample packs', () => {
    write(path.join(d, 'afuera/importante.wav'), 'no tocar')
    write(path.join(M(), '_PAILA/otra/cosa.txt'), 'tampoco')
    // un acceso directo (junction) dentro de la papelera que apunta afuera: no se sigue ni se borra lo de adentro
    fs.symlinkSync(path.join(d, 'afuera'), P('enlace'), 'junction')
    const tanda = P('2026-01-01_00-00-00_tanda-50_zzzz')
    write(path.join(tanda, 'Samples/kick.wav'), 'kick') // de un sample pack: nunca
    write(path.join(tanda, 'Rock/x.mp3'), 'x')
    fs.symlinkSync(path.join(d, 'afuera'), path.join(tanda, 'Rock/enlace'), 'junction')
    const u = trashUsage(l.db, () => l.roots())
    expect(u.folders.some((f) => f.folder === 'enlace')).toBe(false)
    const keys = [...u.folders.map((f) => f.key), `${l.roots()[0].id}|..`, `${l.roots()[0].id}|enlace`] // y claves inventadas
    const r = purgeTrash(l.db, () => l.roots(), keys)
    expect(r.failed).toEqual([])
    expect(r.kept).toEqual([{ rel: '_PAILA/papelera/2026-01-01_00-00-00_tanda-50_zzzz/Samples/kick.wav', why: expect.stringMatching(/sample pack/) }])
    expect(fs.readFileSync(path.join(d, 'afuera/importante.wav'), 'utf8')).toBe('no tocar')
    expect(fs.existsSync(path.join(M(), '_PAILA/otra/cosa.txt'))).toBe(true)
    expect(fs.existsSync(path.join(tanda, 'Samples/kick.wav'))).toBe(true)
    expect(fs.existsSync(path.join(tanda, 'Rock/x.mp3'))).toBe(false)
    expect(fs.existsSync(path.join(M(), 'Rock/Tres.mp3'))).toBe(true) // la biblioteca, intacta
    expect(trashUsage(l.db, () => l.roots()).files).toBe(1) // queda solo el sample
  })
})

// Con miles de duplicados, mandar a la papelera movía todo de un tirón en el proceso principal y la ventana quedaba
// congelada (como Organizar antes del corte real del 22/10). Ahora el motor cede el control entre paso y paso.
describe('papelera sin congelar la app', () => {
  let d: string
  let l: Library
  const N = 300
  /** Corre `fn` contando cuántas veces llegó a correr un reloj de 5 ms en el medio (con el motor de antes: 0). */
  const ticking = async <T>(fn: () => Promise<T>) => {
    let ticks = 0
    const iv = setInterval(() => { ticks++ }, 5)
    try { const r = await fn(); return { r, ticks } } finally { clearInterval(iv) }
  }

  beforeAll(async () => {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-trash-async-'))
    fs.mkdirSync(path.join(d, 'M/Dup'), { recursive: true })
    l = new Library(path.join(d, 'paila.db'), findFfprobe())
    const root = await l.addRoot(path.join(d, 'M'), [{ rel: '', kind: 'musica' }])
    // los temas se anotan directo en la base (escanear 300 archivos con ffprobe sería lento y no es lo que se prueba)
    const ins = l.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext) VALUES (?, ?, 1, 0, 'musica', 'mp3')")
    for (let i = 0; i < N; i++) {
      fs.writeFileSync(path.join(d, 'M/Dup', `${i}.mp3`), 'x')
      ins.run(root.id, `Dup/${i}.mp3`)
      fs.writeFileSync(path.join(d, 'M/Dup', `${i}.tmp`), 'basura')
    }
  })
  afterAll(() => { l.close(); fs.rmSync(d, { recursive: true, force: true }) })

  it('mandar 300 temas a la papelera y restaurarlos deja correr la app en el medio', async () => {
    const t = new Trash(l.db, (rid) => l.roots().find((r) => r.id === rid)?.path ?? null, new Playlists(l.db, (i) => l.trackPath(i)))
    const ids = (l.db.prepare("SELECT id FROM files WHERE rel_path LIKE 'Dup/%'").all() as { id: number }[]).map((x) => x.id)
    const p = t.trash(ids, 'Duplicados')
    expect(p).toBeInstanceOf(Promise) // no bloquea: devuelve enseguida
    const sent = await ticking(() => p)
    expect(sent.r).toMatchObject({ moved: N, failed: [] })
    expect(sent.ticks).toBeGreaterThan(0)
    expect(fs.readdirSync(path.join(d, 'M/Dup')).filter((f) => f.endsWith('.mp3'))).toHaveLength(0)

    const back = await ticking(() => t.restore(sent.r.batchId!))
    expect(back.r).toMatchObject({ moved: N, failed: [] })
    expect(back.ticks).toBeGreaterThan(0)
    expect(fs.readdirSync(path.join(d, 'M/Dup')).filter((f) => f.endsWith('.mp3'))).toHaveLength(N)
    expect(l.db.prepare('SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL').get()).toMatchObject({ n: 0 })
  })

  it('la limpieza de Espacio tampoco bloquea', async () => {
    const space = new Space(l.db, () => l.roots())
    const rootId = l.roots()[0].id
    const r = await ticking(() => space.trashFiles(Array.from({ length: N }, (_, i) => ({ rootId, rel: `Dup/${i}.tmp` }))))
    expect(r.r).toMatchObject({ moved: N, failed: [] })
    expect(r.ticks).toBeGreaterThan(0)
  })
})
