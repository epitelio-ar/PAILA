// Choques entre herramientas (repaso de experiencia del 27/10, docs/pruebas/2026-10-27-repaso-experiencia.md): una herramienta
// que deshace o desengancha lo que hizo otra según el orden en que se usan. Cada caso reproduce un choque real; los que todavía
// no tienen arreglo van con `it.skip` y dicen qué tendría que pasar: al arreglarlo, se saca el `.skip`.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { PlaylistOps } from '@paila/core/playlistops'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { Changes } from '@paila/core/changes'
import { Replacer, replacedSince } from '@paila/core/replace'
import { Trash } from '@paila/core/trash'
import { retenidos } from '@paila/core/confianza'
import { OpLock, WaitCancelled } from '@paila/core/oplock'
import { LibraryJob } from '@paila/core/libraryjob'
import { Space } from '@paila/core/space'
import { applyTrim, planTrims, trimValue } from '@paila/core/trim'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library, pl: Playlists, ops: PlaylistOps
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const conMeta = (meta: Record<string, string>) => Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
const tone = (rel: string, meta: Record<string, string>, secs = 2) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, ...conMeta(meta), M(rel)])
}
/** Un MP3 bajado de un video: 3 s de silencio, 12 de tono y 9 de silencio (como en tests/recortar-silencios.test.ts). */
const conSilencios = (rel: string, meta: Record<string, string>) => {
  fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
  const pedazos = ['anullsrc=r=44100:cl=stereo:d=3', 'sine=frequency=440:sample_rate=44100:duration=12', 'anullsrc=r=44100:cl=stereo:d=9']
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...pedazos.flatMap((p) => ['-f', 'lavfi', '-i', p]), '-filter_complex',
    '[0:a]aformat=channel_layouts=stereo[a];[1:a]aformat=channel_layouts=stereo[b];[2:a]aformat=channel_layouts=stereo[c];[a][b][c]concat=n=3:v=0:a=1[o]',
    '-map', '[o]', ...conMeta(meta), '-c:a', 'libmp3lame', '-b:a', '192k', M(rel)])
}
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
/** Un pedido de "Traer una lista" atado a una playlist, como lo deja requests.ts. */
const pedido = (playlistId: number, nombre: string) =>
  Number(lib.db.prepare("INSERT INTO requests (name, source, playlist_id, created_at) VALUES (?, 'texto', ?, ?)").run(nombre, playlistId, new Date().toISOString()).lastInsertRowid)
const playlistDelPedido = (req: number) => (lib.db.prepare('SELECT playlist_id AS p FROM requests WHERE id = ?').get(req) as { p: number | null }).p

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-choques-'))
  tone('a.mp3', { artist: 'Madonna', title: 'Vogue' })
  tone('b.mp3', { artist: 'Duran Duran', title: 'Ordinary World' })
  conSilencios('Bajados/video.mp3', { artist: 'Fulana', title: 'Video' })
  conSilencios('Bajados/otro video.mp3', { artist: 'Fulana', title: 'Otro video' })
  tone('Cabina/con grilla.mp3', { artist: 'Fulano', title: 'Con grilla' }, 4)
  tone('Repetidos/copia.mp3', { artist: 'Fulano', title: 'Copia' })
  tone('Bajados/clip.webm', { artist: 'Fulana', title: 'Clip' })
  tone('Cabina/sesion.wav', { artist: 'Fulano', title: 'Sesión' })
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  ops = new PlaylistOps(lib.db, pl)
}, 180_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Traer una lista × Fusionar playlists', () => {
  // Uso real del 24/10: seis «Fiesta 2026» fusionadas con "Sacar las originales"; la lista «Faltan o suenan mal» con "Solo de esta
  // playlist" dejó de mostrar lo que faltaba. El pedido tiene que pasar a la playlist nueva (y volver si se deshace la fusión).
  it.skip('fusionar sacando las originales pasa los pedidos a la playlist nueva', () => {
    const p1 = pl.create('Fiesta 2026'), p2 = pl.create('Fiesta 2026 (2)')
    pl.addTracks(p1, [id('a.mp3')]); pl.addTracks(p2, [id('b.mp3')])
    const r1 = pedido(p1, 'Fiesta 2026'), r2 = pedido(p2, 'Fiesta 2026')
    const m = ops.merge([p1, p2], 'Fiesta 2026', true)
    expect(playlistDelPedido(r1)).toBe(m.id)
    expect(playlistDelPedido(r2)).toBe(m.id)
  })
})

