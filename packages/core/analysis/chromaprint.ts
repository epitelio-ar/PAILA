// Huella acústica Chromaprint (la de AcoustID), calculada en TypeScript a partir del mismo audio que ya decodifica el
// análisis: no hace falta el programa fpcalc ni otra lectura del archivo.
//
// Es un port del algoritmo "TEST2" (el que usan fpcalc y AcoustID por defecto) de Chromaprint 1.6
// (https://github.com/acoustid/chromaprint, © Lukas Lalinsky, licencia MIT). Entra audio mono de 16 bits a 11.025 Hz
// (ffmpeg lo prepara igual que fpcalc: ver chromaFilter) y sale una lista de números de 32 bits, uno cada ~0,124 s.
// Dos temas que suenan igual tienen huellas casi iguales aunque cambie el formato, la calidad o el volumen.

export const CHROMA_SAMPLE_RATE = 11025

/**
 * Filtro de ffmpeg que deja el audio como lo prepara fpcalc: mono, 16 bits, 11.025 Hz, con el mismo remuestreador y las
 * mismas opciones. El estéreo se mezcla mitad y mitad, como fpcalc; así la huella sale idéntica (comprobado con el fpcalc
 * oficial sobre temas reales). Pedirle "mono" al remuestreador no da lo mismo. Con más de 2 canales (o sin dato) se usa la
 * mezcla estándar de ffmpeg: casi idéntica.
 */
export function chromaFilter(channels: number | null): string {
  const resample = `aresample=osr=${CHROMA_SAMPLE_RATE}:osf=s16:filter_size=16:phase_shift=8:linear_interp=1:cutoff=0.8`
  if (channels === 1) return resample
  if (channels === 2) return `pan=mono|c0=0.5*c0+0.5*c1,${resample}`
  return `aformat=channel_layouts=mono,${resample}`
}
/** Igual que fpcalc: solo los primeros 120 s (es lo que espera AcoustID y alcanza para comparar). */
export const CHROMA_MAX_SECONDS = 120
/** Número de algoritmo que viaja en la huella comprimida (TEST2 = 1). */
const ALGORITHM = 1

const FRAME = 4096
const STEP = FRAME / 3 | 0 // 1365: Chromaprint superpone 2/3 de cada cuadro
const MIN_FREQ = 28, MAX_FREQ = 3520
const CHROMA_FILTER = [0.25, 0.75, 1.0, 0.75, 0.25]

// [tipo de filtro, y, alto, ancho] y los tres umbrales: 16 clasificadores, 2 bits cada uno = 32 bits por cuadro.
const CLASSIFIERS: [number, number, number, number, number, number, number][] = [
  [0, 4, 3, 15, 1.98215, 2.35817, 2.63523],
  [4, 4, 6, 15, -1.03809, -0.651211, -0.282167],
  [1, 0, 4, 16, -0.298702, 0.119262, 0.558497],
  [3, 8, 2, 12, -0.105439, 0.0153946, 0.135898],
  [3, 4, 4, 8, -0.142891, 0.0258736, 0.200632],
  [4, 0, 3, 5, -0.826319, -0.590612, -0.368214],
  [1, 2, 2, 9, -0.557409, -0.233035, 0.0534525],
  [2, 7, 3, 4, -0.0646826, 0.00620476, 0.0784847],
  [2, 6, 2, 16, -0.192387, -0.029699, 0.215855],
  [2, 1, 3, 2, -0.0397818, -0.00568076, 0.0292026],
  [5, 10, 1, 15, -0.53823, -0.369934, -0.190235],
  [3, 6, 2, 10, -0.124877, 0.0296483, 0.139239],
  [2, 1, 1, 14, -0.101475, 0.0225617, 0.231971],
  [3, 5, 6, 4, -0.0799915, -0.00729616, 0.063262],
  [1, 9, 2, 12, -0.272556, 0.019424, 0.302559],
  [3, 4, 2, 14, -0.164292, -0.0321188, 0.0846339],
]
const MAX_WIDTH = Math.max(...CLASSIFIERS.map((c) => c[3]))
const GRAY = [0, 1, 3, 2]

