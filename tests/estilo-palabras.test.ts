// Regla de la etapa 6 del MASTERPLAN-5 (hallazgos 9 y 10 de la revisión del 02/11): cada palabra técnica del camino principal
// lleva su ⓘ con una explicación corta, y lo que solo le sirve a un DJ no se ve si las herramientas para DJ están apagadas.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PROBLEMS } from '../apps/paila/ui/src/problems'
import { PROBLEMAS_DJ } from '../apps/paila/ui/src/ProblemCenter'

const raiz = path.join(__dirname, '..')
const leer = (f: string) => fs.readFileSync(path.join(raiz, f), 'utf8')

describe('estilo: palabras con su ⓘ (MASTERPLAN-5, etapa 6)', () => {
  it('cada problema del Centro de problemas se explica en la fila misma (ⓘ), no solo al pasar por la fila', () => {
    for (const p of PROBLEMS) expect(p.help.length, p.key).toBeGreaterThan(30)
    expect(leer('apps/paila/ui/src/ProblemCenter.tsx')).toContain('<Info tip={g.help} />')
  })
  it('«Rekordbox no los lee» y «BPM dudoso» solo se ven con las herramientas para DJ prendidas', () => {
    expect([...PROBLEMAS_DJ].sort()).toEqual(['bpm_doubtful', 'rekordbox'])
    expect(leer('apps/paila/ui/src/ProblemCenter.tsx')).toMatch(/djTools \|\| !PROBLEMAS_DJ\.has/)
  })
  it('en Duplicados, «byte a byte», «huella acústica» y «comparten N s» se explican junto al motivo del grupo', () => {
    const src = leer('apps/paila/ui/src/Duplicates.tsx')
    expect(src).toContain('<Info tip={T.porQueTip} />')
    for (const palabra of ['Byte a byte', 'Huella acústica', 'Comparten N s']) expect(src).toContain(palabra)
  })
  it('lo que se ve arriba mientras PAILA trabaja no habla de BPM a quien no usa DJ', () => {
    expect(leer('packages/core/precise.ts')).not.toMatch(/precisa: \{ es: '[^']*BPM/)
  })
  it('la ayuda del silencio dice el nombre actual de la pestaña (Sonido), no el viejo', () => {
    const src = leer('apps/paila/ui/src/Detail.textos.ts')
    expect(src).not.toContain('Mejorar el sonido')
    expect(src).not.toContain('Improve the sound')
  })
  it('Arreglar nombres no muestra barras que no cambian (cinco iguales ocupaban el primer tercio)', () => {
    expect(leer('apps/paila/ui/src/Tidy.tsx')).toMatch(/if \(a === b\) return null/)
  })
})
