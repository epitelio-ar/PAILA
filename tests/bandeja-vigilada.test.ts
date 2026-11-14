// "Faltan o suenan mal" + Bandeja vigilada con "Reemplazar todos" (core/wanted.ts, core/inboxwatch.ts, core/inboxflow.ts),
// de punta a punta con audio generado: la lista y su exportación, la vigilancia, el emparejamiento por huella y por nombre,
// la verificación de la calidad, la simulación, el reemplazo en tanda y deshacerlo desde el Historial.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Inbox, TAR, nameGuess } from '@paila/core/inbox'
import { Wanted, listName } from '@paila/core/wanted'
import { InboxFlow, autoBatch, verify } from '@paila/core/inboxflow'
import { InboxAdd } from '@paila/core/inboxadd'
import { InboxWatcher, watchable } from '@paila/core/inboxwatch'
import { Replacer, describeCandidate, type CandidateInfo } from '@paila/core/replace'
import { History } from '@paila/core/history'
import { Changes } from '@paila/core/changes'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Improver } from '@paila/core/improve'
import { Playlists } from '@paila/core/playlists'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import type { InboxResult } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }

// "Canciones" con notas que cambian (la huella mira las notas) y ruido rosa de fondo (para que haya agudos y la nota
// distinga un FLAC de verdad de uno hecho con un MP3).
const SONG_A = "0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)+0.1*sin(2*PI*523*t)*gte(mod(t,5),2.5)"
const SONG_B = "0.3*sin(2*PI*(294+98*gte(mod(t,3),1))*t)+0.2*sin(2*PI*370*t)*lt(mod(t,2),1)+0.1*sin(2*PI*440*t)*gte(mod(t,7),3)"
const SONG_C = "0.3*sin(2*PI*(196+65*gte(mod(t,5),2))*t)+0.2*sin(2*PI*247*t)*lt(mod(t,2.5),1)+0.15*sin(2*PI*392*t)*gte(mod(t,3),1.5)"
const SONG_D = "0.3*sin(2*PI*(262+131*gte(mod(t,6),3))*t)+0.25*sin(2*PI*311*t)*lt(mod(t,4),2)"
const SONG_E = "0.3*sin(2*PI*(349+87*gte(mod(t,2),1))*t)+0.2*sin(2*PI*466*t)*lt(mod(t,5),2.5)+0.1*sin(2*PI*277*t)*gte(mod(t,3),2)"
const SONG_F = "0.3*sin(2*PI*(185+92*gte(mod(t,3.5),1.5))*t)+0.2*sin(2*PI*415*t)*lt(mod(t,6),2)+0.1*sin(2*PI*622*t)*gte(mod(t,4),1)"
const SONG_G = "0.3*sin(2*PI*(233+117*gte(mod(t,3),1.5))*t)+0.2*sin(2*PI*349*t)*lt(mod(t,4),1)+0.1*sin(2*PI*587*t)*gte(mod(t,6),2)"
const SONG_H = "0.3*sin(2*PI*(311+78*gte(mod(t,2.5),1))*t)+0.2*sin(2*PI*523*t)*lt(mod(t,3.5),1.5)+0.1*sin(2*PI*208*t)*gte(mod(t,4.5),2)"

