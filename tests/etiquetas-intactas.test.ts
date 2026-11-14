// Guardar tags con PAILA nunca borra ni cambia etiquetas que PAILA no tocó, y deshacer devuelve el archivo con todas sus
// etiquetas tal como estaban (core/tagio.ts). Error encontrado el 22/10/2026: en un ID3v2.3 hecho por Picard se perdían la
// fecha original (TDOR) y el artista para ordenar (TSOP); en la Música, 87 de 3.104 MP3 cambiaban algo con solo guardar
// (RVAD de iTunes, comentarios, UFID, los GEOB de Serato, letras). Un caso por cada cosa encontrada, en MP3, AIFF y WAV (el
// ID3 va adentro) y el volumen parejo en FLAC. Archivos sintéticos hechos con ffmpeg y un ID3 armado a mano.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { readReplayGain, readTags, writeTags } from '@paila/core/tagio'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let ch: Changes

// ---- un ID3v2 armado a mano ----
type Fr = [string, Buffer]
const ss = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
const txt = (s: string) => Buffer.concat([Buffer.from([1]), Buffer.from('﻿' + s, 'utf16le')]) // UTF-16 con BOM, como Picard en v2.3
function id3(version: 3 | 4, frames: Fr[]): Buffer {
  const body = Buffer.concat(frames.map(([id, b]) => {
    const h = Buffer.alloc(10); h.write(id, 0, 'latin1')
    if (version === 4) ss(b.length).copy(h, 4); else h.writeUInt32BE(b.length, 4)
    return Buffer.concat([h, b])
  }))
  const pad = Buffer.alloc(256)
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), ss(body.length + pad.length), body, pad])
}
/** Los cuadros de un ID3v2 (nombre y contenido), leídos a mano. */
function framesOf(tag: Buffer): string[] {
  const v = tag[3], size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9]
  const out: string[] = []
  for (let p = 10; p + 10 <= 10 + size;) {
    const id = tag.toString('latin1', p, p + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const n = v === 4 ? (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7] : tag.readUInt32BE(p + 4)
    out.push(`${id}:${tag.subarray(p + 10, p + 10 + n).toString('hex')}`)
    p += 10 + n
  }
  return out.sort()
}
/** El ID3 de un archivo: al principio (MP3) o en su bloque "ID3 "/"id3 " (AIFF, WAV). */
function tagOf(file: string): Buffer {
  const b = fs.readFileSync(file)
  if (b.toString('latin1', 0, 3) === 'ID3') return b
  const be = b.toString('latin1', 0, 4) === 'FORM'
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString('latin1', p, p + 4), n = be ? b.readUInt32BE(p + 4) : b.readUInt32LE(p + 4)
    if (/^id3 $/i.test(id)) return b.subarray(p + 8, p + 8 + n)
    p += 8 + n + (n & 1)
  }
  throw new Error('sin ID3')
}
/** Agrega un bloque ID3 a un WAV o AIFF hecho por ffmpeg. */
function withChunk(file: string, tag: Buffer) {
  const b = fs.readFileSync(file)
  const be = b.toString('latin1', 0, 4) === 'FORM'
  const h = Buffer.alloc(8); h.write(be ? 'ID3 ' : 'id3 ', 0, 'latin1')
  if (be) h.writeUInt32BE(tag.length, 4); else h.writeUInt32LE(tag.length, 4)
  const out = Buffer.concat([b, h, tag, tag.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
  if (be) out.writeUInt32BE(out.length - 8, 4); else out.writeUInt32LE(out.length - 8, 4)
  fs.writeFileSync(file, out)
}

// lo que dejan Picard, iTunes y Serato en un ID3v2.3 (lo que se perdía o cambiaba al guardar)
const RARE: Fr[] = [
  ['TPE1', txt('Jerry Townes')], ['TIT2', txt(' Just Say the Word ')], ['TALB', txt('Disco')],
  ['TDOR', txt('2011-11-22')], ['TSOP', txt('Townes, Jerry')], ['TSO2', txt('Varios')], ['TSOA', txt('Disco, El')],
  ['TDRC', txt('2011-11-22')], ['TDRL', txt('2011')], ['TIPL', txt('mix\u0000DJ X')],
  ['RVAD', Buffer.from('0310000000000000000000000000', 'hex')], // el volumen viejo de iTunes
  ['GEOB', Buffer.concat([Buffer.from([0]), Buffer.from('application/octet-stream\u0000\u0000Serato Markers2\u0000', 'latin1'), Buffer.from('0102030405060708', 'hex')])],
  ['UFID', Buffer.from('http://musicbrainz.org\u00004a7aaf8b-8413-4a37-88e0', 'latin1')],
  ['COMM', Buffer.concat([Buffer.from([1]), Buffer.from('eng'), Buffer.from('﻿iTunNORM\u0000', 'utf16le'), Buffer.from('﻿ 000003E8 000003E8', 'utf16le')])],
  ['USLT', Buffer.concat([Buffer.from([0]), Buffer.from('eng'), Buffer.from('\u0000Letra con\r\nsaltos', 'latin1')])],
  // un TXXX vacío y mal formado (solo la marca de UTF-16), como los de "TiK ToK" de Kesha: al escribir el volumen parejo se rearmaba
  ['TXXX', Buffer.from('01fffe4c0059005200490043004900530054000000fffe', 'hex')],
]

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-etiquetas-'))
  const m = path.join(dir, 'M')
  fs.mkdirSync(m)
  const ff = (out: string, ...codec: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...codec, out])
  // MP3: el ID3 va al principio
  ff(path.join(dir, 'raw.mp3'), '-write_id3v2', '0', '-write_xing', '0')
  fs.writeFileSync(path.join(m, 'picard23.mp3'), Buffer.concat([id3(3, RARE), fs.readFileSync(path.join(dir, 'raw.mp3'))]))
  // un ID3v2.4 con cuadros de la v2.3 (el año a la vieja)
  fs.writeFileSync(path.join(m, 'viejo24.mp3'), Buffer.concat([id3(4, [['TIT2', txt('Baila Morena')], ['TYER', txt('2004')], ['TDAT', txt('2210')]]), fs.readFileSync(path.join(dir, 'raw.mp3'))]))
  // AIFF y WAV: el ID3 en su bloque
  ff(path.join(m, 'picard.aiff'), '-c:a', 'pcm_s16be', '-write_id3v2', '0')
  withChunk(path.join(m, 'picard.aiff'), id3(3, RARE))
  ff(path.join(m, 'picard.wav'), '-c:a', 'pcm_s16le')
  withChunk(path.join(m, 'picard.wav'), id3(3, RARE))
  // FLAC con el volumen parejo de otro programa (texto con 8 decimales, clave en minúsculas)
  ff(path.join(m, 'otro.flac'), '-c:a', 'flac', '-metadata', 'replaygain_track_gain=-4.90 dB', '-metadata', 'replaygain_track_peak=0.84814500',
    '-metadata', 'replaygain_album_gain=-5.10 dB', '-metadata', 'replaygain_album_peak=0.93804900')
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(m, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'datos', 'resguardo'))
}, 120_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const idOf = (name: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path = ?').get(name) as { id: number }).id
const fileOf = (name: string) => path.join(dir, 'M', name)
// lo que la prueba cambia a propósito: el título y los TXXX del volumen parejo
const TOUCHED = { test: (f: string) => f.startsWith('TIT2:') || (f.startsWith('TXXX:') && Buffer.from(f.slice(5), 'hex').toString('latin1').replace(/[^A-Za-z_]/g, '').toUpperCase().includes('REPLAYGAIN')) }

describe('guardar no borra lo que PAILA no tocó, y deshacer lo devuelve todo', () => {
  for (const name of ['picard23.mp3', 'picard.aiff', 'picard.wav']) {
    it(`${name}: un ID3v2.3 de Picard, con RVAD, GEOB de Serato, UFID, comentario de iTunes y letra`, async () => {
      const before = framesOf(tagOf(fileOf(name)))
      expect(before.length).toBe(RARE.length)
      const id = idOf(name)
      ch.stage([id], 'title', 'Otro título')
      ch.stage([id], 'replaygain', JSON.stringify({ tg: -3.21, tp: 0.9, ag: null, ap: null }))
      const r = await ch.apply()
      expect(r.failed).toEqual([])
      // al aplicar: cambian el título y el volumen parejo; todo lo demás, byte por byte
      const applied = framesOf(tagOf(fileOf(name)))
      expect(applied.filter((f) => !TOUCHED.test(f))).toEqual(before.filter((f) => !TOUCHED.test(f)))
      expect(readTags(fileOf(name)).title).toBe('Otro título')
      // al deshacer: el tag queda como estaba, título con sus espacios incluido
      await ch.undo(r.batchId!)
      expect(framesOf(tagOf(fileOf(name)))).toEqual(before)
      expect(readTags(fileOf(name), { exact: true }).title).toBe(' Just Say the Word ')
    })
  }

  it('un ID3v2.4 con el año a la vieja (TYER, TDAT): cambiar el título no lo toca; cambiar el año sí lo pasa a TDRC', async () => {
    const f = fileOf('viejo24.mp3')
    const before = framesOf(tagOf(f))
    const id = idOf('viejo24.mp3')
    ch.stage([id], 'title', 'Baila Morena (remix)')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(framesOf(tagOf(f)).filter((x) => !TOUCHED.test(x))).toEqual(before.filter((x) => !TOUCHED.test(x)))
    await ch.undo(r.batchId!)
    // el título vuelve con el mismo texto (la librería lo escribe en UTF-8, lo normal en un v2.4); lo demás, byte por byte
    expect(framesOf(tagOf(f)).filter((x) => !TOUCHED.test(x))).toEqual(before.filter((x) => !TOUCHED.test(x)))
    expect(readTags(f, { exact: true }).title).toBe('Baila Morena')
    expect(readTags(f).year).toBe('2004')
    // escribir el año: queda uno solo, en el cuadro nuevo (la librería no sabe guardar TYER en un v2.4)
    writeTags(f, { year: '2005' })
    expect(framesOf(tagOf(f)).map((x) => x.split(':')[0]).filter((x) => /^(TYER|TDRC)$/.test(x))).toEqual(['TDRC'])
    expect(readTags(f).year).toBe('2005')
  })

  it('FLAC: el volumen parejo cambia solo los datos que cambian; los demás quedan escritos como estaban', async () => {
    const f = fileOf('otro.flac')
    const raw = () => execFileSync(findFfprobe()!, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', f]).toString()
    const before = JSON.parse(raw()).format.tags as Record<string, string>
    const id = idOf('otro.flac')
    const cur = JSON.parse(readReplayGain(f)!) as { ag: number; ap: number }
    ch.stage([id], 'replaygain', JSON.stringify({ tg: -3.21, tp: 0.9, ag: cur.ag, ap: cur.ap }))
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    const after = JSON.parse(raw()).format.tags as Record<string, string>
    const key = (o: Record<string, string>, k: string) => Object.entries(o).find(([x]) => x.toLowerCase() === k)?.[1]
    expect(key(after, 'replaygain_album_peak')).toBe(key(before, 'replaygain_album_peak')) // "0.93804900", no "0.938049"
    expect(key(after, 'replaygain_album_gain')).toBe(key(before, 'replaygain_album_gain'))
    await ch.undo(r.batchId!)
    expect(JSON.parse(readReplayGain(f)!)).toMatchObject({ tg: -4.9, tp: 0.848145, ag: -5.1 })
  })
})
