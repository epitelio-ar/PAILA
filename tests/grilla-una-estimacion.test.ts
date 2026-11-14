// "Programas de DJ" → "5. Grilla y cue points" (el autor, 24/10/2026: "no se entiende, dicen números distintos en la misma
// página"): con una tanda en marcha seguía arriba la estimación de la playlist del selector ("pop: unos 33 min") junto al tiempo
// de la tanda ("falta 1 h 56 min"). Ahora, mientras corre, el selector y su estimación no están: el título de la tanda dice qué
// lista se calcula y abajo, "Cuando termine esta tanda podés elegir otra lista".
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ponerIdioma } from '@paila/shared/idioma'
import { sePuedeElegir } from '../apps/paila/ui/src/RekordboxPro'

const ROOT = path.join(__dirname, '..')
const ui = fs.readFileSync(path.join(ROOT, 'apps/paila/ui/src/RekordboxPro.tsx'), 'utf8')
const dj = fs.readFileSync(path.join(ROOT, 'apps/paila/electron/ipc/dj.ts'), 'utf8')
afterAll(() => ponerIdioma('es'))

describe('grilla: una sola estimación a la vista', () => {
  it('con una tanda en marcha no se elige otra lista', () => {
    expect(sePuedeElegir(null)).toBe(true)
    expect(sePuedeElegir({ running: false })).toBe(true) // terminó: se puede elegir la próxima
    expect(sePuedeElegir({ running: true })).toBe(false)
  })

  it('el selector y su estimación solo se dibujan cuando se puede elegir', () => {
    expect(ui).toMatch(/\{elegir && <div className="row"[^]*?<select value=\{String\(target\)\}/)
    expect(ui).toMatch(/\{elegir && plan && \(/)
    // y no se pide la estimación mientras corre
    expect(ui).toMatch(/if \(!elegir\) return\n\s*window\.paila\.gridPlan\(/)
    expect(ui).toMatch(/\{!elegir && <p className="muted small">\{T\.cuandoTermine\}<\/p>\}/)
  })

  it('el aviso y el título de la tanda están en los dos idiomas, y el título dice qué lista', () => {
    expect(ui).toContain("cuandoTermine: { es: 'Cuando termine esta tanda podés elegir otra lista.', en: 'When this batch finishes you can choose another list.' }")
    expect(dj).toMatch(/grilla: \{ es: \(lista: string \| null\) => \(lista \? `Calculando grilla y cues: \$\{lista\}` : 'Calculando grilla y cues de toda la Música'\), en: \(lista: string \| null\) =>/)
    // el título se arma una vez: lo usa la barra del proceso y el renglón "espera a que termine" (core/oplock.ts)
    expect(dj).toMatch(/const label = T\.grilla\(playlistId == null \? null : /)
    expect(dj).toMatch(/c\.jobs\.run\('grid', label, /)
  })
})
