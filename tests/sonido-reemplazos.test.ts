// Sonido, una sola historia (MASTERPLAN-5, etapa 5): lo que llega a la Bandeja y es mejor entra solo al Aplicar único (core/sonido-reemplazos.ts),
// va al final del Aplicar (hereda los tags que ese Aplicar le pone al tema), es una parte de la tanda y se deshace con ella. Lo destildado no
// se aplica, y lo que no es mejor nunca se propone. Con audio generado, como tests/bandeja-vigilada.test.ts.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Inbox } from '@paila/core/inbox'
import { Wanted } from '@paila/core/wanted'
import { InboxFlow } from '@paila/core/inboxflow'
import { Replacer, describeCandidate } from '@paila/core/replace'
import { History } from '@paila/core/history'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Improver } from '@paila/core/improve'
import { Playlists } from '@paila/core/playlists'
import { aplicarTodo, paraAplicar, type AplicarDeps } from '@paila/core/aplicar'
import { aplicarReemplazos, proponerDeLaBandeja } from '@paila/core/sonido-reemplazos'
import { propuestas } from '@paila/core/propuestas'
import { apagar, claveProp } from '@paila/core/revision-apagados'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }
const SONG_A = "0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)+0.1*sin(2*PI*523*t)*gte(mod(t,5),2.5)"
const SONG_B = "0.3*sin(2*PI*(294+98*gte(mod(t,3),1))*t)+0.2*sin(2*PI*370*t)*lt(mod(t,2),1)+0.1*sin(2*PI*440*t)*gte(mod(t,7),3)"
const SONG_C = "0.3*sin(2*PI*(196+65*gte(mod(t,5),2))*t)+0.2*sin(2*PI*247*t)*lt(mod(t,2.5),1)+0.15*sin(2*PI*392*t)*gte(mod(t,3),1.5)"

