// Arreglar nombres y tags, paso "BPM y tono": borra del tag solo el BPM y el tono que seguro están mal (core/tidy-djtag.ts), por
// Cambios pendientes y el motor (core/changes.ts, core/djtag.ts), con respaldo y deshacer. Pedido del autor del 24/10, después del
// ensayo general del punto 1: en su Música, 13 temas con BPM 0, 0000, 11 o 19188, y el disco "Pet Sounds" con 192 en los 13 temas.
// Un caso por regla y por cosa que no se tiene que tocar; aplicar y deshacer en MP3 (ID3v2.3 y v2.4), FLAC, M4A, WAV y AIFF.
// Archivos sintéticos hechos con ffmpeg (nunca la biblioteca real).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { File } from 'node-taglib-sharp'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { tidy, toProposals } from '@paila/core/tidy'
import { junkBpm, junkKey, tagBpm } from '@paila/core/tidy-djtag'
import { pendingDjTags, readDjTag, refreshDjTags, writeDjTag } from '@paila/core/djtag'
import { readSeratoTag } from '@paila/core/seratotag'
import { readTags, writeTags } from '@paila/core/tagio'
import { backupsOf } from '@paila/core/ops/backup'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')

describe('qué es basura segura', () => {
  it('BPM: sin números o fuera de 40–250; lo raro y lo posible quedan', () => {
    for (const v of ['0', '0000', '11', '19188', '?', '-', ' ', '-1', '0.00', '300.5']) expect(junkBpm(v), v).toBe(true)
    for (const v of ['128', '128.00', '128,5', '128 BPM', '40', '250', '120-130', '128/64']) expect(junkBpm(v), v).toBe(false)
    expect(tagBpm('128,5')).toBe(128.5)
    expect(tagBpm('120-130')).toBeNull()
    expect(junkBpm(null)).toBe(false)
    // fuera de rango, pero PAILA mide eso, el doble o la mitad: un tema lento o un speedcore
    expect(junkBpm('35', [70])).toBe(false)
    expect(junkBpm('300', [150])).toBe(false)
    expect(junkBpm('19188', [96])).toBe(true)
  })

  it('tono: solo lo que no se lee de ninguna forma', () => {
    for (const v of ['?', '0', '13A', '0m', '-', 'Unknown', 'N/A', 'null', '  ']) expect(junkKey(v), v).toBe(true)
    for (const v of ['Am', 'A minor', '8A', '08A', '1d', '10m', '8A - Energy 6', 'Abm', 'G#m', 'C', 'La menor', 'Do#', 'Sol m', 'Fis-Dur', 'H-Moll', 'Am7', 'C Lydian', 'Eb']) expect(junkKey(v), v).toBe(false)
    expect(junkKey(null)).toBe(false)
  })
})

// ---- una biblioteca con cada caso (todos MP3 con ID3v2.4, copias de uno solo) ----
let dir: string
let lib: Library
let ch: Changes
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const idOf = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(rel) as { id: number }).id
/** Lo que PAILA mide (la tabla del análisis), sin analizar de verdad. */
const measured = (rel: string, bpm: number) => lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm, bpm_base) VALUES (?, 1, 1, 1, '', ?, ?)").run(idOf(rel), bpm, bpm)