// Tablas que no dependen del audio.
const WINDOW = new Float64Array(FRAME)
for (let i = 0; i < FRAME; i++) WINDOW[i] = (0.54 - 0.46 * Math.cos((i * 2 * Math.PI) / (FRAME - 1))) / 32767
const MIN_INDEX = Math.max(1, Math.round((FRAME * MIN_FREQ) / CHROMA_SAMPLE_RATE))
const MAX_INDEX = Math.min(FRAME / 2, Math.round((FRAME * MAX_FREQ) / CHROMA_SAMPLE_RATE))
const NOTE = new Uint8Array(FRAME)
for (let i = MIN_INDEX; i < MAX_INDEX; i++) {
  const octave = Math.log((i * CHROMA_SAMPLE_RATE) / FRAME / (440 / 16)) / Math.log(2)
  NOTE[i] = Math.trunc(12 * (octave - Math.floor(octave)))
}
// FFT real de 4096 puntos hecha como una compleja de 2048 (pares en la parte real, impares en la imaginaria): la mitad de trabajo.
const HALF = FRAME / 2
const LEVELS = Math.log2(HALF)
const REV = new Uint16Array(HALF)
for (let i = 0; i < HALF; i++) { let x = i, y = 0; for (let j = 0; j < LEVELS; j++) { y = (y << 1) | (x & 1); x >>= 1 } REV[i] = y }
const COS = new Float64Array(FRAME / 2), SIN = new Float64Array(FRAME / 2)
for (let i = 0; i < FRAME / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / FRAME); SIN[i] = Math.sin((2 * Math.PI * i) / FRAME) }

/** Calcula la huella de a pedazos, a medida que llega el audio (mono, 16 bits, 11.025 Hz). */
export class Chromaprinter {
  private buf = new Int16Array(FRAME)
  private filled = 0
  private fed = 0
  private readonly limit: number
  private re = new Float64Array(HALF)
  private im = new Float64Array(HALF)
  private chromaRing: Float64Array[] = Array.from({ length: 8 }, () => new Float64Array(12))
  private ringPos = 0
  private ringSize = 1
  private integral: Float64Array[] = [] // imagen integral: fila = tiempo, columna = nota
  private out: number[] = []

  constructor(maxSeconds = CHROMA_MAX_SECONDS) { this.limit = Math.round(maxSeconds * CHROMA_SAMPLE_RATE) }

  /** Ya entró todo el audio que hace falta (el resto se puede descartar). */
  get full() { return this.fed >= this.limit }

  feed(samples: Int16Array) {
    let n = Math.min(samples.length, this.limit - this.fed)
    let o = 0
    this.fed += n
    while (n > 0) {
      const take = Math.min(n, FRAME - this.filled)
      this.buf.set(samples.subarray(o, o + take), this.filled)
      this.filled += take; o += take; n -= take
      if (this.filled === FRAME) {
        this.frame()
        this.buf.copyWithin(0, STEP)
        this.filled = FRAME - STEP
      }
    }
  }

  /** La huella completa (cuadros de 32 bits sin signo). */
  finish(): Uint32Array { return Uint32Array.from(this.out) }