let dir: string, lib: Library, wanted: Wanted, inbox: Inbox, flow: InboxFlow, hist: History
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const B = (rel: string) => path.join(dir, 'Bandeja', ...rel.split('/'))
const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
/** El "master" de una canción: FLAC con agudos. */
const master = (name: string, expr: string, secs = 40) => {
  const out = path.join(dir, 'src', `${name}.flac`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ff('-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${secs}`, '-f', 'lavfi', '-i', `anoisesrc=d=${secs}:c=pink:a=0.08:s=7:r=44100`,
    '-filter_complex', 'amix=inputs=2:normalize=0', '-ac', '2', '-sample_fmt', 's16', out)
  return out
}
const derive = (src: string, out: string, args: string[], meta: Record<string, string> = {}) => {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ff('-i', src, '-map_metadata', '-1', ...args, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out)
  return out
}
const idOf = (name: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${name}`) as { id: number }).id
const describe_ = (f: string) => describeCandidate(real, ffprobe, ffmpeg, f)

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-bandeja-'))
  const A = master('A', SONG_A), Bm = master('B', SONG_B), C = master('C', SONG_C), D = master('D', SONG_D)
  const E = master('E', SONG_E), F = master('F', SONG_F, 20), G = master('G', SONG_G), H = master('H', SONG_H)
  // biblioteca: temas de mala calidad (MP3 96/128), un FLAC bueno, el mismo audio con dos títulos, samples y un set
  derive(A, M('Bajados/Daft Punk - Uno.mp3'), ['-b:a', '96k']) // sin tags: el nombre sale del archivo
  derive(Bm, M('Rock/b.mp3'), ['-b:a', '96k'], { artist: 'La Renga', title: 'Bien Alto', album: 'Detonador' })
  derive(G, M('Maceo/Conjure Balearia.mp3'), ['-b:a', '96k'], { artist: 'Maceo Plex', title: 'Conjure Balearia' })
  ff('-i', M('Maceo/Conjure Balearia.mp3'), '-c', 'copy', '-metadata', 'title=Conjure Drama', M('Maceo/Conjure Drama.mp3'))
  derive(F, M('Revisar/c.mp3'), ['-b:a', '96k'], { artist: 'Alguien', title: 'Para Revisar' })
  // sin tags y con el nombre cortado (la carpeta Contents de un pendrive de Rekordbox): error de la corrida del 20/10
  derive(H, M('Revisar/Contents/Kidd Keo feat. Aleman - Touchdown (feat. Ale.mp3'), ['-b:a', '96k'])
  derive(D, M('Samples/kick loop.mp3'), ['-b:a', '96k'])
  derive(D, M('Sets/enganchado.mp3'), ['-b:a', '96k'])
  derive(E, M('Bien/e.flac'), [], { artist: 'Otro', title: 'Bueno' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }, { rel: 'Revisar', kind: 'revisar' }, { rel: 'Samples', kind: 'produccion' }, { rel: 'Sets', kind: 'sets' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  // la Bandeja: lo que "se bajó"
  derive(A, B('Uno (FLAC).flac'), []) // el mismo audio, mejor, sin tags ni nombre útil
  derive(Bm, B('track07.flac'), []) // el mismo audio sin tags
  derive(M('Bajados/Daft Punk - Uno.mp3'), B('falso.flac'), []) // un FLAC hecho con el MP3 de 96: no sirve
  ff('-i', F, '-i', Bm, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-b:a', '320k', B('b extended.mp3')) // otra versión
  // el tema que faltaba (suena distinto de "Conjure Drama.mp3"), con tags de otra cosa: se reconoce por el nombre (corrida del 20/10)
  derive(C, B('Maceo Plex - Conjure Drama.flac'), [], { artist: 'kase.O', title: 'Intro' })
  derive(D, B('otro.mp3'), ['-b:a', '256k']) // suena como un sample: los samples nunca son candidatos
  fs.writeFileSync(B('bajando.mp3.part'), 'a medio bajar')
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const replacer = new Replacer(lib.db, rootPath, ffprobe, ffmpeg)
  wanted = new Wanted(lib.db)
  inbox = new Inbox(lib.db, ffprobe, path.join(dir, 'work'), ffmpeg, wanted)
  flow = new InboxFlow(lib.db, inbox, wanted, replacer, { ffprobe, describe: describe_, inRekordbox: () => [] })
  const playlists = new Playlists(lib.db, (i) => lib.trackPath(i))
  hist = new History(lib.db, { changes: new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg), trash: new Trash(lib.db, rootPath, playlists), organizer: new Organizer(lib.db, rootPath), replacer, improver: new Improver(lib.db), rootPath })
}, 240_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('faltan o suenan mal', () => {
  it('trae los temas de nota D/F de Música y Para revisar, con el nombre limpio; nunca samples, sets ni lo que está bien', () => {
    const l = wanted.list()
    const rels = l.map((i) => i.rel)
    expect(rels).toEqual(expect.arrayContaining(['Bajados/Daft Punk - Uno.mp3', 'Rock/b.mp3', 'Maceo/Conjure Balearia.mp3', 'Revisar/c.mp3']))
    expect(rels.some((r) => r?.startsWith('Samples/') || r?.startsWith('Sets/') || r?.startsWith('Bien/'))).toBe(false)
    expect(l.find((i) => i.rel === 'Bajados/Daft Punk - Uno.mp3')).toMatchObject({ artist: 'Daft Punk', title: 'Uno', status: 'pendiente', reasons: ['nota'] })
    const b = l.find((i) => i.rel === 'Rock/b.mp3')!
    expect(b).toMatchObject({ artist: 'La Renga', title: 'Bien Alto', album: 'Detonador' })
    expect(b.quality).toMatch(/^MP3 96 kbps · nota [DF]/)
    expect(b.want).toMatch(/FLAC/)
    // "Para revisar" sin tags y con el nombre cortado: sin basura ni lo que quedó a medias (corrida del 20/10)
    expect(l.find((i) => i.rel?.includes('Touchdown'))).toMatchObject({ artist: 'Kidd Keo feat. Aleman', title: 'Touchdown' })
    expect(nameGuess('Ballarak - Tekna (Original Mix) [www.slider..mp3')).toEqual({ artist: 'Ballarak', title: 'Tekna (Original Mix)' })
    expect(nameGuess('Bad Bunny - Amorfoda [www.slider.kz].mp3')).toEqual({ artist: 'Bad Bunny', title: 'Amorfoda' })
    // nombres para buscar (solo en la lista): casos reales de la corrida del 20/10
    expect(listName('Rodrigo', '04 - SOY CORDOBES', 'set/Rodrigo - Soy Cordobes.mp3')).toEqual({ artist: 'Rodrigo', title: 'SOY CORDOBES' })
    expect(listName('Various Artists', '017 - Queen - Bohemian Rhapsody', 'set/017 - Queen - Bohemian Rhapsody.mp3')).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' })
    expect(listName('Lucas Pereira', 'Rodrigo - Fuego y pasion', 'set/Rodrigo - Fuego y pasion.wav')).toEqual({ artist: 'Rodrigo', title: 'Fuego y pasion' })
    expect(listName('EminemMusic', 'Eminem - Without Me', 'set/Eminem - Without Me (Official Music Video).wav')).toEqual({ artist: 'Eminem', title: 'Without Me' })
    expect(listName('Divididos', 'Salir a asustar - En vivo', 'Rock/Salir a asustar - En vivo.mp3')).toEqual({ artist: 'Divididos', title: 'Salir a asustar - En vivo' })
    expect(listName('Tan Bionica', 'Ella - Tan Bionica', 'Tan Bionica - Ella.mp3').artist).toBe('Tan Bionica')
    // con la casilla de nota apagada (y sin lossless falsos), no entra nada de esto
    expect(wanted.list({ bad: false, fair: false, fakes: false, rekordbox: false })).toEqual([])
  })

  it('"puede venir de un MP3" (B, corte en seco en 19,5 kHz): solo con su casilla, para buscar el original (23/10/2026)', () => { const id = idOf('Bien/e.flac'), set = (g: string, f: string | null) => lib.db.prepare('UPDATE analysis SET grade = ?, flags = ? WHERE file_id = ?').run(g, f, id), was = lib.db.prepare('SELECT grade, flags FROM analysis WHERE file_id = ?').get(id) as { grade: string; flags: string | null }; set('B', 'cut20,cut20_mp3like')
    try { expect([wanted.list().some((i) => i.fileId === id), wanted.list({ bad: false, fair: false, fakes: false, rekordbox: false, mp3like: true }).find((i) => i.fileId === id)]).toMatchObject([false, { reasons: ['puede_mp3'], want: expect.stringMatching(/original sin pérdida/) }]) } finally { set(was.grade, was.flags) } })
  it('suma con un clic el tema que falta (el mismo audio con otro título, de Duplicados), sin repetirlo', () => {
    const k = wanted.addMissing('Maceo Plex', 'Conjure Drama', idOf('Conjure Drama.mp3'))
    expect(wanted.addMissing('maceo plex', 'CONJURE DRAMA')).toBe(k)
    const it = wanted.list().find((i) => i.key === k)!
    expect(it).toMatchObject({ fileId: null, refRel: 'Maceo/Conjure Drama.mp3', reasons: ['falta'], quality: 'No lo tenés', status: 'pendiente' })
  })

  it('exporta .txt y .csv; lo exportado queda "pedido", y lo ignorado nunca sale', () => {
    wanted.setStatus(`f${idOf('Revisar/c.mp3')}`, 'ignorar')
    const csv = wanted.export('csv')
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('Artista;Título;Álbum;Duración;Calidad actual;Conviene conseguir;Estado;Pedido') // Pedido: la lista traída de la que viene (core/requests.ts)
    expect(lines.some((l) => l.startsWith('La Renga;Bien Alto;Detonador;0:40;MP3 96 kbps'))).toBe(true)
    expect(csv.text).not.toContain('Para Revisar')
    expect(csv.marked).toBe(csv.count)
    const txt = wanted.export('txt')
    expect(txt.text.split('\r\n')).toEqual(expect.arrayContaining(['Daft Punk - Uno', 'La Renga - Bien Alto', 'Maceo Plex - Conjure Drama']))
    expect(txt.marked).toBe(0) // ya estaban pedidos
    expect(wanted.export('txt', undefined, { onlyNew: true }).count).toBe(0)
    expect(wanted.list().find((i) => i.rel === 'Rock/b.mp3')!.status).toBe('pedido')
    expect(wanted.requested()).toContain(idOf('Rock/b.mp3'))
  })
})

describe('verificación', () => {
  const cand = (o: Partial<CandidateInfo>): CandidateInfo => ({
    path: 'x.flac', ext: 'flac', codec: 'flac', kbps: 900, sampleRate: 44100, bits: 16, duration: 200, size: 1, grade: 'A', label: 'Calidad CD real', says: '', why: [],
    lufs: -9, cutoff: 22000, artist: null, title: null, album: null, flags: [], clipEvents: 0, spectrum: [], ...o,
  })
  const old = { grade: 'D', duration: 200, clipEvents: 0, lufs: -9 }
  it('pasa si es mejor de verdad; un FLAC falso, otra duración, dañado o con más recortes no', () => {
    expect(verify(old, cand({})).ok).toBe(true)
    expect(verify(old, cand({ grade: 'F', label: 'MP3 de ~128 kbps disfrazado', flags: ['fake_lossless'] })).problems.join()).toMatch(/disfrazado/)
    expect(verify(old, cand({ grade: 'D' })).problems.join()).toMatch(/No es mejor/)
    expect(verify(old, cand({ duration: 203 })).problems.join()).toMatch(/Dura distinto/)
    expect(verify(old, cand({ duration: 201.5 })).ok).toBe(true) // ±2 s
    expect(verify(old, cand({ flags: ['damaged'] })).ok).toBe(false)
    expect(verify(old, cand({ clipEvents: 120, lufs: -7 })).problems.join()).toMatch(/más fuerte y con más recortes/)
    expect(verify({ ...old, clipEvents: 118 }, cand({ clipEvents: 120 })).ok).toBe(true)
    // con el mismo volumen, más recortes en el lossless es un efecto del MP3 (corrida del 20/10: "Blues de la libertad")
    expect(verify({ ...old, clipEvents: 56, lufs: -11.7 }, cand({ clipEvents: 207, lufs: -11.5 })).ok).toBe(true)
  })
  it('un FLAC hecho de tu MP3 saturado no pasa aunque engañe al detector de agudos (corrida del 20/10: "Cruz diablo")', () => {
    // espectros de 128 puntos (0–22 kHz): el tuyo corta en 18,2 kHz; el falso suma solo ~28 dB arriba, uno de verdad ~60
    const mp3 = Array.from({ length: 128 }, (_, i) => (i < 106 ? -60 : -150))
    const fake = mp3.map((x, i) => (i < 106 ? x : -122))
    const realFlac = mp3.map((x, i) => (i < 106 ? x : -85))
    const o = { ...old, cutoff: 18249, spectrum: mp3 }
    expect(verify(o, cand({ spectrum: fake })).problems.join()).toMatch(/hecho a partir de un archivo como el tuyo/)
    expect(verify(o, cand({ spectrum: realFlac })).ok).toBe(true)
    expect(verify({ ...o, cutoff: 22050 }, cand({ spectrum: fake })).ok).toBe(true) // si el tuyo no corta, no se mira
    // el tuyo es un MP3 disfrazado y muy saturado (mucho "ruido" arriba): el bueno suma poco pero pasa liso ("Cómo le Digo")
    const noisy = mp3.map((x, i) => (i < 106 ? x : -95))
    expect(verify({ ...o, spectrum: noisy }, cand({ spectrum: mp3.map(() => -60.5) })).ok).toBe(true)
    // un MP3 320 corta casi donde el tuyo: no dice tener más agudos, no se mira ("Nuestro amo juega al esclavo")
    expect(verify({ ...o, cutoff: 20166 }, cand({ spectrum: fake, cutoff: 20252 })).ok).toBe(true)
  })
  it('otro master pasa con aviso; si el tema de la biblioteca no está analizado, no se decide solo', () => {
    const r = verify(old, cand({ lufs: -6 }))
    expect(r.ok).toBe(true)
    expect(r.warnings.join()).toMatch(/otro master/)
    expect(verify({ ...old, grade: null }, cand({})).ok).toBe(false)
  })
})

describe('vigilancia', () => {
  it('ignora descargas a medias y las carpetas de PAILA', () => {
    const f = B('')
    expect(watchable(f, B('a.mp3'))).toBe(true)
    expect(watchable(f, B('disco.zip'))).toBe(true)
    for (const n of ['a.mp3.part', 'a.crdownload', 'a.tmp', 'a.mp3.incomplete', 'usados/a.mp3', 'no-sirvió/a.mp3', 'notas.txt']) expect(watchable(f, B(n))).toBe(false)
  })

  it('toma un archivo recién cuando terminó de bajarse, una sola vez aunque lleguen muchos avisos', async () => {
    const w = path.join(dir, 'Vigilada')
    fs.mkdirSync(w)
    const seen: string[] = []
    const watcher = new InboxWatcher({ handle: async (f) => { seen.push(path.basename(f)) }, list: (p) => inbox.expand(p), canWork: () => true }, { stableMs: 400, pollMs: 100, debounceMs: 100 })
    watcher.start(w)
    const f = path.join(w, 'llegando.mp3')
    fs.writeFileSync(f, Buffer.alloc(1000))
    for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 120)); fs.appendFileSync(f, Buffer.alloc(1000)) }
    expect(seen).toEqual([]) // todavía cambiaba
    fs.writeFileSync(path.join(w, 'otro.mp3.crdownload'), 'x')
    await new Promise((r) => setTimeout(r, 300))
    await watcher.idle(5000)
    await new Promise((r) => setTimeout(r, 300))
    watcher.stop()
    expect(seen).toEqual(['llegando.mp3'])
  })
})

describe('bandeja vigilada', () => {
  let results: InboxResult[]
  const byName = (n: string) => results.find((r) => r.name === n)!

  it('revisa todo al arrancar: empareja por huella (con los pedidos primero) o por nombre, verifica y decide', async () => {
    const watcher = new InboxWatcher({ handle: async (f) => { await flow.evaluate(f) }, list: (p) => inbox.expand(p), canWork: () => !lib.ops.busy }, { stableMs: 300, pollMs: 100 })
    watcher.start(B(''))
    await new Promise((r) => setTimeout(r, 200))
    await watcher.idle(120_000)
    watcher.stop()
    results = flow.results(B(''))
    expect(results.map((r) => r.name).sort()).toEqual(['Maceo Plex - Conjure Drama.flac', 'Uno (FLAC).flac', 'b extended.mp3', 'falso.flac', 'otro.mp3', 'track07.flac'])
    expect(byName('Uno (FLAC).flac')).toMatchObject({ decision: 'reemplazar', match: { rel: 'Bajados/Daft Punk - Uno.mp3', kind: 'mismo', by: 'sonido' }, check: { ok: true, newGrade: 'A' } })
    expect(byName('track07.flac')).toMatchObject({ decision: 'reemplazar', match: { rel: 'Rock/b.mp3', kind: 'mismo' } })
    expect(byName('falso.flac')).toMatchObject({ decision: 'no-sirve', match: { kind: 'mismo' } })
    expect(byName('falso.flac').why).toMatch(/no sirve/)
    expect(byName('b extended.mp3')).toMatchObject({ decision: 'mirar', match: { kind: 'version', rel: 'Rock/b.mp3' } })
    // se llama como "Conjure Drama.mp3" de la biblioteca, pero ese archivo suena como "Conjure Balearia": es el tema que faltaba
    expect(byName('Maceo Plex - Conjure Drama.flac')).toMatchObject({ decision: 'falta', match: null, missing: { artist: 'Maceo Plex', title: 'Conjure Drama' } })
    expect(byName('otro.mp3')).toMatchObject({ decision: 'sin-pareja', match: null })
    // los pedidos que llegaron bien pasan a "llegó"
    const st = (rel: string) => wanted.list().find((i) => i.rel === rel)!.status
    expect(st('Rock/b.mp3')).toBe('llego')
    expect(wanted.list().find((i) => i.title === 'Conjure Drama' && i.fileId == null)!.status).toBe('llego')
  }, 180_000)

  it('lo ya revisado no se vuelve a analizar mientras no cambie', async () => {
    let n = 0
    const counting = new InboxFlow(lib.db, inbox, wanted, (flow as unknown as { replacer: Replacer }).replacer, { ffprobe, describe: async (f) => { n++; return describe_(f) }, inRekordbox: () => [] })
    await counting.evaluate(B('track07.flac'))
    expect(n).toBe(0)
  })

  it('"Reemplazar todos": la simulación no toca nada; al aplicar, reemplaza, mueve a usados/ y no-sirvió/ y es una sola tanda', async () => {
    const plan = flow.plan(B(''))
    expect(plan.replace.map((p) => p.name).sort()).toEqual(['Uno (FLAC).flac', 'track07.flac'])
    expect(plan.replace.find((p) => p.name === 'track07.flac')!.newRel).toBe('Rock/b.flac')
    expect(plan.reject.map((r) => r.name)).toEqual(['falso.flac'])
    expect(fs.existsSync(M('Rock/b.mp3'))).toBe(true) // la simulación no tocó nada
    const before = idOf('Rock/b.mp3')
    const r = await lib.ops.run('test', () => flow.apply(B(''), plan))
    expect(r).toEqual({ replaced: 2, rejected: 1, failed: [] })
    // el tema es el mismo para PAILA (playlists, historial), ahora en FLAC con sus tags de siempre
    expect(idOf('Rock/b.flac')).toBe(before)
    expect(lib.db.prepare('SELECT artist, title FROM files WHERE id = ?').get(before)).toEqual({ artist: 'La Renga', title: 'Bien Alto' })
    expect(fs.existsSync(M('Rock/b.mp3'))).toBe(false)
    expect(fs.existsSync(B('usados/track07.flac'))).toBe(true)
    expect(fs.existsSync(B('track07.flac'))).toBe(false)
    expect(fs.existsSync(B('no-sirvió/falso.flac'))).toBe(true)
    expect(fs.readFileSync(B('no-sirvió/motivos.txt'), 'utf8')).toMatch(/falso\.flac · .*disfrazado|falso\.flac · .*No es mejor/)
    // nada se borró: el viejo está en la papelera de PAILA
    expect(fs.readdirSync(M('_PAILA/papelera'), { recursive: true }).map(String).some((f) => f.endsWith('b.mp3'))).toBe(true)
    // sale de la próxima exportación
    expect(wanted.list().find((i) => i.fileId === before)!.status).toBe('reemplazado')
    expect(wanted.export('txt').text).not.toContain('Bien Alto')
    // lo que queda en la Bandeja: la versión, el que faltaba y el sin pareja; la vigilancia no mira usados/ ni no-sirvió/
    expect((await inbox.expand([B('')])).map((f) => path.basename(f)).sort()).toEqual(['Maceo Plex - Conjure Drama.flac', 'b extended.mp3', 'otro.mp3'])
    const h = hist.list().filter((e) => e.kind === 'reemplazo')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ files: 2, canUndo: true })
    expect(h[0].summary).toMatch(/Se reemplazaron 2 temas/)
  }, 120_000)

  it('deshacer la tanda desde el Historial vuelve los originales y el tema queda "pedido" de nuevo', async () => {
    const h = hist.list().find((e) => e.kind === 'reemplazo')!
    const r = await lib.ops.run('test', () => hist.undo('reemplazo', h.id))
    expect(r.done).toBe(2)
    expect(fs.existsSync(M('Rock/b.mp3'))).toBe(true)
    expect(fs.existsSync(M('Rock/b.flac'))).toBe(false)
    expect(wanted.list().find((i) => i.rel === 'Rock/b.mp3')!.status).toBe('pedido')
  })

  // docs/PENDIENTES.md, punto 3: un ZIP cuyos temas ya se usaron queda en la Bandeja (corrida del 20/10)
  it('un ZIP de la Bandeja: sus temas se abren en la carpeta de trabajo, se reemplazan y van a usados/', async () => {
    const pack = path.join(dir, 'zip'), song = path.join(pack, 'Para Revisar.flac')
    derive(path.join(dir, 'src', 'F.flac'), song, [])
    execFileSync(TAR, ['-a', '-c', '-f', B('pack.zip'), '-C', pack, 'Para Revisar.flac'])
    for (const f of await inbox.expand([B('pack.zip')])) await flow.evaluate(f)
    const plan = flow.plan(B(''))
    expect(plan.replace.map((p) => [p.name, p.rel])).toEqual([['Para Revisar.flac', 'Revisar/c.mp3']])
    expect(await lib.ops.run('test', () => flow.apply(B(''), plan))).toMatchObject({ replaced: 1, failed: [] })
    expect(fs.existsSync(B('usados/Para Revisar.flac'))).toBe(true)
  }, 120_000)
  it('…y el ZIP ya usado sale de la Bandeja (a usados/) en vez de quedar ahí', () => {
    expect(fs.existsSync(B('pack.zip'))).toBe(false)
    expect(fs.existsSync(B('usados/pack.zip'))).toBe(true)
  })
  // 22/10: con "Pasar a tu Música" (core/inboxadd.ts) los temas del ZIP se iban a la Música, pero el ZIP quedaba en la Bandeja
  it('un ZIP cuyos temas se pasaron a tu Música también sale de la Bandeja', async () => {
    const pack = path.join(dir, 'zip2')
    fs.mkdirSync(pack, { recursive: true })
    ff('-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*(415+104*gte(mod(t,3),1.5))*t)+0.2*sin(2*PI*277*t)*lt(mod(t,2.5),1)':s=44100:d=30", '-ac', '2',
      '-metadata', 'artist=Nadie Conocido', '-metadata', 'title=Tema Nuevo', path.join(pack, 'Nadie Conocido - Tema Nuevo.flac'))
    execFileSync(TAR, ['-a', '-c', '-f', B('nuevo.zip'), '-C', pack, 'Nadie Conocido - Tema Nuevo.flac'])
    for (const f of await inbox.expand([B('nuevo.zip')])) await flow.evaluate(f)
    const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
    const add = new InboxAdd(lib.db, { rootPath })
    const plan = add.plan(flow.results(B('')))
    const item = plan.items.find((i) => i.name === 'Nadie Conocido - Tema Nuevo.flac')!
    expect(item).toBeTruthy()
    const r = await lib.ops.run('test', () => flow.addToMusic(B(''), add, plan, [item.path]))
    expect(r).toMatchObject({ added: 1, failed: [] })
    expect(fs.existsSync(M('Recibidos/Nadie Conocido - Tema Nuevo.flac'))).toBe(true)
    expect(fs.existsSync(B('nuevo.zip'))).toBe(false)
    expect(fs.existsSync(B('usados/nuevo.zip'))).toBe(true)
  }, 120_000)
  // MASTERPLAN-3, punto 6: "Reemplazar todos" automático solo cuando hay confianza (huella segura + verificación)
  it('modo automático: solo el mismo audio por huella, verificado y sin avisos; lo del día es una tanda del Historial', async () => {
    // lo que quedó en la Bandeja no se reemplaza solo: otra versión, el que faltaba, el sin pareja
    for (const n of ['b extended.mp3', 'Maceo Plex - Conjure Drama.flac', 'otro.mp3']) expect(flow.autoItem(B(''), B(n))).toBeNull()
    // llega "Touchdown" en FLAC (el de la biblioteca es un MP3 de 96 sin tags, con el nombre cortado)
    const T = derive(path.join(dir, 'src', 'H.flac'), B('auto/Touchdown.flac'), [])
    expect(await flow.evaluate(T)).toMatchObject({ decision: 'reemplazar', match: { kind: 'mismo', by: 'sonido' }, check: { ok: true } })
    expect(flow.autoItem(B(''), T)).toMatchObject({ rel: 'Revisar/Contents/Kidd Keo feat. Aleman - Touchdown (feat. Ale.mp3' })
    const rb = new InboxFlow(lib.db, inbox, wanted, (flow as unknown as { replacer: Replacer }).replacer, { ffprobe, describe: describe_, inRekordbox: (ids) => ids })
    expect(rb.autoItem(B(''), T)).toBeNull() // ya está en Rekordbox: queda para mirarlo
    // con un aviso (otro master) o emparejado por el nombre y no por cómo suena: tampoco
    const row = lib.db.prepare('SELECT result FROM inbox_items WHERE path = ?').get(T) as { result: string }
    const tocar = (fn: (x: InboxResult) => void) => { const x = JSON.parse(row.result) as InboxResult; fn(x); lib.db.prepare('UPDATE inbox_items SET result = ? WHERE path = ?').run(JSON.stringify(x), T) }
    tocar((x) => { x.check!.warnings = ['Es otro master: el volumen cambia 2,5 dB.'] }); expect(flow.autoItem(B(''), T)).toBeNull()
    tocar((x) => { x.match!.by = 'tags' }); expect(flow.autoItem(B(''), T)).toBeNull()
    lib.db.prepare('UPDATE inbox_items SET result = ? WHERE path = ?').run(row.result, T)
    // se aplica con la tanda del día: en el Historial dice que lo hizo solo, y se deshace
    expect(autoBatch(new Date(2026, 9, 22))).toBe('bandeja-auto-2026-10-22')
    expect(await lib.ops.run('test', () => flow.apply(B(''), { replace: [flow.autoItem(B(''), T)!], reject: [], rekordbox: 0 }, {}, autoBatch()))).toMatchObject({ replaced: 1, failed: [] })
    expect([fs.existsSync(B('usados/Touchdown.flac')), fs.existsSync(M('Revisar/Contents/Kidd Keo feat. Aleman - Touchdown (feat. Ale.flac'))]).toEqual([true, true])
    expect(hist.list().find((e) => e.kind === 'reemplazo')).toMatchObject({ canUndo: true, summary: 'Se reemplazó solo «Kidd Keo feat. Aleman - Touchdown (feat. Ale.mp3» por una versión mejor (Bandeja, modo automático)' })
  }, 120_000)
})
