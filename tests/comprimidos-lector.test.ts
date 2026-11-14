// Lectores de ZIP y RAR (core/archive/): listar sin descomprimir, sacar archivos idénticos byte a byte, nombres raros (ñ, ♥,
// ш, emoji, la página 850 de MS-DOS), RAR "sólido", partido en partes, con clave, RAR4 armado acá y zips dañados.
// Los .rar de tests/fixtures/comprimidos se armaron con WinRAR 7.13 (RAR5) a partir de dos MP3 de 1 s y dos archivos chicos.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { extractEntries, listArchive, archiveFormat } from '@paila/core/archive/read'
import { decodeName, safeRel } from '@paila/core/archive/names'
import { nextVolume } from '@paila/core/archive/rarread'
import { isArchiveName } from '@paila/core/files'
import { makeZip } from '@paila/core/zip'
import { ponerIdioma } from '@paila/shared/idioma'

const FIX = path.join(__dirname, 'fixtures', 'comprimidos')
const MD5: Record<string, string> = {
  '01 Uno ñandú.mp3': '7c92e694ba00d1635ae2a1704a5b9cd0', '02 Dos ♥ ш 🎵.mp3': '7394e1bd1ea612f91e4acd65ea434140',
  'cover.jpg': '368ac2f9b3aef66bdaa66af4bf76fd3a', 'leeme.txt': '23e434b9f9a68d8c100ade0b32f0dd61',
}
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-lector-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Saca todo lo que no es carpeta y compara con los originales. */
async function roundTrip(file: string, label: string) {
  const l = listArchive(file)
  const files = l.entries.filter((e) => !e.dir)
  const out = files.map((e) => ({ index: e.index, dest: path.join(tmp, label, e.name) }))
  const r = await extractEntries(l, out)
  expect(r.map((x) => x.error)).toEqual(files.map(() => null))
  for (const e of files) expect(md5(path.join(tmp, label, e.name)), e.name).toBe(MD5[path.posix.basename(e.name)])
  return l
}

describe('RAR5 (fixtures armados con WinRAR)', () => {
  it('lista sin descomprimir, con los nombres exactos (ñ, ♥, ш, emoji) y los tamaños', () => {
    const l = listArchive(path.join(FIX, 'disco.rar'))
    expect(l.format).toBe('rar')
    expect(l.rar!.version).toBe(5)
    expect(l.entries.filter((e) => !e.dir).map((e) => [e.name, e.size]).sort()).toEqual([
      ['Disco Ñandú/01 Uno ñandú.mp3', 4447], ['Disco Ñandú/02 Dos ♥ ш 🎵.mp3', 4447], ['Disco Ñandú/cover.jpg', 14], ['Disco Ñandú/leeme.txt', 6],
    ])
    expect(l.entries.find((e) => e.dir)?.name).toBe('Disco Ñandú')
  })

  it('saca cada archivo idéntico al original: normal, "sólido" y partido en tres partes', async () => {
    expect((await roundTrip(path.join(FIX, 'disco.rar'), 'normal')).solid).toBe(false)
    expect((await roundTrip(path.join(FIX, 'solido.rar'), 'solido')).solid).toBe(true)
    const p = await roundTrip(path.join(FIX, 'partes.part1.rar'), 'partes')
    expect(p.volumes.map((v) => path.basename(v))).toEqual(['partes.part1.rar', 'partes.part2.rar', 'partes.part3.rar'])
    expect(p.rar!.entries.some((e) => e.parts.length > 1)).toBe(true) // algún archivo cruza de una parte a otra
  })

  it('con una parte de menos: el archivo que seguía en ella queda bloqueado con el motivo; el resto se abre', async () => {
    const d = path.join(tmp, 'falta'); fs.mkdirSync(d)
    for (const n of ['partes.part1.rar', 'partes.part2.rar']) fs.copyFileSync(path.join(FIX, n), path.join(d, n))
    const l = listArchive(path.join(d, 'partes.part1.rar'))
    expect(l.missing).toBe('partes.part3.rar')
    const blocked = l.entries.filter((e) => e.blocked)
    expect(blocked.map((e) => e.blocked)).toEqual(['Falta la parte partes.part3.rar'])
    const ok = l.entries.filter((e) => !e.dir && !e.blocked)
    const r = await extractEntries(l, ok.map((e) => ({ index: e.index, dest: path.join(d, 'x', String(e.index)) })))
    expect(r.every((x) => x.error === null)).toBe(true)
  })

  it('con clave: si esconde los nombres no se lista; si no, se ve qué tiene pero no se abre', async () => {
    expect(listArchive(path.join(FIX, 'clave.rar'))).toMatchObject({ locked: true, entries: [] })
    const l = listArchive(path.join(FIX, 'clave-archivos.rar'))
    const files = l.entries.filter((e) => !e.dir)
    expect(files.length).toBe(4)
    expect(files.every((e) => e.blocked === 'Tiene clave')).toBe(true)
    const r = await extractEntries(l, [{ index: files[0].index, dest: path.join(tmp, 'clave', 'x.mp3') }])
    expect(r[0].error).toBe('Tiene clave')
    expect(fs.existsSync(path.join(tmp, 'clave', 'x.mp3'))).toBe(false)
  })

  it('un rar que no es un rar falla con un error en castellano', () => {
    const f = path.join(tmp, 'falso.rar'); fs.writeFileSync(f, 'esto no es un rar')
    expect(() => listArchive(f)).toThrow(/No es un rar/)
  })
})

