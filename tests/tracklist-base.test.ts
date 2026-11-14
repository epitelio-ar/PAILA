// Tests del tracklist de sets con la base y audio de verdad (core/setlists.ts, setlists-out.ts y el campo "comentario" de
// Cambios pendientes): temas con melodías inventadas, un set armado con pedazos de ellos, escucharlo, corregir a mano,
// sacarlo como texto / .cue / CSV, al tag del set (aplicar y deshacer, con el audio intacto) y como cue points.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { DjData } from '@paila/core/djdata'
import { encodeFingerprint } from '@paila/core/analysis/chromaprint'
import { setPrint } from '@paila/core/analysis/setprint'
import { readComment, writeTags } from '@paila/core/tagio'
import { SetLists } from '@paila/core/setlists'
import { pcmHash } from '@paila/core/audiohash'
import { recognizeGaps } from '@paila/core/setlists-scan'
import { FRAMES_PER_SECOND } from '@paila/core/soundmatch'
import { KeyError } from '@paila/core/online/http'
import type { AcoustId } from '@paila/core/online/sources'
import type { AudD } from '@paila/core/online/audd'
import type { TrackInSet } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string, lib: Library, sets: SetLists
const M = () => path.join(dir, 'M')
/** Una melodía inventada (una nota distinta cada medio segundo, según la semilla): cada tema suena distinto. */
const melody = (seed: number, secs: number) =>
  `aevalsrc='0.4*sin(2*PI*(220*pow(2,mod(floor(t*2)*${seed}+floor(t/3)*${seed * 3 + 1},12)/12))*t)+0.3*sin(2*PI*(330*pow(2,mod(floor(t*4)*${seed + 5},7)/12))*t)':s=44100:d=${secs}`
