// Tests de Separar voz (MASTERPLAN-4, 4B.6; core/analysis/stems.ts): la FFT de cualquier largo contra la DFT directa, la
// STFT que vuelve igual, y el demix en pedazos con modelos de mentira (el de UVR se baja aparte): uno que devuelve lo mismo
// y otro que se queda con los graves, para ver que la voz sea lo que resta y que los pedazos se peguen sin costuras.
import { describe, expect, it } from 'vitest'
import { fft, fftPlan, istftStereo, mdxChunks, mdxSeparate, sdr, stftStereo, STEMS_RATE, type MdxConfig, type MdxModel } from '@paila/core/analysis/stems'

/** Energía de x respecto de la de ref, en dB. */
const relativa = (x: Float32Array, ref: Float32Array) => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / ref.reduce((s, v) => s + v * v, 0))
const tono = (n: number, ...f: [hz: number, amp: number][]) =>
  Float32Array.from({ length: n }, (_, i) => f.reduce((s, [hz, a]) => s + a * Math.sin((2 * Math.PI * hz * i) / STEMS_RATE), 0))

describe('FFT de cualquier largo', () => {
  for (const n of [12, 30, 60, 6144, 7680]) {
    it(`${n} da lo mismo que la DFT directa`, () => {
      const pl = fftPlan(n)
      const xr = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) * 0.7), xi = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.37) * 0.2)
      const yr = new Float64Array(n), yi = new Float64Array(n)
      fft(pl, xr, xi, yr, yi)
      for (const k of [0, 1, 7, n - 1]) {
        let r = 0, im = 0
        for (let j = 0; j < n; j++) { const a = (-2 * Math.PI * j * k) / n; r += xr[j] * Math.cos(a) - xi[j] * Math.sin(a); im += xr[j] * Math.sin(a) + xi[j] * Math.cos(a) }
        expect(Math.abs(r - yr[k])).toBeLessThan(1e-8)
        expect(Math.abs(im - yi[k])).toBeLessThan(1e-8)
      }
    })
  }
})

describe('STFT', () => {
  it('ida y vuelta sin perder nada (Inst_HQ_3: 6144 / 1024)', () => {
    const n = 1024 * 255
    const L = tono(n, [440, 0.5], [3000, 0.2]), R = tono(n, [220, 0.4], [7000, 0.1])
    const { data, T } = stftStereo(L, R, 6144, 1024, 3073)
    expect(T).toBe(256)
    const back = istftStereo(data, 3073, T, 6144, 1024)
    expect(back[0].length).toBe(n)
    expect(sdr([L, R], back)).toBeGreaterThan(100)
  })

  it('separa bien los dos canales (L + iR en un solo FFT)', () => {
    const n = 1024 * 63
    const L = tono(n, [1000, 0.5]), R = new Float32Array(n)
    const { data, T } = stftStereo(L, R, 2048, 1024, 1025)
    const plane = 1025 * T
    let rEnergy = 0
    for (let i = 2 * plane; i < 4 * plane; i++) rEnergy += data[i] ** 2
    expect(rEnergy).toBeLessThan(1e-12)
  })
})

describe('demix en pedazos', () => {
  // Chico para que el test sea rápido: 64 cuadros de 512 = pedazos de ~0,7 s
  const cfg: MdxConfig = { nfft: 2048, hop: 512, dimF: 1025, dimT: 64, compensate: 1, primary: 'instrumental' }
  const n = Math.round(STEMS_RATE * 3.3)

  it('con un modelo que devuelve lo mismo, el instrumental es el tema y la voz queda en silencio', async () => {
    let llamadas = 0
    const igual: MdxModel = async (spec) => { llamadas++; return spec }
    const L = tono(n, [500, 0.4], [2500, 0.2]), R = tono(n, [700, 0.3])
    const r = await mdxSeparate(cfg, igual, L, R)
    expect(llamadas).toBe(mdxChunks(cfg, n))
    expect(sdr([L, R], r.instrumental)).toBeGreaterThan(50)
    expect(relativa(r.vocals[0], L)).toBeLessThan(-50)
  })

  it('con un modelo que se queda con los graves, la voz es lo agudo: sin costuras entre pedazos', async () => {
    const corte = Math.round((1200 * cfg.nfft) / STEMS_RATE) // bin de 1200 Hz
    const graves: MdxModel = async (spec, [, , F, T]) => {
      const o = Float32Array.from(spec)
      for (let c = 0; c < 4; c++) o.fill(0, (c * F + corte) * T, (c + 1) * F * T)
      return o
    }
    const bajo = tono(n, [300, 0.5]), alto = tono(n, [5000, 0.3])
    const L = bajo.map((v, i) => v + alto[i]), R = Float32Array.from(L)
    const r = await mdxSeparate(cfg, graves, L, R)
    expect(sdr([bajo, bajo], r.instrumental)).toBeGreaterThan(30)
    expect(sdr([alto, alto], r.vocals)).toBeGreaterThan(30)
  })

  it('compensate y "primary": un modelo de voz devuelve la voz, y el instrumental es el resto', async () => {
    const voz: MdxConfig = { ...cfg, primary: 'vocals', compensate: 2 }
    const mitad: MdxModel = async (spec) => spec.map((v) => v / 2)
    const L = tono(n, [800, 0.4]), R = Float32Array.from(L)
    const r = await mdxSeparate(voz, mitad, L, R)
    expect(sdr([L, R], r.vocals)).toBeGreaterThan(50) // ½ × 2
    expect(relativa(r.instrumental[0], L)).toBeLessThan(-50)
  })

  it('avisa el avance y se puede cancelar entre pedazos', async () => {
    const vistos: number[] = []
    let corta = false
    const igual: MdxModel = async (spec) => spec
    const L = tono(n, [500, 0.4]), R = Float32Array.from(L)
    await expect(mdxSeparate(cfg, igual, L, R, { onChunk: (d) => { vistos.push(d); if (d === 2) corta = true }, cancelled: () => corta })).rejects.toThrow()
    expect(vistos).toEqual([1, 2])
  })
})
