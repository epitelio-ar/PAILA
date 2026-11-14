// MP3 que la librería de tags no abre ("MPEG audio header not found") porque entre el tag ID3 y el audio queda algo que el tag no
// cuenta como suyo y que no es audio (los ceros sueltos los arregla absorbZeroPadding, en tagio.ts). Del punto 1 real del 24/10:
// - el tag dice terminar antes que su último cuadro: en "Escapate Conmigo" (Wisin y Ozuna) la tapa sigue 2.873 bytes después;
// - restos de un cuadro de audio roto antes del primero bueno: en "La bomba loca" (Gustavo Cordera), 1.035 bytes con el encabezado
//   LAME a medias.
// El arreglo es el mismo: el tamaño declarado del tag se agranda hasta el primer cuadro de audio de verdad (dos cuadros MPEG seguidos)
// y lo del medio pasa a ser relleno del tag. ffmpeg ya lo salteaba: el sonido no cambia (el motor lo verifica con la huella).
// Tests: tests/mp3-raros.test.ts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { absorbZeroPadding } from './tagio'
import { textos } from '@paila/shared/idioma'

const T = textos({ libreria: { es: 'La librería de tags no puede abrir este archivo, ni arreglando lo que hay antes del audio', en: "The tag library can't open this file, even after fixing what comes before the audio" } })

/** Cuánto se acepta saltar como mucho: más es otra cosa (un archivo pegado a otro), no un tag mal cerrado. */
const MAX_JUNK = 64 * 1024
const RATES = [[11025, 12000, 8000], [0, 0, 0], [22050, 24000, 16000], [44100, 48000, 32000]] // por versión (2.5, -, 2, 1)
const KBPS1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const KBPS2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]

/** El largo de un cuadro MPEG capa III que empieza en `i`, o null si ahí no hay uno. */
function frameLen(b: Buffer, i: number): number | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, br = b[i + 2] >> 4, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1
  if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return null
  const rate = RATES[ver][sr], kbps = (ver === 3 ? KBPS1 : KBPS2)[br]
  return Math.floor(((ver === 3 ? 144000 : 72000) * kbps) / rate) + pad
}

/** Dónde empieza el audio de verdad desde `from`: dos cuadros MPEG seguidos. */
function firstFrame(b: Buffer, from: number): number | null {
  for (let i = from; i + 4 <= b.length; i++) {
    const n = frameLen(b, i)
    if (n && frameLen(b, i + n)) return i
  }
  return null
}

/** El largo de un tamaño "syncsafe" (7 bits por byte) o normal, según la versión del ID3. */
const size4 = (b: Buffer, i: number, safe: boolean) => (safe ? (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3] : b.readUInt32BE(i))

/**
 * Agranda el tag ID3v2 del principio hasta el primer cuadro de audio de verdad, si entre los dos hay un cuadro del tag que se pasa
 * del final declarado o restos que no son audio. Solo toca los 4 bytes del tamaño. Devuelve true si cambió algo.
 */
export function absorbJunkBeforeAudio(file: string): boolean {
  const fd = fs.openSync(file, 'r+')
  try {
    const head = Buffer.alloc(10)
    if (fs.readSync(fd, head, 0, 10, 0) < 10 || head.toString('latin1', 0, 3) !== 'ID3' || head[3] < 3 || head[3] > 4) return false
    if (head[5] & 0x80 || head[5] & 0x10) return false // con "unsynchronisation" o pie: no se toca
    const declared = 10 + size4(head, 6, true)
    // los cuadros del tag, por si el último se pasa del final declarado (se leen hasta ahí, más lo que se acepta saltar)
    const b = Buffer.alloc(Math.min(fs.fstatSync(fd).size, declared + MAX_JUNK * 2 + 8192))
    fs.readSync(fd, b, 0, b.length, 0)
    let at = 10, end = 10
    while (at + 10 <= b.length && at < declared && /^[A-Z0-9]{4}$/.test(b.toString('latin1', at, at + 4))) {
      const n = size4(b, at + 4, head[3] === 4)
      if (n <= 0 || at + 10 + n > declared + MAX_JUNK) break
      at += 10 + n; end = at
    }
    const from = Math.max(declared, end)
    if (frameLen(b, declared) && frameLen(b, declared + frameLen(b, declared)!)) return false // el audio empieza donde dice: nada que hacer
    const audio = firstFrame(b, from)
    if (audio == null || audio <= declared || audio - from > MAX_JUNK) return false
    const n = audio - 10
    fs.writeSync(fd, Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]), 0, 4, 6)
    return true
  } finally { fs.closeSync(fd) }
}

/**
 * Lee algo de un MP3 que la librería no abre, sobre una copia arreglada (los ceros sueltos o lo de arriba): para saber de entrada
 * si se le va a poder escribir (al aplicar, el motor hace el mismo arreglo y verifica el sonido). Si ni así se puede, el error.
 */
export function readRepaired<T>(file: string, read: (f: string) => T): T {
  const tmp = path.join(os.tmpdir(), `paila-mp3-${process.pid}-${Date.now()}.mp3`)
  fs.copyFileSync(file, tmp)
  try {
    if (!absorbZeroPadding(tmp) && !absorbJunkBeforeAudio(tmp)) throw new Error(T.libreria)
    return read(tmp)
  } finally { fs.rmSync(tmp, { force: true }) }
}
