// Tests de Separar voz, lo que toca archivos (core/stems/separar.ts y correr.ts): a dónde va (adentro de tu Música, nunca en
// _PAILA), cómo se llaman (el BPM y el tono en el nombre, que es de donde los lee Producción), que el original quede igual, que
// la carpeta pase a Producción, el Historial con deshacer a la papelera, el modo "solo mirar", un corte en el medio, el
// buscador y la espera de una versión mejor. Con un modelo de mentira (el de UVR se baja aparte) y audio sintético.
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMUCS_N, demucsBagSeparate, demucsChunks, demucsSeparate, type DemucsBag, type DemucsModel } from '@paila/core/stems/demucs'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { STEMS4_FOLDER, STEMS_FOLDER, STEMS_STAGING, StemsSeparate, bajaCalidad } from '@paila/core/stems/separar'
import { decodeStereo, separarArchivo } from '@paila/core/stems/correr'
import { sdr, type MdxModel } from '@paila/core/analysis/stems'
import { djFromName } from '@paila/core/analysis/dj'
import { History, type HistoryDeps } from '@paila/core/history'
import { OpJournal } from '@paila/core/journal'
import { recover } from '@paila/core/recovery'
import { readTags, readComment } from '@paila/core/tagio'
import { trashUsage } from '@paila/core/purge'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')

let dir: string, M: string, tema: string, lib: Library, s: StemsSeparate, hist: History, id: number
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
const sine = (out: string, hz: number, secs = 3, extra: string[] = []) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-ac', '2', ...extra, out])

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-separar-'))
  M = path.join(dir, 'Música')
  fs.mkdirSync(path.join(M, 'Rock'), { recursive: true })
  fs.mkdirSync(path.join(M, 'Producción'), { recursive: true })
  tema = path.join(M, 'Rock', 'Sumo - Mejor no hablar.mp3')
  sine(tema, 440, 3, ['-metadata', 'artist=Sumo', '-metadata', 'title=Mejor no hablar (de ciertas cosas)', '-metadata', 'genre=Rock', '-b:a', '192k'])
  sine(path.join(M, 'Producción', 'Mejor no hablar loop.wav'), 220, 1)
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }, { rel: 'Producción', kind: 'produccion' }])
  await lib.scan()
  s = new StemsSeparate({ db: lib.db, rootPath, roots: () => lib.roots(), setRule: (r, rel, k) => lib.setRule(r, rel, k) })
  hist = new History(lib.db, { rootPath, separar: s, improver: { batches: () => [] } } as unknown as HistoryDeps)
  id = (lib.db.prepare("SELECT id FROM files WHERE rel_path LIKE 'Rock/%'").get() as { id: number }).id
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

/** Lo que devolvería la separación: dos FLAC en la carpeta de trabajo. */
function separado() {
  const st = s.staging(s.destination())
  const staged = { acapella: path.join(st, 'acapella.flac'), instrumental: path.join(st, 'instrumental.flac') }
  sine(staged.acapella, 880); sine(staged.instrumental, 110)
  return { st, staged }
}

describe('a dónde va', () => {
  it('de fábrica, «Acapellas e instrumentales (PAILA)» en la carpeta de música; se puede elegir otra adentro de la Música', () => {
    expect(s.destination()).toMatchObject({ rel: STEMS_FOLDER, chosen: false, available: true })
    expect(s.choose(path.join(M, 'Rock', 'Acapellas')).rel).toBe('Rock/Acapellas')
    expect(() => s.choose(path.join(dir, 'afuera'))).toThrow()
    expect(() => s.choose(path.join(M, '_PAILA', 'x'))).toThrow()
    expect(s.choose(null)).toMatchObject({ rel: STEMS_FOLDER, chosen: false })
  })

  it('el nombre lleva BPM y tono (Producción los lee del nombre) y nunca pisa uno que ya está', () => {
    const t = { id, name: 'Sumo - Mejor no hablar', duration: 180, grade: null, bpm: 94.6, musicKey: 'Am' }
    const n = s.names(t, s.destination())
    expect(n.acapella).toBe(`${STEMS_FOLDER}/Sumo - Mejor no hablar (Acapella) 95 BPM Am.flac`)
    expect(djFromName(path.posix.basename(n.acapella))).toMatchObject({ bpm: 95, key: 'Am' })
    fs.mkdirSync(path.join(M, STEMS_FOLDER), { recursive: true })
    fs.writeFileSync(path.join(M, ...n.instrumental.split('/')), 'ocupado')
    expect(s.names(t, s.destination()).instrumental).toBe(`${STEMS_FOLDER}/Sumo - Mejor no hablar (Instrumental) 95 BPM Am (2).flac`)
    fs.rmSync(path.join(M, STEMS_FOLDER), { recursive: true })
  })
})

