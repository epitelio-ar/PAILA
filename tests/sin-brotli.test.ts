// fetchSinBrotli (core/online/http.ts): mientras el Node de Electron tenga la falla de Brotli (CVE-2026-111497), PAILA pide
// solo gzip/deflate y rechaza una respuesta en Brotli sin leerla.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSinBrotli } from '@paila/core/online/http'

afterEach(() => vi.unstubAllGlobals())

const respuesta = (encoding: string | null) => new Response('{"ok":true}', { headers: encoding ? { 'content-encoding': encoding } : {} })

describe('fetchSinBrotli', () => {
  it('pide solo gzip y deflate, aunque el pedido traiga otros encabezados', async () => {
    const f = vi.fn(async (_u: string | URL, _i?: RequestInit) => respuesta(null))
    vi.stubGlobal('fetch', f)
    await fetchSinBrotli('https://musicbrainz.org/ws/2/x', { headers: { 'user-agent': 'PAILA', 'accept-encoding': 'br' } })
    const h = new Headers(f.mock.calls[0][1]?.headers)
    expect(h.get('accept-encoding')).toBe('gzip, deflate')
    expect(h.get('user-agent')).toBe('PAILA')
  })

  it('rechaza una respuesta en Brotli sin leerla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta('gzip, br')))
    await expect(fetchSinBrotli('https://ejemplo.org/a')).rejects.toThrow(/ejemplo\.org.*Brotli/)
  })

  it('deja pasar gzip y las respuestas sin comprimir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta('gzip')))
    expect((await fetchSinBrotli('https://ejemplo.org/a')).ok).toBe(true)
  })
})