// ---------- RAR 2.9/4 armado acá (guardado sin comprimir: libarchive lo saca igual) ----------

/** Nombre Unicode de RAR4: los bytes "de siempre", un 0 y cada carácter como 1 byte (modo 0) o 2 bytes (modo 2). */
function rar4Name(name: string): Buffer {
  const chars = [...name].flatMap((c) => { const cp = c.codePointAt(0)!; return cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp] })
  const ansi = Buffer.from(chars.map((c) => (c < 128 ? c : 0x3f)))
  const enc: number[] = [0] // byte alto (no se usa: todo va en modo 0 o 2)
  for (let i = 0; i < chars.length; i += 4) {
    const group = chars.slice(i, i + 4)
    enc.push(group.reduce((f, c, k) => f | ((c < 256 ? 0 : 2) << (6 - 2 * k)), 0))
    for (const c of group) c < 256 ? enc.push(c) : enc.push(c & 0xff, c >> 8)
  }
  return Buffer.concat([ansi, Buffer.from([0]), Buffer.from(enc)])
}
function block4(rest: Buffer) { const b = Buffer.concat([Buffer.alloc(2), rest]); b.writeUInt16LE(zlib.crc32(rest) & 0xffff, 0); return b }
function makeRar4(files: { name: string; data: Buffer }[]): Buffer {
  const out = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), block4(Buffer.from([0x73, 0, 0, 13, 0, 0, 0, 0, 0, 0, 0]))]
  for (const f of files) {
    const name = rar4Name(f.name)
    const h = Buffer.alloc(30)
    h[0] = 0x74; h.writeUInt16LE(0x8000 | 0x0200, 1); h.writeUInt16LE(32 + name.length, 3)
    h.writeUInt32LE(f.data.length, 5); h.writeUInt32LE(f.data.length, 9); h[13] = 2 // Windows
    h.writeUInt32LE(zlib.crc32(f.data) >>> 0, 14); h.writeUInt32LE(0x5b570000, 18); h[22] = 29; h[23] = 0x30 // guardado
    h.writeUInt16LE(name.length, 24); h.writeUInt32LE(0x20, 26)
    out.push(block4(Buffer.concat([h, name])), f.data)
  }
  out.push(block4(Buffer.from([0x7b, 0x00, 0x40, 0x07, 0x00])))
  return Buffer.concat(out)
}

describe('RAR 2.9/4', () => {
  it('lee los nombres Unicode a su manera y saca los archivos iguales', async () => {
    const files = [{ name: 'Viejo/Shlшmo ♥ Ñandú.mp3', data: crypto.randomBytes(3000) }, { name: 'Viejo/INVŌKER 🎵.flac', data: crypto.randomBytes(1000) }]
    const f = path.join(tmp, 'viejo.rar'); fs.writeFileSync(f, makeRar4(files))
    const l = listArchive(f)
    expect(l.rar!.version).toBe(4)
    expect(l.entries.map((e) => [e.name, e.size])).toEqual(files.map((x) => [x.name, x.data.length]))
    const r = await extractEntries(l, l.entries.map((e) => ({ index: e.index, dest: path.join(tmp, 'v4', String(e.index)) })))
    expect(r.map((x) => x.error)).toEqual([null, null])
    files.forEach((x, i) => expect(fs.readFileSync(path.join(tmp, 'v4', String(i))).equals(x.data)).toBe(true))
  })
})

