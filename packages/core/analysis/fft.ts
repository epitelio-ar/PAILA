// FFT radix-2 con ventana Hann (cacheada por tamaño).

export interface Fft { n: number; win: Float64Array; run: (re: Float64Array, im: Float64Array) => void }

const cache = new Map<number, Fft>()

export function getFft(n: number): Fft {
  const hit = cache.get(n)
  if (hit) return hit
  const levels = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let x = i, y = 0
    for (let j = 0; j < levels; j++) { y = (y << 1) | (x & 1); x >>= 1 }
    rev[i] = y
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n) }
  const win = new Float64Array(n)
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  const run = (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const a = j + half
          const tre = re[a] * cos[k] + im[a] * sin[k]
          const tim = im[a] * cos[k] - re[a] * sin[k]
          re[a] = re[j] - tre; im[a] = im[j] - tim
          re[j] += tre; im[j] += tim
        }
      }
    }
  }
  const f = { n, win, run }
  cache.set(n, f)
  return f
}

/**
 * Acumula el espectro de potencia promedio de cuadros mono, salteando silencios. También el promedio en dB (`logPower`): lo
 * que suena la mayor parte del tiempo. En el de potencia, unas chispas sueltas arriba del corte (los restos que deja un MP3
 * de 128 pasado a 320) pesan tanto como el sonido de verdad; en dB casi no pesan (comparación con Fakin' The Funk, 23/10/2026).
 */
export class SpectrumAccumulator {
  readonly fft: Fft
  readonly power: Float64Array
  readonly logPower: Float64Array
  frames = 0
  private re: Float64Array
  private im: Float64Array

  constructor(n: number) {
    this.fft = getFft(n)
    this.power = new Float64Array(n / 2)
    this.logPower = new Float64Array(n / 2)
    this.re = new Float64Array(n)
    this.im = new Float64Array(n)
  }

  add(frame: Float32Array | Float64Array) {
    const n = this.fft.n
    let e = 0
    for (let i = 0; i < n; i++) e += frame[i] * frame[i]
    if (Math.sqrt(e / n) < 0.0015) return // silencio (~ -56 dBFS)
    for (let i = 0; i < n; i++) { this.re[i] = frame[i] * this.fft.win[i]; this.im[i] = 0 }
    this.fft.run(this.re, this.im)
    for (let k = 0; k < n / 2; k++) {
      const p = this.re[k] * this.re[k] + this.im[k] * this.im[k]
      this.power[k] += p
      this.logPower[k] += Math.max(-160, 10 * Math.log10(p + 1e-30))
    }
    this.frames++
  }
}

export interface CutoffResult {
  cutoff: number | null // Hz donde el audio "choca contra una pared". = el tope del formato si no hay pared
  drop: number // dB de caída en esa pared
  cdEdgeDrop: number | null // en archivos de más de 48 kHz: caída justo arriba de 22 kHz
  frames: number
  spectrum: number[] // 128 puntos en dB, para dibujar
  /** Lo más que cae el sonido en medio kHz alrededor del corte (dB). Un MP3 corta de golpe (15 dB o más); un vinilo o un master viejo, de a poco. */
  sharp?: number
  /** Cuánto cae en total, del sonido de antes del corte al piso de después (dB). */
  fall?: number
  /** Escalón en 16 kHz (dB de más respecto de la pendiente de alrededor): típico de un MP3, aunque arriba siga habiendo algo. */
  step16?: number
  /** El corte coincide con el tope del formato (archivos de 32 kHz o menos): no es sospechoso. */
  formatLimit?: boolean
  /**
   * Arriba del corte solo quedan restos sueltos (chispas): el corte es donde termina el sonido de verdad y `ceiling`, hasta
   * dónde llegan los restos. Así queda un MP3 de 128 pasado a 320 o a un formato sin pérdida.
   */
  scraps?: boolean
  ceiling?: number
}

/** Qué se sabe del archivo para leer bien el espectro. */
export interface CutoffOptions {
  /** Frecuencia del archivo original cuando es menor que la del análisis. */
  formatRate?: number | null
  /** Sin pérdida: no tiene por qué haber nada "de a ratos" arriba de 16 kHz (un MP3 sí guarda esos agudos de a ratos). */
  lossless?: boolean
}

/**
 * Busca la caída brusca de agudos que dejan los codecs con pérdida (o un CD estirado a hi-res).
 * `formatRate`: frecuencia del archivo original cuando es menor que la del análisis (un archivo de 32 kHz no puede tener
 * nada arriba de 16 kHz: ese corte es del formato y no se busca). Un número suelto vale como `formatRate`.
 *
 * Restos arriba del corte (comparación con Fakin' The Funk, 23/10/2026, docs/pruebas/2026-10-23-fakin-the-funk.md): en el
 * promedio de potencia unas chispas sueltas pesan tanto como el sonido, y la pared más grande quedaba arriba de ellas (un MP3
 * de 128 pasado a 320 "llegaba" a 20 kHz). En un archivo sin pérdida se busca además la pared en el promedio en dB (lo que
 * suena la mayor parte del tiempo); en uno con pérdida, solo un escalón fuerte con todo plano arriba (un MP3 genuino guarda
 * los agudos de arriba de 16 kHz de a ratos, y eso no es un corte).
 */
