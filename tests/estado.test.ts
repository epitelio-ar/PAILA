// El estado de la colección (core/estado.ts; MASTERPLAN-5, etapa 1): cada parte sale de la base, no de marcas. Para cada una:
// hacer → baja a 0, deshacer → vuelve el número, rehacer → otra vez 0. Y "Dejar como está" queda en la base. Con archivos de verdad.
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
import { OnlineCache } from '@paila/core/online/http'
import { cleanedRows } from '@paila/core/official-run'
import { recKey } from '@paila/core/official-findings'
import { albumGroups } from '@paila/core/albums'
import { coverFromBytes } from '@paila/core/tagio'
import { Estado, hayVeredicto, siguienteGrupo } from '@paila/core/estado'
import { guardarRegla, reglaElegida } from '@paila/core/estado-dejar'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, org: Organizer, ch: Changes, trash: Trash, estado: Estado
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const tone = (rel: string, meta: Record<string, string>, freq = 440) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
}
const ids = new Map<string, number>() // por nombre de archivo de entrada (Organizar los mueve)
const idDe = (nombre: string) => ids.get(nombre) ?? (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${nombre}`) as { id: number }).id
/** Simula que PAILA ya escuchó todo (el análisis de verdad tarda): una fila vigente por tema, con su nota. */
const escuchar = (nota = 'A') => lib.db.prepare(
  `INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, prints_at) SELECT id, 1, size, mtime, 'x', ?, 'x' FROM files WHERE true
   ON CONFLICT (file_id) DO UPDATE SET src_size = excluded.src_size, src_mtime = excluded.src_mtime`).run(nota)
const leer = async () => estado.listo()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-estado-'))
  tone('Descargas/uno.mp3', { artist: 'La Renga', title: 'Uno', album: 'Disco A', date: '1996', track: '1' }, 300)
  tone('Descargas/dos.mp3', { artist: 'La Renga', title: 'Dos', album: 'Disco A', date: '1996', track: '2' }, 500)
  fs.copyFileSync(M('Descargas/uno.mp3'), M('Descargas/uno (1).mp3')) // la misma copia: un repetido seguro
  tone('Mezclas/sin artista.mp3', { title: 'Algo' }, 700)
  tone('Mezclas/roto.mp3', { artist: 'JosÃ© Feliciano', title: 'Feliz' }, 900) // letras rotas
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  org = new Organizer(lib.db, rootPath)
  ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  trash = new Trash(lib.db, rootPath, new Playlists(lib.db, (i) => lib.trackPath(i)))
  estado = new Estado(lib.db, { pathOf: (i) => lib.trackPath(i), organizer: org })
  for (const n of ['uno (1).mp3', 'Descargas/uno.mp3', 'dos.mp3', 'sin artista.mp3', 'roto.mp3']) ids.set(n, idDe(n))
  escuchar()
}, 60_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('estado de la colección: hacer, deshacer, rehacer', () => {
  it('sin veredicto con pocos datos, y los repetidos esperan a que PAILA termine de escuchar', () => {
    expect(hayVeredicto(49, 1000)).toBe(false)
    expect(hayVeredicto(50, 1000)).toBe(true)
    expect(hayVeredicto(3, 20)).toBe(true) // el 10 %
    lib.db.prepare('DELETE FROM analysis WHERE file_id = ?').run(idDe('dos.mp3'))
    const e = estado.leer()
    expect(e.grupos.repetidos).toMatchObject({ n: null, espera: 'escuchando' }) // 1 de 5 sin escuchar: más del 2 %
    escuchar()
  })

  it('repetidos: a la papelera baja a 0, restaurar lo vuelve a contar, y otra vez a la papelera', async () => {
    expect(estado.leer().grupos.repetidos.espera).toBe('calculando') // lee archivos: va aparte
    const copia = idDe('uno (1).mp3'), original = idDe('Descargas/uno.mp3')
    const antes = (await leer()).grupos.repetidos
    expect(antes.n).toBe(1)
    expect([[copia], [original]]).toContainEqual(antes.filas[0].ids) // una de las dos: la otra se queda
    const r = await trash.trash(antes.filas[0].ids, 'Duplicados')
    expect((await leer()).grupos.repetidos.n).toBe(0)
    await trash.restore(r.batchId!)
    expect((await leer()).grupos.repetidos.n).toBe(1)
    await trash.trash(antes.filas[0].ids, 'Duplicados')
    expect((await leer()).grupos.repetidos.n).toBe(0)
  }, 30_000)

  it('nombres: arreglar el artista baja, deshacerlo lo vuelve a contar, rehacer baja otra vez', async () => {
    const sin = idDe('sin artista.mp3')
    expect(estado.leer().grupos.nombres.filas.map((f) => f.ids[0]).sort()).toEqual([sin, idDe('roto.mp3')].sort())
    ch.stage([sin], 'artist', 'Alguien')
    await ch.apply()
    expect(estado.leer().grupos.nombres.n).toBe(1)
    await ch.undo(ch.batches()[0].batchId)
    expect(estado.leer().grupos.nombres.n).toBe(2)
    ch.stage([sin], 'artist', 'Alguien'); await ch.apply()
    expect(estado.leer().grupos.nombres.n).toBe(1)
  }, 30_000)

  it('internet: lo buscado no cuenta; si le cambiás el nombre, vuelve a contar (se busca con el nombre de hoy)', async () => {
    const cache = new OnlineCache(lib.db)
    const total = estado.leer().grupos.internet.n!
    expect(total).toBeGreaterThan(0)
    for (const r of cleanedRows(lib.db)) if (r.artist?.trim() && r.title?.trim()) cache.put('musicbrainz', recKey(r.artist, r.title), 'ok', [])
    expect(estado.leer().grupos.internet.n).toBe(0)
    const dos = idDe('dos.mp3')
    ch.stage([dos], 'title', 'Dos (en vivo)'); await ch.apply()
    expect(estado.leer().grupos.internet.filas.map((f) => f.ids[0])).toEqual([dos])
    await ch.undo(ch.batches()[0].batchId)
    expect(estado.leer().grupos.internet.n).toBe(0)
    ch.stage([dos], 'title', 'Dos (en vivo)'); await ch.apply()
    expect(estado.leer().grupos.internet.n).toBe(1)
    escuchar()
  }, 30_000)

  it('carpetas: Organizar baja a 0, deshacerlo vuelve a decir cuántos están fuera, rehacer baja otra vez', async () => {
    const regla = reglaElegida(lib.db)
    expect(regla.dest).toBe('Biblioteca') // nunca se ordenó: la de fábrica
    const fuera = estado.leer().grupos.carpetas.n!
    expect(fuera).toBeGreaterThanOrEqual(3)
    expect(estado.leer().reglaGuardada).toBe(false)
    expect(estado.regla(regla).reglaGuardada).toBe(true) // la que la ventana recordaba de antes pasa a la base
    await org.apply(org.plan(regla))
    expect(estado.leer().grupos.carpetas.n).toBe(0)
    await org.undo(org.batches()[0].batchId)
    expect(estado.leer().grupos.carpetas.n).toBe(fuera)
    await org.apply(org.plan(regla))
    expect(estado.leer().grupos.carpetas.n).toBe(0)
    // otra regla elegida: se cuenta con esa
    guardarRegla(lib.db, { rule: '%genero%/%artista% - %titulo%', dest: 'Otra' })
    expect(estado.leer().grupos.carpetas.n).toBeGreaterThan(0)
    guardarRegla(lib.db, regla)
    expect(estado.leer().grupos.carpetas.n).toBe(0)
  }, 30_000)

  it('tapas: con una tapa para poner cuenta el disco; ponerla baja, deshacerla lo vuelve a contar', async () => {
    const disco = albumGroups(lib.db, 2).find((g) => g.album === 'Disco A')!
    expect(estado.leer().grupos.tapas).toMatchObject({ n: 1, aparte: 1 }) // nunca revisado
    new OnlineCache(lib.db).put('tapas', `veredicto|${disco.key}`, 'ok', { poner: true })
    expect(estado.leer().grupos.tapas).toMatchObject({ n: 1, aparte: 0 })
    const poner = async () => { for (const t of disco.tracks) ch.stage([t.id], 'cover', coverFromBytes(PNG)); await ch.apply() }
    await poner()
    expect(estado.leer().grupos.tapas.n).toBe(0)
    await ch.undo(ch.batches()[0].batchId)
    expect(estado.leer().grupos.tapas.n).toBe(1)
    await poner()
    expect(estado.leer().grupos.tapas.n).toBe(0)
    escuchar()
  }, 30_000)

  it('suena mal: cuenta las notas D y F; "Dejar como está" lo saca, queda en la base, y se puede volver a contar', () => {
    const f = idDe('roto.mp3')
    lib.db.prepare("UPDATE analysis SET grade = 'F' WHERE file_id = ?").run(f)
    expect(estado.leer().grupos.sonido).toMatchObject({ n: 1, dejados: 0 })
    expect(estado.dejar('sonido', [f]).grupos.sonido).toMatchObject({ n: 0, dejados: 1 })
    // otra ventana (o la base traída a otra compu) ve lo mismo: no es una marca de la pantalla
    expect(new Estado(lib.db, { pathOf: () => null, organizer: org }).leer().grupos.sonido.n).toBe(0)
    expect(estado.dejar('sonido', [f], false).grupos.sonido.n).toBe(1)
    expect(siguienteGrupo(estado.leer())).toBe('internet') // lo que sigue: el tema que cambió de nombre, sin buscar
  })

  it('"Dejar como está" en carpetas: Organizar ya no lo mueve, y no vuelve a contar', async () => {
    guardarRegla(lib.db, { rule: '%genero%/%artista% - %titulo%', dest: 'Otra' })
    const antes = estado.leer().grupos.carpetas
    const uno = antes.filas[0].ids[0]
    const despues = estado.dejar('carpetas', [uno]).grupos.carpetas
    expect(despues.n).toBe(antes.n! - 1)
    expect(org.plan(reglaElegida(lib.db)).skipped.find((s) => s.fileId === uno)?.reason).toMatch(/dejaste como está/)
    expect(() => estado.dejar('otra cosa' as never, [uno])).toThrow(/desconocida/)
    // una regla rota no deja al Inicio sin las otras partes
    const e = estado.regla({ rule: '%nada%/%titulo%', dest: 'X' })
    expect(e.grupos.carpetas).toMatchObject({ n: null, espera: 'error', error: expect.stringMatching(/%nada%/) })
    expect(e.grupos.nombres.n).toBe(1)
  })
})