describe('ZIP (lector propio)', () => {
  it('lista y saca con deflate, nombres en UTF-8, y descarta lo que no coincide con el CRC sin dejar nada', async () => {
    const mp3 = fs.readFileSync(path.join(tmp, 'normal', 'Disco Ñandú', '01 Uno ñandú.mp3'))
    const f = path.join(tmp, 'disco.zip'); fs.writeFileSync(f, makeZip([{ name: 'Disco Ñandú/01 Uno ñandú.mp3', data: mp3 }, { name: 'Disco Ñandú/♥.txt', data: 'hola' }]))
    const l = listArchive(f)
    expect(l.entries.map((e) => e.name)).toEqual(['Disco Ñandú/01 Uno ñandú.mp3', 'Disco Ñandú/♥.txt'])
    const r = await extractEntries(l, [{ index: 0, dest: path.join(tmp, 'z', 'a.mp3') }])
    expect(r[0].error).toBeNull()
    expect(md5(path.join(tmp, 'z', 'a.mp3'))).toBe(MD5['01 Uno ñandú.mp3'])
    // dañado: un byte cambiado en los datos comprimidos
    const bad = fs.readFileSync(f); bad[30 + Buffer.byteLength('Disco Ñandú/01 Uno ñandú.mp3') + 100] ^= 0xff
    const fb = path.join(tmp, 'roto.zip'); fs.writeFileSync(fb, bad)
    const rb = await extractEntries(listArchive(fb), [{ index: 0, dest: path.join(tmp, 'z', 'roto.mp3') }])
    expect(rb[0].error).toMatch(/dañado|No se pudo sacar/)
    expect(fs.existsSync(path.join(tmp, 'z', 'roto.mp3'))).toBe(false)
  })

  it('un zip con el CRC que no coincide dice "dañado" tal cual, también en inglés (se reconoce por una marca, no por el texto)', async () => {
    const b = makeZip([{ name: 'a.txt', data: 'hola hola hola' }])
    b[b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16] ^= 0xff // el CRC del índice
    const f = path.join(tmp, 'crc.zip'); fs.writeFileSync(f, b)
    const sacar = async () => (await extractEntries(listArchive(f), [{ index: 0, dest: path.join(tmp, 'z', 'crc.txt') }]))[0].error
    expect(await sacar()).toBe('El zip está dañado: lo que salió no coincide con lo que dice el zip')
    ponerIdioma('en')
    try { expect(await sacar()).toBe("The zip is damaged: what came out doesn't match what the zip says") } finally { ponerIdioma('es') }
  })

  it('un zip cortado o que no es zip avisa en castellano', () => {
    const f = path.join(tmp, 'corto.zip'); fs.writeFileSync(f, makeZip([{ name: 'a.mp3', data: 'x'.repeat(500) }]).subarray(0, 100))
    expect(() => listArchive(f)).toThrow(/zip/)
  })
})

describe('nombres', () => {
  it('los zip viejos de Windows vienen en la página 850 de MS-DOS; los de Mac, en UTF-8 sin avisar', () => {
    expect(decodeName(Buffer.from([0xa5, 0x61, 0x6e, 0x64, 0xa3]))).toBe('Ñandú')
    expect(decodeName(Buffer.from([0x43, 0x61, 0x6e, 0x63, 0x69, 0xa2, 0x6e, 0x20, 0xb5]))).toBe('Canción Á')
    expect(decodeName(Buffer.from('Ñandú ♥', 'utf8'))).toBe('Ñandú ♥')
  })

  it('las rutas para sacar no se escapan de la carpeta ni usan lo que Windows no acepta', () => {
    expect(safeRel('../../Windows/x.mp3')).toBe('Windows/x.mp3')
    expect(safeRel('C:/x/y.mp3')).toBe('x/y.mp3')
    expect(safeRel('/abs\\a:b?.mp3')).toBe('abs/a_b_.mp3')
    expect(safeRel('Disco/con.mp3')).toBe('Disco/_con.mp3')
    expect(safeRel('Disco. /tema .mp3')).toBe('Disco/tema .mp3')
    expect(safeRel('../..')).toBeNull()
  })

  it('qué se escanea: .zip y la primera parte de un .rar (las demás van con ella)', () => {
    expect(['a.zip', 'b.RAR', 'c.part1.rar', 'd.part01.rar', 'e.part2.rar', 'f.part10.rar', 'g.r00', '._h.zip'].filter(isArchiveName)).toEqual(['a.zip', 'b.RAR', 'c.part1.rar', 'd.part01.rar'])
    expect(archiveFormat('x.part3.rar')).toBeNull()
    expect(nextVolume('x.part09.rar')).toBe('x.part10.rar')
    expect(nextVolume('x.rar')).toBe('x.r00')
    expect(nextVolume('x.r99')).toBe('x.s00')
  })
})
