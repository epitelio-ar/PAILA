// Las decisiones del autor sobre la etapa 6 (MASTERPLAN-5, 13/11/2026): una prueba por punto.
//  7. El Tracklist de sets vive solo en la pestaña DJ.
//  8. El grupo «Herramientas» de la barra lateral arranca cerrado.
//  9. «Rajatabla» pasa a llamarse «Estricto» en los textos, sin cambiar la clave guardada.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NAV_GROUPS } from '../apps/paila/ui/src/nav'
import { SECCIONES, SOLO_DJ, partesDe } from '../apps/paila/ui/src/secciones'
import { DEFAULT_PROFILE, PROFILES, rulesOf } from '../packages/shared/tidy-profiles'
import { ponerIdioma } from '../packages/shared/idioma'

const UI = path.join(__dirname, '..', 'apps', 'paila', 'ui', 'src')

describe('etapa 6, decisión 7: el Tracklist de sets solo en DJ', () => {
  it('está en el grupo DJ de la navegación y en ningún otro', () => {
    const donde = NAV_GROUPS.filter((g) => g.items.some((i) => i.page === 'tracklist')).map((g) => g.id)
    expect(donde).toEqual(['dj'])
  })
  it('es parte de la pestaña DJ, se ve solo con las herramientas para DJ y no está en ninguna otra pestaña', () => {
    const en = SECCIONES.filter((s) => s.partes.includes('tracklist') || s.detalle?.includes('tracklist')).map((s) => s.id)
    expect(en).toEqual(['dj'])
    expect(SOLO_DJ.has('tracklist')).toBe(true)
    for (const s of SECCIONES) expect(partesDe(s, false), s.id).not.toContain('tracklist')
  })
})

describe('etapa 6, decisión 8: Herramientas arranca cerrado', () => {
  const src = fs.readFileSync(path.join(UI, 'Sidebar.tsx'), 'utf8')
  it('el grupo «herramientas» se declara cerrado de fábrica', () => {
    const g = /<Group\s+id="herramientas"[^>]*>/.exec(src)?.[0] ?? ''
    expect(g).toMatch(/\bcerradoDeFabrica\b/)
  })
  it('sin nada guardado un grupo cerradoDeFabrica arranca plegado (y recuerda lo que la persona hizo)', () => {
    expect(src).toMatch(/v == null \? cerradoDeFabrica/)
  })
})

describe('etapa 6, decisión 9: Rajatabla → Estricto', () => {
  it('el perfil se llama Estricto en castellano y Strict en inglés, con la misma clave guardada', () => {
    const p = PROFILES.find((x) => x.key === 'rajatabla')!
    ponerIdioma('es'); expect(p.label).toBe('Estricto')
    ponerIdioma('en'); expect(p.label).toBe('Strict')
    ponerIdioma('es')
    expect(PROFILES.map((x) => x.key)).toEqual(['minimo', 'prolijo', 'rajatabla', 'oficial'])
    expect(DEFAULT_PROFILE).toBe('prolijo')
    expect(rulesOf('rajatabla')).toContain('mayusculas')
  })
  it('la palabra «Rajatabla» no queda en ningún texto de pantalla', () => {
    const archivos = [path.join(__dirname, '..', 'packages', 'shared', 'tidy-profiles.ts'), ...fs.readdirSync(UI).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(UI, f))]
    for (const f of archivos) {
      const textos = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /Rajatabla/.test(l) && !/^\s*\/\//.test(l) && !/'rajatabla'|RAJATABLA/.test(l))
      expect(textos, path.basename(f)).toEqual([])
    }
  })
})
