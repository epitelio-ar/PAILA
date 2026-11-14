// Repaso de coherencia (24/10, docs/DECISIONES.md): los nombres nuevos de la barra lateral, que nada útil quede escondido
// (Recortar silencios en la barra, las secciones de Configuración en Ctrl+K) y que no vuelvan los nombres viejos a la pantalla.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
/** Los archivos de la interfaz de PAILA y NAPIA y los textos de los paquetes (sin los comentarios). */
function textosDePantalla(): { archivo: string; linea: string }[] {
  const out: { archivo: string; linea: string }[] = []
  for (const dir of ['apps/paila/ui/src', 'apps/napia/ui/src', 'packages/shared', 'packages/core', 'packages/diseno/src']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(f)) continue
      for (const linea of read(path.join(dir, f)).split('\n')) if (!/^\s*(\/\/|\/\*|\*)/.test(linea)) out.push({ archivo: path.join(dir, f), linea })
    }
  }
  return out
}

describe('coherencia de nombres y lugares', () => {
  it('la barra lateral usa los nombres nuevos', async () => {
    const { NAV_GROUPS, NAV_TOP } = await import('../apps/paila/ui/src/nav')
    const grupo = (id: string) => NAV_GROUPS.find((g) => g.id === id)!
    expect(grupo('quality').title).toBe('Sonido')
    expect(grupo('dj').title).toBe('DJ y producción')
    expect(grupo('dj').items.find((i) => i.page === 'rekordbox')?.label).toBe('Programas de DJ')
    expect(NAV_TOP.find((i) => i.page === 'stats')?.label).toBe('Estadísticas')
  })

  it('Recortar silencios está en la barra (y por eso en Ctrl+K), no solo detrás del Centro de problemas', async () => {
    const { NAV_GROUPS } = await import('../apps/paila/ui/src/nav')
    expect(NAV_GROUPS.find((g) => g.id === 'quality')!.items.map((i) => i.page)).toContain('silencios')
  })

  it('cada sección de Configuración del índice y de Ctrl+K tiene su ancla en la pantalla', async () => {
    const { CONFIG_SECCIONES } = await import('../apps/paila/ui/src/nav')
    const settings = read('apps/paila/ui/src/Settings.tsx')
    expect(CONFIG_SECCIONES.length).toBeGreaterThanOrEqual(9)
    for (const s of CONFIG_SECCIONES) expect(settings, s.id).toContain(`id="${s.id}"`)
    expect(read('apps/paila/ui/src/CommandPalette.tsx')).toContain('CONFIG_SECCIONES')
  })

  it('no vuelven a la pantalla los nombres viejos', () => {
    const viejos = [/Rekordbox y cabina/, /Rekordbox and the booth/, /Organizador de carpetas/, /'Tu colección'/, /'Para DJs'/, /'Mejorar la calidad'/, /camino de Inicio/, /tarjeta "Lossless falsos" de Inicio/, /no corta nada/, /más adelante PAILA lo hace/, /Comic or Plain/, /(?:es|en): ['"`]\{T\./]
    const malos = textosDePantalla().filter(({ linea }) => viejos.some((v) => v.test(linea)))
    expect(malos.map((m) => `${m.archivo}: ${m.linea.trim().slice(0, 90)}`)).toEqual([])
  })

  it('Ctrl+K no promete buscar temas (eso es el cuadro de arriba) y "pendrive" lleva a algún lado', async () => {
    expect(read('apps/paila/ui/src/atajos.ts')).not.toMatch(/Ir a cualquier pantalla, tema/)
    const { NAV_GROUPS } = await import('../apps/paila/ui/src/nav')
    expect(NAV_GROUPS.flatMap((g) => g.items).some((i) => /pendrive/i.test(`${i.label} ${i.help}`))).toBe(true)
  })
})
