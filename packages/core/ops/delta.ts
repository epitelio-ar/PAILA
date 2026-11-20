// "Lo que cambia" entre dos versiones de un archivo (respaldo liviano del motor único; decisión del 24/10): cuando PAILA
// escribe tags, tapas o volumen, el audio queda igual byte a byte (a veces corrido de lugar) y solo cambian los pedazos de
// metadatos. Acá se comparan el archivo de antes y el de después, y se guarda lo justo para rearmar el de antes desde el de
// después: los pedazos que solo tenía el de antes, tal cual, y para el resto, de qué parte del nuevo copiarlo. Sirve para
// cualquier formato (no lee tags: compara bytes) y se verifica siempre rearmándolo y comparando la huella con el original.
// Si casi todo cambió (un M4A reacomodado, por ejemplo), se guarda el archivo de antes entero: es lo mínimo que lo garantiza.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { textos } from '@paila/shared/idioma'

const T = textos({
  noRearma: { es: 'El respaldo liviano no rearma el original: no se tocó nada', en: "The light backup doesn't rebuild the original: nothing was touched" },
  noEs: { es: 'Ese archivo no es un respaldo de PAILA', en: "That file isn't a PAILA backup" },
})

/** De qué está hecho el archivo de antes, en orden: un pedazo del archivo nuevo ([0, desde, largo]) o bytes guardados ([1, largo]). */
export type DeltaOp = [0, number, number] | [1, number]

export interface DeltaHeader {
  v: 1
  /** El tema (para leerlo a mano: el número y la ruta de cuando se respaldó). */
  fileId: number | null
  rel: string
  old: { size: number; sha1: string }
  new: { size: number; sha1: string }
  ops: DeltaOp[]
  /** true = se guardó el archivo de antes entero (cambiaba casi todo). */
  entero: boolean
  at: string
}

const MAGIC = Buffer.from('PAILA-ANTES 1\n', 'latin1')
const CH = 1 << 20
const W = 4096
/** Un pedazo distinto más chico que esto se guarda tal cual (no vale la pena buscarle partes repetidas). */
const MIN_SEARCH = 64 * 1024

/**
 * La huella de los bytes de un archivo, sin cargarlo entero en memoria. Termina cuando el archivo ya se cerró, no cuando se
 * terminó de leer: en Windows, reemplazar un archivo que PAILA todavía tiene abierto falla, y deshacer el cover.jpg de una
 * carpeta (que se copia y se compara justo antes) a veces no lo devolvía (tests/tapas-volumen.test.ts en el runner de Windows).
 */
export function fileSha1(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1')
    let huella: string | null = null
    fs.createReadStream(p).on('data', (c) => h.update(c)).on('error', reject).on('end', () => { huella = h.digest('hex') })
      .on('close', () => (huella ? resolve(huella) : reject(new Error(`No se pudo leer ${p}`))))
  })
}

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.allocUnsafe(len)
  let n = 0
  while (n < len) { const r = fs.readSync(fd, b, n, len - n, pos + n); if (!r) break; n += r }
  return n === len ? b : b.subarray(0, n)
}

/** Cuántos bytes iguales hay desde el principio de los dos pedazos (o desde el final, con `back`). */
function same(x: Buffer, y: Buffer, back: boolean): number {
  const len = Math.min(x.length, y.length)
  if (!back && x.subarray(0, len).equals(y.subarray(0, len))) return len
  if (back && x.subarray(x.length - len).equals(y.subarray(y.length - len))) return len
  let k = 0
  for (; k + W <= len; k += W) {
    const a = back ? x.subarray(x.length - k - W, x.length - k) : x.subarray(k, k + W)
    const b = back ? y.subarray(y.length - k - W, y.length - k) : y.subarray(k, k + W)
    if (!a.equals(b)) break
  }
  while (k < len && (back ? x[x.length - 1 - k] === y[y.length - 1 - k] : x[k] === y[k])) k++
  return k
}

/** Bytes iguales hacia adelante desde `ao`/`bo` (hasta `max`). */
function prefix(a: number, ao: number, b: number, bo: number, max: number): number {
  let n = 0
  while (n < max) {
    const len = Math.min(CH, max - n)
    const k = same(readAt(a, ao + n, len), readAt(b, bo + n, len), false)
    n += k
    if (k < len) break
  }
  return n
}

/** Bytes iguales hacia atrás, terminando en `ae`/`be` (hasta `max`). */
function suffix(a: number, ae: number, b: number, be: number, max: number): number {
  let n = 0
  while (n < max) {
    const len = Math.min(CH, max - n)
    const k = same(readAt(a, ae - n - len, len), readAt(b, be - n - len, len), true)
    n += k
    if (k < len) break
  }
  return n
}

