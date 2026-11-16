// La nota de cada versión en GitHub Releases sale de las novedades (scripts/notas-version.mjs): las dos lenguas, y si falta
// la entrada de esa versión, el armado corta.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { descargas, nota, seccion } from '../scripts/notas-version.mjs'

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

  it('arriba van los links para bajar, solo de los archivos que se suben', () => {
    const d = descargas('1.0.1')
    expect(d.startsWith('## ⬇️ Descargar · Download')).toBe(true)
    // los nombres son los artifactName de apps/paila/package.json: si cambian, los links se rompen
    for (const n of ['PAILA-instalador-1.0.1.exe', 'PAILA-mac-arm64-1.0.1.dmg', 'PAILA-mac-x64-1.0.1.dmg', 'PAILA-portable-1.0.1.exe']) {
      expect(d).toContain(`[${n}](https://github.com/epitelio-ar/PAILA/releases/download/v1.0.1/${n})`)
    }
    // orden: instalador, portable, Mac
    const pos = ['PAILA-instalador-', 'PAILA-portable-', 'PAILA-mac-arm64-', 'PAILA-mac-x64-'].map((n) => d.indexOf(`[${n}`))
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
    expect(d).toMatch(/PAILA-portable-1\.0\.1\.exe\)[^\n]*no se actualiza sola/)
    const soloWin = descargas('1.0.1', { archivos: ['PAILA-instalador-1.0.1.exe', 'PAILA-portable-1.0.1.exe'] })
    expect(soloWin).not.toContain('.dmg') // sin el armado de Mac, no hay links rotos
  })

  it('los nombres del bloque siguen a los del armado', () => {
    const pkg = fs.readFileSync('apps/paila/package.json', 'utf8')
    for (const a of ['PAILA-portable-${version}.exe', 'PAILA-mac-${arch}-${version}.${ext}', 'PAILA-instalador-${version}.${ext}']) expect(pkg).toContain(a)
  })

  it('las novedades de verdad tienen la versión de hoy en las dos lenguas', () => {
    const v = JSON.parse(fs.readFileSync('apps/paila/package.json', 'utf8')).version
    expect(nota('.', v)).toContain(`### ${v} `)
  })
})
