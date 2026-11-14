// Textos neutros (Fase P): la interfaz habla para cualquiera con mucha música, no solo para DJs (ver docs/GLOSARIO.md).
// Las palabras de cabina solo van donde la persona prendió las herramientas para DJ o está en una pantalla de DJs.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('textos neutros', () => {
  it('las ayudas de la calidad no suponen que sos DJ', () => {
    const t = read('apps/paila/ui/src/problems.ts') + read('apps/paila/ui/src/WantedList.tsx') + read('apps/paila/ui/src/Duplicates.tsx') + read('packages/core/analysis/grade.ts') + read('packages/core/analysis/grade.textos.ts')
    expect(t).not.toMatch(/para pinchar|pinchar está|en un equipo grande|y en un equipo grande/i)
    expect(read('apps/paila/ui/src/problems.ts')).toContain('con auriculares o un buen equipo se nota'.replace('con', 'Con'))
  })

  it('la sección de la barra lateral se llama "DJ y producción", como el interruptor, y no "Para pinchar"', () => {
    const nav = read('apps/paila/ui/src/nav.ts')
    expect(nav).toContain("title: tr({ es: 'DJ y producción'")
    expect(nav).not.toMatch(/Para pinchar/i)
  })

  it('"mala calidad" (glosario) en vez de "baja calidad" suelto en lo que se le muestra a la persona', () => {
    expect(read('packages/core/requests.textos.ts')).toContain("baja: { es: 'En mala calidad'")
  })
})