describe('guardar lo separado', () => {
  it('en modo "solo mirar" no escribe nada', async () => {
    const { st, staged } = separado()
    process.env.PAILA_SOLO_LECTURA = '1'
    try { await expect(s.place(id, staged)).rejects.toThrow(/solo para mirar/) } finally { delete process.env.PAILA_SOLO_LECTURA; s.dropStaging(st) }
  })

  it('va a su carpeta con los tags del original, el original queda igual, la carpeta pasa a Producción y queda en el Historial', async () => {
    const antes = md5(tema)
    const { st, staged } = separado()
    const r = await s.place(id, staged)
    s.dropStaging(st)
    expect(r.done).toBe(2)
    expect(md5(tema)).toBe(antes)
    const aca = path.join(M, ...r.rels.find((x) => x.includes('(Acapella)'))!.split('/'))
    expect(readTags(aca)).toMatchObject({ artist: 'Sumo', title: 'Mejor no hablar (de ciertas cosas) (Acapella)', genre: 'Rock' })
    expect(readComment(aca)).toMatch(/Separado por PAILA/)
    expect(fs.existsSync(path.join(M, ...STEMS_STAGING.split('/')))).toBe(false)
    expect(lib.roots()[0].rules).toContainEqual({ rel: STEMS_FOLDER, kind: 'produccion' })
    await lib.scan()
    const kinds = lib.db.prepare('SELECT kind FROM files WHERE rel_path LIKE ?').all(`${STEMS_FOLDER}/%`) as { kind: string }[]
    expect(kinds.map((k) => k.kind)).toEqual(['produccion', 'produccion'])
    const e = hist.list().find((h) => h.kind === 'separar')!
    expect(e).toMatchObject({ files: 2, canUndo: true, undone: false })
    expect(hist.detail('separar', e.id).rows.map((x) => x.before)).toEqual(['Sumo - Mejor no hablar.mp3', 'Sumo - Mejor no hablar.mp3'])
    expect(s.made()[0]).toMatchObject({ batch: e.id, source: 'Sumo - Mejor no hablar.mp3', available: true })
  })

  it('deshacer manda los dos a la papelera de PAILA (con su nombre en la papelera) y deja de listarlos', async () => {
    const e = hist.list().find((h) => h.kind === 'separar' && !h.undone)!
    const u = await hist.undo('separar', e.id)
    expect(u).toMatchObject({ done: 2, failed: [] })
    expect(fs.readdirSync(path.join(M, STEMS_FOLDER))).toEqual([])
    expect(hist.list().find((h) => h.id === e.id)).toMatchObject({ undone: true, canUndo: false })
    expect(s.made()).toEqual([])
    const tanda = trashUsage(lib.db, () => lib.roots()).folders.find((f) => /_separado-\d+_/.test(f.folder))
    expect(tanda?.label).toMatch(/separaste/i)
  })

  it('si lo cambiaste después de separarlo, deshacer lo deja donde está', async () => {
    const { st, staged } = separado()
    const r = await s.place(id, staged)
    s.dropStaging(st)
    fs.appendFileSync(path.join(M, ...r.rels[0].split('/')), 'editado')
    const u = await hist.undo('separar', r.batch)
    expect(u.done).toBe(1)
    expect(u.failed.length).toBe(1)
    expect(fs.existsSync(path.join(M, ...r.rels[0].split('/')))).toBe(true)
  })

  it('un corte en el medio: lo que llegó se anota, lo que quedó en la carpeta de trabajo se saca', async () => {
    const { st, staged } = separado()
    const dst = (p: string) => path.join(M, STEMS_FOLDER, `Corte (${p}).flac`)
    fs.renameSync(staged.acapella, dst('Acapella')) // la acapella llegó; el instrumental no
    const j = new OpJournal(lib.db)
    const data = (part: string, p: string) => ({ batch: 77, sourceId: id, sourceRel: 'Rock/Sumo - Mejor no hablar.mp3', part, rootId: lib.roots()[0].id, rel: `${STEMS_FOLDER}/Corte (${p}).flac` })
    j.begin({ op: 'separar', rootId: null, src: staged.acapella, dst: dst('Acapella'), data: data('acapella', 'Acapella') })
    j.begin({ op: 'separar', rootId: null, src: staged.instrumental, dst: dst('Instrumental'), data: data('instrumental', 'Instrumental') })
    const rep = await recover(lib.db, { rootPath, ffmpeg })
    expect(rep.items.map((i) => i.result).sort()).toEqual(['completado', 'no-hecho'])
    expect(fs.existsSync(staged.instrumental)).toBe(false)
    expect(hist.detail('separar', 77).rows.map((x) => x.name)).toEqual(['Corte (Acapella).flac'])
    s.dropStaging(st)
  })
})