export function findCutoff(acc: SpectrumAccumulator, sampleRate: number, opts?: number | null | CutoffOptions): CutoffResult {
  const { formatRate, lossless } = typeof opts === 'object' && opts ? opts : { formatRate: opts, lossless: false }
  const H = acc.power.length
  const binHz = sampleRate / (H * 2), nyq = sampleRate / 2
  if (acc.frames < 4) return { cutoff: null, drop: 0, cdEdgeDrop: null, frames: acc.frames, spectrum: [] }
  const db = new Float64Array(H)
  for (let k = 0; k < H; k++) db[k] = Math.max(-160, 10 * Math.log10(acc.power[k] / acc.frames + 1e-30))
  const sums = (d: Float64Array) => { const ps = new Float64Array(H + 1); for (let k = 0; k < H; k++) ps[k + 1] = ps[k] + d[k]; return ps }
  const mean = (ps: Float64Array) => (a: number, b: number) => { a = Math.min(H - 1, Math.max(0, a)); b = Math.max(a, Math.min(H - 1, b)); return (ps[b + 1] - ps[a]) / (b - a + 1) }
  const avg = mean(sums(db))
  let shape = avg // donde se mide la forma del corte
  const hb = (hz: number) => Math.round(hz / binHz)

  // tope del formato: el remuestreo deja un "eco" suave arriba de él, así que se busca 1 kHz por debajo
  const formatTop = formatRate && formatRate / 2 < nyq - 1000 ? formatRate / 2 : null
  const top = formatTop ? formatTop - 1000 : nyq - 1000
  const near = Math.max(2, hb(150)), far = hb(900)
  const wall = (av: typeof avg) => {
    const ref = av(hb(1000), hb(4000))
    let w: { k: number; drop: number } | null = null
    for (let k = hb(10000); k <= Math.floor(top / binHz); k++) {
      const above = av(k + near, k + far)
      const drop = av(k - far, k - near) - above
      if (drop >= 18 && above < ref - 45 && (!w || drop > w.drop)) w = { k, drop }
    }
    return w
  }
  let best = wall(avg)
  let ceiling: number | null = null
  if (!formatTop && lossless) {
    // sin pérdida: la pared de lo que suena la mayor parte del tiempo, si queda bastante más abajo
    const ld = new Float64Array(H)
    for (let k = 0; k < H; k++) ld[k] = acc.logPower[k] / acc.frames
    const logAvg = mean(sums(ld))
    const typical = wall(logAvg)
    if (typical && typical.k < (best ? best.k : Math.floor(top / binHz)) - hb(1000)) {
      ceiling = best ? best.k : null
      best = typical
      shape = logAvg // la forma del corte se mide donde está la pared
    }
  } else if (!formatTop && best) {
    // con pérdida: un escalón de 25 dB o más y todo plano arriba hasta la pared (los restos de un MP3 más chico)
    let step: { k: number; drop: number } | null = null
    for (let k = hb(12000); k < best.k - hb(1500); k++) {
      const above = avg(k + near, k + far), drop = avg(k - far, k - near) - above
      if (drop < 25 || (step && drop <= step.drop)) continue
      let flat = true
      for (let j = k + near; j + hb(500) < best.k - near; j += hb(250)) if (avg(j, j + hb(500)) > above + 6) { flat = false; break }
      if (flat) step = { k, drop }
    }
    if (step) { ceiling = best.k; best = step }
  }
  const cdEdgeDrop = nyq > 26000 ? Math.round(avg(hb(19000), hb(21000)) - avg(hb(22500), hb(24000))) : null
  const spectrum: number[] = []
  const w = H / 128
  for (let i = 0; i < 128; i++) spectrum.push(Math.round(avg(Math.floor(i * w), Math.floor((i + 1) * w) - 1)))
  const out: CutoffResult = {
    cutoff: best ? Math.round(best.k * binHz) : Math.round(formatTop ?? nyq),
    drop: best ? Math.round(best.drop) : 0,
    cdEdgeDrop,
    frames: acc.frames,
    spectrum,
  }
  // sin pared, o con la pared pegada al tope (LAME corta ~1 kHz antes en un MP3 de 32 kHz): es el formato
  if (formatTop && (!best || best.k * binHz >= formatTop * 0.9)) { out.formatLimit = true; out.cutoff = Math.round(formatTop); out.drop = 0; best = null }
  if (best && ceiling != null) { out.scraps = true; out.ceiling = Math.round(ceiling * binHz) }
  if (best) {
    // forma del corte: lo más que cae en medio kHz (cerca del corte) y cuánto cae en total. Si el corte salió del promedio en
    // dB, se mide en los dos y vale el más de golpe: el promedio en dB suaviza las paredes (un MP3 parecía un vinilo).
    const c = best.k
    const form = (av: typeof avg) => {
      let sharp = 0
      for (let k = c - hb(1500); k <= c + hb(1500); k++) sharp = Math.max(sharp, av(k - hb(250), k - hb(50)) - av(k + hb(50), k + hb(250)))
      return { sharp: Math.round(sharp), fall: Math.round(av(c - hb(2000), c - hb(1000)) - av(c + hb(500), c + hb(1500))) }
    }
    const a = form(shape), b = shape === avg ? a : form(avg)
    Object.assign(out, b.sharp > a.sharp ? b : a)
  }
  if (!formatTop && nyq > 18000) {
    const s = avg(hb(15200), hb(15850)) - avg(hb(16150), hb(16800))
    const trend = (avg(hb(14400), hb(15050)) - avg(hb(15200), hb(15850)) + avg(hb(16150), hb(16800)) - avg(hb(16950), hb(17600))) / 2
    out.step16 = Math.round(s - Math.max(0, trend))
  }
  return out
}