/** Un pedazo casi sin variedad (silencio, relleno de ceros) aparece en muchos lados: no sirve para ubicar el audio. */
function plain(win: Buffer): boolean {
  const seen = new Uint8Array(256)
  let k = 0
  for (const x of win) if (!seen[x]) { seen[x] = 1; if (++k >= 24) return false }
  return true
}

interface Diff { a: number; b: number; oldSize: number; newSize: number; ops: DeltaOp[]; lits: [number, number][]; scanned: number }

/** Dónde aparece en el nuevo un pedazo del medio del viejo: primero donde suele estar (mismo lugar, corrido por los tags) y si no, buscándolo. */
function anchor(d: Diff, a0: number, a1: number, b0: number, b1: number): { q: number; c: number } | null {
  let searched = false
  for (const frac of [0.5, 0.25, 0.75, 0.125, 0.875, 0.375, 0.625, 0.0625, 0.9375]) {
    const q = a0 + Math.floor((a1 - a0 - W) * frac)
    const win = readAt(d.a, q, W)
    if (win.length < W || plain(win)) continue
    const cands = [b0 + (q - a0), b1 - (a1 - q), q, q + (d.newSize - d.oldSize)].filter((c, i, all) => c >= b0 && c + W <= b1 && all.indexOf(c) === i)
    for (const c of cands) if (readAt(d.b, c, W).equals(win)) return { q, c }
    // buscarlo en todo el pedazo del nuevo, una sola vez por pedazo y sin pasar de leer el nuevo dos veces en total
    if (searched || d.scanned > 2 * d.newSize) continue
    searched = true
    for (let pos = b0; pos < b1; pos += 4 * CH - W) {
      const chunk = readAt(d.b, pos, Math.min(4 * CH, b1 - pos))
      d.scanned += chunk.length
      const hit = chunk.indexOf(win)
      if (hit >= 0) return { q, c: pos + hit }
      if (pos + chunk.length >= b1) break
    }
  }
  return null
}

function lit(d: Diff, at: number, len: number) {
  if (!len) return
  const last = d.ops[d.ops.length - 1], l = d.lits[d.lits.length - 1]
  if (last?.[0] === 1 && l[0] + l[1] === at) { last[1] += len; l[1] += len } else { d.ops.push([1, len]); d.lits.push([at, len]) }
}
function copy(d: Diff, from: number, len: number) {
  if (!len) return
  const last = d.ops[d.ops.length - 1]
  if (last?.[0] === 0 && last[1] + last[2] === from) last[2] += len; else d.ops.push([0, from, len])
}

/** El viejo [a0, a1) armado desde el nuevo [b0, b1): lo igual del principio y del final, y el medio buscando partes repetidas. */
function walk(d: Diff, a0: number, a1: number, b0: number, b1: number, depth: number) {
  const p = prefix(d.a, a0, d.b, b0, Math.min(a1 - a0, b1 - b0))
  const s = suffix(d.a, a1, d.b, b1, Math.min(a1 - a0, b1 - b0) - p)
  copy(d, b0, p)
  const [m0, m1, n0, n1] = [a0 + p, a1 - s, b0 + p, b1 - s]
  const m = m1 - m0 >= MIN_SEARCH && n1 - n0 >= W && depth < 12 && d.ops.length < 5000 ? anchor(d, m0, m1, n0, n1) : null
  if (!m) lit(d, m0, m1 - m0)
  else {
    const back = suffix(d.a, m.q, d.b, m.c, Math.min(m.q - m0, m.c - n0))
    const fwd = prefix(d.a, m.q, d.b, m.c, Math.min(m1 - m.q, n1 - m.c))
    walk(d, m0, m.q - back, n0, m.c - back, depth + 1)
    copy(d, m.c - back, back + fwd)
    walk(d, m.q + fwd, m1, m.c + fwd, n1, depth + 1)
  }
  copy(d, b1 - s, s)
}

/**
 * Compara el archivo de antes (`oldPath`) con el de después (`newPath`) y agrega al final de `out` (el archivo de la tanda,
 * cambios.paila: uno solo por tanda y disco, porque en un disco exFAT cada archivo chico ocupa al menos 512 KB) lo justo para
 * rearmar el de antes, con sincronización al disco. Después lo rearma desde lo escrito y compara la huella con la del original:
 * si no da igual, tira un error. Devuelve lo anotado, cuánto ocupa y dónde empieza (`pos`).
 */
