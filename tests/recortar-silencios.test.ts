// Recortar silencios de punta a punta (masterplan 4, 4A.3; core/trim.ts): la propuesta (qué se corta y qué no, y por qué),
// Cambios pendientes, aplicar con el Reemplazo (el original a la papelera), el Historial y deshacer.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe, probe } from '@paila/core/probe'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import { Changes } from '@paila/core/changes'
import { Replacer } from '@paila/core/replace'
import { replacementEntries } from '@paila/core/history-replace'
import { applyTrim, planTrims, proposal, trimValue } from '@paila/core/trim'
import { readTags } from '@paila/core/tagio'
import type { TrimPlan } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }
let dir: string
let lib: Library
let plan: TrimPlan
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const sha = (f: string) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')

type Piece = ['silencio', number] | ['tono', number] | ['ruido', number] | ['fade', number]
/** Un tema con pedazos: silencio digital, un tono, ruido de fondo bajito (−70 dB, como una cinta) o un tono que se apaga. */
function make(rel: string, pieces: Piece[], args: string[] = []) {
  const out = M(rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const src = (p: Piece) => p[0] === 'silencio' ? `anullsrc=r=44100:cl=stereo:d=${p[1]}` : p[0] === 'ruido' ? `anoisesrc=r=44100:a=0.0003:d=${p[1]}` : `sine=frequency=440:sample_rate=44100:duration=${p[1]}`
  const graph = pieces.map((p, i) => `[${i}:a]aformat=sample_fmts=fltp:channel_layouts=stereo${p[0] === 'fade' ? `,afade=t=out:st=0:d=${p[1]}` : ''}[p${i}]`).join(';')
    + `;${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1[o]`
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...pieces.flatMap((p) => ['-f', 'lavfi', '-i', src(p)]), '-filter_complex', graph, '-map', '[o]',
    '-metadata', 'artist=Fulana', '-metadata', `title=${path.basename(rel)}`, ...args, out])
}
const item = (name: string) => plan.items.find((i) => i.rel.endsWith(name))
const skipped = (name: string) => plan.skipped.find((i) => i.rel.endsWith(name))?.why

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-recorte-'))
  make('Bajados/video.mp3', [['silencio', 3], ['tono', 12], ['silencio', 9]], ['-c:a', 'libmp3lame', '-b:a', '192k'])
  // con la extensión en mayúscula (muestra del 23/10: "….Mp3" fallaba al reemplazar)
  make('Bajados/remix.Mp3', [['silencio', 1], ['tono', 12], ['silencio', 9]], ['-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3'])
  make('CD/cinta.flac', [['ruido', 3], ['tono', 12], ['silencio', 9]])
  make('CD/fade.flac', [['tono', 10], ['fade', 6], ['silencio', 8]])
  make('Cabina/con cues.wav', [['silencio', 3], ['tono', 12], ['silencio', 9]])
  make('CD/corto.flac', [['silencio', 1], ['tono', 12], ['silencio', 3]])
  make('Celu/nota.m4a', [['silencio', 3], ['tono', 12], ['silencio', 9]], ['-c:a', 'aac'])
  // un "MP3" que adentro es Opus (bajado de YouTube; corrida del 23/10: "Dos Besitos")
  make('Bajados/video de youtube.mp3', [['silencio', 3], ['tono', 12], ['silencio', 9]], ['-c:a', 'libopus', '-f', 'webm'])
  make('Samples/hueco.wav', [['silencio', 3], ['tono', 2], ['silencio', 9]])
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  const id = (name: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${name}`) as { id: number }).id
  // un tema con cues traídos de Rekordbox, y el sample pack con el aviso (los sample packs no se analizan: se anota a mano)
  lib.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start) VALUES (?, 'rekordbox', 'hot', 1, 3.2)").run(id('con cues.wav'))
  lib.db.prepare('INSERT OR REPLACE INTO silence (file_id, silence_start, silence_end, silence_v) VALUES (?, 3, 9, 1)').run(id('hueco.wav'))
  plan = await planTrims(lib.db, (i) => lib.trackPath(i), ffmpeg)
}, 180_000)
afterAll(() => { lib?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('la propuesta', () => {
  it('el silencio de un video bajado: se corta de los dos lados, dejando un respiro', () => {
    const p = item('video.mp3')!
    expect(p.cutStart && p.cutEnd).toBe(true)
    expect(p.from).toBeCloseTo(2.7, 1) // 0,3 s antes de que suene
    expect(p.duration - p.to).toBeGreaterThan(7.5) // queda 1 s después
    expect(p.duration - p.to).toBeLessThan(8.5)
  })

  it('ruido de fondo bajito (una cinta) no es silencio: ese lado no se toca', () => {
    const p = item('cinta.flac')!
    expect(p.cutStart).toBe(false)
    expect(p.from).toBe(0)
    expect(p.cutEnd).toBe(true)
  })

  it('un fade-out queda entero: se corta recién donde ya no se oye nada', () => {
    const p = item('fade.flac')!
    expect(p.cutStart).toBe(false)
    expect(p.to).toBeGreaterThan(16.5) // el fade (lineal) se oye hasta los 16 s; se corta 1 s después
  })

  it('con cues de Rekordbox se corta solo el final, y dice por qué', () => {
    const p = item('con cues.wav')!
    expect(p.cutStart).toBe(false)
    expect(p.cutEnd).toBe(true)
    expect(p.note).toMatch(/Rekordbox o Serato/)
  })

  it('sin aviso no se propone; los sample packs y los formatos que no se cortan sin recodificar, tampoco (con su porqué)', () => {
    expect(item('corto.flac')).toBeUndefined()
    expect(skipped('hueco.wav')).toMatch(/sample packs/)
    expect(skipped('nota.m4a')).toMatch(/solo MP3, FLAC, WAV y AIFF/)
    expect(skipped('video de youtube.mp3')).toMatch(/adentro es otro formato \(opus\)/)
  })

  it('la cuenta pura: todo en silencio no tiene propuesta', () => {
    expect(proposal(Array(100).fill(1e-12))).toBeNull()
  })

  it('un golpe suelto que se oye en el silencio no se corta, y dice por qué (corrida del 23/10: el final de "Tatuaje")', () => {
    const blocks = (e: number, n: number) => Array(n).fill(e)
    const tema = [...blocks(1e-12, 60), ...blocks(1e-2, 2000), ...blocks(1e-12, 100)]
    expect(proposal(tema)).toMatchObject({ cutStart: true, cutEnd: true, click: null })
    // 0,1 s a −18 dB al final, después de 5 s de silencio digital (el comienzo del tema siguiente de un CD)
    const conGolpe = proposal([...tema, ...blocks(10 ** -1.8, 2)])!
    expect(conGolpe).toMatchObject({ cutStart: true, cutEnd: false, click: 'end' })
    // un ruidito de −75 dB (no se oye) sí se corta con el silencio
    expect(proposal([...tema, ...blocks(10 ** -7.5, 2)])).toMatchObject({ cutEnd: true, click: null })
  })
})

describe('aplicar y deshacer', () => {
  it('por Cambios pendientes: el recortado reemplaza al tema, el original va a la papelera y el Historial lo muestra como recorte', async () => {
    const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
    const replacer = new Replacer(lib.db, rootPath, ffprobe, ffmpeg)
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    changes.trimmer = (id, v, batch) => applyTrim(lib.db, replacer, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'recortes'), id, v, batch)
    const video = item('video.mp3')!, cues = item('con cues.wav')!, remix = item('remix.Mp3')!
    const before = { video: sha(M('Bajados/video.mp3')), cues: sha(M('Cabina/con cues.wav')), remix: sha(M('Bajados/remix.Mp3')) }
    changes.stageMany([video, cues, remix].map((p) => ({ id: p.fileId, field: 'trim' as const, value: trimValue(p) })))
    const shown = changes.list()
    expect(shown.find((c) => c.fileId === video.fileId)!.after).toMatch(/^Dura 0:1\d: sin 2,7 s al empezar y [78](,\d)? s al terminar de silencio$/)
    const r = await changes.apply()
    expect(r.failed).toEqual([])
    expect(r.applied).toBe(3)
    expect(changes.list()).toEqual([])
    // el MP3 quedó más corto, con sus tags; el WAV con cues, sin tocar el principio
    expect((await probe(ffprobe, M('Bajados/video.mp3'))).duration!).toBeCloseTo(video.to - video.from, 0)
    expect(readTags(M('Bajados/video.mp3'))).toMatchObject({ artist: 'Fulana', title: 'video.mp3' })
    expect((await probe(ffprobe, M('Cabina/con cues.wav'))).duration!).toBeCloseTo(cues.to, 1)
    // los originales, en la papelera de PAILA
    const reps = lib.db.prepare('SELECT id, file_id AS fileId, old_trash_rel AS t, batch FROM replacements ORDER BY id').all() as { id: number; fileId: number; t: string; batch: string }[]
    expect(reps).toHaveLength(3)
    expect(fs.readdirSync(M('Bajados'))).toContain('remix.Mp3') // la extensión, tal cual
    expect(reps.every((x) => x.batch.startsWith('recorte-') && x.t.startsWith('_PAILA/papelera/'))).toBe(true)
    expect(sha(path.join(dir, 'M', ...reps.find((x) => x.fileId === video.fileId)!.t.split('/')))).toBe(before.video)
    // el Historial: una sola tanda, como recorte
    const h = replacementEntries(lib.db, () => true)
    expect(h).toHaveLength(1)
    expect(h[0].summary).toBe('Se recortaron los silencios de 3 temas')
    expect(h[0].canUndo).toBe(true)
    // deshacer: vuelven los originales, idénticos
    for (const x of reps) replacer.undo(x.id)
    expect(sha(M('Bajados/video.mp3'))).toBe(before.video)
    expect(sha(M('Cabina/con cues.wav'))).toBe(before.cues)
    expect(sha(M('Bajados/remix.Mp3'))).toBe(before.remix)
  }, 120_000)

  it('si el archivo cambió desde la vista previa, no se toca', async () => {
    const p = item('fade.flac')!
    const replacer = new Replacer(lib.db, (rid) => lib.roots().find((r) => r.id === rid)?.path ?? null, ffprobe, ffmpeg)
    await expect(applyTrim(lib.db, replacer, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'recortes'), p.fileId, trimValue({ ...p, size: p.size + 1 }), 'recorte-x'))
      .rejects.toThrow(/cambió desde la vista previa/)
  })

  it('los sample packs no se pueden pasar a Cambios pendientes', () => {
    const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    const id = (lib.db.prepare("SELECT id FROM files WHERE rel_path LIKE '%hueco.wav'").get() as { id: number }).id
    expect(() => changes.stage([id], 'trim', '{}')).toThrow(/sample packs no se recortan/)
  })
})
