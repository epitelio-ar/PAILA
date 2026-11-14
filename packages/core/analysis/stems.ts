// Separar voz (MASTERPLAN-4, 4B.6): lo de PAILA alrededor de MDX-Net (Inst_HQ_3, de UVR, licencia MIT; se baja aparte), sin
// dependencias: una FFT de cualquier largo (2·3·5), la STFT como la de torch y el "demix" en pedazos superpuestos de UVR.
// El modelo entra como función (lo corre stemsrun.ts con onnxruntime-node). Probado contra las partes oficiales de un disco
// (docs/pruebas/2026-10-24-4B6-stems-etapa2.md): voz 10,9 dB y instrumental 15,0 dB de SDR, de promedio.

export const STEMS_RATE = 44100

/** Lo que necesita saber PAILA de un modelo MDX-Net (de model_data.json de UVR, por la huella del archivo). */
export interface MdxConfig {
  nfft: number
  hop: number
  /** Bins de frecuencia que mira el modelo (los de arriba quedan en 0). */
  dimF: number
  /** Cuadros por pedazo. */
  dimT: number
  /** Ganancia que UVR le aplica a lo que sale del modelo. */
  compensate: number
  /** Qué devuelve el modelo: el instrumental (la voz es el resto) o la voz. */
  primary: 'instrumental' | 'vocals'
}

/** UVR-MDX-NET-Inst_HQ_3 (huella 55657dd7… en model_data.json: n_fft 6144, compensate 1,022). */
export const INST_HQ3: MdxConfig = { nfft: 6144, hop: 1024, dimF: 3072, dimT: 256, compensate: 1.022, primary: 'instrumental' }

/** Corre el modelo sobre un espectrograma [1, 4, dimF, dimT] (L re, L im, R re, R im) y devuelve uno igual. */
export type MdxModel = (spec: Float32Array, dims: [number, number, number, number]) => Promise<Float32Array>

export type Stereo = [Float32Array, Float32Array]

// ── FFT compleja de cualquier largo con factores 2, 3, 4 y 5 (al estilo de KissFFT) ─────────────────────────────────────
export interface FftPlan { n: number; fac: number[]; twr: Float64Array; twi: Float64Array; sr: Float64Array; si: Float64Array }
const planes = new Map<number, FftPlan>()

export function fftPlan(n: number): FftPlan {
  const hit = planes.get(n)
  if (hit) return hit
  const fac: number[] = []
  let m = n, p = 4
  const tope = Math.floor(Math.sqrt(n))
  do {
    while (m % p) { p = p === 4 ? 2 : p === 2 ? 3 : p + 2; if (p > tope) p = m }
    m /= p; fac.push(p, m)
  } while (m > 1)
  const twr = new Float64Array(n), twi = new Float64Array(n)
  for (let i = 0; i < n; i++) { twr[i] = Math.cos((-2 * Math.PI * i) / n); twi[i] = Math.sin((-2 * Math.PI * i) / n) }
  const pl = { n, fac, twr, twi, sr: new Float64Array(n), si: new Float64Array(n) }
  planes.set(n, pl)
  return pl
}

/** FFT hacia adelante: (inR, inI) → (outR, outI), sin escalar. */
export function fft(pl: FftPlan, inR: Float64Array, inI: Float64Array, outR: Float64Array, outI: Float64Array): void {
  work(pl, outR, outI, 0, inR, inI, 0, 1, 0)
}