let dir: string, lib: Library, flow: InboxFlow, hist: History, deps: AplicarDeps, changes: Changes, wanted: Wanted
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const B = (rel: string) => path.join(dir, 'Bandeja', ...rel.split('/'))
const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
const master = (name: string, expr: string) => {
  const out = path.join(dir, 'src', `${name}.flac`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ff('-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=30`, '-f', 'lavfi', '-i', 'anoisesrc=d=30:c=pink:a=0.08:s=7:r=44100',
    '-filter_complex', 'amix=inputs=2:normalize=0', '-ac', '2', '-sample_fmt', 's16', out)
  return out
}
const derive = (src: string, out: string, args: string[], meta: Record<string, string> = {}) => {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ff('-i', src, '-map_metadata', '-1', ...args, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out)
}
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number } | undefined)?.id
const rel = (id: number) => (lib.db.prepare('SELECT rel_path AS r, artist FROM files WHERE id = ?').get(id) as { r: string; artist: string })

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-sonido-'))
  const A = master('A', SONG_A), Bm = master('B', SONG_B), C = master('C', SONG_C)
  derive(A, M('Rock/uno.mp3'), ['-b:a', '96k'], { artist: 'Los Uno', title: 'Uno' })
  derive(Bm, M('Rock/dos.mp3'), ['-b:a', '96k'], { artist: 'Los Dos', title: 'Dos' })
  derive(C, M('Rock/tres.mp3'), ['-b:a', '96k'], { artist: 'Los Tres', title: 'Tres' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  // lo que "bajó NAPIA": dos mejores de verdad y uno hecho con el MP3 (no sirve)
  derive(A, B('PAILA - mejorar calidad/Los Uno - Uno.flac'), [])
  derive(C, B('PAILA - mejorar calidad/Los Tres - Tres.flac'), [])
  derive(M('Rock/dos.mp3'), B('PAILA - mejorar calidad/Los Dos - Dos.flac'), [])
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const replacer = new Replacer(lib.db, rootPath, ffprobe, ffmpeg)
  wanted = new Wanted(lib.db)
  const inbox = new Inbox(lib.db, ffprobe, path.join(dir, 'work'), ffmpeg, wanted)
  flow = new InboxFlow(lib.db, inbox, wanted, replacer, { ffprobe, describe: (f) => describeCandidate(real, ffprobe, ffmpeg, f), inRekordbox: () => [] })
  for (const f of await inbox.expand([B('')])) await flow.evaluate(f)
  const playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
  changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
  const trash = new Trash(lib.db, rootPath, playlists), organizer = new Organizer(lib.db, rootPath)
  hist = new History(lib.db, { changes, trash, organizer, replacer, improver: new Improver(lib.db), rootPath })
  deps = { db: lib.db, changes, trash, organizer, reemplazar: (props, avance, cancel) => aplicarReemplazos({ db: lib.db, flow, replacer, wanted, carpeta: () => B('') }, props, avance, cancel) }
}, 240_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('lo que llega entra al Aplicar único', () => {
  it('PAILA propone solo lo que es mejor de verdad, con una frase; lo trucho nunca', () => {
    expect(proponerDeLaBandeja(lib.db, flow, B(''))).toBe(2)
    const ps = propuestas(lib.db, 'reemplazo')
    expect(ps.map((p) => p.rel).sort()).toEqual(['Rock/tres.mp3', 'Rock/uno.mp3'])
    const lista = paraAplicar(lib.db, changes).filter((c) => c.field === 'reemplazo')
    expect(lista).toHaveLength(2)
    expect(lista[0].after).toMatch(/^Por una copia mejor: Llegó una copia mejor/)
    // sincronizar de nuevo no duplica ni pierde nada
    expect(proponerDeLaBandeja(lib.db, flow, B(''))).toBe(2)
    expect(propuestas(lib.db, 'reemplazo')).toHaveLength(2)
  })

  it('lo destildado no se aplica; lo demás va al final del Aplicar, hereda los tags nuevos y es una parte de la tanda', async () => {
    const uno = idOf('Rock/uno.mp3')!, tres = idOf('Rock/tres.mp3')!
    apagar(lib.db, [claveProp(tres, 'reemplazo')])
    expect(paraAplicar(lib.db, changes).some((c) => c.field === 'reemplazo' && c.fileId === tres)).toBe(false)
    changes.stage([uno], 'artist', 'Los Unos')
    const r = await lib.ops.run('test', () => aplicarTodo(deps))
    expect(r.failed).toEqual([])
    expect(r.partes).toMatchObject({ tags: 1, reemplazos: 1 })
    expect(rel(uno)).toEqual({ r: 'Rock/uno.flac', artist: 'Los Unos' })
    expect(fs.existsSync(M('Rock/uno.mp3'))).toBe(false)
    expect(fs.existsSync(B('usados/Los Uno - Uno.flac'))).toBe(true)
    expect(wanted.list().find((i) => i.fileId === uno)?.status ?? 'reemplazado').toBe('reemplazado')
    // el destildado sigue ahí, sin tocar
    expect(fs.existsSync(M('Rock/tres.mp3'))).toBe(true)
    expect(propuestas(lib.db, 'reemplazo').map((p) => p.fileId)).toEqual([tres])
    // en el Historial: un solo Aplicar con las dos partes
    const e = hist.list().find((x) => x.kind === 'aplicar')!
    expect(e.summary).toMatch(/1 copia mejor/)
    expect(e.partes?.map((p) => p.kind).sort()).toEqual(['reemplazo', 'tags'])
  }, 120_000)

  it('deshacer el Aplicar deja el tema como estaba: el MP3 de antes con su artista de antes', async () => {
    const uno = idOf('Rock/uno.flac')!
    const e = hist.list().find((x) => x.kind === 'aplicar')!
    const r = await lib.ops.run('test', () => hist.undo('aplicar', e.id))
    expect(r.failed).toEqual([])
    expect(rel(uno)).toEqual({ r: 'Rock/uno.mp3', artist: 'Los Uno' })
    expect(fs.existsSync(M('Rock/uno.flac'))).toBe(false)
  }, 60_000)

  it('si el archivo que llegó cambió o ya no está, no se aplica: vuelve con el motivo', async () => {
    const tres = idOf('Rock/tres.mp3')!
    apagar(lib.db, [claveProp(tres, 'reemplazo')], false)
    fs.appendFileSync(B('PAILA - mejorar calidad/Los Tres - Tres.flac'), Buffer.from([0]))
    const r = await lib.ops.run('test', () => aplicarTodo(deps))
    expect(r.partes.reemplazos).toBe(0)
    expect(r.failed[0]?.error).toMatch(/cambió/)
    expect(fs.existsSync(M('Rock/tres.mp3'))).toBe(true)
    // sin carpeta de Bandeja (ni quien aplique), tampoco
    const sin = await lib.ops.run('test', () => aplicarTodo({ ...deps, reemplazar: undefined }, { ids: [-propuestas(lib.db, 'reemplazo')[0].id] }))
    expect(sin.failed[0]?.error).toMatch(/Bandeja/)
  }, 60_000)
})
