// La nota de cada versión en GitHub Releases sale de las novedades (scripts/notas-version.mjs): las dos lenguas, y si falta
// la entrada de esa versión, el armado corta.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nota, seccion } from '../scripts/notas-version.mjs'

const NOV = '# Novedades\n\n<!-- cómo se escribe -->\n\n## 1.0.1 · 15/11/2026: arreglos\n\n- Uno.\n\n## 1.0.0 · 14/11/2026: la primera pública\n\n- Todo.\n- Más.\n'

describe('la nota de una versión', () => {
  it('saca solo la sección de esa versión', () => {
    expect(seccion(NOV, '1.0.0')).toBe('## 1.0.0 · 14/11/2026: la primera pública\n\n- Todo.\n- Más.')
    expect(seccion(NOV, '1.0.1')).toBe('## 1.0.1 · 15/11/2026: arreglos\n\n- Uno.')
    expect(seccion(NOV, '1.0')).toBeNull() // "1.0" no es "1.0.0"
  })

  it('junta castellano e inglés con cómo comprobar los archivos, y corta si falta una', () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'notas-'))
    fs.mkdirSync(path.join(raiz, 'docs'))
    fs.writeFileSync(path.join(raiz, 'docs', 'NOVEDADES.md'), NOV)
    fs.writeFileSync(path.join(raiz, 'docs', 'NOVEDADES.en.md'), '# What\'s new\n\n## 1.0.0 · 14/11/2026: the first public one\n\n- All.\n')
    const t = nota(raiz, '1.0.0')
    expect(t).toContain('### 1.0.0 · 14/11/2026: la primera pública')
    expect(t).toContain('### 1.0.0 · 14/11/2026: the first public one')
    expect(t).toContain('SHA256SUMS.txt')
    expect(() => nota(raiz, '1.0.1')).toThrow(/NOVEDADES\.en\.md/)
    fs.rmSync(raiz, { recursive: true, force: true })
  })

  it('las novedades de verdad tienen la versión de hoy en las dos lenguas', () => {
    const v = JSON.parse(fs.readFileSync('apps/paila/package.json', 'utf8')).version
    expect(nota('.', v)).toContain(`### ${v} `)
  })
})