export async function saveDelta(oldPath: string, newPath: string, out: string, info: { fileId: number | null; rel: string }): Promise<{ header: DeltaHeader; bytes: number; pos: number }> {
  const [oldSha1, newSha1] = await Promise.all([fileSha1(oldPath), fileSha1(newPath)])
  const a = fs.openSync(oldPath, 'r'), b = fs.openSync(newPath, 'r')
  let header: DeltaHeader
  let pos: number, end: number
  try {
    const oldSize = fs.fstatSync(a).size, newSize = fs.fstatSync(b).size
    const d: Diff = { a, b, oldSize, newSize, ops: [], lits: [], scanned: 0 }
    walk(d, 0, oldSize, 0, newSize, 0)
    const stored = d.lits.reduce((s, l) => s + l[1], 0)
    const entero = oldSize > 0 && stored > oldSize / 2
    if (entero) { d.ops = [[1, oldSize]]; d.lits = [[0, oldSize]] }
    header = { v: 1, fileId: info.fileId, rel: info.rel, old: { size: oldSize, sha1: oldSha1 }, new: { size: newSize, sha1: newSha1 }, ops: d.ops, entero, at: new Date().toISOString() }
    const json = Buffer.from(JSON.stringify(header), 'utf8')
    const len = Buffer.alloc(4); len.writeUInt32LE(json.length)
    // al final del archivo de la tanda, de una vez (sin esperas en el medio: dos temas a la vez no se mezclan)
    const fd = fs.openSync(out, 'a')
    try {
      pos = fs.fstatSync(fd).size
      fs.writeSync(fd, MAGIC); fs.writeSync(fd, len); fs.writeSync(fd, json)
      for (const [at, n] of d.lits) for (let k = 0; k < n; k += CH) fs.writeSync(fd, readAt(a, at + k, Math.min(CH, n - k)))
      fs.fsyncSync(fd)
      end = fs.fstatSync(fd).size
    } finally { fs.closeSync(fd) }
  } finally { fs.closeSync(a); fs.closeSync(b) }
  // si no rearma el original, ese pedazo queda sin usar (no se anota en ningún lado) y el archivo no se toca
  if (await rebuild(out, newPath, null, pos) !== oldSha1) throw new Error(T.noRearma)
  return { header, bytes: end - pos, pos }
}

/** Lee lo anotado de un respaldo liviano que empieza en `pos` del archivo (sin los bytes guardados). */
export function readDelta(file: string, pos = 0): { header: DeltaHeader; dataAt: number } {
  const fd = fs.openSync(file, 'r')
  try {
    const head = readAt(fd, pos, MAGIC.length + 4)
    if (head.length < MAGIC.length + 4 || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(T.noEs)
    const len = head.readUInt32LE(MAGIC.length)
    return { header: JSON.parse(readAt(fd, pos + MAGIC.length + 4, len).toString('utf8')) as DeltaHeader, dataAt: pos + MAGIC.length + 4 + len }
  } finally { fs.closeSync(fd) }
}

/**
 * Rearma el archivo de antes desde el de después (`from`) y el respaldo que empieza en `pos` de `delta`. Con `out`, lo escribe
 * ahí (con sincronización al disco); sin `out`, solo calcula la huella. Devuelve la huella de lo rearmado: quien llama la
 * compara con la del original antes de usarlo.
 */
export async function rebuild(delta: string, from: string, out: string | null, pos = 0): Promise<string> {
  const { header, dataAt } = readDelta(delta, pos)
  const h = crypto.createHash('sha1')
  const src = fs.openSync(from, 'r'), dd = fs.openSync(delta, 'r')
  const o = out ? fs.openSync(out, 'w') : null
  try {
    if (fs.fstatSync(src).size !== header.new.size && !header.entero) return ''
    let lit = dataAt
    for (const op of header.ops) {
      const [fd, start, len] = op[0] === 0 ? [src, op[1], op[2]] : [dd, lit, op[1]]
      for (let k = 0; k < len; k += CH) {
        const chunk = readAt(fd, start + k, Math.min(CH, len - k))
        if (chunk.length < Math.min(CH, len - k)) return ''
        h.update(chunk)
        if (o != null) fs.writeSync(o, chunk)
      }
      if (op[0] === 1) lit += op[1]
    }
    if (o != null) fs.fsyncSync(o)
  } finally {
    fs.closeSync(src); fs.closeSync(dd)
    if (o != null) fs.closeSync(o)
  }
  return h.digest('hex')
}