function work(pl: FftPlan, oR: Float64Array, oI: Float64Array, oo: number, iR: Float64Array, iI: Float64Array, io: number, fstride: number, fi: number): void {
  const p = pl.fac[fi], m = pl.fac[fi + 1]
  if (m === 1) {
    for (let k = 0; k < p; k++) { oR[oo + k] = iR[io + k * fstride]; oI[oo + k] = iI[io + k * fstride] }
  } else {
    for (let k = 0; k < p; k++) work(pl, oR, oI, oo + k * m, iR, iI, io + k * fstride, fstride * p, fi + 2)
  }
  const { twr, twi, n } = pl
  if (p === 2) {
    for (let k = 0; k < m; k++) {
      const a = oo + k, b = a + m, w = k * fstride
      const tr = oR[b] * twr[w] - oI[b] * twi[w], ti = oR[b] * twi[w] + oI[b] * twr[w]
      oR[b] = oR[a] - tr; oI[b] = oI[a] - ti; oR[a] += tr; oI[a] += ti
    }
  } else if (p === 4) {
    for (let k = 0; k < m; k++) {
      const a = oo + k, b = a + m, c = a + 2 * m, d = a + 3 * m
      const w1 = k * fstride, w2 = 2 * w1, w3 = 3 * w1
      const s0r = oR[b] * twr[w1] - oI[b] * twi[w1], s0i = oR[b] * twi[w1] + oI[b] * twr[w1]
      const s1r = oR[c] * twr[w2] - oI[c] * twi[w2], s1i = oR[c] * twi[w2] + oI[c] * twr[w2]
      const s2r = oR[d] * twr[w3] - oI[d] * twi[w3], s2i = oR[d] * twi[w3] + oI[d] * twr[w3]
      const s5r = oR[a] - s1r, s5i = oI[a] - s1i
      const ar = oR[a] + s1r, ai = oI[a] + s1i
      const s3r = s0r + s2r, s3i = s0i + s2i, s4r = s0r - s2r, s4i = s0i - s2i
      oR[c] = ar - s3r; oI[c] = ai - s3i
      oR[a] = ar + s3r; oI[a] = ai + s3i
      oR[b] = s5r + s4i; oI[b] = s5i - s4r
      oR[d] = s5r - s4i; oI[d] = s5i + s4r
    }
  } else if (p === 3) {
    const e = twi[fstride * m] // sen(−2π/3)
    for (let k = 0; k < m; k++) {
      const a = oo + k, b = a + m, c = a + 2 * m, w1 = k * fstride, w2 = 2 * w1
      const s1r = oR[b] * twr[w1] - oI[b] * twi[w1], s1i = oR[b] * twi[w1] + oI[b] * twr[w1]
      const s2r = oR[c] * twr[w2] - oI[c] * twi[w2], s2i = oR[c] * twi[w2] + oI[c] * twr[w2]
      const s3r = s1r + s2r, s3i = s1i + s2i
      const s0r = (s1r - s2r) * e, s0i = (s1i - s2i) * e
      const br = oR[a] - s3r * 0.5, bi = oI[a] - s3i * 0.5
      oR[a] += s3r; oI[a] += s3i
      oR[c] = br + s0i; oI[c] = bi - s0r
      oR[b] = br - s0i; oI[b] = bi + s0r
    }
  } else {
    // cualquier otro factor (5): la DFT directa del pedazo
    const { sr, si } = pl
    for (let u = 0; u < m; u++) {
      for (let q = 0, k = oo + u; q < p; q++, k += m) { sr[q] = oR[k]; si[q] = oI[k] }
      for (let q1 = 0, k = u; q1 < p; q1++, k += m) {
        let accR = sr[0], accI = si[0], tw = 0
        for (let q = 1; q < p; q++) {
          tw += fstride * k; if (tw >= n) tw -= n
          accR += sr[q] * twr[tw] - si[q] * twi[tw]; accI += sr[q] * twi[tw] + si[q] * twr[tw]
        }
        oR[oo + k] = accR; oI[oo + k] = accI
      }
    }
  }
}

// ── STFT e iSTFT como las de torch (center, reflejo, Hann periódica, sin normalizar), con los dos canales juntos ──────────
const hanns = new Map<number, Float64Array>()
const hann = (n: number) => {
  let w = hanns.get(n)
  if (!w) { w = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); hanns.set(n, w) }
  return w
}
const reflect = (n: number, i: number) => { while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * (n - 1) - i } return i }