  private frame() {
    const re = this.re, im = this.im, buf = this.buf
    for (let n = 0; n < HALF; n++) { const j = REV[n]; re[j] = buf[2 * n] * WINDOW[2 * n]; im[j] = buf[2 * n + 1] * WINDOW[2 * n + 1] }
    for (let size = 2; size <= HALF; size <<= 1) {
      const half = size >> 1, step = (HALF / size) * 2 // índice en las tablas de 4096
      for (let i = 0; i < HALF; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const a = j + half
          const tre = re[a] * COS[k] + im[a] * SIN[k]
          const tim = im[a] * COS[k] - re[a] * SIN[k]
          re[a] = re[j] - tre; im[a] = im[j] - tim
          re[j] += tre; im[j] += tim
        }
      }
    }
    // Energía por nota (12 semitonos, sin importar la octava).
    const chroma = this.chromaRing[this.ringPos]
    chroma.fill(0)
    for (let k = MIN_INDEX; k < MAX_INDEX; k++) {
      // separar la FFT de los pares (E) y la de los impares (O), y juntarlas: X[k] = E[k] + e^(-2πik/N)·O[k]
      const k2 = (HALF - k) & (HALF - 1)
      const er = (re[k] + re[k2]) / 2, ei = (im[k] - im[k2]) / 2
      const or = (im[k] + im[k2]) / 2, oi = (re[k2] - re[k]) / 2
      const xr = er + or * COS[k] + oi * SIN[k], xi = ei + oi * COS[k] - or * SIN[k]
      chroma[NOTE[k]] += xr * xr + xi * xi
    }
    this.ringPos = (this.ringPos + 1) % 8
    if (this.ringSize < CHROMA_FILTER.length) { this.ringSize++; return }
    // Suavizado en el tiempo (5 cuadros) y normalización.
    const row = new Float64Array(12)
    const start = (this.ringPos + 8 - CHROMA_FILTER.length) % 8
    for (let b = 0; b < 12; b++) {
      let s = 0
      for (let j = 0; j < CHROMA_FILTER.length; j++) s += this.chromaRing[(start + j) % 8][b] * CHROMA_FILTER[j]
      row[b] = s
    }
    let norm = 0
    for (let b = 0; b < 12; b++) norm += row[b] * row[b]
    norm = norm > 0 ? Math.sqrt(norm) : 0
    for (let b = 0; b < 12; b++) row[b] = norm < 0.01 ? 0 : row[b] / norm
    this.addRow(row)
  }

  private addRow(row: Float64Array) {
    const prev = this.integral[this.integral.length - 1]
    const cur = new Float64Array(12)
    let acc = 0
    for (let b = 0; b < 12; b++) { acc += row[b]; cur[b] = acc + (prev ? prev[b] : 0) }
    this.integral.push(cur)
    const rows = this.integral.length
    if (rows >= MAX_WIDTH) this.out.push(this.subprint(rows - MAX_WIDTH))
  }

  /** Suma de la imagen entre las filas [r1, r2) y las columnas [c1, c2). */
  private area(r1: number, c1: number, r2: number, c2: number) {
    if (r1 === r2 || c1 === c2) return 0
    const I = this.integral
    const at = (r: number, c: number) => (r === 0 || c === 0 ? 0 : I[r - 1][c - 1])
    return at(r2, c2) - at(r1, c2) - at(r2, c1) + at(r1, c1)
  }

  private subprint(x: number): number {
    let bits = 0
    for (const [type, y, h, w, t0, t1, t2] of CLASSIFIERS) {
      const v = this.filter(type, x, y, w, h)
      const q = v < t1 ? (v < t0 ? 0 : 1) : (v < t2 ? 2 : 3)
      bits = ((bits << 2) | GRAY[q]) >>> 0
    }
    return bits
  }

  private filter(type: number, x: number, y: number, w: number, h: number) {
    const A = (r1: number, c1: number, r2: number, c2: number) => this.area(r1, c1, r2, c2)
    let a = 0, b = 0
    switch (type) {
      case 0: a = A(x, y, x + w, y + h); break
      case 1: { const h2 = h >> 1; a = A(x, y + h2, x + w, y + h); b = A(x, y, x + w, y + h2); break }
      case 2: { const w2 = w >> 1; a = A(x + w2, y, x + w, y + h); b = A(x, y, x + w2, y + h); break }
      case 3: {
        const w2 = w >> 1, h2 = h >> 1
        a = A(x, y + h2, x + w2, y + h) + A(x + w2, y, x + w, y + h2)
        b = A(x, y, x + w2, y + h2) + A(x + w2, y + h2, x + w, y + h)
        break
      }
      case 4: { const h3 = (h / 3) | 0; a = A(x, y + h3, x + w, y + 2 * h3); b = A(x, y, x + w, y + h3) + A(x, y + 2 * h3, x + w, y + h); break }
      case 5: { const w3 = (w / 3) | 0; a = A(x + w3, y, x + 2 * w3, y + h); b = A(x, y, x + w3, y + h) + A(x + 2 * w3, y, x + w, y + h); break }
    }
    return Math.log((1 + a) / (1 + b))
  }
}

/** Huella de un audio completo (para tests y usos sueltos). */
export function chromaprint(samples: Int16Array, maxSeconds = CHROMA_MAX_SECONDS): Uint32Array {
  const c = new Chromaprinter(maxSeconds)
  c.feed(samples)
  return c.finish()
}

// ---------- formato comprimido de AcoustID (texto base64, ~2–3 KB por tema) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function packBits(values: number[], bits: number, out: number[]) {
  let acc = 0, n = 0
  for (const v of values) {
    acc |= (v & ((1 << bits) - 1)) << n
    n += bits
    while (n >= 8) { out.push(acc & 255); acc >>>= 8; n -= 8 }
  }
  if (n > 0) out.push(acc & 255)
}