describe('Recortar silencios × cualquier otro cambio del mismo tema', () => {
  // Changes.apply escribe primero los tags (cambia el tamaño y la fecha del archivo) y después recorta; el recorte compara con el
  // tamaño y la fecha de la vista previa y falla con "El archivo cambió". Pasa con Volumen parejo, géneros, tapas o nombres
  // propuestos para el mismo tema que un recorte: en la tanda junta fallan los recortes, y quedan pendientes para siempre.
  it('un recorte y un género del mismo tema se aplican juntos sin error', async () => {
    const replacer = new Replacer(lib.db, rootPath, findFfprobe()!, ffmpeg)
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    changes.trimmer = (fid, v, batch) => applyTrim(lib.db, replacer, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'recortes'), fid, v, batch)
    const plan = await planTrims(lib.db, (i) => lib.trackPath(i), ffmpeg)
    const video = plan.items.find((i) => i.rel.endsWith('Bajados/video.mp3'))!
    expect(video).toBeTruthy()
    changes.stageMany([{ id: video.fileId, field: 'trim', value: trimValue(video) }, { id: video.fileId, field: 'genre', value: 'Cumbia' }])
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    expect(changes.list()).toEqual([])
  }, 60_000)
})

describe('Reemplazar (Bandeja, Convertir) × Grilla y cues', () => {
  // Replacer.replace deja el mismo tema (file_id) con otro audio y solo borra el análisis: la grilla y los cues del audio viejo
  // siguen ahí, gridPlan no los rehace (ya "tiene grilla") y el export a Rekordbox los manda con el archivo nuevo.
  it.skip('al reemplazar un tema por otra versión, la grilla y los cues de PAILA se vuelven a calcular', async () => {
    const fid = id('con grilla.mp3')
    lib.db.prepare("INSERT INTO dj_grid (file_id, method, bpm, segments, made_at) VALUES (?, 'beatthis', 120, '[]', ?)").run(fid, new Date().toISOString())
    lib.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start) VALUES (?, 'paila', 'memory', 1, 0.5)").run(fid)
    const nueva = path.join(dir, 'nuevo', 'con grilla.mp3')
    fs.mkdirSync(path.dirname(nueva), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', ...conMeta({ artist: 'Fulano', title: 'Con grilla' }), nueva])
    await new Replacer(lib.db, rootPath, findFfprobe()!, ffmpeg).replace(fid, nueva, { keepTags: true, keepCover: true, sameName: true })
    expect(lib.db.prepare("SELECT COUNT(*) AS n FROM dj_grid WHERE file_id = ? AND method NOT IN ('rekordbox', 'serato')").get(fid)).toEqual({ n: 0 })
    expect(lib.db.prepare("SELECT COUNT(*) AS n FROM dj_cues WHERE file_id = ? AND source = 'paila'").get(fid)).toEqual({ n: 0 })
  }, 60_000)
})

describe('Duplicados (papelera) × Cambios pendientes', () => {
  // Nadie saca de Cambios pendientes lo propuesto para un tema que después fue a la papelera: queda en la barra, falla en cada
  // Aplicar ("ya no está") y el botón "Aplicar cambios" no se va nunca (nota de uso del 24/10, 21:24).
  it('lo pendiente de un tema que va a la papelera deja de estar pendiente', async () => {
    const fid = id('Repetidos/copia.mp3')
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    changes.stage([fid], 'genre', 'Pop')
    expect(changes.list().some((c) => c.fileId === fid)).toBe(true)
    await new Trash(lib.db, rootPath, pl).trash([fid], 'duplicado')
    expect(changes.list().some((c) => c.fileId === fid)).toBe(false)
  })
})