/**
 * STFT estéreo: el tensor [4, keep, T] (L re, L im, R re, R im) con los primeros `keep` bins. Un solo FFT complejo por
 * cuadro (L + iR); los dos espectros se separan por simetría.
 */
export function stftStereo(L: Float32Array, R: Float32Array, nfft: number, hop: number, keep: number): { data: Float32Array; T: number } {
  const len = L.length, T = 1 + Math.floor(len / hop), half = nfft / 2, bins = half + 1
  const pl = fftPlan(nfft), w = hann(nfft)
  const zr = new Float64Array(nfft), zi = new Float64Array(nfft), Zr = new Float64Array(nfft), Zi = new Float64Array(nfft)
  const out = new Float32Array(4 * keep * T), plane = keep * T
  for (let t = 0; t < T; t++) {
    const s = t * hop - half
    const dentro = s >= 0 && s + nfft <= len
    for (let n = 0; n < nfft; n++) { const j = dentro ? s + n : reflect(len, s + n); zr[n] = L[j] * w[n]; zi[n] = R[j] * w[n] }
    fft(pl, zr, zi, Zr, Zi)
    for (let f = 0; f < keep && f < bins; f++) {
      const g = f === 0 ? 0 : nfft - f
      const ar = Zr[f], ai = Zi[f], br = Zr[g], bi = -Zi[g] // conj(Z[N−f])
      const o = f * T + t
      out[o] = (ar + br) / 2; out[plane + o] = (ai + bi) / 2 // L = (Z + conj Z')/2
      out[2 * plane + o] = (ai - bi) / 2; out[3 * plane + o] = -(ar - br) / 2 // R = (Z − conj Z')/(2i)
    }
  }
  return { data: out, T }
}

/** iSTFT de [4, have, T] (los bins que falten valen 0) → [L, R] de largo hop·(T − 1). */
export function istftStereo(spec: Float32Array, have: number, T: number, nfft: number, hop: number): Stereo {
  const half = nfft / 2, bins = half + 1, len = hop * (T - 1)
  const pl = fftPlan(nfft), w = hann(nfft)
  const yL = new Float64Array(len + nfft), yR = new Float64Array(len + nfft), env = new Float64Array(len + nfft)
  const zr = new Float64Array(nfft), zi = new Float64Array(nfft), Zr = new Float64Array(nfft), Zi = new Float64Array(nfft)
  const plane = have * T
  for (let t = 0; t < T; t++) {
    zr.fill(0); zi.fill(0)
    for (let f = 0; f < Math.min(have, bins); f++) {
      const o = f * T + t
      const borde = f === 0 || 2 * f === nfft // como irfft: la parte imaginaria de 0 y de Nyquist no cuenta
      const lr = spec[o], li = borde ? 0 : spec[plane + o], rr = spec[2 * plane + o], ri = borde ? 0 : spec[3 * plane + o]
      // Z[f] = L[f] + i·R[f]; Z[N−f] = conj(L[f]) + i·conj(R[f]). Se invierte con conj(FFT(conj(Z)))/N.
      zr[f] = lr - ri; zi[f] = -(li + rr)
      if (f > 0 && f < nfft - f) { zr[nfft - f] = lr + ri; zi[nfft - f] = -(rr - li) }
    }
    fft(pl, zr, zi, Zr, Zi)
    const s = t * hop
    for (let n = 0; n < nfft; n++) { yL[s + n] += (Zr[n] / nfft) * w[n]; yR[s + n] += (-Zi[n] / nfft) * w[n]; env[s + n] += w[n] * w[n] }
  }
  const L = new Float32Array(len), R = new Float32Array(len)
  for (let i = 0; i < len; i++) { const e = env[i + half]; L[i] = e > 1e-11 ? yL[i + half] / e : 0; R[i] = e > 1e-11 ? yR[i + half] / e : 0 }
  return [L, R]
}

