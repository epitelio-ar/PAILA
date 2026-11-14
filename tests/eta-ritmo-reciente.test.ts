// Tiempo restante de los procesos largos (el panel de jobs.tsx usa @paila/shared/eta): tiene que seguir el ritmo de lo
// último y no el promedio desde el arranque. Prueba del autor del 28/10: en Completar desde internet lo ya buscado salía
// volando y lo nuevo iba a un pedido por segundo; el promedio prometía unos minutos y tardó 37.
import { describe, expect, it } from 'vitest'
import { EtaMeter } from '@paila/shared/eta'

describe('tiempo restante con el ritmo de lo último', () => {
  it('después de un arranque rápido (lo ya buscado), estima con el ritmo lento de ahora', () => {
    const m = new EtaMeter(), total = 2000
    let t = 0, n = 0
    // 1 min a 10 por segundo (lo que ya estaba en caché)
    for (; t <= 60_000; t += 1000) { m.add(t, n); n += 10 }
    // después, uno por segundo (MusicBrainz), durante 10 minutos
    for (let i = 0; i < 600; i++) { t += 1000; n += 1; m.add(t, n) }
    const restantes = total - n
    const est = m.estimate(restantes)
    const promedio = restantes / ((n * 60_000) / t) // lo que decía antes
    const real = restantes / 60 // a un pedido por segundo
    expect(est.minutes).not.toBeNull()
    expect(Math.abs(est.minutes! - real)).toBeLessThan(real * 0.15)
    expect(promedio).toBeLessThan(real * 0.6) // el promedio se quedaba muy corto
  })

  it('sin 20 s mirando no promete nada', () => {
    const m = new EtaMeter()
    for (let t = 0; t <= 10_000; t += 1000) m.add(t, t / 100)
    expect(m.estimate(500).minutes).toBeNull()
  })
})

describe('el avance que llega entre dos tics cuenta (prueba de la persona 2, 1/11)', () => {
  it('5 por segundo, llegando entre tics: unos 300 por minuto, no "falta 2 h"', () => {
    const m = new EtaMeter(); let done = 0
    for (let s = 0; s < 75; s++) { const t = s * 1000; m.add(t, done); done += 5; m.add(t, done) }
    const e = m.estimate(1068 - done)
    expect(e.perMinute).toBeGreaterThan(250)
    expect(e.minutes!).toBeLessThan(5)
  })
})
