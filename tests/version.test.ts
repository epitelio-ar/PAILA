// Número de versión y novedades: PAILA y NAPIA van con el mismo número, docs/NOVEDADES.md tiene la entrada de la versión
// actual (Configuración la muestra en "Qué hay de nuevo") y `npm run version:subir` no sube sin esa entrada.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { negritas, novedadDe, novedades } from '@paila/shared/novedades'
// @ts-expect-error el script es .mjs sin tipos
import { comparar, subirVersion } from '../scripts/subir-version.mjs'

const RAIZ = path.join(__dirname, '..')
const leer = (f: string) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
const version = (f: string) => JSON.parse(leer(f)).version as string

describe('versión', () => {
  it('PAILA y NAPIA tienen el mismo número, y el lockfile también', () => {
    const v = version('apps/paila/package.json')
    expect(version('apps/napia/package.json')).toBe(v)
    const lock = JSON.parse(leer('package-lock.json'))
    expect([lock.packages['apps/paila'].version, lock.packages['apps/napia'].version]).toEqual([v, v])
  })

  it('docs/NOVEDADES.md tiene la entrada de la versión actual, con algo adentro', () => {
    const n = novedadDe(leer('docs/NOVEDADES.md'), version('apps/paila/package.json'))
    expect(n).not.toBeNull()
    expect(n!.renglones.length).toBeGreaterThan(0)
    expect(n!.titulo).not.toBe('')
  })

  it('docs/NOVEDADES.en.md tiene las mismas versiones, en el mismo orden y con la misma fecha (la app muestra la del idioma)', () => {
    const clave = (f: string) => novedades(leer(f)).map((n) => `${n.version} ${n.fecha}`)
    expect(clave('docs/NOVEDADES.en.md')).toEqual(clave('docs/NOVEDADES.md'))
    expect(novedades(leer('docs/NOVEDADES.en.md')).every((n) => n.titulo && n.renglones.length)).toBe(true)
  })

  it('las versiones de NOVEDADES van de la más nueva a la más vieja, sin repetir', () => {
    const vs = novedades(leer('docs/NOVEDADES.md')).map((n) => n.version)
    expect(new Set(vs).size).toBe(vs.length)
    for (let i = 1; i < vs.length; i++) expect(comparar(vs[i - 1], vs[i])).toBe(1)
  })
})

describe('novedades', () => {
  const md = '# Novedades\n\nIntro que no es de ninguna versión.\n<!-- nota -->\n\n## 1.1.0 · 2/11/2026: Más cosas\n\nUna frase.\n- **Uno:** algo\n  - detalle\n\n## 1.0.0 · 1/11/2026\n- primera\n'
  it('separa cada versión con su fecha, título, frases y puntos', () => {
    expect(novedades(md).map((n) => n.version)).toEqual(['1.1.0', '1.0.0'])
    expect(novedadDe(md, '1.1.0')).toEqual({ version: '1.1.0', fecha: '2/11/2026', titulo: 'Más cosas',
      renglones: [{ nivel: 0, texto: 'Una frase.' }, { nivel: 1, texto: '**Uno:** algo' }, { nivel: 2, texto: 'detalle' }] })
    expect(novedadDe(md, '1.0.0')?.titulo).toBe('')
    expect(novedadDe(md, '9.9.9')).toBeNull()
  })
  it('la negrita se separa del resto', () => {
    expect(negritas('**Uno:** algo')).toEqual([{ texto: 'Uno:', negrita: true }, { texto: ' algo', negrita: false }])
  })
})

describe('subir la versión', () => {
  function copia(v = '0.2.0') {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-version-'))
    for (const app of ['apps/paila', 'apps/napia']) {
      fs.mkdirSync(path.join(r, app), { recursive: true })
      fs.writeFileSync(path.join(r, app, 'package.json'), `{\n  "name": "x",\n  "version": "${v}",\n  "build": { "a": [ { "from": "b", "to": "c" } ] }\n}\n`)
    }
    fs.writeFileSync(path.join(r, 'package-lock.json'), JSON.stringify({ packages: { 'apps/paila': { version: v }, 'apps/napia': { version: v }, 'node_modules/x': { version: '7.0.0' } } }, null, 2) + '\n')
    fs.mkdirSync(path.join(r, 'docs'))
    fs.writeFileSync(path.join(r, 'docs', 'NOVEDADES.md'), `# Novedades\n\n## ${v} · 22/10/2026: antes\n- algo\n`)
    return r
  }

  it('sin la entrada en NOVEDADES no sube nada', () => {
    const r = copia()
    expect(() => subirVersion(r, '0.3.0')).toThrow(/Falta la entrada de 0\.3\.0/)
    expect(JSON.parse(fs.readFileSync(path.join(r, 'apps/paila/package.json'), 'utf8')).version).toBe('0.2.0')
  })

  it('con la entrada, sube las dos apps y el lockfile, sin tocar nada más', () => {
    const r = copia()
    const md = fs.readFileSync(path.join(r, 'docs', 'NOVEDADES.md'), 'utf8').replace('## 0.2.0', '## 0.3.0 · 1/11/2026: nuevo\n- otra\n\n## 0.2.0')
    fs.writeFileSync(path.join(r, 'docs', 'NOVEDADES.md'), md)
    subirVersion(r, '0.3.0')
    for (const app of ['apps/paila', 'apps/napia']) {
      expect(fs.readFileSync(path.join(r, app, 'package.json'), 'utf8')).toBe('{\n  "name": "x",\n  "version": "0.3.0",\n  "build": { "a": [ { "from": "b", "to": "c" } ] }\n}\n')
    }
    const lock = JSON.parse(fs.readFileSync(path.join(r, 'package-lock.json'), 'utf8'))
    expect([lock.packages['apps/paila'].version, lock.packages['apps/napia'].version, lock.packages['node_modules/x'].version]).toEqual(['0.3.0', '0.3.0', '7.0.0'])
  })

  it('no baja ni repite la versión, y pide el número bien escrito', () => {
    const r = copia()
    expect(() => subirVersion(r, '0.2.0')).toThrow(/mayor que la actual/)
    expect(() => subirVersion(r, '0.1.9')).toThrow(/mayor que la actual/)
    expect(() => subirVersion(r, 'v1')).toThrow(/Decime la versión nueva/)
    expect(comparar('0.10.0', '0.9.0')).toBe(1)
  })
})