describe('elegir temas', () => {
  it('el buscador encuentra sin acentos ni mayúsculas, y no busca en Producción', () => {
    expect(s.buscar('MEJOR hablar').map((t) => t.name)).toEqual(['Sumo - Mejor no hablar (de ciertas cosas)'])
    expect(s.buscar('loop')).toEqual([])
    expect(s.buscar('   ')).toEqual([])
  })

  it('"Buscar uno mejor": queda esperando hasta que se separe o se saque', () => {
    s.esperar([id, id])
    expect(s.esperando().map((t) => t.id)).toEqual([id])
    s.dejarDeEsperar(id)
    expect(s.esperando()).toEqual([])
  })
})

describe('el aviso de baja calidad', () => {
  it('avisa en D y F (desde un MP3 de 128, también inflado a 320) y no en A, B ni C (un MP3 de 192 separa igual que el FLAC)', () => {
    expect(['A+', 'A', 'B', 'C', 'D', 'F', null].map(bajaCalidad)).toEqual([false, false, false, false, true, true, false])
  })
})

describe('el trabajo pesado (con un modelo de mentira)', () => {
  it('lee el tema, lo pasa por el modelo y escribe dos FLAC: con un modelo que devuelve todo, el instrumental es el tema', async () => {
    const out = path.join(dir, 'salida')
    const igual: MdxModel = async (spec) => spec
    const r = await separarArchivo({ file: tema, modo: 'voz', salidas: { acapella: path.join(out, 'v.flac'), instrumental: path.join(out, 'i.flac') }, dir: '', ffmpeg, threads: 1 }, igual)
    expect(r.seconds).toBeGreaterThan(2.9)
    const [orig, inst] = [await decodeStereo(ffmpeg, tema), await decodeStereo(ffmpeg, path.join(out, 'i.flac'))]
    const n = Math.min(orig[0].length, inst[0].length)
    expect(sdr([orig[0].subarray(0, n), orig[1].subarray(0, n)], [inst[0].subarray(0, n), inst[1].subarray(0, n)])).toBeGreaterThan(25)
    expect(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,bits_per_raw_sample', '-of', 'csv=p=0', path.join(out, 'v.flac')], { encoding: 'utf8' }).trim()).toBe('flac,24')
  })
  it('en 4 (HT-Demucs): escribe voz, batería, bajo y resto; con un modelo que reparte el tema en 4 cuartos, sumados dan el tema', async () => {
    const out = path.join(dir, 'salida4')
    // de mentira: cada parte es un cuarto del pedazo (la suma de las 4, el pedazo)
    const cuartos: DemucsModel = async (mix) => { const r = new Float32Array(4 * mix.length); for (let p = 0; p < 4; p++) for (let i = 0; i < mix.length; i++) r[p * mix.length + i] = mix[i] / 4; return r }
    const salidas = { acapella: path.join(out, 'voz.flac'), bateria: path.join(out, 'bat.flac'), bajo: path.join(out, 'bajo.flac'), resto: path.join(out, 'resto.flac') }
    await separarArchivo({ file: tema, modo: 'cuatro', salidas, dir: '', ffmpeg, threads: 1 }, cuartos)
    const orig = await decodeStereo(ffmpeg, tema)
    const partes = await Promise.all(Object.values(salidas).map((f) => decodeStereo(ffmpeg, f)))
    const n = Math.min(orig[0].length, ...partes.map((p) => p[0].length))
    const suma = [0, 1].map((ch) => { const s = new Float32Array(n); for (const p of partes) for (let i = 0; i < n; i++) s[i] += p[ch][i]; return s }) as [Float32Array, Float32Array]
    expect(sdr([orig[0].subarray(0, n), orig[1].subarray(0, n)], suma)).toBeGreaterThan(25)
  })
})

describe('a dónde va lo separado con dos carpetas de música', () => {
  it('a la carpeta del tema si está conectada; si no, a la primera conectada (con F: desenchufado se podía separar nada, 31/10)', () => {
    const roots = [{ id: 1, path: 'F:\Música', available: false, rules: [] }, { id: 2, path: 'C:\Temas', available: true, rules: [] }] as unknown as ReturnType<Library['roots']>
    const st = new StemsSeparate({ db: lib.db, rootPath: () => null, roots: () => roots, setRule: () => {} })
    expect(st.destination(false, 2)).toMatchObject({ rootId: 2, available: true, rel: STEMS_FOLDER })
    expect(st.destination(true)).toMatchObject({ rootId: 2, available: true, rel: STEMS4_FOLDER })
    expect(st.destination(false, 1)).toMatchObject({ rootId: 2, available: true })
  })
})

describe('separar en 4: los pedazos de 7,8 s', () => {
  it('se pisan y se juntan sin costuras: un tema de 20 s pasa entero, también el principio y el final', async () => {
    const n = 44100 * 20, L = new Float32Array(n), R = new Float32Array(n)
    for (let i = 0; i < n; i++) { L[i] = Math.sin(i / 30); R[i] = Math.cos(i / 50) }
    const pedidos: number[] = []
    const r = await demucsSeparate(async (mix) => { pedidos.push(mix.length); const o = new Float32Array(4 * mix.length); o.set(mix, 3 * mix.length); return o }, L, R)
    expect(pedidos.length).toBe(demucsChunks(n))
    let maxErr = 0
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(r.voz[0][i] - L[i]), Math.abs(r.voz[1][i] - R[i]))
    expect(maxErr).toBeLessThan(1e-5) // la voz es el tema (el modelo de mentira lo pone en la cuarta parte), sin fundidos de más
    expect(Math.max(...r.bateria[0].subarray(0, 1000))).toBe(0)
  })
  it('máxima calidad: carga cada especialista de a uno, toma solo su parte y lo suelta', async () => {
    const n = 44100 * 10, L = new Float32Array(n).fill(0.5), R = new Float32Array(n).fill(0.25)
    const log: string[] = []
    // de mentira: el especialista i devuelve el tema multiplicado por i+1 en las 4 filas (así se ve de cuál salió cada parte)
    const bag: DemucsBag = { cargar: async (i) => { log.push(`carga ${i}`); return { run: async (mix) => { const o = new Float32Array(4 * mix.length); for (let k = 0; k < o.length; k++) o[k] = mix[k % mix.length] * (i + 1); return o }, soltar: async () => { log.push(`suelta ${i}`) } } } }
    const avance: number[] = []
    const r = await demucsBagSeparate(bag, L, R, { onChunk: (d, t) => avance.push(d / t) })
    expect(log).toEqual(['carga 0', 'suelta 0', 'carga 1', 'suelta 1', 'carga 2', 'suelta 2', 'carga 3', 'suelta 3'])
    expect([r.bateria[0][5000], r.bajo[0][5000], r.resto[0][5000], r.voz[1][5000]]).toEqual([0.5, 1, 1.5, 1])
    expect(avance.at(-1)).toBe(1)
  })
  it('un tema más corto que un pedazo va en uno solo', () => {
    expect([demucsChunks(44100 * 5), demucsChunks(DEMUCS_N), demucsChunks(DEMUCS_N + 1)]).toEqual([1, 1, 2])
  })
})