/** Comprime la huella como lo hace Chromaprint (`chromaprint_get_fingerprint`): es lo que se manda a AcoustID. */
export function encodeFingerprint(fp: ArrayLike<number>): string {
  const normal: number[] = [], exceptional: number[] = []
  for (let i = 0; i < fp.length; i++) {
    let x = (i ? (fp[i] ^ fp[i - 1]) : fp[i]) >>> 0
    let bit = 1, last = 0
    while (x !== 0) {
      if (x & 1) {
        const v = bit - last
        if (v >= 7) { normal.push(7); exceptional.push(v - 7) } else normal.push(v)
        last = bit
      }
      x >>>= 1
      bit++
    }
    normal.push(0)
  }
  const bytes = [ALGORITHM, (fp.length >> 16) & 255, (fp.length >> 8) & 255, fp.length & 255]
  packBits(normal, 3, bytes)
  packBits(exceptional, 5, bytes)
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0
    s += B64[b0 >> 2] + B64[((b0 << 4) | (b1 >> 4)) & 63]
    if (i + 1 < bytes.length) s += B64[((b1 << 2) | (b2 >> 6)) & 63]
    if (i + 2 < bytes.length) s += B64[b2 & 63]
  }
  return s
}

/** Lo inverso de `encodeFingerprint` (para comparar huellas guardadas en la PC, sin internet). Rápido: Duplicados decodifica
 * la huella de toda la biblioteca (100.000 temas) de una vez. */
export function decodeFingerprint(s: string): Uint32Array {
  // el texto es base64 "url" sin relleno (el alfabeto de AcoustID): Node lo decodifica solo, mucho más rápido
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('Huella inválida')
  const raw = Buffer.from(s, 'base64url'), nb = raw.length
  if (nb < 4) throw new Error('Huella inválida')
  const b = new Uint8Array(nb + 3) // +3: leer de a tres bytes nunca se pasa del final
  b.set(raw)
  const size = (b[1] << 16) | (b[2] << 8) | b[3]
  // Valor "normal" número k (3 bits cada uno, desde el byte 4). Terminan cuando se juntaron `size` ceros (un cero cierra
  // cada cuadro); después vienen los "excepcionales" (5 bits).
  // (se guardan en la primera pasada para no volver a sacarlos de los bits en la segunda)
  const last = Math.floor(((nb - 4) * 8) / 3)
  const normal = new Uint8Array(last + 8)
  let zeros = 0, count = 0
  // de a tres bytes: ocho valores de 3 bits
  for (let i = 4; zeros < size; i += 3) {
    let w = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
    for (let j = 0; j < 8; j++) {
      if (count >= last) throw new Error('Huella cortada')
      const v = w & 7
      w >>>= 3
      normal[count++] = v
      if (v === 0 && ++zeros === size) break
    }
  }
  const start = 4 + Math.ceil((count * 3) / 8)
  const out = new Uint32Array(size)
  let e = 0, prev = 0, x = 0, bit = 0, f = 0
  for (let k = 0; k < count; k++) {
    let v = normal[k]
    if (v === 0) { prev = f ? (prev ^ x) : x; out[f++] = prev; x = 0; bit = 0; continue }
    if (v === 7) {
      // el excepcional número e (5 bits, después de los normales)
      const eb = e * 5, ei = start + (eb >> 3)
      if (ei >= nb) throw new Error('Huella cortada')
      v += ((b[ei] | (b[ei + 1] << 8)) >> (eb & 7)) & 31
      e++
    }
    bit += v
    x |= 1 << (bit - 1)
  }
  return out
}

/**
 * Qué tan parecidas son dos huellas, de 0 a 1 (1 = mismo audio). Prueba corrimientos de hasta `maxShift` cuadros
 * (~0,124 s cada uno) por si uno de los archivos empieza un poco antes o después. Por encima de ~0,85 es el mismo audio.
 */
export function fingerprintSimilarity(a: ArrayLike<number>, b: ArrayLike<number>, maxShift = 80): number {
  let best = 0
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let same = 0, total = 0
    for (let i = Math.max(0, -shift); i < a.length && i + shift < b.length; i++) {
      let x = (a[i] ^ b[i + shift]) >>> 0
      x -= (x >>> 1) & 0x55555555
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
      const diff = (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
      same += 32 - diff
      total += 32
    }
    // Se exige que se superpongan al menos 10 s para no dar por iguales dos pedacitos sueltos.
    if (total >= 32 * 80) best = Math.max(best, same / total)
  }
  return best
}