const CASES: { rel: string; bpm?: string; key?: string; paila?: number }[] = [
  // fuera de rango o sin números: se borran
  { rel: 'Rango/cero.mp3', bpm: '0', paila: 128 }, { rel: 'Rango/ceros.mp3', bpm: '0000' }, { rel: 'Rango/once.mp3', bpm: '11', paila: 122 },
  { rel: 'Rango/enorme.mp3', bpm: '19188', paila: 96 }, { rel: 'Rango/pregunta.mp3', bpm: '?' },
  // quedan: lento medido al doble, rango raro, con "BPM" escrito, distinto de PAILA nomás
  { rel: 'Rango/lento.mp3', bpm: '35', paila: 70 }, { rel: 'Rango/rango.mp3', bpm: '120-130' }, { rel: 'Rango/texto.mp3', bpm: '128 BPM', paila: 128 },
  { rel: 'Rango/distinto.mp3', bpm: '130', paila: 152 },
  // tonos
  { rel: 'Tonos/am.mp3', key: 'Am' }, { rel: 'Tonos/pregunta.mp3', key: '?' }, { rel: 'Tonos/13a.mp3', key: '13A' }, { rel: 'Tonos/la.mp3', key: 'La menor' },
  { rel: 'Tonos/h.mp3', key: 'H-Moll' }, { rel: 'Tonos/unknown.mp3', key: 'Unknown' }, { rel: 'Tonos/mik.mp3', key: '8A - Energy 6' },
  // Pet Sounds: 192 en los 13, PAILA mide otra cosa en los 12 medidos (uno sin medir): se borran los 13
  ...[88.4, 123.6, 114.7, 125.8, 164.4, 124.2, 116.6, 116.6, 120.7, 92.8, 116, 151.6].map((p, i) => ({ rel: `Carpeta X/Pet Sounds/1-${String(i + 1).padStart(2, '0')}.mp3`, bpm: '192', paila: p })),
  { rel: 'Carpeta X/Pet Sounds/1-13.mp3', bpm: '192' },
  // un EP de techno a 125: PAILA se le parece en la mayoría (igual, el doble, 2/3): no se toca, ni el que no se parece
  ...[125, 124.8, 250, 166, 83.4].map((p, i) => ({ rel: `Techno/EP/${i + 1}.mp3`, bpm: '125', paila: p })),
  // 128 en 4, PAILA se le parece en 1: se borran los 3 que no, queda el que sí
  ...[128, 90, 95, 101].map((p, i) => ({ rel: `Casi/${i + 1}.mp3`, bpm: '128', paila: p })),
  // le copiaron a todos el BPM del primero: se salva el primero (y el que no se midió); el 2 se parece solo en 3/2: igual se borra
  ...[124, 186, 100, 150, 170, undefined].map((p, i) => ({ rel: `Copiado/${i + 1}.mp3`, bpm: '124', paila: p })),
  // pocos medidos (2 de 5): no se sabe
  ...[90, 95, undefined, undefined, undefined].map((p, i) => ({ rel: `Pocos/${i + 1}.mp3`, bpm: '140', paila: p })),
  // solo 3 con el mismo BPM: no alcanza
  ...[90, 95, 99].map((p, i) => ({ rel: `Tres/${i + 1}.mp3`, bpm: '150', paila: p })),
  // la carpeta dice el BPM: es a propósito
  ...[133, 134, 133, 150].map((p, i) => ({ rel: `Cachengue 100 BPM/${i + 1}.mp3`, bpm: '100', paila: p })),
]

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-bpmtono-'))
  const base = path.join(dir, 'base.mp3')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-b:a', '64k', base])
  for (const c of CASES) {
    fs.mkdirSync(path.dirname(M(c.rel)), { recursive: true })
    fs.copyFileSync(base, M(c.rel))
    writeTags(M(c.rel), { title: c.rel, ...(c.bpm ? { bpm: c.bpm } : {}), ...(c.key ? { key: c.key } : {}) })
  }
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  for (const c of CASES) if (c.paila) measured(c.rel, c.paila)
  ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'datos', 'resguardo'))
}, 120_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('el paso de Arreglar nombres', () => {
  it('lee el BPM y el tono una sola vez, y después solo lo que cambió', async () => {
    const pathOf = (i: number) => lib.trackPath(i)
    expect(pendingDjTags(lib.db, pathOf)).toBe(CASES.length)
    // antes de leerlos, el paso no propone nada (no inventa)
    expect(tidy(lib.db, ['djtags']).changes).toEqual([])
    const r = await refreshDjTags(lib.db, pathOf)
    expect(r).toEqual({ read: CASES.length, found: CASES.length })
    expect(pendingDjTags(lib.db, pathOf)).toBe(0)
  })

  it('propone borrar solo la basura segura', () => {
    const r = tidy(lib.db, ['djtags'])
    const got = r.changes.map((c) => `${c.rel} ${c.field} ${c.from}→${c.to || '∅'}`).sort()
    const want = [
      'Rango/cero.mp3 bpm 0→∅', 'Rango/ceros.mp3 bpm 0000→∅', 'Rango/once.mp3 bpm 11→∅', 'Rango/enorme.mp3 bpm 19188→∅', 'Rango/pregunta.mp3 bpm ?→∅',
      'Tonos/pregunta.mp3 key ?→∅', 'Tonos/13a.mp3 key 13A→∅', 'Tonos/unknown.mp3 key Unknown→∅',
      ...Array.from({ length: 13 }, (_, i) => `Carpeta X/Pet Sounds/1-${String(i + 1).padStart(2, '0')}.mp3 bpm 192→∅`),
      'Casi/2.mp3 bpm 128→∅', 'Casi/3.mp3 bpm 128→∅', 'Casi/4.mp3 bpm 128→∅',
      'Copiado/2.mp3 bpm 124→∅', 'Copiado/3.mp3 bpm 124→∅', 'Copiado/4.mp3 bpm 124→∅', 'Copiado/5.mp3 bpm 124→∅',
    ].sort()
    expect(got).toEqual(want)
    expect(r.changes.every((c) => c.step === 'djtags')).toBe(true)
    // debajo del paso, qué encontró y el disco de ejemplo
    const step = r.steps.find((s) => s.key === 'djtags')!
    expect(step.count).toBe(want.length)
    expect(step.detail).toContain('Pet Sounds')
    expect(step.detail).toContain('19188')
    // los demás pasos no lo ven, y el informe completo lo trae
    expect(tidy(lib.db, ['junk']).changes.some((c) => c.field === 'bpm' || c.field === 'key')).toBe(false)
    expect(tidy(lib.db).changes.filter((c) => c.step === 'djtags')).toHaveLength(want.length)
  })

  it('al proponer, si el archivo ya dice otra cosa, ese no va; y lo leído viejo no se usa', async () => {
    const changes = tidy(lib.db, ['djtags']).changes
    // alguien le puso un BPM bueno con otro programa después de mirar (la base todavía no se enteró)
    writeTags(M('Rango/cero.mp3'), { bpm: '128' })
    ch.stageMany(toProposals(changes))
    const staged = lib.db.prepare('SELECT f.rel_path AS rel, p.field, p.before, p.after FROM pending_changes p JOIN files f ON f.id = p.file_id').all() as { rel: string; field: string; before: string | null; after: string | null }[]
    expect(staged.find((s) => s.rel === 'Rango/cero.mp3')).toBeUndefined()
    expect(staged).toHaveLength(changes.length - 1)
    expect(staged.every((s) => s.after === null && s.before)).toBe(true)
    ch.discard()
    // después de escanear, lo leído de ese tema quedó viejo: el paso no lo usa hasta volver a leerlo
    await lib.scan()
    expect(tidy(lib.db, ['djtags']).changes.some((c) => c.rel === 'Rango/cero.mp3')).toBe(false)
    await refreshDjTags(lib.db, (i) => lib.trackPath(i))
    expect(tidy(lib.db, ['djtags']).changes.some((c) => c.rel === 'Rango/cero.mp3')).toBe(false) // 128 está bien
  })
})