const make = (rel: string, seed: number, secs = 150) => {
  const out = path.join(M(), ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', melody(seed, secs), '-ac', '2', out])
  return out
}
const id = (end: string) => lib.tracks().find((r) => String(r[2]).endsWith(end))![0] as number

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-tracklist-'))
  const a = make('Fiesta/Uno - Primero.wav', 3), b = make('Fiesta/Dos - Segundo.wav', 5), c = make('Fiesta/Tres - Tercero.wav', 11)
  make('Otros/Cuatro - Cuarto.wav', 17)
  // el set: Uno desde el principio, Dos desde los 20 s, Tres desde el principio (90 s de cada uno), con su comentario
  const setFile = path.join(M(), 'Fiesta', 'Set', 'Set en vivo.mp3')
  fs.mkdirSync(path.dirname(setFile), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-t', '90', '-i', a, '-ss', '20', '-t', '90', '-i', b, '-t', '90', '-i', c,
    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[o]', '-map', '[o]', '-b:a', '192k', setFile])
  // (ffmpeg guarda el comentario de un MP3 en otro cuadro, TXXX: el comentario de verdad se pone con la librería de tags)
  writeTags(setFile, { comment: 'Grabado en la terraza' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M(), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  // las huellas de 120 s que guarda el análisis (como si ya hubiera pasado)
  const ins = lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, chromaprint, prints_at) VALUES (?, 1, ?, ?, '', ?, '')")
  for (const t of lib.tracks()) {
    const fid = t[0] as number, rel = String(t[2])
    if (rel.includes('Set en vivo')) continue
    const f = lib.db.prepare('SELECT size, mtime FROM files WHERE id = ?').get(fid) as { size: number; mtime: number }
    const fp = (await setPrint({ ffmpeg, file: lib.trackPath(fid)!, channels: 2, duration: null, seconds: 120 })).fp
    ins.run(fid, f.size, f.mtime, encodeFingerprint(fp))
  }
  sets = new SetLists(lib.db, (i) => lib.trackPath(i), ffmpeg)
}, 180_000)
afterAll(() => { lib?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('escuchar un set de la biblioteca', () => {
  it('dice qué temas suenan y desde qué minuto, y guarda la huella del set', async () => {
    const t = await sets.listen(id('Set en vivo.mp3'))
    const found = t.entries.filter((e) => e.source === 'biblioteca' && e.confidence !== 'baja')
    expect(found.map((e) => `${e.artist} - ${e.title}`)).toEqual(['Uno - Primero', 'Dos - Segundo', 'Tres - Tercero'])
    for (const [e, want] of found.map((e, i) => [e, i * 90] as const)) expect(Math.abs(e.start - want)).toBeLessThan(8)
    expect(t.entries.some((e) => e.title === 'Cuarto')).toBe(false)
    expect(t.printKb).toBeGreaterThan(0)
    // los temas de la carpeta de arriba del set se escucharon enteros (y "Otros" no)
    expect(sets.neighbors(id('Set en vivo.mp3')).sort()).toEqual([id('Primero.wav'), id('Segundo.wav'), id('Tercero.wav')].sort())
    expect((lib.db.prepare('SELECT COUNT(*) AS n FROM long_prints').get() as { n: number }).n).toBe(3)
  }, 120_000)

  it('un set guardado lejos de sus temas: escucha enteras las carpetas de los que ya reconoce', async () => {
    const a = lib.trackPath(id('Primero.wav'))!, c = lib.trackPath(id('Tercero.wav'))!
    const far = path.join(M(), 'Otros', 'Mezcla lejos.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', '30', '-t', '100', '-i', a, '-t', '100', '-i', c, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[o]', '-map', '[o]', '-b:a', '128k', far])
    await lib.scan()
    const steps: string[] = []
    const t = await sets.listen(id('Mezcla lejos.mp3'), { onProgress: (p) => steps.push(p.current) })
    expect(t.entries.filter((e) => e.source === 'biblioteca' && e.confidence !== 'baja').map((e) => e.title)).toEqual(['Primero', 'Tercero'])
    expect(steps.some((s) => s.includes('de las carpetas de los temas que reconoció'))).toBe(true)
  }, 120_000)

  it('la segunda vez usa la huella guardada (no vuelve a leer el set)', async () => {
    const t = await sets.listen(id('Set en vivo.mp3'))
    expect(t.took!.read).toBeLessThan(0.5)
  }, 60_000)

  it('lo corregido a mano queda, y no sale lo quitado', async () => {
    const setId = id('Set en vivo.mp3')
    const t = sets.saved(setId)!
    const edited = t.entries.map((e) => (e.title === 'Segundo' ? { ...e, hidden: true } : e))
    sets.edit(setId, edited)
    expect(sets.export(setId, 'txt')).not.toContain('Segundo')
    // volver a escuchar respeta lo quitado
    const again = await sets.listen(setId)
    expect(again.entries.find((e) => e.title === 'Segundo')!.hidden).toBe(true)
    sets.edit(setId, again.entries.map((e) => ({ ...e, hidden: false })))
  }, 60_000)
})

describe('lo que sale', () => {
  it('texto con minutos, hoja .cue y CSV', () => {
    const setId = id('Set en vivo.mp3')
    expect(sets.export(setId, 'txt').split('\n')[0]).toMatch(/^0:0\d {2}Uno - Primero$/)
    const cue = sets.export(setId, 'cue')
    expect(cue).toContain('FILE "Set en vivo.mp3" MP3')
    expect(cue).toMatch(/TRACK 02 AUDIO\r\n {4}TITLE "Segundo"\r\n {4}PERFORMER "Dos"\r\n {4}INDEX 01 01:[23]\d:\d\d/)
    expect(cue).toContain('INDEX 01 00:00:00')
    expect(sets.export(setId, 'csv').split('\r\n')[0]).toBe('Entra;Artista;Título;De dónde;Seguridad')
  })

  it('el comentario del tag conserva el que ya tenía y reemplaza un tracklist viejo de PAILA', () => {
    const setId = id('Set en vivo.mp3')
    const c = sets.commentFor(setId, 'Grabado en la terraza')!
    expect(c.startsWith('Grabado en la terraza\n\nTracklist (PAILA):\n')).toBe(true)
    expect(sets.commentFor(setId, c)).toBe(c) // otra vez: no se duplica
  })

  it('al tag del set por Cambios pendientes: se aplica, el audio queda igual y se deshace', async () => {
    const setId = id('Set en vivo.mp3'), file = lib.trackPath(setId)!
    const before = await pcmHash(ffmpeg, file)
    const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'datos', 'resguardo'))
    ch.stage([setId], 'comment', sets.commentFor(setId, readComment(file)))
    const pend = ch.list()
    expect(pend).toHaveLength(1)
    expect(pend[0].after).toMatch(/^Grabado en la terraza \(\d+ renglones\)$/)
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readComment(file)).toContain('Uno - Primero')
    expect(await pcmHash(ffmpeg, file)).toBe(before)
    await ch.undo(r.batchId!)
    expect(readComment(file)).toBe('Grabado en la terraza')
  }, 120_000)

  it('el comentario se lee y escribe igual en WAV y FLAC', () => {
    for (const ext of ['wav', 'flac']) {
      const f = path.join(dir, `prueba.${ext}`)
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', f])
      writeTags(f, { comment: 'Tracklist (PAILA):\n0:00  Uno - Primero\n1:30  Dos - Segundo' })
      expect(readComment(f)).toBe('Tracklist (PAILA):\n0:00  Uno - Primero\n1:30  Dos - Segundo')
    }
  })

  it('cue points para Rekordbox: uno por tema, sumados a los otros, y se pueden sacar', () => {
    const setId = id('Set en vivo.mp3')
    const dj = new DjData(lib.db)
    lib.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'rekordbox', 'hot', 0, 1.5, NULL, 'A', NULL)").run(setId)
    expect(sets.saveCues(setId)).toBe(3)
    const cues = dj.cues(setId)
    expect(cues.filter((c) => c.source === 'tracklist').map((c) => c.name)).toEqual(['Uno - Primero', 'Dos - Segundo', 'Tres - Tercero'])
    expect(cues.some((c) => c.source === 'rekordbox')).toBe(true)
    expect(sets.saveCues(setId)).toBe(3) // rehacerlos no los duplica
    expect(sets.cuesSaved(setId)).toBe(3)
    expect(sets.clearCues(setId)).toBe(3)
    expect(dj.cues(setId).map((c) => c.source)).toEqual(['rekordbox'])
  })

  it('la lista de sets: los largos que parecen un set, con cuántos temas encontró', () => {
    const setId = id('Set en vivo.mp3')
    expect(sets.candidates()).toEqual([]) // dura 4 minutos y medio: no es un set
    lib.db.prepare('UPDATE files SET duration = 1000 WHERE id = ?').run(setId)
    const c = sets.candidates()
    expect(c.map((x) => x.fileId)).toEqual([setId])
    expect(c[0].found).toBe(3)
    expect(c[0].why).toMatch(/set|en vivo/)
  })
})

