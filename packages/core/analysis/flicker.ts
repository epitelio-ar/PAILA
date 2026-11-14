// "Huecos" en el espectrograma: en un MP3 de calidad baja o media los agudos aparecen y desaparecen de un instante al
// otro (el codificador apaga bandas enteras para ahorrar). Se mide con cuadros cortos (12 ms, el tamaño de un bloque de MP3).

import { getFft } from './fft'

const N = 512
const GROUP = 8 // cuadros seguidos que se miran…
const EVERY = 32 // …cada tantos (una cuarta parte del tema alcanza)
const BAND_HZ = 500
const LOW_HZ = 14000

/**
 * Junta, cuadro a cuadro, la energía de los agudos (bandas de 500 Hz desde 14 kHz) y la de los medios (2–8 kHz).
 * Al final, `jitter(corte)` compara cuánto saltan los agudos de un cuadro al siguiente con cuánto saltan los medios:
 * en un tema genuino saltan parecido (1–2); en un MP3 de 128–192 kbps los agudos saltan mucho más (4–5).
 */
export class FlickerMeter {
  private fft = getFft(N)
  private buf = new Float64Array(N)
  private re = new Float64Array(N)
  private im = new Float64Array(N)
  private pos = 0
  private frame = 0
  private bands: number
  private highs: number[][] = [] // por cuadro: energía de cada banda alta (lineal)
  private mids: number[] = [] // por cuadro: energía de los medios (lineal); NaN = cuadro en silencio
  private group: number[] = [] // a qué grupo pertenece cada cuadro (para no comparar cuadros separados)

  constructor(private sampleRate = 44100) {
    this.bands = Math.max(0, Math.floor((sampleRate / 2 - LOW_HZ) / BAND_HZ))
  }

  push(x: number) {
    this.buf[this.pos++] = x
    if (this.pos < N) return
    this.pos = 0
    const f = this.frame++
    if (f % EVERY < GROUP && this.bands) this.measure(Math.floor(f / EVERY))
  }

  private measure(group: number) {
    const { re, im, buf } = this
    let e = 0
    for (let i = 0; i < N; i++) { e += buf[i] * buf[i]; re[i] = buf[i] * this.fft.win[i]; im[i] = 0 }
    this.group.push(group)
    if (Math.sqrt(e / N) < 0.0015) { this.mids.push(NaN); this.highs.push([]); return } // silencio
    this.fft.run(re, im)
    const binHz = this.sampleRate / N
    const pw = (a: number, b: number) => { let s = 0; for (let k = Math.round(a / binHz); k < Math.round(b / binHz); k++) s += re[k] * re[k] + im[k] * im[k]; return s }
    this.mids.push(pw(2000, 8000))
    const h: number[] = []
    for (let b = 0; b < this.bands; b++) h.push(pw(LOW_HZ + b * BAND_HZ, LOW_HZ + (b + 1) * BAND_HZ))
    this.highs.push(h)
  }

  /** Cuánto más saltan los agudos (de 16 kHz hasta el corte) que los medios. null si no hay agudos para medir. */
  jitter(cutoff: number | null): number | null {
    const hi = Math.min(cutoff ?? this.sampleRate / 2, 20000) - 500
    const b0 = Math.round((16000 - LOW_HZ) / BAND_HZ), b1 = Math.floor((hi - LOW_HZ) / BAND_HZ)
    if (b1 - b0 < 2) return null
    const db = (x: number) => 10 * Math.log10(x + 1e-30)
    let jh = 0, jm = 0, pairs = 0
    for (let i = 1; i < this.mids.length; i++) {
      if (this.group[i] !== this.group[i - 1] || Number.isNaN(this.mids[i]) || Number.isNaN(this.mids[i - 1])) continue
      let a = 0, b = 0
      for (let k = b0; k < b1; k++) { a += this.highs[i][k]; b += this.highs[i - 1][k] }
      jh += Math.abs(db(a) - db(b))
      jm += Math.abs(db(this.mids[i]) - db(this.mids[i - 1]))
      pairs++
    }
    return pairs >= 50 && jm > 0 ? Math.round((jh / jm) * 100) / 100 : null
  }
}
