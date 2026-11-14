// Cortes a mitad de una operación (luz, cuelgue, cierre forzado): el diario se escribe antes de actuar y, al "reabrir"
// PAILA, core/recovery.ts deja la base y el disco consistentes. Solo archivos sintéticos en carpetas temporales.
//
// Cómo se simula el corte:
// - entre mover y anotar: la anotación final del diario (`OpJournal.done`) "no llega" (tira un error y no se vuelve atrás nada);
// - a mitad de una escritura: la verificación de la huella del sonido queda esperando para siempre (como un proceso que
//   murió ahí) y además se rompe el archivo a mano, como si se hubiera cortado mientras se escribía.
// Después se cierra la base, se abre de nuevo (otra conexión) y se corre la recuperación.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { OpJournal } from '@paila/core/journal'
import { markSeen, recover, report } from '@paila/core/recovery'
import { Organizer } from '@paila/core/organizer'
import { Trash } from '@paila/core/trash'
import { Playlists } from '@paila/core/playlists'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'
import { Replacer } from '@paila/core/replace'
import { Space } from '@paila/core/space'
import { purgeTrash, trashUsage } from '@paila/core/purge'
import { pcmHash } from '@paila/core/audiohash'

// pcmHash deja pasar `allow` llamadas y después queda colgada (para cortar a mitad de una escritura).
const ctl = vi.hoisted(() => ({ allow: Infinity, calls: 0 }))
vi.mock('@paila/core/audiohash', async (orig) => {
  const real = await orig<typeof import('@paila/core/audiohash')>()
  return { pcmHash: (ffmpeg: string, file: string) => (++ctl.calls > ctl.allow ? new Promise<string>(() => {}) : real.pcmHash(ffmpeg, file)) }
})
const hangAfter = (n: number) => { ctl.calls = 0; ctl.allow = n }

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()
const dirs: string[] = []
const envs: Env[] = []
afterEach(() => { vi.restoreAllMocks(); ctl.allow = Infinity })
afterAll(() => {
  for (const e of envs) { try { e.lib.close() } catch { /* ya cerrada */ } }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

interface Env { dir: string; root: string; dbFile: string; backupDir: string; lib: Library; rootPath: (id: number) => string | null }

/** Biblioteca nueva con archivos de prueba (rel → tags). */
async function setup(files: Record<string, Record<string, string>>): Promise<Env> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-recovery-'))
  dirs.push(dir)
  const root = path.join(dir, 'M')
  for (const [rel, meta] of Object.entries(files)) {
    const out = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
  }
  const dbFile = path.join(dir, 'paila.db')
  const lib = new Library(dbFile, ffprobe)
  await lib.addRoot(root, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const env = { dir, root, dbFile, backupDir: path.join(dir, 'resguardo'), lib, rootPath: rootPathOf(lib) }
  envs.push(env)
  return env
}
const rootPathOf = (lib: Library) => (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null

/** "Reabrir PAILA": se cierra la base, se abre de nuevo y se corre la recuperación (como en electron/main.ts). */
async function reopen(env: Env, opts: { offline?: boolean } = {}) {
  env.lib.close()
  env.lib = new Library(env.dbFile, ffprobe)
  env.rootPath = rootPathOf(env.lib)
  const rep = await recover(env.lib.db, { rootPath: opts.offline ? () => null : env.rootPath, ffmpeg, backupDir: env.backupDir })
  return rep
}

const fileId = (lib: Library, rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number } | undefined)?.id
const relOf = (lib: Library, id: number) => (lib.db.prepare('SELECT rel_path AS r FROM files WHERE id = ?').get(id) as { r: string }).r
const openEntries = (lib: Library) => (lib.db.prepare('SELECT COUNT(*) AS n FROM op_journal WHERE recovered_at IS NULL').get() as { n: number }).n
const at = (env: Env, rel: string) => path.join(env.root, ...rel.split('/'))
/** Corte justo después de mover: la anotación final no llega a guardarse. */
const cutBeforeAnnotate = () => vi.spyOn(OpJournal.prototype, 'done').mockImplementationOnce(() => { throw new Error('corte de luz') })

describe('recuperación tras un corte', () => {
  it('organizar: el archivo ya se había movido → al abrir se completa la anotación y se puede deshacer', async () => {
    const env = await setup({ 'Descargas/uno.mp3': { artist: 'La Renga', title: 'Uno' } })
    const id = fileId(env.lib, 'Descargas/uno.mp3')!
    const rootId = env.lib.roots()[0].id
    const org = new Organizer(env.lib.db, env.rootPath)
    cutBeforeAnnotate()
    const r = await org.apply({ moves: [{ fileId: id, rootId, from: 'Descargas/uno.mp3', to: 'La Renga/Uno.mp3' }], alreadyOk: 0, skipped: [], extras: [], conflicts: 0 })
    expect(r.failed[0].error).toMatch(/corte/)
    // estado del corte: el disco ya cambió, la base todavía no
    expect(fs.existsSync(at(env, 'La Renga/Uno.mp3'))).toBe(true)
    expect(relOf(env.lib, id)).toBe('Descargas/uno.mp3')
    expect(openEntries(env.lib)).toBe(1)

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['completado'])
    expect(rep.items[0].message).toMatch(/ya se había movido/)
    expect(relOf(env.lib, id)).toBe('La Renga/Uno.mp3')
    expect(env.lib.db.prepare('SELECT batch_id, from_rel, to_rel FROM moves_log').all()).toEqual([{ batch_id: 1, from_rel: 'Descargas/uno.mp3', to_rel: 'La Renga/Uno.mp3' }])
    expect(openEntries(env.lib)).toBe(0)
    // queda deshacible como cualquier otra tanda
    const u = await new Organizer(env.lib.db, env.rootPath).undo(1)
    expect(u.failed).toEqual([])
    expect(fs.existsSync(at(env, 'Descargas/uno.mp3'))).toBe(true)
    expect(relOf(env.lib, id)).toBe('Descargas/uno.mp3')
    // otra recuperación no encuentra nada (no anota dos veces)
    expect((await reopen(env)).items.map((i) => i.result)).toEqual(['completado']) // el aviso de antes sigue sin "Entendido"
    expect((env.lib.db.prepare('SELECT COUNT(*) AS n FROM moves_log').get() as { n: number }).n).toBe(1)
  })

  it('organizar: el corte fue antes de mover → al abrir se da por no hecho y no queda ninguna carpeta vacía', async () => {
    const env = await setup({ 'Descargas/dos.mp3': { artist: 'X', title: 'Dos' } })
    const id = fileId(env.lib, 'Descargas/dos.mp3')!
    const rootId = env.lib.roots()[0].id
    // se anotó en el diario, se creó la carpeta de destino y se cortó antes del movimiento
    const begin = OpJournal.prototype.begin
    vi.spyOn(OpJournal.prototype, 'begin').mockImplementationOnce(function (this: OpJournal, e) {
      begin.call(this, e)
      fs.mkdirSync(at(env, 'X/Sueltos'), { recursive: true })
      throw new Error('corte de luz')
    })
    await new Organizer(env.lib.db, env.rootPath).apply({ moves: [{ fileId: id, rootId, from: 'Descargas/dos.mp3', to: 'X/Sueltos/Dos.mp3' }], alreadyOk: 0, skipped: [], extras: [], conflicts: 0 })
    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['no-hecho'])
    expect(relOf(env.lib, id)).toBe('Descargas/dos.mp3')
    expect(fs.existsSync(at(env, 'Descargas/dos.mp3'))).toBe(true)
    expect(fs.existsSync(at(env, 'X'))).toBe(false)
    expect(env.lib.db.prepare('SELECT * FROM moves_log').all()).toEqual([])
  })

  it('papelera: ya estaba en la papelera → se anota, las playlists pasan a la copia que se queda y se puede restaurar', async () => {
    const env = await setup({ 'a.mp3': { title: 'A' }, 'b.mp3': { title: 'B' } })
    const a = fileId(env.lib, 'a.mp3')!, b = fileId(env.lib, 'b.mp3')!
    const pl = new Playlists(env.lib.db, (i) => env.lib.trackPath(i))
    const list = pl.create('Para el sábado')
    pl.addTracks(list, [a])
    cutBeforeAnnotate()
    const r = await new Trash(env.lib.db, env.rootPath, pl).trash([a], 'duplicado', new Map([[a, b]]))
    expect(r.failed[0].error).toMatch(/corte/)
    expect(fs.existsSync(at(env, 'a.mp3'))).toBe(false)

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['completado'])
    const pl2 = new Playlists(env.lib.db, (i) => env.lib.trackPath(i))
    expect(pl2.trackIds(list)).toEqual([b])
    expect((env.lib.db.prepare('SELECT trashed_at FROM files WHERE id = ?').get(a) as { trashed_at: string | null }).trashed_at).not.toBeNull()
    const t = new Trash(env.lib.db, env.rootPath, pl2)
    expect(t.items().map((i) => i.rel)).toEqual(['a.mp3'])
    expect((await t.restore(t.batches()[0].batchId)).failed).toEqual([])
    expect(fs.existsSync(at(env, 'a.mp3'))).toBe(true)
    expect(pl2.trackIds(list)).toEqual([a]) // como estaba antes: la copia que se quedó le devuelve el lugar
  })

  it('tags: corte a mitad de la escritura → el original nunca se tocó: al abrir se saca el temporal y vuelve el nombre', async () => {
    const env = await setup({ 'Sueltos/viejo.mp3': { title: 'Original' } })
    const id = fileId(env.lib, 'Sueltos/viejo.mp3')!
    const original = fs.readFileSync(at(env, 'Sueltos/viejo.mp3'))
    const hash0 = await pcmHash(ffmpeg, at(env, 'Sueltos/viejo.mp3'))
    const ch = new Changes(env.lib.db, (i) => env.lib.trackPath(i), ffmpeg, env.backupDir)
    ch.stage([id], 'title', 'Nuevo título')
    ch.stage([id], 'filename', 'Nuevo nombre')
    hangAfter(1) // la huella del original sí; la verificación del temporal ya escrito queda colgada
    void ch.apply()
    await vi.waitFor(() => expect((env.lib.db.prepare('SELECT hash FROM op_journal').get() as { hash: string | null } | undefined)?.hash).toBe(hash0), { timeout: 10_000 })
    const work = path.join(env.root, '_PAILA', 'escribiendo')
    await vi.waitFor(() => expect(fs.readdirSync(work)).toHaveLength(1), { timeout: 10_000 })
    // en pleno guardado: se renombró, pero el contenido sigue siendo el original, byte a byte; lo nuevo está en el temporal
    expect(fs.existsSync(at(env, 'Sueltos/viejo.mp3'))).toBe(false)
    expect(fs.readFileSync(at(env, 'Sueltos/Nuevo nombre.mp3')).equals(original)).toBe(true)
    const tmp = path.join(work, fs.readdirSync(work)[0])
    expect(readTags(tmp).title).toBe('Nuevo título')
    // ... y se cortó mientras se escribía: el temporal quedó por la mitad
    fs.truncateSync(tmp, Math.floor(original.length / 3))
    ctl.allow = Infinity

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['vuelto-atras'])
    expect(rep.items[0].message).toMatch(/no se llegó a cambiar \(se le devolvió el nombre de antes\)/)
    expect(fs.existsSync(at(env, 'Sueltos/Nuevo nombre.mp3'))).toBe(false)
    expect(fs.readFileSync(at(env, 'Sueltos/viejo.mp3')).equals(original)).toBe(true)
    expect(relOf(env.lib, id)).toBe('Sueltos/viejo.mp3') // la base nunca cambió
    expect(fs.readdirSync(work)).toEqual([]) // el temporal era de PAILA
    // los cambios siguen pendientes y se pueden aplicar de nuevo
    const ch2 = new Changes(env.lib.db, (i) => env.lib.trackPath(i), ffmpeg, env.backupDir)
    expect(ch2.list().map((c) => c.field).sort()).toEqual(['filename', 'title'])
    expect((await ch2.apply()).failed).toEqual([])
    expect(relOf(env.lib, id)).toBe('Sueltos/Nuevo nombre.mp3')
    expect(readTags(at(env, 'Sueltos/Nuevo nombre.mp3')).title).toBe('Nuevo título')
    expect(fs.readdirSync(work)).toEqual([])
  })

  it('tags: corte justo después de reemplazar el archivo, antes de anotarlo → al abrir vuelve byte a byte desde el respaldo liviano', async () => {
    const env = await setup({ 'Sueltos/otro.mp3': { title: 'Otro', genre: 'Rock' } })
    const id = fileId(env.lib, 'Sueltos/otro.mp3')!
    const original = fs.readFileSync(at(env, 'Sueltos/otro.mp3'))
    const ch = new Changes(env.lib.db, (i) => env.lib.trackPath(i), ffmpeg, env.backupDir)
    ch.stage([id], 'genre', 'Cumbia')
    // la anotación final no llega y, desde ahí, PAILA ya no puede hacer nada más (se cortó la luz)
    let cut = false
    vi.spyOn(OpJournal.prototype, 'done').mockImplementationOnce(() => { cut = true; throw new Error('corte de luz') })
    const realOpen = fs.openSync
    vi.spyOn(fs, 'openSync').mockImplementation(((...a: Parameters<typeof fs.openSync>) => { if (cut) throw new Error('corte de luz'); return realOpen(...a) }) as typeof fs.openSync)
    const r = await ch.apply()
    vi.restoreAllMocks()
    expect(r.failed[0].error).toMatch(/corte/)
    // estado del corte: el archivo ya es el nuevo, la base todavía no
    expect(readTags(at(env, 'Sueltos/otro.mp3')).genre).toBe('Cumbia')
    expect(openEntries(env.lib)).toBe(1)

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['vuelto-atras'])
    expect(rep.items[0].message).toMatch(/volvió a como estaba, byte a byte, desde su respaldo/)
    expect(fs.readFileSync(at(env, 'Sueltos/otro.mp3')).equals(original)).toBe(true)
    expect(fs.readdirSync(path.join(env.root, '_PAILA', 'escribiendo'))).toEqual([])
    const ch2 = new Changes(env.lib.db, (i) => env.lib.trackPath(i), ffmpeg, env.backupDir)
    expect(ch2.list().map((c) => c.field)).toEqual(['genre']) // sigue pendiente
  })

  it('reemplazo: corte con el original en la papelera y la copia nueva a medias → el tema vuelve a como estaba', async () => {
    const env = await setup({ 'Rock/Tema.mp3': { artist: 'La Renga', title: 'Tema' } })
    const id = fileId(env.lib, 'Rock/Tema.mp3')!
    const original = fs.readFileSync(at(env, 'Rock/Tema.mp3'))
    const cand = path.join(env.dir, 'Descargas', 'track01.flac')
    fs.mkdirSync(path.dirname(cand))
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', cand])
    hangAfter(0) // se corta mientras se copian los tags al archivo nuevo
    void new Replacer(env.lib.db, env.rootPath, ffprobe!, ffmpeg).replace(id, cand, { keepTags: true, keepCover: false, sameName: true })
    expect(fs.existsSync(at(env, 'Rock/Tema.mp3'))).toBe(false)
    expect(fs.existsSync(at(env, 'Rock/Tema.flac'))).toBe(true)
    ctl.allow = Infinity

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['vuelto-atras'])
    expect(fs.readFileSync(at(env, 'Rock/Tema.mp3')).equals(original)).toBe(true)
    expect(fs.existsSync(at(env, 'Rock/Tema.flac'))).toBe(false)
    expect(relOf(env.lib, id)).toBe('Rock/Tema.mp3')
    expect(env.lib.db.prepare('SELECT * FROM replacements').all()).toEqual([])
    expect(fs.existsSync(cand)).toBe(true) // el archivo elegido sigue donde estaba
    // la copia nueva a medias no se borró: está en la papelera
    const trashed = fs.readdirSync(path.join(env.root, '_PAILA/papelera'), { recursive: true }) as string[]
    expect(trashed.some((f) => /recuperado/.test(f) && f.endsWith('Tema.flac'))).toBe(true)
  })

  it('deshacer un reemplazo: los dos movimientos se hicieron pero no se anotó → al abrir se completa', async () => {
    const env = await setup({ 'Rock/Tema.mp3': { artist: 'La Renga', title: 'Tema' } })
    const id = fileId(env.lib, 'Rock/Tema.mp3')!
    const cand = path.join(env.dir, 'nuevo.flac')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', cand])
    const rep1 = new Replacer(env.lib.db, env.rootPath, ffprobe!, ffmpeg)
    const { replacementId } = await rep1.replace(id, cand, { keepTags: true, keepCover: false, sameName: true })
    expect(relOf(env.lib, id)).toBe('Rock/Tema.flac')
    cutBeforeAnnotate()
    expect(() => rep1.undo(replacementId)).toThrow(/corte/)
    expect(fs.existsSync(at(env, 'Rock/Tema.mp3'))).toBe(true)
    expect(relOf(env.lib, id)).toBe('Rock/Tema.flac')

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['completado'])
    expect(relOf(env.lib, id)).toBe('Rock/Tema.mp3')
    expect((env.lib.db.prepare('SELECT undone_at FROM replacements WHERE id = ?').get(replacementId) as { undone_at: string | null }).undone_at).not.toBeNull()
  })

  it('limpieza de Espacio y vaciar papelera: lo que ya se hizo queda anotado', async () => {
    const env = await setup({ 'a.mp3': { title: 'A' } })
    fs.writeFileSync(at(env, 'clip.mp4'), 'video')
    const rootId = env.lib.roots()[0].id
    cutBeforeAnnotate()
    const r = await new Space(env.lib.db, () => env.lib.roots()).trashFiles([{ rootId, rel: 'clip.mp4' }])
    expect(r.failed[0].error).toMatch(/corte/)
    let rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['completado'])
    expect(env.lib.db.prepare('SELECT file_id, from_rel FROM moves_log').all()).toEqual([{ file_id: null, from_rel: 'clip.mp4' }])
    markSeen(env.lib.db)

    // vaciar: se borra todo pero se corta antes de anotarlo
    cutBeforeAnnotate()
    const roots = () => env.lib.roots()
    expect(() => purgeTrash(env.lib.db, roots, trashUsage(env.lib.db, roots).folders.map((f) => f.key))).toThrow(/corte/)
    expect((env.lib.db.prepare('SELECT purged_at FROM moves_log').get() as { purged_at: string | null }).purged_at).toBeNull()
    rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['completado'])
    expect(rep.items[0].message).toMatch(/1 de 1 archivos ya se habían borrado/)
    expect((env.lib.db.prepare('SELECT purged_at FROM moves_log').get() as { purged_at: string | null }).purged_at).not.toBeNull()
  })

  it('disco desconectado: queda pendiente y se resuelve cuando vuelve; "Entendido" saca el aviso', async () => {
    const env = await setup({ 'Descargas/tres.mp3': { title: 'Tres' } })
    const id = fileId(env.lib, 'Descargas/tres.mp3')!
    const rootId = env.lib.roots()[0].id
    cutBeforeAnnotate()
    await new Organizer(env.lib.db, env.rootPath).apply({ moves: [{ fileId: id, rootId, from: 'Descargas/tres.mp3', to: 'Tres.mp3' }], alreadyOk: 0, skipped: [], extras: [], conflicts: 0 })
    let rep = await reopen(env, { offline: true })
    expect(rep.items.map((i) => i.result)).toEqual(['pendiente'])
    expect(rep.pending).toBe(1)
    expect(relOf(env.lib, id)).toBe('Descargas/tres.mp3')
    // lo empezado después de abrir (una operación en marcha ahora) no se confunde con algo a medias
    expect(report(env.lib.db, '2000-01-01T00:00:00.000Z').items).toEqual([])

    rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['completado'])
    expect(relOf(env.lib, id)).toBe('Tres.mp3')
    markSeen(env.lib.db)
    expect(report(env.lib.db, new Date().toISOString()).items).toEqual([])
    expect((env.lib.db.prepare('SELECT COUNT(*) AS n FROM op_journal').get() as { n: number }).n).toBe(0)
  })

  it('casos raros: copia de resguardo incompleta (no se usa) y renombre a medio hacer (vuelve el nombre)', async () => {
    const env = await setup({ 'x.mp3': { title: 'X' }, 'y.mp3': { title: 'Y' } })
    const rootId = env.lib.roots()[0].id
    const j = new OpJournal(env.lib.db)
    fs.mkdirSync(env.backupDir)
    // x: la copia de resguardo quedó más corta que el original → no se toca el archivo, se avisa para revisar
    const bx = path.join(env.backupDir, 'x-copia.mp3')
    fs.writeFileSync(bx, fs.readFileSync(at(env, 'x.mp3')).subarray(0, 100))
    const jx = j.begin({ op: 'tags', rootId, fileId: fileId(env.lib, 'x.mp3'), src: 'x.mp3', dst: 'x.mp3', backup: bx })
    j.phase(jx, 'resguardo', { origSize: fs.statSync(at(env, 'x.mp3')).size })
    const xBefore = fs.readFileSync(at(env, 'x.mp3'))
    // y: se renombró y se cortó antes de hacer la copia (el contenido no se tocó)
    j.begin({ op: 'tags', rootId, fileId: fileId(env.lib, 'y.mp3'), src: 'y.mp3', dst: 'Y nuevo.mp3', backup: path.join(env.backupDir, 'y-nunca.mp3') })
    fs.renameSync(at(env, 'y.mp3'), at(env, 'Y nuevo.mp3'))

    const rep = await reopen(env)
    expect(rep.items.map((i) => i.result)).toEqual(['revisar', 'vuelto-atras'])
    expect(rep.items[0].message).toMatch(/incompleta/)
    expect(fs.readFileSync(at(env, 'x.mp3')).equals(xBefore)).toBe(true)
    expect(fs.existsSync(bx)).toBe(true) // la copia que no se pudo usar se guarda para mirarla a mano
    expect(fs.existsSync(at(env, 'y.mp3'))).toBe(true)
    expect(fs.existsSync(at(env, 'Y nuevo.mp3'))).toBe(false)
  })
})