describe('lo que no está en la biblioteca, por internet (servicios simulados)', () => {
  const gapEntries = (): TrackInSet[] => [
    { start: 0, until: 200, source: 'biblioteca', fileId: 1, alsoIds: [], artist: 'Uno', title: 'Primero', confidence: 'alta', rate: 1, windows: 10 },
    { start: 200, until: 700, source: null, fileId: null, alsoIds: [], artist: null, title: null, confidence: 'baja', rate: 1, windows: 0 },
  ]
  const hit = (artist: string, title: string) => [{ score: 0.9, recordings: [{ source: 'acoustid' as const, title, length: null, credit: [{ name: artist, join: '' }], odd: false }] }]

  it('pregunta cada 2 minutos y medio: AcoustID primero, el reconocedor si no contesta', async () => {
    const silence = path.join(dir, 'silencio.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '720', '-b:a', '16k', silence])
    const answers = [hit('X', 'Tema A'), hit('X', 'Tema A'), [], []]
    const acoustid = { lookup: async () => answers.shift() ?? [] } as unknown as AcoustId
    const auddAnswers = [{ artist: 'Y', title: 'Tema B', album: null, year: null }, null]
    const audd = { recognize: async () => auddAnswers.shift() ?? null } as unknown as AudD
    const r = await recognizeGaps(gapEntries(), new Uint32Array(Math.round(720 * FRAMES_PER_SECOND)), silence, ffmpeg, { acoustid, audd }, {})
    expect(r.entries.map((e) => [e.start, e.until, e.source, e.title])).toEqual([
      [0, 200, 'biblioteca', 'Primero'], [200, 500, 'acoustid', 'Tema A'], [500, 650, 'audd', 'Tema B'],
    ])
    expect(r.info).toEqual({ asked: 6, found: 2, note: null })
  }, 60_000)

  it('sin claves avisa qué falta; una clave que no anda corta ese servicio y lo dice', async () => {
    const none = await recognizeGaps(gapEntries(), new Uint32Array(6000), 'x', ffmpeg, { acoustid: null, audd: null }, {})
    expect(none.info.note).toMatch(/clave de AcoustID/)
    let calls = 0
    const acoustid = { lookup: async () => { calls++; throw new KeyError('AcoustID no aceptó la clave de aplicación') } } as unknown as AcoustId
    const r = await recognizeGaps(gapEntries(), new Uint32Array(6000), 'x', ffmpeg, { acoustid, audd: null }, {})
    expect(calls).toBe(1)
    expect(r.info.note).toMatch(/no aceptó la clave/)
    expect(r.entries).toHaveLength(2)
  })
})