// ── Demix: pedazos superpuestos un 25 %, con ventana de Hann (como UVR / audio-separator) ─────────────────────────────
const chunkOf = (c: MdxConfig) => c.hop * (c.dimT - 1)
const stepOf = (c: MdxConfig) => Math.floor(0.75 * chunkOf(c))
const paddedOf = (c: MdxConfig, n: number) => { const trim = c.nfft / 2, gen = chunkOf(c) - 2 * trim; return trim + n + (gen + trim - (n % gen)) }

/** Cuántas veces corre el modelo para un tema de `n` muestras (para el avance y el tiempo estimado). */
export const mdxChunks = (c: MdxConfig, n: number) => Math.ceil(paddedOf(c, n) / stepOf(c))

export interface SeparateOptions {
  /** Cada pedazo terminado (para el avance). */
  onChunk?: (done: number, total: number) => void
  /** Se revisa entre pedazos: si dice true, corta con un error. */
  cancelled?: () => boolean
}

/** Separa [L, R] (44,1 kHz) en voz e instrumental. El que no devuelve el modelo es lo que queda de restarlo al tema. */
export async function mdxSeparate(c: MdxConfig, model: MdxModel, L: Float32Array, R: Float32Array, o: SeparateOptions = {}): Promise<{ vocals: Stereo; instrumental: Stereo }> {
  const chunk = chunkOf(c), trim = c.nfft / 2, step = stepOf(c), total = paddedOf(c, L.length)
  const mixL = new Float32Array(total), mixR = new Float32Array(total)
  mixL.set(L, trim); mixR.set(R, trim)
  const resL = new Float64Array(total), resR = new Float64Array(total), div = new Float64Array(total)
  const pL = new Float32Array(chunk), pR = new Float32Array(chunk)
  const chunks = mdxChunks(c, L.length)
  for (let i = 0, k = 0; i < total; i += step, k++) {
    if (o.cancelled?.()) throw new Error('cancelado')
    const end = Math.min(i + chunk, total), act = end - i
    pL.fill(0); pR.fill(0); pL.set(mixL.subarray(i, end)); pR.set(mixR.subarray(i, end))
    const { data, T } = stftStereo(pL, pR, c.nfft, c.hop, c.dimF)
    for (let ch = 0; ch < 4; ch++) data.fill(0, ch * c.dimF * T, (ch * c.dimF + 3) * T) // los 3 bins más graves en 0, como UVR
    const pred = await model(data, [1, 4, c.dimF, T])
    const [oL, oR] = istftStereo(pred, c.dimF, T, c.nfft, c.hop)
    for (let j = 0; j < act; j++) {
      const w = act > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (act - 1)) : 1 // np.hanning
      resL[i + j] += oL[j] * w; resR[i + j] += oR[j] * w; div[i + j] += w
    }
    o.onChunk?.(k + 1, chunks)
  }
  const n = L.length
  const pL2 = new Float32Array(n), pR2 = new Float32Array(n), sL = new Float32Array(n), sR = new Float32Array(n)
  for (let j = 0; j < n; j++) {
    const d = div[j + trim]
    pL2[j] = d > 0 ? (resL[j + trim] / d) * c.compensate : 0; pR2[j] = d > 0 ? (resR[j + trim] / d) * c.compensate : 0
    sL[j] = L[j] - pL2[j]; sR[j] = R[j] - pR2[j]
  }
  const primary: Stereo = [pL2, pR2], rest: Stereo = [sL, sR]
  return c.primary === 'instrumental' ? { instrumental: primary, vocals: rest } : { vocals: primary, instrumental: rest }
}

/** SDR global (el del desafío MDX): 10·log10(Σ s² / Σ (s − ŝ)²), con los dos canales juntos. Para los tests y el laboratorio. */
export function sdr(ref: Stereo, est: Stereo): number {
  let num = 0, den = 0
  for (let c = 0; c < 2; c++) for (let i = 0; i < ref[c].length; i++) { num += ref[c][i] ** 2; den += (ref[c][i] - est[c][i]) ** 2 }
  return 10 * Math.log10((num + 1e-8) / (den + 1e-8))
}