describe('Cambios pendientes que no se pueden aplicar (C4)', () => {
  const nueva = () => new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  // "infinitamente queda aplicar cambios" (nota del 24/10): lo que falla queda aparte, con el motivo, y Aplicar ya no lo reintenta
  it('lo que falla queda aparte con su motivo, Aplicar no lo repite y "Sacarlos" lo quita', async () => {
    const changes = nueva()
    const fid = id('a.mp3')
    changes.stage([fid], 'filename', 'b') // ya existe b.mp3 en la misma carpeta
    const r = await changes.apply()
    expect(r.failed).toHaveLength(1)
    const [c] = changes.list().filter((x) => x.fileId === fid)
    expect(c.error).toMatch(/b\.mp3/)
    const otra = await changes.apply()
    expect(otra).toEqual({ batchId: null, applied: 0, failed: [] })
    // se vuelve a probar pidiéndolo por su número: sigue fallando y sigue aparte
    expect((await changes.apply([c.id])).failed).toHaveLength(1)
    changes.discardFailed()
    expect(changes.list().filter((x) => x.fileId === fid)).toEqual([])
  }, 60_000)
  it('volver a proponerlo le saca el motivo viejo', async () => {
    const changes = nueva()
    const fid = id('a.mp3')
    changes.stage([fid], 'filename', 'b')
    await changes.apply()
    changes.stage([fid], 'filename', 'a nuevo')
    expect(changes.list().find((x) => x.fileId === fid)?.error).toBeUndefined()
    changes.discard()
  }, 60_000)
  it('no se proponen tags donde no se pueden escribir (un WebM)', () => {
    const changes = nueva()
    const fid = id('clip.webm')
    expect(changes.stage([fid], 'genre', 'Pop')).toEqual({ staged: 0, held: 0, skipped: 1 })
    expect(changes.list().some((c) => c.fileId === fid)).toBe(false)
    // cambiarle el nombre al archivo sí se puede
    expect(changes.stage([fid], 'filename', 'Fulana - Clip').staged).toBe(1)
    changes.discard()
  })
})

describe('Recortar silencios × marcas traídas después (C8)', () => {
  it('si después de proponer el recorte se trajeron marcas de Rekordbox, no se corta el principio', async () => {
    const replacer = new Replacer(lib.db, rootPath, findFfprobe()!, ffmpeg)
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    changes.trimmer = (fid, v, batch) => applyTrim(lib.db, replacer, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'recortes'), fid, v, batch)
    const plan = await planTrims(lib.db, (i) => lib.trackPath(i), ffmpeg)
    const otro = plan.items.find((i) => i.rel.endsWith('Bajados/otro video.mp3'))!
    expect(otro.cutStart).toBe(true)
    changes.stageMany([{ id: otro.fileId, field: 'trim', value: trimValue(otro) }])
    lib.db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (?, 'rb-otro', 'rekordbox')").run(otro.fileId)
    const r = await changes.apply()
    expect(r.failed.map((f) => f.error).join()).toMatch(/Rekordbox o Serato/)
    lib.db.prepare('DELETE FROM rb_ids WHERE file_id = ?').run(otro.fileId)
    changes.discard()
  }, 60_000)
})