// ---- aplicar y deshacer por el motor, en cada formato ----
type Fr = [string, Buffer]
const ss = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
const latin1 = (s: string) => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')])
const utf16 = (s: string) => Buffer.concat([Buffer.from([1]), Buffer.from('﻿' + s, 'utf16le')])
function id3(version: 3 | 4, frames: Fr[]): Buffer {
  const body = Buffer.concat(frames.map(([id, b]) => {
    const h = Buffer.alloc(10); h.write(id, 0, 'latin1')
    if (version === 4) ss(b.length).copy(h, 4); else h.writeUInt32BE(b.length, 4)
    return Buffer.concat([h, b])
  }))
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), ss(body.length + 256), body, Buffer.alloc(256)])
}
/** Los cuadros del ID3 (nombre y bytes), del principio del archivo (MP3) o de su bloque "ID3 "/"id3 " (AIFF, WAV). */
function frames(file: string): string[] {
  let b = fs.readFileSync(file)
  if (b.toString('latin1', 0, 3) !== 'ID3') {
    const be = b.toString('latin1', 0, 4) === 'FORM'
    for (let p = 12; p + 8 <= b.length;) {
      const id = b.toString('latin1', p, p + 4), n = be ? b.readUInt32BE(p + 4) : b.readUInt32LE(p + 4)
      if (/^id3 $/i.test(id)) { b = b.subarray(p + 8, p + 8 + n); break }
      p += 8 + n + (n & 1)
    }
  }
  const v = b[3], size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
  const out: string[] = []
  for (let p = 10; p + 10 <= 10 + size;) {
    const id = b.toString('latin1', p, p + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const n = v === 4 ? (b[p + 4] << 21) | (b[p + 5] << 14) | (b[p + 6] << 7) | b[p + 7] : b.readUInt32BE(p + 4)
    out.push(`${id}:${b.subarray(p + 10, p + 10 + n).toString('hex')}`)
    p += 10 + n
  }
  return out.sort()
}
function withChunk(file: string, tag: Buffer) {
  const b = fs.readFileSync(file)
  const be = b.toString('latin1', 0, 4) === 'FORM'
  const h = Buffer.alloc(8); h.write(be ? 'ID3 ' : 'id3 ', 0, 'latin1')
  if (be) h.writeUInt32BE(tag.length, 4); else h.writeUInt32LE(tag.length, 4)
  const out = Buffer.concat([b, h, tag, tag.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
  if (be) out.writeUInt32BE(out.length - 8, 4); else out.writeUInt32LE(out.length - 8, 4)
  fs.writeFileSync(file, out)
}
const DJ = (f: string) => f.startsWith('TBPM:') || f.startsWith('TKEY:')

describe('aplicar y deshacer, en cada formato', () => {
  let fdir: string
  let flib: Library
  let fch: Changes
  const F = (name: string) => path.join(fdir, 'M', name)
  const FORMATS = ['v23.mp3', 'v24.mp3', 'a.flac', 'a.m4a', 'a.wav', 'a.aiff']
  beforeAll(async () => {
    fdir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-bpmtono-f-'))
    fs.mkdirSync(path.join(fdir, 'M'))
    const ff = (out: string, ...codec: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...codec, out])
    // MP3 con un ID3v2.3 armado a mano (textos en Latin-1 y UTF-16, como dejan distintos programas) y otros cuadros que no se tocan
    ff(path.join(fdir, 'raw.mp3'), '-write_id3v2', '0', '-write_xing', '0')
    const v23: Fr[] = [['TIT2', utf16('Wouldn\'t It Be Nice')], ['TPE1', utf16('The Beach Boys')], ['TBPM', latin1('0000')], ['TKEY', latin1('?')], ['TCON', latin1('Pop')],
      ['COMM', Buffer.concat([Buffer.from([0]), Buffer.from('eng'), Buffer.from('\u0000de Serato', 'latin1')])]]
    fs.writeFileSync(F('v23.mp3'), Buffer.concat([id3(3, v23), fs.readFileSync(path.join(fdir, 'raw.mp3'))]))
    ff(F('v24.mp3'), '-metadata', 'title=Sloop John B', '-metadata', 'TBPM=19188', '-metadata', 'TKEY=13A')
    ff(F('a.flac'), '-c:a', 'flac', '-metadata', 'title=God Only Knows', '-metadata', 'BPM=0', '-metadata', 'INITIALKEY=-')
    ff(F('a.m4a'), '-c:a', 'aac', '-b:a', '96k', '-metadata', 'title=Caroline, No')
    const m4a = File.createFromPath(F('a.m4a')); writeDjTag(m4a, 'bpm', '19188'); writeDjTag(m4a, 'key', 'Unknown'); m4a.save(); m4a.dispose()
    ff(F('a.wav'), '-c:a', 'pcm_s16le')
    withChunk(F('a.wav'), id3(3, [['TIT2', latin1('Here Today')], ['TBPM', latin1('11')], ['TALB', latin1('Pet Sounds')]]))
    ff(F('a.aiff'), '-c:a', 'pcm_s16be', '-write_id3v2', '0')
    withChunk(F('a.aiff'), id3(4, [['TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('Pet Sounds', 'utf8')])], ['TBPM', latin1('0')], ['TKEY', latin1('?')]]))
    flib = new Library(path.join(fdir, 'paila.db'), findFfprobe())
    await flib.addRoot(path.join(fdir, 'M'), [{ rel: '', kind: 'musica' }])
    await flib.scan()
    fch = new Changes(flib.db, (i) => flib.trackPath(i), ffmpeg, path.join(fdir, 'datos', 'resguardo'))
  }, 120_000)
  afterAll(() => { flib.close(); fs.rmSync(fdir, { recursive: true, force: true }) })

  it('se borra, se verifica el sonido, queda el respaldo y deshacer lo devuelve', async () => {
    const pathOf = (i: number) => flib.trackPath(i)
    await refreshDjTags(flib.db, pathOf)
    const before = Object.fromEntries(FORMATS.map((n) => [n, { dj: readDjTag(F(n)), tags: readTags(F(n), { exact: true }), id3: /mp3|wav|aiff/.test(n) ? frames(F(n)) : null }]))
    expect(before['v23.mp3'].dj).toEqual({ bpm: '0000', key: '?' })
    expect(before['a.flac'].dj).toEqual({ bpm: '0', key: '-' })
    expect(before['a.m4a'].dj).toEqual({ bpm: '19188', key: 'Unknown' })
    expect(before['a.wav'].dj).toEqual({ bpm: '11', key: null })
    const changes = tidy(flib.db, ['djtags']).changes
    expect(changes.map((c) => `${c.rel}:${c.field}`).sort()).toEqual(['a.aiff:bpm', 'a.aiff:key', 'a.flac:bpm', 'a.flac:key', 'a.m4a:bpm', 'a.m4a:key', 'a.wav:bpm', 'v23.mp3:bpm', 'v23.mp3:key', 'v24.mp3:bpm', 'v24.mp3:key'])
    fch.stageMany(toProposals(changes))
    expect(fch.list().filter((c) => c.field === 'bpm' || c.field === 'key')).toHaveLength(changes.length)
    const r = await fch.apply()
    expect(r.failed).toEqual([])
    expect(r.applied).toBe(changes.length)
    // el respaldo de la tanda, antes de escribir (motor único)
    expect(backupsOf(flib.db, ['tags'], r.batchId!).reduce((s, b) => s + b.files, 0)).toBe(FORMATS.length)
    for (const n of FORMATS) {
      expect(readDjTag(F(n)), n).toEqual({ bpm: null, key: null })
      expect(readTags(F(n), { exact: true }), n).toEqual(before[n].tags) // lo demás, igual
      if (before[n].id3) expect(frames(F(n)).filter((f) => !DJ(f)), n).toEqual(before[n].id3!.filter((f) => !DJ(f)))
    }
    // lo leído sigue al día: no hace falta volver a leer, y ya no propone nada
    expect(pendingDjTags(flib.db, pathOf)).toBe(0)
    expect(tidy(flib.db, ['djtags']).changes).toEqual([])
    // en el diario, con lo que había de verdad
    const j = flib.db.prepare('SELECT field, before, after FROM journal WHERE batch_id = ? ORDER BY rel_path, field').all(r.batchId!) as { field: string; before: string; after: string | null }[]
    expect(j.find((x) => x.before === '0000')).toMatchObject({ field: 'bpm', after: null })

    const u = await fch.undo(r.batchId!)
    expect(u.failed).toEqual([])
    for (const n of FORMATS) {
      expect(readDjTag(F(n)), n).toEqual(before[n].dj)
      expect(readTags(F(n), { exact: true }), n).toEqual(before[n].tags)
      // en el ID3, lo demás byte por byte; el BPM y el tono vuelven con el mismo texto
      if (before[n].id3) expect(frames(F(n)).filter((f) => !DJ(f)), n).toEqual(before[n].id3!.filter((f) => !DJ(f)))
    }
    expect(pendingDjTags(flib.db, pathOf)).toBe(0)
    expect(tidy(flib.db, ['djtags']).changes).toHaveLength(changes.length)
  }, 120_000)

  it('con las marcas de Serato en la misma tanda: las dos quedan de acuerdo', async () => {
    const id = (flib.db.prepare("SELECT id FROM files WHERE rel_path = 'v24.mp3'").get() as { id: number }).id
    const serato = JSON.stringify({ m2: Buffer.from('marcas').toString('base64'), key: '13A', bpm: '19188' })
    fch.stage([id], 'serato', serato)
    fch.stageMany(toProposals(tidy(flib.db, ['djtags']).changes.filter((c) => c.rel === 'v24.mp3')))
    const r = await fch.apply()
    expect(r.failed).toEqual([])
    expect(readDjTag(F('v24.mp3'))).toEqual({ bpm: null, key: null })
    expect(JSON.parse(readSeratoTag(F('v24.mp3'))!)).toEqual({ m2: Buffer.from('marcas').toString('base64') })
    await fch.undo(r.batchId!)
    expect(readDjTag(F('v24.mp3'))).toEqual({ bpm: '19188', key: '13A' })
    expect(readSeratoTag(F('v24.mp3'))).toBe(JSON.stringify({ key: '13A', bpm: '19188' }))
  }, 60_000)
})