describe('Reemplazar × lo pendiente calculado con el audio viejo (C6)', () => {
  it('al reemplazar se saca lo pendiente de volumen y Serato; los tags propuestos quedan', async () => {
    const fid = id('b.mp3')
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    changes.stageMany([
      { id: fid, field: 'replaygain', value: JSON.stringify({ tg: -3.21, tp: 0.9, ag: null, ap: null }) },
      { id: fid, field: 'genre', value: 'New Wave' },
    ])
    const nueva = path.join(dir, 'nuevo', 'b.mp3')
    fs.mkdirSync(path.dirname(nueva), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', ...conMeta({ artist: 'Duran Duran', title: 'Ordinary World' }), nueva])
    await new Replacer(lib.db, rootPath, findFfprobe()!, ffmpeg).replace(fid, nueva, { keepTags: true, keepCover: true, sameName: true })
    expect(changes.list().filter((c) => c.fileId === fid).map((c) => c.field)).toEqual(['genre'])
    expect(replacedSince(lib.db, '2000-01-01').has(fid)).toBe(true)
    changes.discard()
  }, 60_000)
})

describe('Orden de confianza para nombres y tags (DECISIONES 27/10)', () => {
  const nueva = () => new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  it('una regla automática no pisa lo propuesto desde internet: queda para mirar a mano, con quién lo puso', () => {
    const changes = nueva()
    const fid = id('a.mp3')
    changes.stage([fid], 'title', 'Vogue (Single Version)', 'internet')
    expect(changes.stage([fid], 'title', 'Vogue (single version)', 'reglas')).toEqual({ staged: 0, held: 1, skipped: 0 })
    expect(changes.list().find((c) => c.fileId === fid && c.field === 'title')?.after).toBe('Vogue (Single Version)')
    const [h] = retenidos(lib.db, () => 'Vogue')
    expect(h).toMatchObject({ id: fid, field: 'title', to: 'Vogue (single version)', from: 'Vogue (Single Version)' })
    expect(h.why).toMatch(/Completar desde internet/)
    // lo que elige la persona manda sobre todo, y suelta lo retenido
    expect(changes.stage([fid], 'title', 'Vogue', 'mano').staged + changes.stage([fid], 'title', 'Vogue (Remix)', 'mano').staged).toBeGreaterThan(0)
    expect(retenidos(lib.db, () => 'Vogue')).toEqual([])
    changes.discard()
  })
  it('una segunda herramienta del mismo nivel tampoco pisa a la primera; la misma sí se corrige sola', () => {
    const changes = nueva()
    const fid = id('a.mp3')
    changes.stage([fid], 'genre', 'Dance', 'generos')
    expect(changes.stage([fid], 'genre', 'Pop', 'internet').held).toBe(1)
    expect(changes.stage([fid], 'genre', 'House', 'generos').staged).toBe(1)
    expect(changes.list().find((c) => c.fileId === fid && c.field === 'genre')?.after).toBe('House')
    changes.discard()
    lib.db.exec('DELETE FROM held_changes')
  })
  it('lo aplicado a mano tampoco lo pisan las reglas después (si nadie lo cambió por fuera)', async () => {
    const changes = nueva()
    const fid = id('Cabina/con grilla.mp3')
    changes.stage([fid], 'title', 'Con Grilla (Edit)', 'mano')
    expect((await changes.apply()).failed).toEqual([])
    expect(changes.stage([fid], 'title', 'Con grilla (edit)', 'reglas').held).toBe(1)
    expect(changes.stage([fid], 'title', 'Con grilla (edit)').staged).toBe(1) // sin decir quién (lo de antes): no traba
    changes.discard()
    lib.db.exec('DELETE FROM held_changes')
  }, 60_000)
})

describe('Fila de trabajos y el análisis (C7)', () => {
  it('lo que mueve espera a lo que está leyendo, y lo dice en un renglón', async () => {
    const lock = new OpLock(); lock.pollMs = 10
    let soltar!: () => void
    const lee = lock.read('Buscando tapas', () => new Promise<void>((r) => { soltar = r }))
    const renglones: string[] = []
    let movio = false
    const mueve = lock.run('moviendo', async () => { movio = true }, { wait: { update: (p) => renglones.push(p.current), cancelled: () => false } })
    await new Promise((r) => setTimeout(r, 50))
    expect(movio).toBe(false)
    expect(renglones[0]).toBe('Espera a que termine: Buscando tapas')
    soltar(); await lee; await mueve
    expect(movio).toBe(true)
  })
  it('sin renglón donde decirlo, avisa enseguida; y lo que lee espera a lo que mueve', async () => {
    const lock = new OpLock(); lock.pollMs = 10
    let soltar!: () => void
    const lee = lock.read('Buscando tapas', () => new Promise<void>((r) => { soltar = r }))
    await expect(lock.run('mandando a la papelera', async () => 1)).rejects.toThrow(/buscando tapas/)
    soltar(); await lee
    let suelta!: () => void
    const mueve = lock.run('moviendo archivos', () => new Promise<void>((r) => { suelta = r }))
    let leyo = false
    const otra = lock.read('Buscando duplicados', async () => { leyo = true })
    await new Promise((r) => setTimeout(r, 50))
    expect(leyo).toBe(false)
    suelta(); await mueve; await otra
    expect(leyo).toBe(true)
  })
  it('se puede cancelar la espera', async () => {
    const lock = new OpLock(); lock.pollMs = 10
    let soltar!: () => void
    const lee = lock.read('Calculando grilla', () => new Promise<void>((r) => { soltar = r }))
    let cancelar = false
    const mueve = lock.run('moviendo', async () => 1, { wait: { update: () => {}, cancelled: () => cancelar } })
    cancelar = true
    await expect(mueve).rejects.toBeInstanceOf(WaitCancelled)
    expect(lock.busy).toBeNull()
    soltar(); await lee
  })
  it('el análisis lo pausa y lo prende PAILA sola, recién cuando terminaron todos', () => {
    const job = new LibraryJob()
    job.begin('analysis', 'analizando')
    const grilla = job.hold('grilla'), organizar = job.hold('organizar')
    expect(job.status.paused).toBe(true)
    expect(job.status.heldBy).toBe('grilla') // la pantalla dice por qué se pausó (prueba de la persona 1, 31/10)
    grilla() // la grilla termina en medio de un Organizar: no lo prende
    expect(job.status.paused).toBe(true)
    organizar()
    expect(job.status.paused).toBe(false)
    expect(job.status.heldBy).toBeNull()
    // si la persona lo había pausado, queda pausado
    job.pause()
    const otra = job.hold('aplicar'); otra()
    expect(job.status.paused).toBe(true)
    job.resume()
    // un análisis que arranca mientras algo lo tiene en pausa arranca en pausa, y sigue solo al soltar
    job.finish()
    const mover = job.hold('mover')
    job.begin('analysis', 'analizando')
    expect(job.status).toMatchObject({ paused: true, heldBy: 'mover' })
    mover()
    expect(job.status.paused).toBe(false)
  })
})

describe('Espacio, WAV → FLAC × Rekordbox (C8)', () => {
  it('cuenta cuántos de los que pasan a FLAC están en Rekordbox', () => {
    const fid = id('Cabina/sesion.wav')
    const space = new Space(lib.db, () => lib.roots() as never)
    expect(space.savings().wavAiff.inRekordbox).toBe(0)
    lib.db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (?, 'rb-sesion', 'rekordbox')").run(fid)
    expect(space.savings().wavAiff).toMatchObject({ count: 1, inRekordbox: 1 })
  })
})

describe('Dos herramientas que proponen lo mismo', () => {
  // pending_changes guarda un valor por tema y campo: la segunda propuesta pisa a la primera sin avisar (Arreglar nombres con el
  // perfil Prolijo después del Oficial, o Completar desde internet después de un arreglo a mano). Hoy pasa así: este test fija
  // el comportamiento, para que el arreglo (avisar o preguntar cuál queda) lo cambie a propósito.
  it('la última propuesta del mismo campo reemplaza a la anterior, sin avisar', () => {
    const fid = id('Bajados/otro video.mp3')
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    changes.stage([fid], 'title', 'Otro Video (Oficial)')
    changes.stage([fid], 'title', 'Otro video (Prolijo)')
    const mios = changes.list().filter((c) => c.fileId === fid && c.field === 'title')
    expect(mios.map((c) => c.after)).toEqual(['Otro video (Prolijo)'])
    changes.discard(mios.map((c) => c.id))
  })
})
